# Dự án đã đóng (`ProjectStatus.Closed`) — TEST-213

Chủ dự án chốt 2026-11-23. Quy tắc: `Domain/ClosedProjectRules.cs` (test `ClosedProjectRulesTests`), dùng qua `ProjectViewer.CanWorkOn(id, active)` / `ClosedError(id, active)` / `CanComment(id)`; kho tài liệu: `DocumentRules.CanWriteProjectSpace` + `DocumentAccess.CanWriteProject` (test `ProjectSpaceWriteTests`).

- **Mở lại được**: quản lý dự án / HR `PUT /api/projects/{id}` với `status: Active` → `ClosedOn = null`, mọi thứ như cũ.
- **Quản lý dự án + HR / admin (trên web)**: làm việc **đầy đủ** như khi dự án đang chạy — tạo / sửa / chuyển trạng thái / xoá việc, việc phải chờ (`dependsOn`), thêm / bỏ người theo dõi.
- **Thành viên thường**: tạo / sửa / chuyển / xoá việc (kể cả việc mình tạo), việc phải chờ, người theo dõi → **409 "Dự án đã đóng — bạn chỉ bình luận được"** (sau kiểm 403 `CanWork`). **Được**: bình luận chữ + ảnh / tệp (vé `POST /tasks/{tid}/uploads`), xoá bình luận của chính mình (trên web).
- **Token AI / bot** (kể cả của quản lý dự án): không ghi việc → 409 "trợ lý AI không sửa việc ở dự án đã đóng"; DTO `canWork = false`. Bình luận qua token vẫn được như trước. Không đánh thức bot (Telegram giao / trả lại / sẵn sàng / @nhắc / `column_entered` + webhook) khi dự án đóng (`ClosedProjectRules.WakesBots`); agent-runner bỏ qua việc có `projectActive = false`.
- **Vẫn chặn khi đóng (409), không đổi**: mốc nghiệm thu (tạo / sửa / xoá / nghiệm thu), yêu cầu thay đổi (CR: tạo / sửa / đổi trạng thái — TEST-249), cột trạng thái, hướng dẫn làm việc / mô tả dự án, link tải lên từ thiết bị khác `/u/{token}` (tạo link 409, link cũ 410).
- **DTO dự án**: `canWork` = `CanWorkOn` (đóng → chỉ quản lý dự án / HR trên web); **`canComment`** = thành viên + quản lý, mọi trạng thái. `myAccess` (bảng quyền phụ lục) không đổi theo trạng thái.
- **Kho tài liệu dự án đóng**: thành viên thường chỉ đọc / tải về (tải lên, thư mục, sửa tài liệu của chính mình → 403); quản lý dự án + HR toàn quyền (tải lên, tạo / đổi tên / xoá thư mục, thay file, sửa, xoá). `GET /api/documents/spaces` → `canWrite` theo người xem, `closed` vẫn báo dự án đóng.
- **FE**: bảng việc `readOnly = !canWork`; dòng chú thích "Dự án đã đóng — bạn chỉ bình luận được." (thành viên) / "… bạn là quản lý nên vẫn sửa được việc." (quản lý); `TaskDialog` hiện ô bình luận theo `canComment`, ô sửa / kéo thả theo `canWork`, ẩn nút link tải lên khi dự án đóng; `library-tab` chỉ hiện "Dự án đã đóng — kho chỉ đọc." khi `closed && !canWrite`.
- E2E: `scripts/dev/closed-project-e2e.ts` (59/59, 2026-11-23).
