using Amazon;
using Amazon.S3;
using Amazon.S3.Model;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.BuildingBlocks.Storage;

/// <summary>
/// Lưu file nghiệp vụ (hợp đồng, CCCD, avatar) trên S3. Chỉ đọc qua presigned URL.
/// <paramref name="key"/> là đường dẫn tương đối (ví dụ "contracts/2026/abc.pdf");
/// tiền tố {S3__KeyPrefix}files/ được thêm tự động để không lẫn với dữ liệu khác trong bucket.
/// </summary>
public interface IFileStorage
{
    Task UploadAsync(string key, Stream content, string contentType, CancellationToken ct = default);
    Task<string> GetDownloadUrlAsync(string key, TimeSpan? ttl = null);
    Task DeleteAsync(string key, CancellationToken ct = default);
    /// <summary>Đọc file vào bộ nhớ (stream seek được) — chỉ cho file nhỏ xử lý phía server (vd mẫu hợp đồng .docx).</summary>
    Task<MemoryStream> OpenReadAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Presigned PUT để trình duyệt tải file thẳng lên S3 (không đi qua Api; tối đa 5 GB / lần PUT). Trình duyệt phải gửi đúng
    /// header <c>Content-Type</c> = <paramref name="contentType"/>. Bucket cần CORS cho PUT từ domain app.
    /// URL trỏ vào key TẠM (<see cref="StagingPrefix"/> + <paramref name="key"/>), KHÔNG phải <paramref name="key"/>: sau khi xác nhận
    /// (<see cref="PromoteUploadAsync"/>) server chép sang key chính — link PUT còn hạn không còn thay được file đã xác nhận (TEST-13).
    /// </summary>
    Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan ttl);

    /// <summary>Kích thước file trên S3 (HEAD); null nếu chưa có.</summary>
    Task<long?> GetSizeAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Xác nhận file trình duyệt vừa PUT qua <see cref="GetUploadUrlAsync"/>: chép key tạm → <paramref name="key"/> (MIME theo đuôi
    /// <paramref name="fileName"/>), xoá key tạm, rồi kiểm kích thước + chữ ký đầu file trên BẢN ĐÃ CHÉP (không đổi được nữa).
    /// Chữ ký không khớp đuôi → xoá file, trả lỗi. Chưa tải lên → Size null. Gọi lại sau khi đã chép → kiểm bản chính.
    /// </summary>
    Task<UploadCheck> PromoteUploadAsync(string key, string fileName, CancellationToken ct = default);

    /// <summary>
    /// Presigned GET kèm tên file. MIME ép theo đuôi <paramref name="fileName"/> (<see cref="FileTypes"/>); <paramref name="inline"/> chỉ có tác dụng
    /// với loại an toàn (ảnh raster, PDF, video, âm thanh) — SVG / HTML / văn bản luôn tải về.
    /// </summary>
    Task<string> GetDownloadUrlAsync(string key, string fileName, bool inline, TimeSpan? ttl = null);
}

/// <summary>Kết quả xác nhận tải lên: <c>Size</c> null + <c>Error</c> null = chưa tải lên; <c>Error</c> = nội dung không hợp lệ (file đã bị xoá).</summary>
public sealed record UploadCheck(long? Size, string? Error = null);

public sealed class S3FileStorage(IAmazonS3 s3, IOptions<S3Settings> options, TimeProvider clock) : IFileStorage
{
    /// <summary>Thư mục key tạm cho PUT từ trình duyệt (nên đặt lifecycle S3 xoá sau 1–2 ngày: file tải lên rồi bỏ dở).</summary>
    public const string StagingPrefix = "uploads/";
    private readonly S3Settings _cfg = options.Value;
    private ServerSideEncryptionMethod? Sse => string.IsNullOrEmpty(_cfg.ServiceUrl) ? ServerSideEncryptionMethod.AES256 : null;

