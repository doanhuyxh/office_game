# Đội agent tự phối hợp (bảng việc + webhook + việc phụ thuộc)

> Code: `Modules/Projects/…/Domain/{AgentTeamRules,DependencyRules}.cs`, `Features/TaskEndpoints.cs`; `Modules/Notification/…/Domain/Webhook.cs`, `Infrastructure/Webhooks.cs`, `Features/WebhookEndpoints.cs`; Mcp `Tools/ProjectTools.cs` + `Program.cs` (ServerInstructions); FE `features/ai-access/components/webhook-card`, `features/projects/components/task-dependencies`. Về [README.md](README.md) · bot: [office-bots.md](office-bots.md) · việc: [projects-tasks.md](projects-tasks.md).

Chủ dự án hỏi 2026-11-11 "đội agent tự làm việc với nhau được không" → nói "triển khai đi" **không chốt từng điểm**; dùng phương án đề xuất (có thể đổi): phối hợp **qua bảng việc** (không qua chat — bot không nhắn riêng với nhau), "Xong" luôn **người thật duyệt**, bot được giao việc cho bot khác, ≤ 20 việc / ngày.

## 1. Rào chắn + @nhắc (`AgentTeamRules`, áp cho mọi request bằng token AI — người hay bot đều vậy)

| Luật | Chi tiết |
|---|---|
| Token **không bao giờ duyệt** | `CanApprove = CanManage && !IsAccessToken()` → không chuyển vào / ra cột `ApproverOnly`, không tạo việc ở đó, `TaskDetailDto.canApprove = false` — kể cả quản lý dự án / HR dùng Claude |
| ≤ **N việc / ngày** / tài khoản qua token (mặc định 50) | đếm `task_activities` Kind=Created, ByBot, `ActorEmployeeId`, từ 0 giờ VN (`ProjectClock.StartOfToday`) → 429 |
| Chuỗi bot ≤ **M** (mặc định 10) | một việc có M thao tác bot liên tiếp (chuyển trạng thái / giao người / bình luận / đặt việc chờ; tạo + sửa nội dung không tính) mà chưa có sự kiện của người thật → 409 với mọi thao tác bot trên việc đó cho tới khi người thật bình luận / thao tác. Chặn 2 bot @nhắc nhau qua lại |
| **@mã-nhân-viên** trong bình luận | `MentionedCodes` (không dính email, ≤ 10, bỏ dấu câu cuối) → `MentionRecipients`: chuông "X nhắc bạn trong việc …" cho **thành viên dự án còn làm, có tài khoản** được nhắc (trừ người viết và người làm việc — đã có chuông bình luận). Tool `comment_task` thêm `mention` (mã / tên thành viên → chèn `@mã`; người ngoài dự án → lỗi). Web (TEST-62): ô bình luận việc gõ `@` → gợi ý thành viên (`task-comment-input`, ảnh từ `MemberDto.avatarUrl`, nhãn BOT từ `isBot`) chèn đúng `@mã`; hiển thị `@mã` của thành viên thành họ tên nổi bật (`Markdown mentions`). Helper chung với Bảng tin: `utils/mention.ts`, `hooks/useMentionNav.ts`, `components/common/mention-list` |

**N, M do admin chỉnh** (TEST-36, 2026-11-12): bảng một dòng `projects.agent_settings` (`[Audited]`, migration `AgentSettings`; chưa có dòng → `AgentLimits.Default` 50 / 10). `GET / PUT /api/projects/agent-settings` `{ maxBotTasksPerDay 1–500, maxBotStreak 1–100 }` chỉ `AuthPolicies.Admin`, ngoài allowlist token AI (bot không tự nới). Đọc DB mỗi request token AI (không cache) → áp dụng ngay; câu lỗi ghi số thật. FE: `/system?tab=config` → thẻ "Giới hạn trợ lý AI" (`features/projects` `AgentLimitsCard`).

## 2. Webhook cá nhân (module Notification) — "đánh thức agent"

