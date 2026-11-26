# Đối tượng của thông báo — `target` (TEST-237, G1)

> Về [notifications.md](notifications.md) · danh mục: [notifications-catalog.md](notifications-catalog.md). Code: `Notification.Contracts/NotificationTarget.cs`, `NotificationLinkBuilder.cs`; `Notification/Domain/NotificationTargets.cs` (backfill); FE `features/notifications/utils/target.ts`, `public/sw.js`.

Thông báo mang **đối tượng** nó trỏ tới để mọi client (web, app mobile, agent) tự định tuyến, thay vì tách URL web. Lộ trình: **G1 (đã làm)** thêm `target`, `link` vẫn trả song song cho client cũ · **G2 (TEST-238)** bỏ hẳn `link`.

## Quy tắc

- `NotificationTarget(Type, Id?, Params?)` — `Params` là map chuỗi → chuỗi. Tạo bằng **factory** (tên factory = `Type` dạng PascalCase, test kiểm tra): `ProjectTask(projectId, taskId, commentId?)`, `ApprovalRequest(id)`, `ChatConversation(id, messageId?)`, `NewsPost(id, commentId?)`, `Page(key, (tên, giá trị)…)`…
- `NotificationTargetTypes`: giá trị **ổn định**, đặt theo **tên đối tượng** (không theo màn hình). Thông báo có đối tượng cụ thể **phải** dùng đối tượng; `page` (+ `params.key` = đường dẫn bỏ "/" đầu, tham số còn lại = query) chỉ cho thông báo trỏ trang danh sách (nhắc chấm công, cảnh báo AI, bảo mật tài khoản, bàn giao tài liệu, bài bị gỡ).
- Module nghiệp vụ **không tự ghép URL**: truyền `Target` vào `NotificationRequest` (thay tham số link cũ) và `IPushSender.PushAsync`. `NotificationRequest.Link` còn lại `[Obsolete]` (chỉ dùng khi không có target — Notifier tách link như backfill).
- `NotificationCatalog.CategoryTargets`: loại được phép cho từng category (+ `ChatPushTargets` cho push tin nhắn). Gửi loại khác → Notifier log cảnh báo; `NotificationCatalogTests` quét code (câu lệnh có `NotificationCategories.X` + `NotificationTarget.Y(`) và fail nếu lệch, nếu category chưa khai báo, nếu loại chưa có factory / chưa được `NotificationLinkBuilder` xử lý, hoặc nếu `NotificationRequest` / `PushAsync` nhận chuỗi `"/…"`.

## Loại → link web (`NotificationLinkBuilder`, một chỗ cho chuông, email, push, webhook)

| Loại | Id | Params | Link (giữ như trước G1) |
|---|---|---|---|
| `project_task` | việc | `projectId`, `commentId?` | `/projects/{p}?task={id}[&comment=]` |
| `project` | dự án | `tab?` (`page?` từ backfill) | `/projects/{id}[?tab=…]` |
| `wiki_share` | link chia sẻ | `projectId`, `pageId?` | `/projects/{p}?tab=wiki[&page=]` |
| `approval_request` · `approval_delegation` | đơn · uỷ quyền | | `/approvals` ⚠ |
| `chat_conversation` | hội thoại | `messageId?` | `/chat?c={id}` |
| `news_post` | bài | `commentId?` | `/news/{id}[?comment=]` |
| `meeting_booking` | lịch họp | | `/meetings` ⚠ |
| `labor_contract` | HĐ lao động | | `/contracts` ⚠ |
| `payslip` | phiếu lương (mỗi người một thông báo) | | `/payslips` ⚠ |
| `asset_device` · `asset_service` · `asset_review` · `asset_handover` | thiết bị · dịch vụ · đợt rà soát · biên bản | | `/assets` ⚠ |
| `employee` | nhân viên | `view=assets` (nghỉ việc còn giữ tài sản) | `/assets` (không view → `/employees`) |
| `social_account` | BM | `view=posts?` | `posts` → `/social/facebook`; không → `/assets?tab=social&platform=facebook` |
| `social_post` | bài MXH | | `/social/facebook` |
| `document_asset` | tài liệu | | `/documents?asset={id}` |
| `expense_request` | đề nghị chi | | `/finance` ⚠ |
| `sales_customer` | khách hàng | | `/sales?customer={id}` |
| `sales_contract` | HĐ bán (CR được duyệt) | `customerId` | `/sales?customer={customerId}` |
| `sales_receivable` | đợt thu | `contractId` | `/sales?tab=receivables` ⚠ |
| `profile_change_request` | yêu cầu sửa hồ sơ | `view=profile?` | `profile` → `/profile` (người đề nghị); không → `/employees` (HR) |
| `page` | — | `key` + query | `/{key}[?query]` (key: `[a-z0-9-]` + `/`) |

⚠ = màn hình web chưa mở được theo id: link vẫn về trang danh sách, `target` có id cho app mobile / agent (mở theo id trên web là việc riêng).

## Lưu & trả ra

- Bảng `notifications.notifications`: `TargetType` (≤40), `TargetId` (uuid), `TargetParams` (jsonb), index (`TargetType`, `TargetId`); `Link` vẫn ghi (sinh từ target). Migration `NotificationTargets`.
- **Backfill**: ngay sau migration, `NotificationMigrator.BackfillTargetsAsync` (C#, lô 1000, idempotent) tách link cũ bằng `NotificationTargets.FromLink`: `/projects/{p}?task=…[&comment=]`, `/projects/{p}[?tab=…[&page=]]`, `/chat?c=`, `/news/{id}[?comment=]`, `/documents?asset=`, `/sales?customer=` → đối tượng; còn lại → `page` + key từ path + query; link null / lạ → `page` key rỗng (`/`). Không dòng nào còn `TargetType` rỗng. Cột `Link` không đổi.
- `GET /api/notifications` (chuông + trang): mỗi mục thêm `target: { type, id, params }` (null chỉ khi dòng chưa backfill), giữ `link`. MCP `list_notifications` trả nguyên.
- Push FCM `data` (map chuỗi): `targetType`, `targetId`, `targetParams` (JSON) + `link`.
- Webhook `notification`: thêm `target: { type, id, params }` (giữ `link`, `url`). Webhook `chat.message` / `chat.mention`: thêm `target` (`chat_conversation`, `params.messageId`), `link` sinh bằng `NotificationLinkBuilder`.
- Telegram đánh thức agent không mang link → không đổi.

## FE

- `utils/target.ts`: `targetToRoute(target)` theo từng loại (khớp bảng trên; `project_task` mở thẳng hộp thoại việc qua `?task=`), `notificationRoute(n)` = target, thiếu / loại lạ → `linkTarget(link)`; `pushRoute(data)` cho push lúc tab mở; `routeHref` (văn phòng ảo mở tab mới).
- Chuông, trang `/notifications`, `usePush` dùng `notificationRoute` / `pushRoute`. `public/sw.js` `notificationclick`: `targetUrl(data)` (bản rút gọn cùng bảng) → thiếu thì `data.link` → `/`.
