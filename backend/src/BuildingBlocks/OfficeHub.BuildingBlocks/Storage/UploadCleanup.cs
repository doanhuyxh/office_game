using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;

namespace OfficeHub.BuildingBlocks.Storage;

/// <summary>
/// Dọn vé tải lên bỏ dở (đã xin presigned PUT nhưng không bao giờ gắn vào tin / bài): xoá file trên S3 — cả key chính lẫn key tạm
/// (<see cref="S3FileStorage.StagingPrefix"/>) — rồi xoá dòng vé. Mỗi lần tối đa <paramref name="batch"/> vé để không làm chậm request.
/// Xoá key không tồn tại trên S3 vẫn thành công; lỗi S3 → giữ vé lại cho lần sau.
/// </summary>
public static class UploadCleanup
{
    public static async Task<int> PurgeAsync<T>(DbSet<T> tickets, Expression<Func<T, bool>> stale, Func<T, string> keyOf, IFileStorage files,
        DbContext db, CancellationToken ct, int batch = 20) where T : class
    {
        var rows = await tickets.Where(stale).Take(batch).ToListAsync(ct);
        var done = new List<T>();
        foreach (var t in rows)
        {
            try
            {
                await files.DeleteAsync(keyOf(t), ct);
                await files.DeleteAsync(S3FileStorage.StagingPrefix + keyOf(t), ct);
                done.Add(t);
            }
            catch (Exception) when (!ct.IsCancellationRequested) { /* S3 lỗi tạm → lần sau dọn tiếp */ }
        }
        if (done.Count == 0) return 0;
        tickets.RemoveRange(done);
        await db.SaveChangesAsync(ct);
        return done.Count;
    }
}
