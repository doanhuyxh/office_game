using System.Security.Claims;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Meetings.Domain;
using OfficeHub.Modules.Meetings.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Meetings.Features;

public sealed record OpenAgentMeetingRequest(string RoomId, string Topic, Guid ChairEmployeeId, Guid[]? BotIds);
public sealed record AssignTurnRequest(Guid EmployeeId);
/// <param name="IsSpeaking">Đang giữ lượt nói.</param>
/// <param name="QueuePosition">Thứ tự trong hàng chờ lượt (1 = kế tiếp), null = không chờ.</param>
public sealed record AgentMeetingBotDto(Guid EmployeeId, string Name, bool IsChair, bool IsSpeaking = false, int? QueuePosition = null);
/// <param name="CurrentSpeakerEmployeeId">Bot đang giữ lượt (TEST-75); <paramref name="TurnDeadline"/> = quá giờ này chưa nói → coi như bỏ lượt.</param>
/// <param name="IsMyTurn">Người gọi (token bot) đang giữ lượt.</param>
public sealed record AgentMeetingDto(Guid Id, string RoomId, string RoomName, string Topic, AgentMeetingStatus Status, AgentMeetingEndReason? EndReason,
    Guid OpenedByEmployeeId, string OpenedByName, Guid ChairEmployeeId, IReadOnlyList<AgentMeetingBotDto> Bots, int TurnsUsed, int MaxTurns, int MaxMinutes,
    DateTimeOffset StartedAt, DateTimeOffset ExpiresAt, DateTimeOffset? EndedAt, string? EndedByName, bool CanStop,
    Guid? CurrentSpeakerEmployeeId = null, DateTimeOffset? TurnDeadline = null, bool IsMyTurn = false);

/// <param name="IsDefault">Chưa ai chỉnh — đang dùng giá trị mặc định.</param>
public sealed record AgentMeetingSettingsDto(int MaxTurns, int MaxMinutes, bool IsDefault, DateTimeOffset? UpdatedAt, string? UpdatedByName,
    int DefaultMaxTurns, int DefaultMaxMinutes, int TurnsMin, int TurnsMax, int MinutesMin, int MinutesMax);
public sealed record UpdateAgentMeetingSettings(int MaxTurns, int MaxMinutes);

/// <summary>
/// Phiên họp agent (TEST-74): người thật mở / dừng, bot chỉ xem phiên mình dự. Mở / dừng / cài đặt KHÔNG nằm trong allowlist token AI
/// (<c>AccessTokenAuth</c>) và còn tự trả 403 cho token AI — bot không tự mở họp hay nới trần.
/// </summary>
internal static class AgentMeetingEndpoints
{
    private const string AiForbidden = "Chỉ người thật mở / dừng cuộc họp agent trên web";

    public static void Map(RouteGroupBuilder g)
    {
        var s = g.MapGroup("/sessions");
        s.MapGet("", ListAsync);
        s.MapGet("/{id:guid}", GetAsync);
        s.MapPost("", OpenAsync);
        s.MapPost("/{id:guid}/stop", StopAsync);
        s.MapPost("/{id:guid}/pass", PassAsync);     // TEST-75: bot giữ lượt bỏ lượt
        s.MapPost("/{id:guid}/assign", AssignAsync); // TEST-75: bot chủ trì (đang giữ lượt) chỉ định người nói kế

        var cfg = g.MapGroup("/agent-settings").RequireAuthorization(AuthPolicies.Admin);
        cfg.MapGet("", GetSettingsAsync);
        cfg.MapPut("", UpdateSettingsAsync);
    }

    private static async Task<EmployeeRef?> MeAsync(ClaimsPrincipal user, IEmployeeDirectory dir, CancellationToken ct) =>
        user.GetUserId() is { } uid ? await dir.GetByUserIdAsync(uid, ct) : null;

    private static AgentMeetingDto ToDto(AgentMeeting m, MeetingRooms rooms, Guid? meEmployeeId, ClaimsPrincipal user) =>
        new(m.Id, m.RoomId, rooms.Find(m.RoomId)?.Name ?? m.RoomId, m.Topic, m.Status, m.EndReason, m.OpenedByEmployeeId, m.OpenedByName,
            m.ChairEmployeeId,
            m.Bots.OrderByDescending(b => b.EmployeeId == m.ChairEmployeeId).ThenBy(b => b.Name)
                .Select(b => new AgentMeetingBotDto(b.EmployeeId, b.Name, b.EmployeeId == m.ChairEmployeeId, b.EmployeeId == m.CurrentSpeakerEmployeeId,
                    m.QueuedSpeakerIds.IndexOf(b.EmployeeId) is >= 0 and var i ? i + 1 : null)).ToList(),
            m.TurnsUsed, m.MaxTurns, m.MaxMinutes, m.StartedAt, m.ExpiresAt, m.EndedAt, m.EndedByName,
            CanStop: m.Status == AgentMeetingStatus.Active && !user.IsAccessToken() && (m.OpenedByEmployeeId == meEmployeeId || user.IsHr()),
            m.CurrentSpeakerEmployeeId, m.TurnDeadline,
            IsMyTurn: meEmployeeId is { } me && m.CurrentSpeakerEmployeeId == me);

