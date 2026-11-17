# Front-end: ảnh / video

> Về [frontend-ui.md](frontend-ui.md) · [AGENTS.md](../AGENTS.md).

## Ảnh / video ngoài

- (TEST-22, `utils/trustedMedia.ts`): Markdown (`components/common/markdown.tsx`) và link media của việc (`task-media`) chỉ tự tải ảnh / file video từ cùng domain hoặc S3 `*.amazonaws.com`; nguồn khác hiện thành link bấm mở (tránh ảnh theo dõi). YouTube / Vimeo / Drive nhúng như cũ.

## Trình xem ảnh toàn màn hình (TEST-147)

`components/common/image-viewer` → `<ImageViewer images index onIndex onDownload? />`; `images: { id, url, fileName, caption?, downloadable? }[]`, `index: number | null` (null = đóng). **Mọi chỗ xem ảnh lớn dùng component này** — không tự bọc `<img>` trong `Dialog`.
- Radix Dialog (giữ `role="dialog"` + bẫy tiêu điểm → engine 3D / phím tắt HUD bỏ qua phím, xem `TYPING_SCOPES`) nhưng tự vẽ: lớp phủ `bg-black/90` + blur, nội dung `fixed inset-0`; luôn tối ở cả theme sáng / tối (màu đen / trắng cố ý, không dùng token).
- Thanh trên tách khỏi ảnh: `caption` + tên tệp (cắt "…") | bộ đếm "3 / 12" | Tải về (khi có `onDownload` và `downloadable !== false`, nút `loading`) | Mở tab mới | Đóng. Nhiều ảnh: cột nút trước / sau hai bên (không đè ảnh), phím ← →, vòng tròn; một ảnh thì ẩn nút + bộ đếm.
- Ảnh ở giữa, kích thước thật, chỉ thu nhỏ khi vượt khung (không phóng to ảnh nhỏ). Zoom tự viết (pointer events + CSS transform, không thư viện): nhấp / chạm đúp vừa màn hình ↔ 100% (ảnh nhỏ: ↔ 200%), lăn chuột quanh con trỏ (vừa màn hình → 400%), kéo khi đang zoom, chụm hai ngón; đổi ảnh = đặt lại zoom (`Stage` có `key` theo ảnh). Không vuốt ngang chuyển ảnh (xung đột chụm).
- Đóng: Esc, bấm nền (không phải ảnh / nút), ✕. Ảnh lỗi (link presigned hết hạn sau 60 phút) → "Không tải được ảnh".
- `data-testid`: `image-viewer`, `-img` (`data-scale`, `data-fit`), `-stage`, `-caption`, `-filename`, `-counter`, `-prev`, `-next`, `-download`, `-open`, `-close`, `-error`. E2E: `scripts/dev/image-viewer-checks.ts` (gọi từ `chat-ui-e2e.ts`, `office-chat-full-e2e.ts`).
- Đang dùng: `MessagePane` (chat web + khung chat 3D — danh sách = ảnh của mọi tin đã tải, bỏ tin thu hồi / tin hệ thống, `caption` "Người gửi · ngày giờ", tải về `downloadAttachment` ở `features/chat/utils/attachments.ts`, ảnh tin đang gửi không tải về), `MediaGrid` của Bảng tin (tải về `newsApi.mediaUrl(id, true)`).
