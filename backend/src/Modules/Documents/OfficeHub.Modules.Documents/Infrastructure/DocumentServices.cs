using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Approval.Contracts;
using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Identity.Contracts;
using OfficeHub.Modules.Notification.Contracts;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Infrastructure;

/// <summary>
/// Kết quả duyệt ban hành (idempotent: chỉ đổi khi tài liệu còn PendingApproval). Duyệt → cấp số hiệu {stt}/{năm}/{loại}-{kho},
/// ngày ban hành, tính lại hạn lưu trữ từ ngày ban hành. Từ chối / huỷ → về Nháp (giữ lý do từ chối).
/// </summary>
internal sealed class DocumentPublishHandler(DocumentsDbContext db, DocumentAccess access, DocClock clock) : IApprovalHandler
{
    public string Type => ApprovalTypes.DocumentPublish;

    public async Task OnApprovedAsync(Guid subjectId, CancellationToken ct)
    {
        var a = await db.Assets.FirstOrDefaultAsync(x => x.Id == subjectId, ct);
        if (a is null || a.Status != AssetStatus.PendingApproval) return;
        var type = await db.DocTypes.FirstAsync(t => t.Id == a.DocTypeId, ct);
        var space = await access.SpaceAsync(a.SpaceKind, a.SpaceId, ct);
        var spaceCode = space?.Code ?? DocumentRules.SpaceCode(a.SpaceKind, null);
        var today = clock.Today;
        var seq = await db.NextAsync($"pub:{type.Code}:{spaceCode}:{today.Year}", ct);
        a.DocumentNumber = DocumentRules.DocumentNumber(seq, today.Year, type.Code, spaceCode);
        a.Status = AssetStatus.Published;
        a.PublishedAt = clock.Now;
        a.RejectReason = null;
        a.RetentionUntil = DocumentRules.RetentionUntil(today, type.RetentionYears);
        a.RetentionNotifiedAt = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
    }

    public Task OnRejectedAsync(Guid subjectId, string? comment, CancellationToken ct) => BackToDraftAsync(subjectId, comment, ct);
    public Task OnCancelledAsync(Guid subjectId, CancellationToken ct) => BackToDraftAsync(subjectId, null, ct);

    private async Task BackToDraftAsync(Guid id, string? reason, CancellationToken ct)
    {
        var a = await db.Assets.FirstOrDefaultAsync(x => x.Id == id, ct);
        if (a is null || a.Status != AssetStatus.PendingApproval) return;
        a.Status = AssetStatus.Draft;
        a.RejectReason = reason;
        a.ApprovalRequestId = null;
        a.UpdatedAt = clock.Now;
        await db.SaveChangesAsync(ct);
    }
}

/// <summary>
/// Mỗi giờ: (1) nhắc HR + người phụ trách tài liệu sắp hết hạn lưu trữ (≤ 30 ngày, một lần); (2) xoá hẳn tài liệu nằm thùng rác quá 30 ngày
/// (file S3 + hồ sơ); (3) dọn vé tải lên quá 24 giờ chưa đăng ký (xoá file rác trên S3). Chỉ chạy ở host Api, giả định một instance.
/// </summary>
internal sealed class DocumentsMaintenanceJob(IServiceScopeFactory scopes, ILogger<DocumentsMaintenanceJob> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stop)
    {
        await Task.Delay(TimeSpan.FromSeconds(45), stop);
        using var timer = new PeriodicTimer(TimeSpan.FromHours(1));
        do
        {
            try { await RunOnceAsync(stop); }
            catch (Exception ex) when (!stop.IsCancellationRequested) { log.LogError(ex, "Lỗi khi bảo trì kho tài liệu"); }
        } while (await timer.WaitForNextTickAsync(stop));
    }

    internal async Task RunOnceAsync(CancellationToken ct)
    {
        using var scope = scopes.CreateScope();
        var sp = scope.ServiceProvider;
        var db = sp.GetRequiredService<DocumentsDbContext>();
        var clock = sp.GetRequiredService<DocClock>();
        var files = sp.GetRequiredService<IFileStorage>();

        // (1) Hạn lưu trữ
        var horizon = clock.Today.AddDays(DocumentRules.RetentionNoticeDays);
        var due = await db.Assets.Where(a => a.DeletedAt == null && a.DestroyedAt == null && a.RetentionUntil != null
                                             && a.RetentionUntil <= horizon && a.RetentionNotifiedAt == null).Take(200).ToListAsync(ct);
        if (due.Count > 0)
        {
            var accounts = sp.GetRequiredService<IAccountService>();
            var dir = sp.GetRequiredService<IEmployeeDirectory>();
            var notifier = sp.GetRequiredService<INotifier>();
            var hr = await accounts.ListByRoleAsync(Roles.Hr, ct);
            if (hr.Count == 0) hr = await accounts.ListByRoleAsync(Roles.Admin, ct);
            foreach (var a in due)
            {
                var to = hr.Select(x => x.Id).ToList();
                if (a.CustodianEmployeeId is { } cid && (await dir.GetAsync(cid, ct)) is { IsActive: true, UserId: { } cu }) to.Add(cu);
                var left = a.RetentionUntil!.Value.DayNumber - clock.Today.DayNumber;
                await notifier.NotifyAsync(new NotificationRequest(to, NotificationCategories.DocumentRetention,
                    $"Tài liệu {a.Code} {(left <= 0 ? "đã hết" : $"còn {left} ngày là hết")} hạn lưu trữ",
                    $"{a.Title}\nHạn lưu trữ: {a.RetentionUntil:dd/MM/yyyy}. Xem xét gia hạn hoặc huỷ tại Tài liệu → Quản trị.",
                    $"/documents?asset={a.Id}"), ct);
                a.RetentionNotifiedAt = clock.Now;
            }
            await db.SaveChangesAsync(ct);
            log.LogInformation("Đã nhắc {Count} tài liệu sắp hết hạn lưu trữ", due.Count);
        }

        // (2) Thùng rác quá hạn
        var cutoff = clock.Now.AddDays(-DocumentRules.TrashDays);
        var trash = await db.Assets.Include(a => a.Versions).Where(a => a.DeletedAt != null && a.DeletedAt < cutoff).Take(100).ToListAsync(ct);
        foreach (var a in trash)
        {
            foreach (var v in a.Versions.Where(v => v.FileKey is not null)) await files.DeleteAsync(v.FileKey!, ct);
            db.Assets.Remove(a);
        }
        if (trash.Count > 0) { await db.SaveChangesAsync(ct); log.LogInformation("Đã xoá hẳn {Count} tài liệu trong thùng rác", trash.Count); }

        // (3) Vé tải lên bỏ dở
        var stale = clock.Now - DocumentRules.TicketCleanupAfter;
        var tickets = await db.UploadTickets.Where(t => t.CreatedAt < stale).Take(200).ToListAsync(ct);
        foreach (var t in tickets) await files.DeleteAsync(t.FileKey, ct); // S3 xoá key không tồn tại vẫn thành công
        if (tickets.Count > 0) { db.UploadTickets.RemoveRange(tickets); await db.SaveChangesAsync(ct); }
    }
}
