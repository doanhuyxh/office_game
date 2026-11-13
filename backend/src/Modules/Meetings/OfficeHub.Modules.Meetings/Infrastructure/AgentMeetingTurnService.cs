using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Meetings.Contracts;
using OfficeHub.Modules.Meetings.Domain;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Meetings.Infrastructure;

/// <summary>
/// Giữ lượt nói của phiên họp agent (TEST-75): mọi lần đổi lượt chạy trong giao dịch có khoá theo phòng (cùng khoá với lúc mở họp), quy tắc ở
/// <see cref="AgentMeetingTurnRules"/>. Sau khi ghi: đánh thức đúng bot vừa nhận lượt (Telegram <c>meeting_turn</c> + webhook <c>meeting.turn</c>),
/// phiên vừa kết thúc → tin hệ thống trong kênh phòng. Chat gọi qua <see cref="IAgentMeetingTurns"/>.
/// </summary>
internal sealed class AgentMeetingTurnService(MeetingsDbContext db, IMeetingRoomChannel channel, IEmployeeDirectory dir, ITelegramWakeup telegram,
    IWebhookPublisher webhooks, MeetingRooms rooms, TimeProvider clock, ILogger<AgentMeetingTurnService> log) : IAgentMeetingTurns
{
    public async Task<MeetingSpeakGate?> GateAsync(string roomId, Guid userId, CancellationToken ct = default)
    {
        var m = await db.AgentMeetings.AsNoTracking().Include(x => x.Bots)
            .FirstOrDefaultAsync(x => x.RoomId == roomId && x.Status == AgentMeetingStatus.Active, ct);
        if (m is null) return null;
        if (AgentMeetingRules.LimitReached(m, clock.GetUtcNow()) is not null)
        {
            // Quá trần mà job chưa kịp đóng → đóng luôn, phòng chat lại như thường
            await SweepAsync(m.Id, ct);
            return null;
        }
        var bot = m.Bots.FirstOrDefault(b => b.UserId == userId);
        return bot is null ? new(m.Id, false, null) : new(m.Id, true, AgentMeetingTurnRules.CanAct(m, bot.EmployeeId));
    }

    public async Task<IReadOnlyList<Guid>> OnMessageAsync(string roomId, Guid conversationId, Guid senderUserId, IReadOnlyList<Guid> mentionedUserIds,
        CancellationToken ct = default)
    {
        var id = await db.AgentMeetings.AsNoTracking().Where(x => x.RoomId == roomId && x.Status == AgentMeetingStatus.Active)
            .Select(x => (Guid?)x.Id).FirstOrDefaultAsync(ct);
        if (id is null) return [];
        var (m, change) = await ApplyAsync(id.Value, (m, now) =>
        {
            var mentioned = mentionedUserIds.Select(u => m.Bots.FirstOrDefault(b => b.UserId == u)?.EmployeeId).OfType<Guid>().ToList();
            var sender = m.Bots.FirstOrDefault(b => b.UserId == senderUserId);
            // Bot giữ lượt gửi hai tin sát nhau: tin sau lọt cổng trước khi tin đầu đổi lượt → không tính thêm (Spoke tự bỏ qua khi không giữ lượt)
            return sender is null ? AgentMeetingTurnRules.HumanSpoke(m, mentioned, now) : AgentMeetingTurnRules.Spoke(m, sender.EmployeeId, mentioned, now);
        }, ct);
        return m is not null && change.Next is { } next ? [m.Bots.First(b => b.EmployeeId == next).UserId] : [];
    }

    /// <summary>
    /// Đổi lượt phiên <paramref name="sessionId"/> dưới khoá theo phòng: nạp lại phiên (đang họp), áp <paramref name="apply"/>, lưu, rồi đánh thức /
    /// báo kết thúc. Phiên không tồn tại / đã kết thúc → (null, None).
    /// </summary>
    public async Task<(AgentMeeting? Meeting, TurnChange Change)> ApplyAsync(Guid sessionId, Func<AgentMeeting, DateTimeOffset, TurnChange> apply,
        CancellationToken ct)
    {
        var roomId = await db.AgentMeetings.AsNoTracking().Where(x => x.Id == sessionId).Select(x => x.RoomId).FirstOrDefaultAsync(ct);
        if (roomId is null) return (null, TurnChange.None);

        AgentMeeting? m;
        TurnChange change;
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await LockRoomAsync(db, roomId, ct);
            m = await db.AgentMeetings.Include(x => x.Bots).FirstOrDefaultAsync(x => x.Id == sessionId, ct);
            if (m is null || m.Status != AgentMeetingStatus.Active) return (m, TurnChange.None);
            if (db.Entry(m).State == EntityState.Unchanged) await db.Entry(m).ReloadAsync(ct); // đã nạp trước khoá trong cùng context → lấy bản mới
            change = apply(m, clock.GetUtcNow());
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        await AfterAsync(m, change, ct);
        return (m, change);
    }

    /// <summary>Job nền: phiên quá trần → kết thúc; bot giữ lượt quá giờ chờ → coi như bỏ lượt.</summary>
    public Task<(AgentMeeting? Meeting, TurnChange Change)> SweepAsync(Guid sessionId, CancellationToken ct) =>
        ApplyAsync(sessionId, (m, now) =>
        {
            if (AgentMeetingRules.LimitReached(m, now) is { } reason) { m.End(reason, now); return new(null, reason); }
            return AgentMeetingTurnRules.TimedOut(m, now) ? AgentMeetingTurnRules.Passed(m, m.CurrentSpeakerEmployeeId!.Value, now) : TurnChange.None;
        }, ct);

    /// <summary>Phiên vừa mở (đã lưu, lượt đầu thuộc bot chủ trì): cho bot dự họp vào kênh phòng rồi đánh thức bot chủ trì.</summary>
    public async Task OpenedAsync(AgentMeeting m, CancellationToken ct)
    {
        try { await channel.EnsureMembersAsync(m.RoomId, m.Bots.Select(b => b.UserId).ToList(), ct); }
        catch (Exception ex) when (!ct.IsCancellationRequested) { log.LogError(ex, "Không thêm được bot dự họp vào kênh phòng {Room}", m.RoomId); }
        await WakeAsync(m, m.ChairEmployeeId, ct);
    }

    /// <summary>Tin hệ thống báo kết thúc trong kênh phòng (người dừng, job, phiên quá hạn bị đóng khi mở phiên mới).</summary>
    public Task AnnounceEndAsync(AgentMeeting m, CancellationToken ct) => channel.PostSystemAsync(m.RoomId, AgentMeetingTurnRules.EndNotice(m), ct);

    private async Task AfterAsync(AgentMeeting m, TurnChange change, CancellationToken ct)
    {
        if (change.Next is { } next) await WakeAsync(m, next, ct);
        if (change.Ended is not null) await AnnounceEndAsync(m, ct);
    }

    /// <summary>Đánh thức đúng bot vừa nhận lượt: Telegram (chỉ tài khoản bot, lọc trong TelegramWakeup) + webhook cá nhân. Lỗi chỉ ghi log.</summary>
    private async Task WakeAsync(AgentMeeting m, Guid employeeId, CancellationToken ct)
    {
        try
        {
            var bot = m.Bots.FirstOrDefault(b => b.EmployeeId == employeeId);
            if (bot is null) return;
            var conversationId = await channel.ConversationIdAsync(m.RoomId, ct);
            if (conversationId is not { } conv) { log.LogWarning("Phòng {Room} chưa có kênh chat — không đánh thức bot họp", m.RoomId); return; }
            if (await dir.GetAsync(employeeId, ct) is { } emp)
                await telegram.MeetingTurnAsync(bot.UserId, emp.Code, m.Id, conv, ct);
            await webhooks.PublishAsync([bot.UserId], WebhookEvents.MeetingTurn, new
            {
                sessionId = m.Id, conversationId = conv, roomId = m.RoomId, roomName = rooms.Find(m.RoomId)?.Name ?? m.RoomId, topic = m.Topic,
                isChair = employeeId == m.ChairEmployeeId, turnsUsed = m.TurnsUsed, maxTurns = m.MaxTurns, turnDeadline = m.TurnDeadline,
                expiresAt = m.ExpiresAt, link = $"/chat?c={conv}",
            }, ct);
        }
        catch (Exception ex) when (!ct.IsCancellationRequested)
        {
            log.LogError(ex, "Không đánh thức được bot họp {Employee} (phiên {Session})", employeeId, m.Id);
        }
    }

    /// <summary>Khoá theo phòng trong giao dịch hiện tại — dùng chung với lúc mở họp (một phiên đang họp mỗi phòng).</summary>
    public static Task LockRoomAsync(MeetingsDbContext db, string roomId, CancellationToken ct) =>
        db.Database.ExecuteSqlInterpolatedAsync($"SELECT pg_advisory_xact_lock(hashtext({"meetings:agent:" + roomId}))", ct);
}