    public Task UploadAsync(string key, Stream content, string contentType, CancellationToken ct = default) =>
        s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(key),
            InputStream = content,
            ContentType = contentType,
            ServerSideEncryptionMethod = Sse,
        }, ct);

    public Task<string> GetDownloadUrlAsync(string key, TimeSpan? ttl = null) =>
        s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(key),
            Verb = HttpVerb.GET,
            Expires = clock.GetUtcNow().UtcDateTime.Add(ttl ?? TimeSpan.FromMinutes(_cfg.PresignMinutes)),
        });

    public Task DeleteAsync(string key, CancellationToken ct = default) =>
        s3.DeleteObjectAsync(_cfg.BucketFiles, FullKey(key), ct);

    public async Task<MemoryStream> OpenReadAsync(string key, CancellationToken ct = default)
    {
        using var res = await s3.GetObjectAsync(_cfg.BucketFiles, FullKey(key), ct);
        var ms = new MemoryStream();
        await res.ResponseStream.CopyToAsync(ms, ct);
        ms.Position = 0;
        return ms;
    }

    public Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan ttl) =>
        s3.GetPreSignedURLAsync(new GetPreSignedUrlRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(StagingPrefix + key.TrimStart('/')),
            Verb = HttpVerb.PUT,
            ContentType = contentType,
            Expires = clock.GetUtcNow().UtcDateTime.Add(ttl),
        });

    public async Task<long?> GetSizeAsync(string key, CancellationToken ct = default)
    {
        try
        {
            var meta = await s3.GetObjectMetadataAsync(_cfg.BucketFiles, FullKey(key), ct);
            return meta.ContentLength;
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            return null;
        }
    }

    public async Task<UploadCheck> PromoteUploadAsync(string key, string fileName, CancellationToken ct = default)
    {
        var final = FullKey(key);
        try
        {
            await s3.CopyObjectAsync(new CopyObjectRequest
            {
                SourceBucket = _cfg.BucketFiles, SourceKey = FullKey(StagingPrefix + key.TrimStart('/')),
                DestinationBucket = _cfg.BucketFiles, DestinationKey = final,
                ContentType = FileTypes.ContentTypeFor(fileName), MetadataDirective = S3MetadataDirective.REPLACE,
                ServerSideEncryptionMethod = Sse,
            }, ct);
            await s3.DeleteObjectAsync(_cfg.BucketFiles, FullKey(StagingPrefix + key.TrimStart('/')), ct);
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.NotFound)
        {
            // Không có key tạm: đã chép ở lần gọi trước, hoặc vé cấp trước bản này (PUT thẳng vào key chính) → kiểm bản chính bên dưới.
        }
        var size = await GetSizeAsync(key, ct);
        if (size is null) return new UploadCheck(null);
        byte[] head;
        try
        {
            using var res = await s3.GetObjectAsync(new GetObjectRequest
            {
                BucketName = _cfg.BucketFiles, Key = final, ByteRange = new ByteRange(0, FileTypes.SignatureBytes - 1),
            }, ct);
            using var ms = new MemoryStream();
            await res.ResponseStream.CopyToAsync(ms, ct);
            head = ms.ToArray();
        }
        catch (AmazonS3Exception ex) when (ex.StatusCode == System.Net.HttpStatusCode.RequestedRangeNotSatisfiable) { head = []; }
        if (!FileTypes.SignatureMatches(fileName, head))
        {
            await s3.DeleteObjectAsync(_cfg.BucketFiles, final, ct);
            return new UploadCheck(null, $"Nội dung file không đúng định dạng {Path.GetExtension(fileName)} — file đã bị loại");
        }
        return new UploadCheck(size);
    }

    public Task<string> GetDownloadUrlAsync(string key, string fileName, bool inline, TimeSpan? ttl = null)
    {
        var req = new GetPreSignedUrlRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(key),
            Verb = HttpVerb.GET,
            Expires = clock.GetUtcNow().UtcDateTime.Add(ttl ?? TimeSpan.FromMinutes(_cfg.PresignMinutes)),
        };
        // TEST-13: MIME do server quyết theo đuôi (không dùng MIME đã lưu từ trình duyệt); loại không an toàn luôn tải về.
        var type = FileTypes.ContentTypeFor(fileName);
        req.ResponseHeaderOverrides.ContentType = type;
        req.ResponseHeaderOverrides.ContentDisposition = ContentDisposition(fileName, inline && FileTypes.IsInlineSafe(type));
        return s3.GetPreSignedURLAsync(req);
    }

    /// <summary>RFC 6266: tên ASCII dự phòng + filename* UTF-8 (tên tiếng Việt).</summary>
    internal static string ContentDisposition(string fileName, bool inline)
    {
        var ascii = new string(fileName.Normalize(System.Text.NormalizationForm.FormD)
            .Where(c => System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c) != System.Globalization.UnicodeCategory.NonSpacingMark)
            .Select(c => c is 'đ' ? 'd' : c is 'Đ' ? 'D' : c < 128 && c != '"' && c != '\\' && !char.IsControl(c) ? c : '_').ToArray());
        return $"{(inline ? "inline" : "attachment")}; filename=\"{ascii}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }

    private string FullKey(string key)
    {
        key = key.TrimStart('/');
        if (key.Length == 0 || key.Contains("..")) throw new ArgumentException("Key file không hợp lệ", nameof(key));
        return _cfg.FilesPrefix + key;
    }

    internal static IAmazonS3 CreateClient(S3Settings cfg)
    {
        var s3Config = new AmazonS3Config { ForcePathStyle = cfg.ForcePathStyle };
        if (string.IsNullOrWhiteSpace(cfg.ServiceUrl))
            s3Config.RegionEndpoint = RegionEndpoint.GetBySystemName(cfg.Region);
        else
        {
            s3Config.ServiceURL = cfg.ServiceUrl;
            s3Config.AuthenticationRegion = cfg.Region;
        }
        return new AmazonS3Client(cfg.AccessKey, cfg.SecretKey, s3Config);
    }
}
