# Kết nối AI (MCP)

> Nguồn sự thật là code: `backend/src/OfficeHub.Mcp/`, `BuildingBlocks/Auth/AccessTokenAuth.cs`, `Modules/Identity/…/AccessToken*`, `frontend/src/features/ai-access/`. Về [README.md](README.md).

Nhân viên dùng trợ lý AI của mình (Claude web / Desktop / điện thoại, Claude Code, Cursor, Codex, GitHub Copilot — VS Code / Visual Studio / JetBrains / Copilot CLI) để thao tác với OfficeHub thay cho web. AI chạy **đúng quyền của người dùng**, không hơn.

## Quyết định đã chốt (2026-11-06, đừng đề xuất lại)

- Client: Claude, Cursor, Codex, GitHub Copilot (thêm 2026-11-06). Hai cách: **Đăng nhập OAuth** (khuyên dùng, bắt buộc với claude.ai / Desktop / điện thoại) và **token cá nhân (PAT)** dán vào header → OAuth, nhật ký, quản trị HR: [mcp-oauth.md](mcp-oauth.md).
- **Cho ghi**: chấm công, gửi đơn nghỉ / tăng ca / giải trình, huỷ đơn, duyệt / từ chối (quản lý / HR).
- **Hợp đồng và lương ẩn hoàn toàn**: không tool, và token bị chặn ở Api (`/api/contracts/*` → 403).
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
| POST | `/api/auth/access-tokens` | `{ name (≤100), expiresInDays ∈ 30/90/180/365 (mặc định 90) }` → `{ accessToken, token }`; `token` hiện **một lần**. Tối đa 10 token đang dùng / người → 409 |
| DELETE | `/api/auth/access-tokens/{id}` | Thu hồi (đặt `RevokedAt`, giữ dòng) → 204. Chủ token hoặc HR |

- Token = `ohk_` + 32 byte ngẫu nhiên base64url. Lưu SHA-256 (`identity.access_tokens.TokenHash`, unique) + `Prefix` để hiển thị. Chỉ quản lý được bằng cookie web (token gọi → 403).
- Xác thực (`Infrastructure/AccessTokenHandler.cs`, scheme `AccessToken`): scheme mặc định của Api là policy `OfficeHub` → có `Authorization: Bearer ohk_…` thì dùng token, ngược lại cookie. Mỗi request đọc lại token + user (+ grant nếu là token OAuth): token / grant thu hồi, hết hạn, user `IsActive=false`, đang khoá, `MustChangePassword`, hoặc `AccessTokens__Enabled=false` → 401. Principal tạo bằng `AppClaimsFactory` (vai trò hiện tại) + claim `access_token_id`; `LastUsedAt` ghi tối đa 5 phút / lần.
- **Danh sách route cho phép** `AccessTokenAuth.IsAllowed` (mặc định chặn; khớp theo đoạn path): route ngoài danh sách → **403** dù token hợp lệ. Cố ý không có: `/api/contracts` (cả mẫu hợp đồng), `/api/reports` (lương / tiền), `/api/auth/*` trừ `/me`, ghi của `/api/org` (nhân viên, tài khoản, vai trò), ca / lịch / ngày lễ, `/api/leave/balances`, `/api/leave/adjustments`. Thêm endpoint mới cho AI → thêm vào đây + test `tests/OfficeHub.Mcp.Tests/AccessTokenScopeTests.cs`.
- Code module khác nhận biết request từ AI bằng `ClaimsPrincipal.IsAccessToken()` (BuildingBlocks).

## Tool (34)

| Nhóm | Tool |
|---|---|
| Chung | `get_my_profile` (tài khoản, hồ sơ, `now` giờ VN), `list_notifications`, `mark_notifications_read`, `search_colleagues` (bỏ thông tin tài khoản; có `jobTitle`, `positionLevel`), `list_departments`, `list_positions`, `get_my_role`, `get_department`, `get_position` (vai trò + hướng dẫn: [org-guides.md](org-guides.md)) |
| Chấm công | `get_today_attendance`, `check_in_out`, `get_my_timesheet`, `list_holidays`, `list_shifts`, `list_my_corrections`, `submit_attendance_correction`, `list_my_overtime`, `preview_overtime`, `register_overtime` |
| Nghỉ phép | `list_leave_types`, `get_leave_balance`, `list_my_leave_requests`, `preview_leave`, `submit_leave_request` (`leaveType` = mã / tên / id) |
| Duyệt | `list_approval_inbox`, `list_my_approval_requests`, `get_approval_request`, `approve_request`, `reject_request` (bắt buộc lý do), `cancel_my_request` |
| Phòng họp | `list_meeting_rooms`, `list_meetings`, `book_meeting_room` (ngày + giờ VN → `+07:00`, mời bằng mã / email / tên), `cancel_meeting` ([meetings.md](meetings.md)) |
| Quản lý / HR | `get_team_attendance`, `get_team_attendance_report`, `get_employee_timesheet`, `list_team_leave` (Api trả 403 nếu không đủ quyền) |

Tham số ngày `yyyy-MM-dd`, tháng `yyyy-MM`, giờ `HH:mm` (kiểm tra trong `Tools/ToolHelpers.cs`). Tool ghi có annotation `destructiveHint` (duyệt / từ chối / huỷ) hoặc `readOnlyHint=false`.

## FE: trang "Kết nối AI" (`/ai-access`, ai cũng thấy)

Hướng dẫn kết nối (Đăng nhập / Token × Claude, Claude Code, Cursor, Codex, GitHub Copilot — snippet trong `features/ai-access/utils/labels.ts`, URL = `window.location.origin + /mcp`), tạo / thu hồi token (hiện một lần), ứng dụng đã kết nối, nhật ký; HR thêm tab toàn công ty → [mcp-oauth.md](mcp-oauth.md#fe).

## Chưa làm

Client ID Metadata Document, HR bật / tắt AI theo từng người (hiện chỉ thu hồi + công tắc toàn công ty), deploy VPS.