    /// <summary>Token AI chỉ thấy phiên mình là bot dự; người thật (cookie) thấy mọi phiên.</summary>
    private static IQueryable<AgentMeeting> Visible(IQueryable<AgentMeeting> q, ClaimsPrincipal user)
    {
        if (!user.IsAccessToken()) return q;
        var uid = user.GetUserId() ?? Guid.Empty;
        return q.Where(m => m.Bots.Any(b => b.UserId == uid));
    }

    /// <summary>roomId, active=true để lọc; mới nhất trước, tối đa 50.</summary>
    private static async Task<Ok<List<AgentMeetingDto>>> ListAsync(string? roomId, bool? active, ClaimsPrincipal user, MeetingsDbContext db,
        MeetingRooms rooms, IEmployeeDirectory dir, CancellationToken ct)
    {
        var q = Visible(db.AgentMeetings.AsNoTracking().Include(m => m.Bots), user);
        if (!string.IsNullOrWhiteSpace(roomId)) q = q.Where(m => m.RoomId == roomId);
        if (active == true) q = q.Where(m => m.Status == AgentMeetingStatus.Active);
        var rows = await q.OrderByDescending(m => m.StartedAt).Take(50).ToListAsync(ct);
        var me = await MeAsync(user, dir, ct);
        return TypedResults.Ok(rows.Select(m => ToDto(m, rooms, me?.Id, user)).ToList());
    }

    private static async Task<Results<Ok<AgentMeetingDto>, NotFound>> GetAsync(Guid id, ClaimsPrincipal user, MeetingsDbContext db, MeetingRooms rooms,
        IEmployeeDirectory dir, CancellationToken ct)
    {
        var m = await Visible(db.AgentMeetings.AsNoTracking().Include(x => x.Bots), user).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (m is null) return TypedResults.NotFound();
        var me = await MeAsync(user, dir, ct);
        return TypedResults.Ok(ToDto(m, rooms, me?.Id, user));
    }

