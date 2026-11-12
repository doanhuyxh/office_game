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
- **Danh sách route cho phép** `AccessTokenAuth.IsAllowed` (mặc định chặn; khớp theo đoạn path): route ngoài danh sách → **403** dù token hợp lệ. Cố ý không có: `/api/contracts` (cả mẫu hợp đồng), `/api/reports` (lương / tiền), `/api/payroll`, `/api/org/profile` (hồ sơ cá nhân), `/api/auth/*` trừ `/me`, ghi của `/api/org` (nhân viên, tài khoản, vai trò — **trừ** tạo / sửa / xoá phòng ban cho HR và `PUT …/departments|positions/{id}/guide`), ca / lịch / ngày lễ, `/api/leave/balances`, `/api/leave/adjustments`. Route có Id ở giữa (Dự án, Tài liệu) khớp **nguyên path** bằng mẫu `AllowedExact` (Guid) thay vì tiền tố — để `/api/projects/{id}/financials`, `/allocations`, `/milestones/*`, `/api/documents/assets/{id}/archive`, `/protected-file`… vẫn bị chặn (TEST-54 mở `POST /api/documents/assets/text` + `/{id}/submit`). Thêm endpoint mới cho AI → thêm vào đây + test `tests/OfficeHub.Mcp.Tests/AccessTokenScopeTests.cs`.
- Code module khác nhận biết request từ AI bằng `ClaimsPrincipal.IsAccessToken()` (BuildingBlocks).

## Tool (78)

