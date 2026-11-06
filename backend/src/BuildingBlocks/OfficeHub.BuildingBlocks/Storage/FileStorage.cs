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
