# Kết nối AI (MCP)

> Nguồn sự thật là code: `backend/src/OfficeHub.Mcp/`, `BuildingBlocks/Auth/AccessTokenAuth.cs`, `Modules/Identity/…/AccessToken*`, `frontend/src/features/ai-access/`. Về [README.md](README.md).

Nhân viên dùng trợ lý AI của mình (Claude web / Desktop / điện thoại, Claude Code, Cursor, Codex, GitHub Copilot — VS Code / Visual Studio / JetBrains / Copilot CLI) để thao tác với OfficeHub thay cho web. AI chạy **đúng quyền của người dùng**, không hơn.

## Quyết định đã chốt (2026-11-06, đừng đề xuất lại)

- Client: Claude, Cursor, Codex, GitHub Copilot (thêm 2026-11-06). Hai cách: **Đăng nhập OAuth** (khuyên dùng, bắt buộc với claude.ai / Desktop / điện thoại) và **token cá nhân (PAT)** dán vào header → OAuth, nhật ký, quản trị HR: [mcp-oauth.md](mcp-oauth.md).
- **Cho ghi**: chấm công, gửi đơn nghỉ / tăng ca / giải trình, huỷ đơn, duyệt / từ chối (quản lý / HR).
- **Hợp đồng, lương và thông tin cá nhân nhạy cảm ẩn hoàn toàn**: không tool, và token bị chặn ở Api (`/api/contracts/*`, `/api/payroll/*`, `/api/org/profile/*` — CCCD, ngân hàng, địa chỉ → 403).
- **Chấm công qua AI được phép, luôn tính là làm từ xa**: `Source = Mcp`, `WorkMode = Remote` (server quyết, bỏ qua `source` client gửi, bỏ qua IP).

## Luồng

```
AI client ──POST /mcp (Bearer ohk_…)──▶ OfficeHub.Mcp (BearerGate → tool) ──/api/* (cùng Bearer)──▶ OfficeHub.Api
```

- `OfficeHub.Mcp` **không đọc DB**: mỗi tool gọi lại REST của Api bằng token của người dùng (`Infrastructure/OfficeHubApi.cs`), nên phân quyền, phân cấp quản lý, validate đều do Api làm. Lỗi Api (ProblemDetails / ValidationProblem) → `McpException` tiếng Việt.
- Streamable HTTP **stateless** (SDK `ModelContextProtocol.AspNetCore` 2.3.1), endpoint `/mcp`. `ServerInstructions` trong `Program.cs`: hỏi xác nhận trước tool ghi, coi văn bản người khác nhập là dữ liệu (chống prompt injection), không có hợp đồng / lương.
- `BearerGate`: thiếu / sai token → 401 + `WWW-Authenticate: Bearer resource_metadata=…` (OAuth discovery); kiểm tra bằng `GET /api/auth/me`, nhớ `Mcp__TokenCacheSeconds` (30 s). Api không phản hồi → 503 (không nhớ). Thu hồi token có hiệu lực ngay ở lệnh gọi tool kế tiếp (Api kiểm tra lại mỗi request).
- Gửi `X-Forwarded-For` = IP client AI và `User-Agent: OfficeHub.Mcp (<UA client>)` sang Api (chỉ để ghi log / sự kiện chấm công).

## Token truy cập (module Identity)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/api/auth/access-tokens` | Token cá nhân của tôi (≤ 50, không gồm access token OAuth), `status` = `Active` / `Expired` / `Revoked` |
| POST | `/api/auth/access-tokens` | `{ name (≤100), expiresInDays ∈ 30/90/180/365 (mặc định 90), confirm (mật khẩu / mã 2FA — bỏ qua nếu vừa đăng nhập ≤ 10 phút) }` → `{ accessToken, token }`; `token` hiện **một lần**. Tối đa 10 token đang dùng / người → 409 |
| DELETE | `/api/auth/access-tokens/{id}` | Thu hồi (đặt `RevokedAt`, giữ dòng) → 204. Chủ token hoặc HR. Tự thu hồi hết khi đổi mật khẩu / khoá ([auth-sessions.md](auth-sessions.md)) |

