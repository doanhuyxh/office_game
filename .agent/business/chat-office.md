# Chat trong văn phòng 3D (khung chat HUD)

> Nguồn sự thật là code: `frontend/src/features/office/components/office-chat/`, `office-chat-button/`, `store/office.store.ts` (`chatOpen`, `chatRequest`, `openChat`). Về [chat.md](chat.md) · HUD / engine: [office-engine.md](office-engine.md). Thiết kế: `design/mockups/office-chat/` (chủ dự án yêu cầu 2026-11-16: toàn bộ tính năng `/chat` trong 3D).

## Dùng chung component `/chat` (TEST-126)

Khung chat 3D **không chép code**: dùng `ConversationList`, `MessagePane`, `NewChatDialog` từ `@/features/chat` (cùng `ChatProvider` bọc trang `/office` — TEST-125) → 1-1, nhóm, kênh phòng, tệp / ảnh, sửa, thu hồi, cảm xúc, tìm, @nhắc, "Họp với AI" (thanh + hộp thoại trong `MessagePane` kênh phòng) giống hệt `/chat`. Màu theo **token theme app** (sáng / tối) như bảng `.bot-act`; `.office-root` đặt `color-scheme: dark` nên `.chat-panel` đặt lại `light` (`.dark` → `dark`).

Phần mở rộng thêm cho chỗ nhúng (mặc định giữ nguyên hành vi `/chat`):

- `ConversationList`: `pinnedId` + `pinnedLabel` (kênh phòng đang đứng xếp đầu, nhãn "ĐANG Ở ĐÂY"), `compact` (cột biểu tượng 60 px, tên ở tooltip, số chưa đọc trên biểu tượng), `onToggleCompact` (nút thu gọn / mở rộng). Dòng hội thoại cao ≥ 44 px; 1-1 với bot có `BotBadge`.
- `MessagePane` (`MessagePaneExtras`): `back` (`mobile` / `always` / `none`), `subtitle`, `headerActions`, `notice`, `placeholder`, `autoFocus`.
- `Composer`: `placeholder`, `autoFocus` (false → không tự focus khi mở — kênh phòng tự mở lúc đang đi bằng phím không cướp phím).
- `ChatContext.subscribe(listener)` → nghe tin mới của người khác `(message, viewing)`; âm báo vẫn do `ChatProvider`.
- `useChatPeer(conversation)`: người kia của 1-1 (phòng ban, mã) — tìm theo tên qua `/api/chat/people` rồi khớp `peerUserId` (back-end không đổi).

## Hành vi

