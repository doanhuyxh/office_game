using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.BuildingBlocks.Storage;
using OfficeHub.Modules.Audit.Domain;

namespace OfficeHub.Modules.Audit.Infrastructure;

/// <summary>
/// Ghi / đọc transcript phiên agent (TEST-144). Nội dung: gzip (runner đã che bí mật) → base64 → <see cref="IFieldEncryptor.Encrypt"/>
/// (AES-256-GCM, khoá <c>Encryption__Key</c> như lương) → S3 <c>agent-transcripts/{userId}/{id}.enc</c>. Bản bàn giao cũng mã hoá.
/// Xoay khoá: file S3 không được mã hoá lại (job chỉ quét cột DB) — giữ khoá cũ trong <c>Encryption__PreviousKeys</c> ≥ 90 ngày (hạn lưu).
/// </summary>
public sealed class AgentTranscriptStore(AuditDbContext db, IFileStorage files, IFieldEncryptor crypto, TimeProvider clock)
{
    internal static string StorageKeyOf(Guid userId, Guid id) => $"agent-transcripts/{userId}/{id}.enc";

    internal static string Sha256Hex(byte[] data) => Convert.ToHexStringLower(SHA256.HashData(data));

    /// <summary>gzip → chuỗi đã mã hoá (nội dung file S3).</summary>
    internal static byte[] Seal(IFieldEncryptor crypto, byte[] gzip) => Encoding.UTF8.GetBytes(crypto.Encrypt(Convert.ToBase64String(gzip)));

    /// <summary>Nội dung file S3 → gzip. Ném <see cref="CryptographicException"/> nếu sai khoá / bị sửa.</summary>
    internal static byte[] Open(IFieldEncryptor crypto, byte[] sealedBytes) => Convert.FromBase64String(crypto.Decrypt(Encoding.UTF8.GetString(sealedBytes)));

    /// <summary>Ghi (thay) bản của (bot, key). Trả true nếu tạo mới.</summary>
    public async Task<(bool Created, AgentTranscript Row)> UpsertAsync(Guid userId, AgentTranscriptUpload u, byte[] gzip, CancellationToken ct)
    {
        var key = u.Key!.Trim();
        var now = clock.GetUtcNow();
        var row = await db.AgentTranscripts.FirstOrDefaultAsync(t => t.UserId == userId && t.Key == key, ct);
        var created = row is null;
        row ??= new AgentTranscript { UserId = userId, Key = key, CreatedAt = now };
        if (created) row.StorageKey = StorageKeyOf(userId, row.Id);
        row.Kind = u.Kind!;
        row.SessionId = u.SessionId!.Trim();
        row.Cwd = string.IsNullOrWhiteSpace(u.Cwd) ? null : u.Cwd;
        row.Branch = string.IsNullOrWhiteSpace(u.Branch) ? null : u.Branch;
        row.SummaryEncrypted = string.IsNullOrWhiteSpace(u.Summary) ? null : crypto.Encrypt(u.Summary.Trim());
        row.Sha256 = Sha256Hex(gzip);
        row.SizeBytes = gzip.Length;
        row.UpdatedAt = now;
        row.ExpiresAt = now.AddDays(AgentTranscriptRoute.RetentionDays);

        using (var body = new MemoryStream(Seal(crypto, gzip)))
            await files.UploadAsync(row.StorageKey, body, "application/octet-stream", ct);
        if (created) db.AgentTranscripts.Add(row);
        try { await db.SaveChangesAsync(ct); }
        catch (DbUpdateException) when (created)
        {
            // Hai lần gửi cùng (bot, key) đồng thời → bản kia đã tạo dòng; bỏ file mồ côi của lần này, báo lỗi để runner gửi lại (thành cập nhật).
            await files.DeleteAsync(row.StorageKey, CancellationToken.None);
            throw;
        }
        return (created, row);
    }

    /// <summary>Bản còn hạn của (bot, key) kèm nội dung gzip; null = không có.</summary>
    public async Task<(AgentTranscript Row, byte[] Gzip)?> ReadAsync(Guid userId, string key, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var row = await db.AgentTranscripts.AsNoTracking().FirstOrDefaultAsync(t => t.UserId == userId && t.Key == key.Trim() && t.ExpiresAt > now, ct);
        return row is null ? null : (row, await ContentAsync(row, ct));
    }

    public async Task<byte[]> ContentAsync(AgentTranscript row, CancellationToken ct)
    {
        using var s = await files.OpenReadAsync(row.StorageKey, ct);
        return Open(crypto, s.ToArray());
    }

    public string? Summary(AgentTranscript row) => row.SummaryEncrypted is { } enc ? crypto.Decrypt(enc) : null;

    /// <summary>Xoá bản hết hạn (file S3 trước, rồi dòng). Trả số bản đã xoá.</summary>
    public async Task<int> DeleteExpiredAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var expired = await db.AgentTranscripts.Where(t => t.ExpiresAt <= now).OrderBy(t => t.ExpiresAt).Take(500).ToListAsync(ct);
        foreach (var t in expired) await files.DeleteAsync(t.StorageKey, ct);
        db.AgentTranscripts.RemoveRange(expired);
        await db.SaveChangesAsync(ct);
        return expired.Count;
    }
}