- Token = `ohk_` + 32 byte ngẫu nhiên base64url. Lưu SHA-256 (`identity.access_tokens.TokenHash`, unique) + `Prefix` để hiển thị. Chỉ quản lý được bằng cookie web (token gọi → 403).
- Xác thực (`Infrastructure/AccessTokenHandler.cs`, scheme `AccessToken`): scheme mặc định của Api là policy `OfficeHub` → có `Authorization: Bearer ohk_…` thì dùng token, ngược lại cookie. Mỗi request đọc lại token + user (+ grant nếu là token OAuth): token / grant thu hồi, hết hạn, user `IsActive=false`, đang khoá, `MustChangePassword`, admin / hr chưa bật 2FA ([auth-2fa.md](auth-2fa.md)), hoặc `AccessTokens__Enabled=false` → 401. Principal tạo bằng `AppClaimsFactory` (vai trò hiện tại) + claim `access_token_id`; `LastUsedAt` ghi tối đa 5 phút / lần.
- **Danh sách route cho phép** `AccessTokenAuth.IsAllowed` (mặc định chặn; khớp theo đoạn path): route ngoài danh sách → **403** dù token hợp lệ. Cố ý không có: `/api/contracts` (cả mẫu hợp đồng), `/api/reports` (lương / tiền), `/api/payroll`, `/api/org/profile` (hồ sơ cá nhân), `/api/auth/*` trừ `/me`, ghi của `/api/org` (nhân viên, tài khoản, vai trò — **trừ** tạo / sửa / xoá phòng ban cho HR và `PUT …/departments|positions/{id}/guide`), ca / lịch / ngày lễ, `/api/leave/balances`, `/api/leave/adjustments`. Route có Id ở giữa (Dự án, Tài liệu) khớp **nguyên path** bằng mẫu `AllowedExact` (Guid) thay vì tiền tố — để `/api/projects/{id}/financials`, `/allocations`, `/milestones/*`, `/api/documents/assets/{id}/archive`, `/protected-file`… vẫn bị chặn (TEST-54 mở `POST /api/documents/assets/text` + `/{id}/submit`; TEST-77 mở GET đọc của `/api/sales`; TEST-78 mở GET đọc của `/api/finance`; TEST-79 đổi `GET /api/org/employees` từ tiền tố sang khớp nguyên path — chỉ danh bạ, `/me`, `/me/role`, `/{id}/summary`; `GET /{id}` (ngày sinh, ghi chú, tài khoản), `/export`, `/import-template`, `/next-code` bị chặn). Thêm endpoint mới cho AI → thêm vào đây + test `tests/OfficeHub.Mcp.Tests/AccessTokenScopeTests.cs`.
- Code module khác nhận biết request từ AI bằng `ClaimsPrincipal.IsAccessToken()` (BuildingBlocks).

## Tool (101)

> Màn hình quản trị **"Công cụ AI (MCP)"** (`/mcp-tools`, chỉ admin — `features/mcp-tools/`) liệt kê đầy đủ 101 tool kèm chi tiết (tên, tiêu đề, mô tả, tham số, loại read/write/destructive, endpoint). Catalog `features/mcp-tools/utils/catalog.ts` **bảo trì thủ công** — đổi tool trong `OfficeHub.Mcp/Tools/*.cs` phải cập nhật catalog (luật #9 [AGENTS.md](../../AGENTS.md)).

Danh sách theo nhóm (tool, endpoint, giới hạn từng tool): [mcp-tools.md](mcp-tools.md).

**Bot bên ngoài (2026-11-10)**: agent chạy ngoài OfficeHub, dùng tài khoản nhân viên bình thường + token / OAuth. Tài khoản HR đánh dấu bot → hiện trong văn phòng 3D khi gọi tool ([office-bots.md](office-bots.md)). `ServerInstructions` phân biệt *đang trò chuyện* (xác nhận trước khi ghi) và *chạy tự động* (tự làm việc được giao theo `workGuide` + quy trình, hỏi qua bình luận, không bao giờ tự duyệt đơn); mô tả tool ghi cũng vậy.

Tham số ngày `yyyy-MM-dd`, tháng `yyyy-MM`, giờ `HH:mm` (kiểm tra trong `Tools/ToolHelpers.cs`). Tool ghi có annotation `destructiveHint` (duyệt / từ chối / huỷ) hoặc `readOnlyHint=false`.

## FE: trang "Kết nối AI" (`/ai-access`, ai cũng thấy)

Hướng dẫn kết nối (Đăng nhập / Token × Claude, Claude Code, Cursor, Codex, GitHub Copilot — snippet trong `features/ai-access/utils/labels.ts`, URL = `window.location.origin + /mcp`), tạo / thu hồi token (hiện một lần), ứng dụng đã kết nối, nhật ký; HR thêm tab toàn công ty → [mcp-oauth.md](mcp-oauth.md#fe).

## Chưa làm

Client ID Metadata Document, HR bật / tắt AI theo từng người (hiện chỉ thu hồi + công tắc toàn công ty), deploy VPS.