- **Khung**: ghim góc dưới trái (mặc định, rộng ~400, cao `min(680px, 100dvh - 140px)` ≥ 320 — TEST-146, CSS `.chat-panel.docked`; mép trên nằm dưới thẻ tài khoản thu gọn, thẻ mở ra nổi trên khung nhờ `.me.open` z-index 8) hoặc nổi (⤢) ~780 × 760 (vừa màn hình) giữa màn hình — `useFloatingPanel` (kéo bằng đầu khung, đổi cỡ góc dưới phải ≥ 300 × 320, nhớ ở localStorage `officehub.office.chat-panel-v2`). Rộng ≥ 600 px → danh sách + hội thoại cạnh nhau; hẹp hơn → hai màn hình (danh sách ↔ hội thoại, nút quay lại) như `/chat` trên điện thoại. Danh sách thu gọn nhớ ở `officehub.office.chat-list-compact`. Mở / đóng nhớ ở `officehub.office.chat-open` (lần đầu: máy tính mở, cảm ứng đóng).
- **Điện thoại** (≤ 640 px): khung 92% rộng, chừa 200 px dưới cho joystick / zoom; cảm ứng xoay ngang: chừa 160 px hai bên. Nút ở đầu khung 44 px.
- **Kênh phòng tự mở**: bước vào phòng có tường → chọn kênh phòng (không focus ô soạn) + dòng báo "Bạn vừa vào <phòng> — đã mở kênh của phòng · Quay lại <hội thoại trước>"; ra khỏi phòng → về hội thoại trước **nếu** vẫn đang xem kênh phòng đó (đã tự chọn hội thoại khác thì giữ). Kênh phòng chưa có trong danh sách (Realtime cấp thành viên chạy nền) → tải lại danh sách sau 1,5 giây. Ô soạn kênh phòng: "Chỉ người trong <phòng> thấy…".
- **Đầu khung 1-1**: phòng ban + "đang trong văn phòng · cách bạn N m" (vị trí từ `OfficeScene`, cập nhật mỗi giây; người kia không có trong văn phòng → không hiện) + nút **Đi tới** → `OfficeScene.walkNear(id)`: đích lùi ~1 m về phía mình, tìm đường lấy ô đi được gần nhất; không có đường → toast "Không có đường tới chỗ đó".
- **Bấm vào nhân vật** (TEST-127): menu cạnh avatar → **Nhắn tin riêng** mở / tạo 1-1 rồi `openChat(id)` (người hoặc bot), **Đi tới cạnh** (người) — chi tiết [office-engine.md](office-engine.md) § Menu bấm nhân vật.
- **Chưa đọc**: nút chat trên thẻ trạng thái có tổng chưa đọc (`useChatUnread`), bấm = mở / đóng. Chat đóng → nút "Tin nhắn" góc dưới trái (cảm ứng: trên joystick) có số + "N hội thoại chưa đọc".
- **Toast**: tin **1-1 / nhóm** của người khác khi khung đóng hoặc đang mở hội thoại khác → "X nhắn bạn" (nhóm: "X nhắn trong <nhóm>") + 1 dòng xem trước + **Trả lời** (`openChat(id)` — mở khung, chọn đúng hội thoại) / **Để sau**; một toast / hội thoại (`id` = hội thoại). Kênh Office / phòng chỉ cộng số chưa đọc. `openChat(conversationId)` là điểm vào cho "Nhắn tin riêng" khi bấm nhân vật (TEST-127).
- **Phím**: gõ trong khung, menu "…" của tin, danh sách gợi ý @, hộp thoại → không đi / không E / M (`TYPING_SCOPES`).
- Bỏ log HUD cũ (hai tab + store `chat` / `pushChat`, kiểu `ChatDto`); sự kiện `Chat` của hub văn phòng vẫn phát (script cũ) nhưng FE đăng ký rỗng.

## Test

- `scripts/dev/office-chat-full-e2e.ts` (TEST-128, Chrome, **DB tạm**, lệnh dựng ở đầu file) — xuyên 3D ↔ `/chat`: bấm avatar → Nhắn tin riêng → chữ + ảnh S3; người nhận có số chưa đọc + âm báo + toast → Trả lời mở đúng hội thoại; người thứ ba ở `/chat` thấy Toàn văn phòng hai chiều nhưng không thấy 1-1 (404); sửa / cảm xúc / thu hồi / tìm trong khung 3D; tải lại còn lịch sử; vào Phòng họp lớn → kênh phòng tự mở (không cướp focus), gửi được ngay, ra → về hội thoại trước; gõ trong ô soạn / menu tin / hộp emoji không đi; đúng **1** WebSocket `/rt/hub/chat` trên `/office` (đếm bằng bọc `window.WebSocket`); điện thoại 390 × 844 hai màn hình, không che joystick / zoom — 77/77 (2026-11-16).
- `office-chat-e2e.ts` (kênh phòng chỉ người trong phòng, Toàn văn phòng, joystick) và phần HUD của `chat-ui-e2e.ts` viết lại theo khung mới, chạy DB tạm. Còn dựa trên log hai tab cũ, chưa viết lại: `office-chat-float-e2e.ts`, phần HUD `rename-e2e.ts`.
- Mẹo viết script: truy vấn trong `[data-testid=office-chat]` bằng đúng `data-testid` `chat-*` của `/chat`; khung ghim góc hẹp (< 600 px) là hai màn hình → bấm `chat-back` trước khi chọn hội thoại; đăng nhập đổi security stamp nên cookie REST lấy trước khi trình duyệt đăng nhập sẽ 401 → gọi Api bằng `fetch` trong trang.