- Mỗi tài khoản ≤ 1 webhook (`notifications.webhooks`, khoá `UserId`). Đặt ở `/ai-access` → khung **Webhook**; API `/api/notifications/webhook`: `GET` (cấu hình + 10 lần gửi gần nhất), `PUT {url, enabled}` (lần đầu trả `secret` **một lần**), `POST /rotate` (khoá mới, một lần), `POST /test` (sự kiện `ping`), `DELETE`. **Token AI → 403** (agent không tự đổi nơi nhận).
- URL: https bắt buộc, không userinfo / `#`, chặn IP nội bộ (`WebhookRules.UrlError` + `IsPublic`: loopback, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, multicast, ULA / link-local IPv6, IPv4-mapped, IPv6 nhúng IPv4 — NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, `::a.b.c.d` — xét theo IPv4 bên trong, Teredo `2001::/32` chặn hẳn — TEST-22). Chặn lại **lúc kết nối** (`SocketsHttpHandler.ConnectCallback` tự resolve + kiểm IP → chống DNS rebinding), không theo chuyển hướng. `ASPNETCORE_ENVIRONMENT=Development` cho phép http / localhost (e2e).
- Sự kiện: **`notification`** — mọi chuông qua `INotifier` (cùng lần lưu, data: `notificationId, category, title, body, link, url`); **`chat.message`** — tin 1-1 tới tài khoản (Chat gọi `IWebhookPublisher`; Office / kênh phòng không gửi); **`ping`**.
- Body `{ id, event, createdAt, data }`; header `X-OfficeHub-Event`, `X-OfficeHub-Delivery`, `X-OfficeHub-Timestamp` (unix giây), `X-OfficeHub-Signature: sha256=hex(HMAC-SHA256(secret, "{timestamp}.{body}"))`. Khoá lưu mã hoá `IFieldEncryptor` (`Encryption__Key`).
- Hàng đợi `notifications.webhook_deliveries` (như email): `WebhookDispatcher` 3 s / lượt, ≤ 20, timeout 10 s; 2xx = Sent; 4xx (trừ 408 / 429) = Failed ngay; còn lại thử lại 1 / 5 / 15 / 60 phút, hết 5 lần → Failed; 20 sự kiện liên tiếp thất bại → **tự tắt** webhook. Dọn bản ghi đã xong > 7 ngày. JobMonitor `notification.webhook`. Giả định một instance Api.

## 3. Việc phụ thuộc (`projects.task_dependencies`, `DependencyRules`)

- `PUT /api/projects/tasks/{id}/dependencies { dependsOn: Guid[] }` (thành viên, dự án đang chạy; token được gọi) — thay toàn bộ; cùng dự án, không vòng (DFS), không chờ chính nó, ≤ 10; ghi lịch sử `Depends` (mã việc trước → sau). Xoá việc → cascade.
- `TaskDto.waitingOn` (số việc chờ chưa xong; FE badge "Chờ N việc"), `TaskDetailDto.dependsOn / blocks` (`{id, code, title, done}`; FE khung "Phải chờ việc" trong hộp thoại việc, thành viên thêm / bỏ; thêm bằng ô tìm mã / tên không phân biệt dấu + danh sách có phân trang 10 việc / trang và nhãn trạng thái, lọc ở FE từ `useTasks` — TEST-33).
- **Bot (token) không đưa việc còn chờ ra khỏi cột đầu** → 409. Người thật: chỉ thấy badge.
- Việc vừa sang cột hoàn thành → mỗi việc chờ nó mà nay hết chờ: chuông **"Sẵn sàng: CODE tên"** cho người làm (chưa giao → quản lý dự án), trừ người thao tác → kèm webhook → agent được giao tự bắt đầu.
- MCP `create_task` / `update_task` thêm `dependsOn` (mã / id, dấu phẩy; `"none"` = bỏ). `update_task` vẫn trả đối tượng việc, thêm trường `dependsOn`.

## Vòng làm việc của đội (ServerInstructions)

Bot trưởng nhóm `create_task` (assignee = bot / người, `dependsOn` cho việc nối tiếp) → webhook / `list_notifications` đánh thức bot thợ → `update_task_status` Đang làm → làm → `comment_task` (kết quả, `mention` người cần đọc) → Chờ review → **người thật** duyệt Xong trên web → việc chờ nó nhận "Sẵn sàng".

E2E: `scripts/dev/agent-team-e2e.ts` (46 kiểm tra, Api Development + Mcp, máy nhận webhook giả trong script).