> Màn hình quản trị **"Công cụ AI (MCP)"** (`/mcp-tools`, chỉ admin — `features/mcp-tools/`) liệt kê đầy đủ 78 tool kèm chi tiết (tên, tiêu đề, mô tả, tham số, loại read/write/destructive, endpoint). Catalog `features/mcp-tools/utils/catalog.ts` **bảo trì thủ công** — đổi tool trong `OfficeHub.Mcp/Tools/*.cs` phải cập nhật catalog (luật #9 [AGENTS.md](../../AGENTS.md)).

| Nhóm | Tool |
|---|---|
| Chung | `get_my_profile` (tài khoản, hồ sơ, `now` giờ VN), `list_notifications`, `mark_notifications_read`, `search_colleagues` (bỏ thông tin tài khoản; có `jobTitle`, `positionLevel`), `list_departments`, `list_positions`, `get_my_role`, `get_department`, `get_position` (vai trò + hướng dẫn: [org-guides.md](org-guides.md)) |
| Chấm công | `get_today_attendance`, `check_in_out`, `get_my_timesheet`, `list_holidays`, `list_shifts`, `list_my_corrections`, `submit_attendance_correction`, `list_my_overtime`, `preview_overtime`, `register_overtime` |
| Nghỉ phép | `list_leave_types`, `get_leave_balance`, `list_my_leave_requests`, `preview_leave`, `submit_leave_request` (`leaveType` = mã / tên / id) |
| Duyệt | `list_approval_inbox` (gồm đơn duyệt thay theo uỷ quyền), `list_my_approval_requests`, `get_approval_request`, `approve_request`, `reject_request` (bắt buộc lý do), `cancel_my_request`. Tạo / thu hồi uỷ quyền duyệt **không** qua token AI (chỉ GET `/api/approval/delegations`). Duyệt / từ chối qua token AI là **cố ý** (giám đốc chốt 2026-11-12, TEST-11): server không chặn, chỉ có lời dặn "không tự ý duyệt" trong hướng dẫn MCP — lý do đơn là dữ liệu người gửi nhập, có thể chứa prompt injection |
| Phòng họp | `list_meeting_rooms`, `list_meetings`, `book_meeting_room` (ngày + giờ VN → `+07:00`, mời bằng mã / email / tên), `cancel_meeting` ([meetings.md](meetings.md)) |
| Bảng tin | `list_news_feed`, `get_news_post` — đọc; Api tự áp phạm vi người xem và (token AI) chỉ trả chữ thuần, không HTML / link tệp. **Admin / HR**: `create_news_post` (Markdown đơn giản → HTML, phạm vi toàn công ty / phòng ban, tuỳ chọn email, không tệp) — thêm 2026-11-09 ([news.md](news.md#mcp)). Sửa / xoá bài, bình luận, cảm xúc, kiểm duyệt **không** qua AI |
| Văn phòng 3D (chỉ bot) | `list_office_places`, `go_to` — 2026-11-11, đi bộ tới phòng / khu / bàn / cạnh người, ở lại tới lần go_to kế ([office-bots.md](office-bots.md#đi-lại-go_to)); `present_screen`, `present_markdown`, `present_document`, `stop_presenting` — chiếu ảnh màn hình / trang Markdown / tài liệu lên TV phòng ([office-bots-screen.md](office-bots-screen.md)) |
| Tin nhắn (chỉ bot) | `list_chats`, `read_chat`, `send_chat_message`, `mark_chat_read` — 2026-11-11, chỉ tài khoản bot, Toàn văn phòng + 1-1 có sẵn, ≤ 60 tin / giờ ([office-bots.md](office-bots.md#tin-nhắn-của-bot)) |
| Tài sản | `get_my_assets`, `get_employee_assets` — chỉ đọc (thiết bị + tài khoản dịch vụ, không giá, không mật khẩu); Api tự kiểm quyền ([assets.md](assets.md)). Cấp / thu hồi / rà soát **không** qua AI |
| Dự án | `list_projects`, `get_project`, `list_project_tasks`, `list_my_tasks`, `list_task_comments`, `get_project_effort` (quản lý dự án / HR / BGĐ — ngày công, không tiền); `get_task` (việc + bình luận + lịch sử, 2026-11-10); **ghi**: `create_task` (mô tả Markdown + `mediaLinks` link ảnh / video), `update_task` (chỉ đổi trường truyền, `"none"` = bỏ — 2026-11-10), `update_task_status` (trạng thái = tên / id cột tự do của dự án; `note` khi lùi; quy trình đi lần lượt + cột cần người duyệt — [projects-tasks.md](projects-tasks.md)), `comment_task`, `list_projects` / `get_project` có `departments`, `viaDepartment` (xem nhờ phòng ban — chỉ đọc) và `myAccess` (TEST-40), `update_project_guide` (quản lý dự án / HR: thay toàn bộ hướng dẫn làm việc, `"none"` = xoá — `PUT /api/projects/{id}/guide`, TEST-35). Mọi ghi hiện nhãn **BOT**. Dự án / việc nhận id hoặc mã (`WEB-2026`, `WEB-12`). Thành viên, phân bổ %, mốc, tài chính, HĐ bán / đợt thu, CR, sửa / xoá việc **không** qua AI ([projects.md](projects.md)) |
| Tài liệu | `list_document_spaces`, `list_document_folders`, `search_documents`, `list_recent_documents`, `get_document`, `get_document_link` — đọc; **ghi (TEST-54)**: `create_document` (tài liệu NHÁP từ chữ md / txt / csv, Api tự lưu S3, luôn Nội bộ), `submit_document` (gửi duyệt — token **luôn** tạo đơn cho người duyệt, không tự ban hành dù chức vụ có quyền; tài liệu Hạn chế / Mật → `get_document_link` 403) — tài liệu nhận id / mã `TL-…` / số hiệu. `get_document_link` trả link presigned (15 phút, media 3 giờ) và **ghi nhật ký xem / tải** như trên web (chủ dự án chốt 2026-11-09). Tải file nhị phân, duyệt / tự ban hành, xoá, nhật ký truy cập, quản trị **không** qua AI ([documents.md](documents.md)) |
| Quản lý / HR | `get_team_attendance`, `get_team_attendance_report`, `get_employee_timesheet`, `list_team_leave` (Api trả 403 nếu không đủ quyền); **HR — phòng ban**: `create_department`, `update_department` (chỉ đổi trường được truyền, `"none"` = bỏ; giữ vùng bản đồ 3D), `delete_department` (xoá mềm; Api từ chối nếu còn phòng con / nhân viên) — thêm 2026-11-09. Sửa phòng / xoá phải khớp đúng tên / mã. **Mô tả + hướng dẫn** (2026-11-09): `update_department_guide` (HR hoặc trưởng phòng đó), `update_position_guide` (HR) — chỉ đổi ô được truyền, `"none"` = xoá, hướng dẫn thay toàn bộ ([org-guides.md](org-guides.md)). Chuyển nhân viên, sửa chức vụ (tên / cấp / quyền) vẫn **chỉ web** |

**Bot bên ngoài (2026-11-10)**: agent chạy ngoài OfficeHub, dùng tài khoản nhân viên bình thường + token / OAuth. Tài khoản HR đánh dấu bot → hiện trong văn phòng 3D khi gọi tool ([office-bots.md](office-bots.md)). `ServerInstructions` phân biệt *đang trò chuyện* (xác nhận trước khi ghi) và *chạy tự động* (tự làm việc được giao theo `workGuide` + quy trình, hỏi qua bình luận, không bao giờ tự duyệt đơn); mô tả tool ghi cũng vậy.

Tham số ngày `yyyy-MM-dd`, tháng `yyyy-MM`, giờ `HH:mm` (kiểm tra trong `Tools/ToolHelpers.cs`). Tool ghi có annotation `destructiveHint` (duyệt / từ chối / huỷ) hoặc `readOnlyHint=false`.

## FE: trang "Kết nối AI" (`/ai-access`, ai cũng thấy)

Hướng dẫn kết nối (Đăng nhập / Token × Claude, Claude Code, Cursor, Codex, GitHub Copilot — snippet trong `features/ai-access/utils/labels.ts`, URL = `window.location.origin + /mcp`), tạo / thu hồi token (hiện một lần), ứng dụng đã kết nối, nhật ký; HR thêm tab toàn công ty → [mcp-oauth.md](mcp-oauth.md#fe).

## Chưa làm

Client ID Metadata Document, HR bật / tắt AI theo từng người (hiện chỉ thu hồi + công tắc toàn công ty), deploy VPS.
