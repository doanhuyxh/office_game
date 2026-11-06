namespace OfficeHub.Modules.Identity.Domain;

/// <summary>
/// Ứng dụng AI tự đăng ký qua Dynamic Client Registration (RFC 7591). Chỉ client công khai (không secret), bắt buộc PKCE.
/// </summary>
public sealed class OAuthClient
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    /// <summary>client_id công khai: ohc_…</summary>
    public string ClientId { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> RedirectUris { get; set; } = [];
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
}

/// <summary>Mã ủy quyền dùng một lần, sống 2 phút. Chỉ lưu hash.</summary>
public sealed class OAuthCode
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public string CodeHash { get; set; } = "";
    public Guid ClientId { get; set; }
    public Guid UserId { get; set; }
    public string RedirectUri { get; set; } = "";
    /// <summary>PKCE S256: base64url(SHA-256(code_verifier)).</summary>
    public string CodeChallenge { get; set; } = "";
    public string? Scope { get; set; }
    public string? Resource { get; set; }
    public DateTimeOffset ExpiresAt { get; set; }
    public DateTimeOffset? ConsumedAt { get; set; }
    /// <summary>Grant sinh ra từ mã này — dùng lại mã → thu hồi grant (RFC 6749 §4.1.2).</summary>
    public Guid? GrantId { get; set; }
}

/// <summary>
/// Một lần người dùng bấm "Cho phép" một ứng dụng. Giữ refresh token (xoay vòng mỗi lần dùng); access token ngắn hạn là các dòng
/// <see cref="AccessToken"/> có <see cref="AccessToken.GrantId"/>. Thu hồi grant = mọi access token của nó hết hiệu lực ngay.
/// </summary>
public sealed class OAuthGrant
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid UserId { get; set; }
    public Guid ClientId { get; set; }
    public string ClientName { get; set; } = "";
    public string? Scope { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? LastUsedAt { get; set; }
    public DateTimeOffset? RevokedAt { get; set; }
    public string RefreshHash { get; set; } = "";
    /// <summary>Refresh token vừa bị thay — nếu ai dùng lại nó (bị đánh cắp) → thu hồi cả grant.</summary>
    public string? PreviousRefreshHash { get; set; }
    public DateTimeOffset RefreshExpiresAt { get; set; }

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && RefreshExpiresAt > now;
}