    private static async Task<Results<Ok<AgentMeetingDto>, ValidationProblem, ProblemHttpResult>> OpenAsync(OpenAgentMeetingRequest req,
        ClaimsPrincipal user, MeetingsDbContext db, MeetingRooms rooms, IEmployeeDirectory dir, IAccountService accounts, AgentMeetingTurnService turns,
        TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.Problem(AiForbidden, statusCode: StatusCodes.Status403Forbidden);
        if (await MeAsync(user, dir, ct) is not { } me)
            return TypedResults.Problem("Tài khoản chưa gắn hồ sơ nhân viên nên chưa mở họp được. Liên hệ HR.", statusCode: StatusCodes.Status409Conflict);
        if ((await accounts.GetAsync(me.UserId!.Value, ct))?.IsBot == true)
            return TypedResults.Problem(AiForbidden, statusCode: StatusCodes.Status403Forbidden);

        var room = rooms.Find(req.RoomId);
        var botIds = (req.BotIds ?? []).Distinct().ToList();
        var lookup = new Dictionary<Guid, BotCandidate>();
        if (botIds.Count <= AgentMeetingRules.MaxBots)
        {
            var emps = new List<EmployeeRef>();
            foreach (var id in botIds)
                if (await dir.GetAsync(id, ct) is { } e) emps.Add(e);
            var accs = await accounts.GetManyAsync(emps.Where(e => e.UserId is not null).Select(e => e.UserId!.Value).ToList(), ct);
            foreach (var e in emps)
            {
                var acc = e.UserId is { } u ? accs.GetValueOrDefault(u) : null;
                lookup[e.Id] = new BotCandidate(e.Id, e.FullName, e.UserId, e.IsActive && acc?.IsActive == true, acc?.IsBot == true);
            }
        }
        var v = new Validation().When(room is null, "roomId", "Phòng họp không tồn tại");
        foreach (var (field, msg) in AgentMeetingRules.ValidateOpen(req.Topic, req.ChairEmployeeId, botIds, lookup)) v.Add(field, msg);
        if (v.Failed) return v.Problem();

        var now = clock.GetUtcNow();
        var (maxTurns, maxMinutes) = await db.AgentMeetingLimitsAsync(ct);
        var meeting = new AgentMeeting
        {
            RoomId = room!.Id,
            Topic = req.Topic.Trim(),
            OpenedByEmployeeId = me.Id,
            OpenedByUserId = me.UserId!.Value,
            OpenedByName = me.FullName,
            ChairEmployeeId = req.ChairEmployeeId,
            MaxTurns = maxTurns,
            MaxMinutes = maxMinutes,
            StartedAt = now,
            Bots = botIds.Select(id => lookup[id]).Select(c => new AgentMeetingBot { EmployeeId = c.EmployeeId, UserId = c.UserId!.Value, Name = c.Name }).ToList(),
        };
        AgentMeetingTurnRules.Start(meeting, now); // lượt đầu thuộc bot chủ trì
        AgentMeeting? stale = null;

        // Khoá theo phòng: hai người mở cùng lúc không cùng lọt qua bước kiểm tra (index unique một phần là chốt chặn cuối).
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            await AgentMeetingTurnService.LockRoomAsync(db, room.Id, ct);
            var running = await db.AgentMeetings.Where(m => m.RoomId == room.Id && m.Status == AgentMeetingStatus.Active).FirstOrDefaultAsync(ct);
            if (running is not null && AgentMeetingRules.LimitReached(running, now) is { } reason)
                (stale = running).End(reason, now); // phiên quá hạn job chưa kịp đóng → đóng luôn rồi mở phiên mới
            else if (running is not null)
                return TypedResults.Problem($"{room.Name} đang có cuộc họp agent \"{running.Topic}\" do {running.OpenedByName} mở",
                    statusCode: StatusCodes.Status409Conflict);
            db.AgentMeetings.Add(meeting);
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
        }
        if (stale is not null) await turns.AnnounceEndAsync(stale, ct);
        await turns.OpenedAsync(meeting, ct); // bot dự họp vào kênh phòng + đánh thức bot chủ trì (meeting_turn)
        return TypedResults.Ok(ToDto(meeting, rooms, me.Id, user));
    }

    /// <summary>Người mở hoặc HR / admin; phiên đã kết thúc → 409.</summary>
    private static async Task<Results<Ok<AgentMeetingDto>, NotFound, ProblemHttpResult>> StopAsync(Guid id, ClaimsPrincipal user, MeetingsDbContext db,
        MeetingRooms rooms, IEmployeeDirectory dir, AgentMeetingTurnService turns, TimeProvider clock, CancellationToken ct)
    {
        if (user.IsAccessToken()) return TypedResults.Problem(AiForbidden, statusCode: StatusCodes.Status403Forbidden);
        var m = await db.AgentMeetings.Include(x => x.Bots).FirstOrDefaultAsync(x => x.Id == id, ct);
        if (m is null) return TypedResults.NotFound();
        var me = await MeAsync(user, dir, ct);
        if (m.OpenedByEmployeeId != me?.Id && !user.IsHr())
            return TypedResults.Problem("Chỉ người mở cuộc họp hoặc HR / admin được dừng", statusCode: StatusCodes.Status403Forbidden);
        if (m.Status != AgentMeetingStatus.Active) return TypedResults.Problem("Cuộc họp đã kết thúc", statusCode: StatusCodes.Status409Conflict);
        var byName = me?.FullName ?? user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
        var (ended, change) = await turns.ApplyAsync(m.Id, (x, now) =>
        {
            x.End(AgentMeetingEndReason.Stopped, now, byName);
            return new TurnChange(null, AgentMeetingEndReason.Stopped); // → tin hệ thống trong kênh phòng
        }, ct);
        // Vừa hết trần / hết lượt cùng lúc → ApplyAsync không chạy (phiên đã kết thúc)
        if (ended is null || change.Ended is null) return TypedResults.Problem("Cuộc họp đã kết thúc", statusCode: StatusCodes.Status409Conflict);
        return TypedResults.Ok(ToDto(ended, rooms, me?.Id, user));
    }

    /// <summary>Bot dự họp của người gọi (theo tài khoản) trong phiên — null = không dự (404, không lộ phiên).</summary>
    private static async Task<(AgentMeeting? M, AgentMeetingBot? Me)> MySessionAsync(Guid id, ClaimsPrincipal user, MeetingsDbContext db, CancellationToken ct)
    {
        var uid = user.GetUserId() ?? Guid.Empty;
        var m = await db.AgentMeetings.AsNoTracking().Include(x => x.Bots).FirstOrDefaultAsync(x => x.Id == id, ct);
        return (m, m?.Bots.FirstOrDefault(b => b.UserId == uid));
    }

    /// <summary>
    /// Bot giữ lượt bỏ lượt (TEST-75): lượt sang bot kế trong hàng chờ, hết hàng → bot chủ trì; bot chủ trì bỏ lượt khi không còn ai chờ → kết thúc (AllPassed).
    /// Không giữ lượt → 409. Tính 1 lượt.
    /// </summary>
    private static async Task<Results<Ok<AgentMeetingDto>, NotFound, ProblemHttpResult>> PassAsync(Guid id, ClaimsPrincipal user, MeetingsDbContext db,
        MeetingRooms rooms, AgentMeetingTurnService turns, CancellationToken ct)
    {
        var (m, bot) = await MySessionAsync(id, user, db, ct);
        if (m is null || bot is null) return TypedResults.NotFound();
        string? error = "Cuộc họp đã kết thúc"; // ApplyAsync không gọi hàm khi phiên đã kết thúc
        var (after, _) = await turns.ApplyAsync(id, (x, now) =>
            (error = AgentMeetingTurnRules.CanAct(x, bot.EmployeeId)) is null ? AgentMeetingTurnRules.Passed(x, bot.EmployeeId, now) : TurnChange.None, ct);
        if (after is null) return TypedResults.NotFound();
        if (error is not null) return TypedResults.Problem(error, statusCode: StatusCodes.Status409Conflict);
        return TypedResults.Ok(ToDto(after, rooms, bot.EmployeeId, user));
    }

    /// <summary>Bot chủ trì đang giữ lượt chỉ định bot dự họp khác nói kế (TEST-75) — như @nhắc trong tin nhưng không cần nói. Tính 1 lượt.</summary>
    private static async Task<Results<Ok<AgentMeetingDto>, NotFound, ProblemHttpResult>> AssignAsync(Guid id, AssignTurnRequest req, ClaimsPrincipal user,
        MeetingsDbContext db, MeetingRooms rooms, AgentMeetingTurnService turns, CancellationToken ct)
    {
        var (m, bot) = await MySessionAsync(id, user, db, ct);
        if (m is null || bot is null) return TypedResults.NotFound();
        string? error = "Cuộc họp đã kết thúc";
        var (after, _) = await turns.ApplyAsync(id, (x, now) =>
            (error = AgentMeetingTurnRules.CanAssign(x, bot.EmployeeId, req.EmployeeId)) is null ? AgentMeetingTurnRules.Assigned(x, req.EmployeeId, now) : TurnChange.None, ct);
        if (after is null) return TypedResults.NotFound();
        if (error is not null) return TypedResults.Problem(error, statusCode: StatusCodes.Status409Conflict);
        return TypedResults.Ok(ToDto(after, rooms, bot.EmployeeId, user));
    }

    private static AgentMeetingSettingsDto SettingsDto(AgentMeetingSettings? row) =>
        new(row?.MaxTurns ?? AgentMeetingRules.DefaultMaxTurns, row?.MaxMinutes ?? AgentMeetingRules.DefaultMaxMinutes, row is null, row?.UpdatedAt,
            row?.UpdatedByName, AgentMeetingRules.DefaultMaxTurns, AgentMeetingRules.DefaultMaxMinutes, AgentMeetingRules.TurnsMin,
            AgentMeetingRules.TurnsMax, AgentMeetingRules.MinutesMin, AgentMeetingRules.MinutesMax);

    private static async Task<Ok<AgentMeetingSettingsDto>> GetSettingsAsync(MeetingsDbContext db, CancellationToken ct) =>
        TypedResults.Ok(SettingsDto(await db.AgentMeetingSettings.AsNoTracking().FirstOrDefaultAsync(x => x.Id == AgentMeetingSettings.SingletonId, ct)));

    /// <summary>Áp dụng cho phiên mở sau đó; phiên đang họp giữ trần đã chụp lúc mở.</summary>
    private static async Task<Results<Ok<AgentMeetingSettingsDto>, ValidationProblem>> UpdateSettingsAsync(UpdateAgentMeetingSettings r,
        ClaimsPrincipal user, MeetingsDbContext db, TimeProvider clock, CancellationToken ct)
    {
        var errors = AgentMeetingRules.ValidateLimits(r.MaxTurns, r.MaxMinutes);
        if (errors.Count > 0)
        {
            var val = new Validation();
            foreach (var (field, msg) in errors) val.Add(field, msg);
            return val.Problem();
        }
        var row = await db.AgentMeetingSettings.FirstOrDefaultAsync(x => x.Id == AgentMeetingSettings.SingletonId, ct);
        if (row is null) db.AgentMeetingSettings.Add(row = new AgentMeetingSettings());
        if (row.MaxTurns != r.MaxTurns || row.MaxMinutes != r.MaxMinutes || db.Entry(row).State == EntityState.Added)
        {
            row.MaxTurns = r.MaxTurns;
            row.MaxMinutes = r.MaxMinutes;
            row.UpdatedAt = clock.GetUtcNow();
            row.UpdatedByName = user.FindFirstValue(ClaimNames.FullName) ?? user.Identity?.Name;
            await db.SaveChangesAsync(ct);
        }
        return TypedResults.Ok(SettingsDto(row));
    }
}
