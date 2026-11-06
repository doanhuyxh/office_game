# Kết nối AI — OAuth, nhật ký, quản trị

> Phần tiếp của [mcp.md](mcp.md). Code: `Modules/Identity/…/Features/OAuth/OAuthEndpoints.cs`, `Domain/OAuth*.cs`, `BuildingBlocks/Auth/OAuthMetadata.cs`, `Modules/Audit/`, FE `features/ai-access/components/OAuthConsentPage.tsx`.

## OAuth 2.1 (MCP Authorization) — "Đăng nhập" thay cho dán token

Dùng cho claude.ai / Claude Desktop / app điện thoại (bắt buộc OAuth, máy chủ Anthropic phải gọi tới được → cần domain HTTPS public), và tuỳ chọn cho Claude Code, Cursor, Codex. Tự viết tối thiểu (không OpenIddict): access token OAuth **là dòng `access_tokens`** (`ohk_`, có `GrantId`) nên đi qua đúng `AccessTokenHandler` + danh sách route cho phép + audit như token cá nhân.

| Bước | Ở đâu |
|---|---|
| 1. Client gọi `/mcp` không token → 401 `WWW-Authenticate: Bearer resource_metadata="<base>/.well-known/oauth-protected-resource/mcp"` | `BearerGate` (Mcp) |
| 2. `GET /.well-known/oauth-protected-resource[/mcp]` (RFC 9728), `GET /.well-known/oauth-authorization-server` (RFC 8414). Issuer = `App__BaseUrl` | Mcp phục vụ (`OAuthMetadata`); nginx / Vite chuyển `/.well-known/oauth-*` → Mcp |
| 3. `POST /api/oauth/register` (DCR, RFC 7591, ẩn danh, CORS `*`, 30/phút/IP) → `client_id` `ohc_…`; luôn client công khai (`token_endpoint_auth_method=none` dù client xin secret) | Identity |
| 4. Trình duyệt mở `<base>/oauth/authorize?…` (route FE, cần đăng nhập web) → FE gọi `GET /api/oauth/authorize` (kiểm tra) → người dùng bấm Cho phép / Từ chối → `POST /api/oauth/authorize` `{…, approve}` → `{ redirectTo }` | FE + Identity (cookie, token AI bị từ chối) |
| 5. `POST /api/oauth/token` (form) `authorization_code` + `code_verifier` → `{ access_token (1 giờ), refresh_token ohr_…, expires_in, token_type }`, `Cache-Control: no-store` | Identity |
| 6. `refresh_token` → cặp mới (xoay vòng). `POST /api/oauth/revoke` (RFC 7009, luôn 200) | Identity |

Quy tắc (`Domain/OAuthRules.cs`, test `tests/OfficeHub.Modules.Identity.Tests`):
- `redirect_uri`: https, http **loopback** (khớp bỏ qua cổng — RFC 8252), hoặc scheme riêng (`cursor://…`); cấm http thường, `javascript:`, `data:`, `file:`, fragment, userinfo. Khớp tuyệt đối với danh sách đã đăng ký.
- client_id / redirect_uri sai → **không chuyển hướng** (chỉ hiện lỗi). Lỗi khác (thiếu PKCE, response_type ≠ code, `resource` khác host — RFC 8707) → chuyển về ứng dụng kèm `error` + `state`.
- PKCE **S256 bắt buộc**. Mã sống 2 phút, dùng 1 lần; dùng lại → thu hồi grant đã cấp từ mã đó. Sai `code_verifier` không tiêu mã.
- Refresh trượt 30 ngày, grant tối đa 365 ngày. Dùng lại refresh token cũ (`PreviousRefreshHash`) → thu hồi cả grant (access token đang dùng chết ngay). Mỗi lần refresh xoá access token hết hạn của grant.
- Kiểm tra lại user (`IsActive`, khoá, `MustChangePassword`) khi đổi mã và refresh. DCR: dọn client chưa từng được cho phép sau 7 ngày, tối đa 2000 client.
- Chưa hỗ trợ: Client ID Metadata Document (`client_id_metadata_document_supported: false`), client có secret, OIDC (`openid-configuration`).

API ứng dụng đã kết nối: `GET /api/oauth/grants` (của tôi), `DELETE /api/oauth/grants/{id}` (chủ hoặc HR).

## Nhật ký AI (module Audit, schema `audit`)

- `AiAuditStartupFilter` (IStartupFilter → bọc cả pipeline Api, không sửa Program.cs): request có `HttpContext.Items[AccessTokenAuth.CallerItemKey]` (Identity đặt khi biết token thuộc ai — **kể cả khi route bị chặn 403**) → đưa vào hàng đợi RAM (10 000, đầy thì bỏ cũ nhất) → `AiAuditWriter` ghi theo lô vào `audit.ai_requests`; xoá bản ghi > 180 ngày mỗi ngày một lần.
- Cột: thời điểm, user, token, tên token / ứng dụng, `ViaOAuth`, `Tool` (header `X-Mcp-Tool` do Mcp gửi qua call-tool filter; chỉ nhận snake_case ≤ 64), method, path, status, thời gian xử lý, IP.
- `GET /api/audit/ai-requests?userId=&before=&take=` (≤ 200): nhân viên luôn chỉ thấy của mình; HR lọc theo người hoặc xem tất cả. Token AI → 403.

## Quản trị (HR) & giới hạn

- `GET /api/auth/ai-connections` (HR): token cá nhân + ứng dụng đang hoạt động của cả công ty. HR thu hồi hộ bằng `DELETE /api/auth/access-tokens/{id}` / `DELETE /api/oauth/grants/{id}`.
- `AccessTokens__Enabled=false` → mọi token / ứng dụng AI bị 401, `/api/oauth/token` trả `access_denied` (công tắc toàn công ty, cần khởi động lại Api).
- `AccessTokens__RequestsPerMinute` (mặc định 120): `GlobalLimiter` theo `access_token_id` → 429 (MCP báo "Gọi quá nhiều lần"). Cookie web không bị giới hạn này.

## FE

- `/oauth/authorize` (`OAuthConsentPage`, toàn màn hình, `requireAuth` giữ nguyên query khi chuyển qua /login): tên ứng dụng, tài khoản, quyền được / không được, host sẽ chuyển về.
- `/ai-access`: tab "Của tôi" (hướng dẫn kết nối Đăng nhập / Token, ứng dụng đã kết nối, token, hoạt động gần đây); HR có thêm tab "Toàn công ty" (kết nối đang hoạt động + thu hồi, nhật ký lọc theo người).

E2E: `scripts/dev/mcp-oauth-e2e.ts` (30 bước: discovery, DCR, đồng ý, PKCE, refresh xoay vòng, dùng lại mã / refresh, audit, HR thu hồi).
