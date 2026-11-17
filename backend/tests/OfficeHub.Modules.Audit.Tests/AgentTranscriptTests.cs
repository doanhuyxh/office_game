using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using OfficeHub.BuildingBlocks.Ai;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Features;
using OfficeHub.Modules.Audit.Infrastructure;

namespace OfficeHub.Modules.Audit.Tests;

/// <summary>TEST-144: transcript phiên agent — kiểm tra bản gửi lên, mã hoá như lương (AES-GCM) trước khi lên S3, tên file tải về.</summary>
public class AgentTranscriptTests
{
    private static byte[] Gzip(string text)
    {
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.Fastest)) gz.Write(Encoding.UTF8.GetBytes(text));
        return ms.ToArray();
    }

    private static AgentTranscriptUpload Upload(string? content = null, string kind = "task", string key = "01a1ced9-0a22-713a-b89d-cbd02c09c92d") =>
        new(key, kind, "sess-1", "/srv/w/TEST-45", "agent/nv120/test-45", "Đã làm: …", content ?? Convert.ToBase64String(Gzip("{\"type\":\"user\"}\n")));

    [Fact]
    public void Valid_upload_returns_gzip_bytes()
    {
        Assert.Null(AgentTranscriptRoute.Validate(Upload(), out var gz));
        Assert.Equal(0x1f, gz[0]);
    }

    [Theory]
    [InlineData("", "task", "key")]
    [InlineData("k", "other", "kind")]
    [InlineData("k", "task", "base64")]
    [InlineData("k", "task", "gzip")]
    public void Invalid_upload_is_rejected(string key, string kind, string expect)
    {
        var content = expect switch { "base64" => "không-phải-base64!!", "gzip" => Convert.ToBase64String("{}"u8.ToArray()), _ => null };
        var err = AgentTranscriptRoute.Validate(Upload(content, kind, key), out _);
        Assert.NotNull(err);
        Assert.Contains(expect == "key" ? "key" : expect == "kind" ? "kind" : expect, err);
    }

    [Fact]
    public void Too_large_or_missing_is_rejected()
    {
        Assert.NotNull(AgentTranscriptRoute.Validate(null, out _));
        Assert.NotNull(AgentTranscriptRoute.Validate(Upload() with { SessionId = " " }, out _));
        Assert.NotNull(AgentTranscriptRoute.Validate(Upload() with { Summary = new string('x', AgentTranscriptRoute.MaxSummary + 1) }, out _));
        var big = new byte[AgentTranscriptRoute.MaxGzipBytes + 1];
        big[0] = 0x1f; big[1] = 0x8b;
        Assert.Contains("MB", AgentTranscriptRoute.Validate(Upload(Convert.ToBase64String(big)), out _));
    }

    [Fact]
    public void Content_is_encrypted_before_storage_and_opens_back()
    {
        var crypto = new AesGcmFieldEncryptor(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        var gz = Gzip("{\"type\":\"assistant\",\"text\":\"bí mật nghiệp vụ\"}\n");
        var sealedBytes = AgentTranscriptStore.Seal(crypto, gz);
        var stored = Encoding.UTF8.GetString(sealedBytes);
        Assert.StartsWith("v2:", stored); // cùng định dạng / khoá với lương, CCCD
        Assert.DoesNotContain(Convert.ToBase64String(gz), stored);
        Assert.Equal(gz, AgentTranscriptStore.Open(crypto, sealedBytes));
        // Khoá khác / file bị sửa → không mở được
        var other = new AesGcmFieldEncryptor(Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)));
        Assert.ThrowsAny<CryptographicException>(() => AgentTranscriptStore.Open(other, sealedBytes));
        Assert.Equal(64, AgentTranscriptStore.Sha256Hex(gz).Length);
    }

    [Fact]
    public void Storage_key_and_download_name()
    {
        var u = Guid.CreateVersion7(); var id = Guid.CreateVersion7();
        Assert.Equal($"agent-transcripts/{u}/{id}.enc", AgentTranscriptStore.StorageKeyOf(u, id));
        Assert.Equal("transcript-chat-NV120_conv_1.jsonl.gz", AgentTranscriptEndpoints.FileName(new AgentTranscript { Kind = "chat", Key = "NV120:conv/1" }));
    }
}
