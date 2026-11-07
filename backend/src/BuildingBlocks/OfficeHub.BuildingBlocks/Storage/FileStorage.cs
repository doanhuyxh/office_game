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
    /// </summary>
    Task<string> GetUploadUrlAsync(string key, string contentType, TimeSpan ttl);

    /// <summary>Kích thước file trên S3 (HEAD); null nếu chưa có — kiểm tra trình duyệt đã tải lên thật chưa.</summary>
    Task<long?> GetSizeAsync(string key, CancellationToken ct = default);

    /// <summary>Presigned GET kèm tên file: <paramref name="inline"/> = xem trong trình duyệt (ảnh, PDF, video), false = tải về.</summary>
    Task<string> GetDownloadUrlAsync(string key, string fileName, bool inline, TimeSpan? ttl = null);
}

public sealed class S3FileStorage(IAmazonS3 s3, IOptions<S3Settings> options, TimeProvider clock) : IFileStorage
{
    private readonly S3Settings _cfg = options.Value;

    public Task UploadAsync(string key, Stream content, string contentType, CancellationToken ct = default) =>
        s3.PutObjectAsync(new PutObjectRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(key),
            InputStream = content,
            ContentType = contentType,
            ServerSideEncryptionMethod = string.IsNullOrEmpty(_cfg.ServiceUrl) ? ServerSideEncryptionMethod.AES256 : null,
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
            Key = FullKey(key),
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

    public Task<string> GetDownloadUrlAsync(string key, string fileName, bool inline, TimeSpan? ttl = null)
    {
        var req = new GetPreSignedUrlRequest
        {
            BucketName = _cfg.BucketFiles,
            Key = FullKey(key),
            Verb = HttpVerb.GET,
            Expires = clock.GetUtcNow().UtcDateTime.Add(ttl ?? TimeSpan.FromMinutes(_cfg.PresignMinutes)),
        };
        req.ResponseHeaderOverrides.ContentDisposition = ContentDisposition(fileName, inline);
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
