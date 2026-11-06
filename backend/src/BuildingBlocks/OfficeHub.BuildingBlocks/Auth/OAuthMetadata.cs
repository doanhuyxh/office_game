namespace OfficeHub.BuildingBlocks.Auth;

/// <summary>
/// Địa chỉ OAuth 2.1 cho trợ lý AI (MCP Authorization spec). Issuer = gốc web (<c>App__BaseUrl</c>);
/// OfficeHub.Mcp phục vụ hai tài liệu well-known, OfficeHub.Api (module Identity) xử lý đăng ký / cấp token,
/// trang đồng ý là route FE <c>/oauth/authorize</c>.
/// </summary>
public static class OAuthMetadata
{
    public const string Scope = "officehub";
    public const string ProtectedResourcePath = "/.well-known/oauth-protected-resource";
    public const string AuthorizationServerPath = "/.well-known/oauth-authorization-server";

    public static string Issuer(string baseUrl) => baseUrl.TrimEnd('/');
    public static string Resource(string baseUrl) => Issuer(baseUrl) + "/mcp";
    public static string ResourceMetadataUrl(string baseUrl) => Issuer(baseUrl) + ProtectedResourcePath + "/mcp";

    /// <summary>RFC 9728 — Protected Resource Metadata của /mcp.</summary>
    public static object ProtectedResource(string baseUrl) => new Dictionary<string, object>
    {
        ["resource"] = Resource(baseUrl),
        ["authorization_servers"] = new[] { Issuer(baseUrl) },
        ["scopes_supported"] = new[] { Scope },
        ["bearer_methods_supported"] = new[] { "header" },
        ["resource_name"] = "OfficeHub",
    };

    /// <summary>RFC 8414 — Authorization Server Metadata.</summary>
    public static object AuthorizationServer(string baseUrl)
    {
        var b = Issuer(baseUrl);
        return new Dictionary<string, object>
        {
            ["issuer"] = b,
            ["authorization_endpoint"] = b + "/oauth/authorize",
            ["token_endpoint"] = b + "/api/oauth/token",
            ["registration_endpoint"] = b + "/api/oauth/register",
            ["revocation_endpoint"] = b + "/api/oauth/revoke",
            ["response_types_supported"] = new[] { "code" },
            ["grant_types_supported"] = new[] { "authorization_code", "refresh_token" },
            ["code_challenge_methods_supported"] = new[] { "S256" },
            ["token_endpoint_auth_methods_supported"] = new[] { "none" },
            ["revocation_endpoint_auth_methods_supported"] = new[] { "none" },
            ["scopes_supported"] = new[] { Scope },
            ["client_id_metadata_document_supported"] = false,
        };
    }
}
