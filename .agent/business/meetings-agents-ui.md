# Giao diện "Họp với AI" (TEST-83)

> Về [meetings-agents.md](meetings-agents.md) (phiên họp, lượt nói, endpoint) · tool MCP của bot: [meetings-agents-mcp.md](meetings-agents-mcp.md). Code FE: `frontend/src/features/meetings/` (`agent-meeting-dialog`, `agent-meeting-bar`, `agent-meeting-settings-card`).

Chủ dự án chốt 2026-11-13: **chỉ người thật mở và dừng**; trần mặc định 30 lượt / 30 phút, admin chỉnh. FE chỉ hiển thị — mọi quy tắc ở back-end (`AgentMeetingRules`, `AgentMeetingEndpoints`); ẩn nút với người không có quyền chỉ là tiện dụng.

## Mở họp

- **Trang `/meetings`**: nút **"Họp với AI"** cạnh "Đặt phòng" (trang không có tab → nút ở hàng điều khiển sẵn có, theo [../frontend.md](../frontend.md)). Ẩn với tài khoản bot (back-end 403).
- **Kênh phòng họp** (trang Tin nhắn, kênh `Room` của phòng `kind = meeting`) và **HUD 3D** khi đang đứng trong phòng họp: thanh trạng thái có nút "Họp với AI" khi phòng không có phiên — hộp thoại điền sẵn phòng.
- Hộp thoại `AgentMeetingDialog`: phòng họp, chủ đề (bắt buộc, ≤ 300), bot dự (2..8, tìm theo tên / mã / phòng ban / chức vụ, chip BOT), bot chủ trì trong số bot đã chọn (bot chọn đầu tiên tự làm chủ trì). Lỗi trường từ back-end hiện dưới ô; phòng đang có phiên → toast 409 của back-end.
- Danh sách bot: **`GET /api/meetings/agent-bots`** → `[{ employeeId, code, name, departmentName, positionName, avatarUrl }]` — nhân viên còn làm + tài khoản đang hoạt động gắn cờ bot (tra `IEmployeeDirectory` + `IAccountService`, không JOIN chéo schema). Cookie người thật; token AI → 403 (route cũng ngoài allowlist `AccessTokenAuth`).
- Mở từ `/meetings` xong → chuyển sang `/chat?room=<roomId>` (trang Tin nhắn tìm kênh `Room` của phòng, tải lại danh sách một lần nếu chưa có, rồi đổi thành `?c=<id>`).
- **Người mở được thêm vào kênh phòng** (`AgentMeetingTurnService.OpenedAsync` → `IMeetingRoomChannel.EnsureMembersAsync` cùng các bot) — mở từ web mà chưa từng đi vào phòng ở 3D vẫn theo dõi / nhắn xen được.

## Thanh trạng thái (`AgentMeetingBar`)

Đặt dưới tiêu đề khung chat kênh phòng (web) và trên log chat HUD 3D (`variant="hud"`, class `.agent-meeting` trong `office.css`). Phòng không phải phòng họp → không hiện.

- Dữ liệu: `GET /sessions?roomId=` lấy phiên mới nhất; **đang họp → hỏi lại mỗi 3 giây**, không thì 15 giây (thấy phiên người khác vừa mở). Lượt đổi theo tin bot gửi nên "thời gian thực" = độ trễ ≤ 3 giây.
- Đang họp: "Họp với AI: chủ đề" · "Đang nói: tên bot" · "Lượt x / trần" · "Còn m:ss" (đếm ngược tới `expiresAt`) · nút **Dừng họp** khi DTO trả `canStop` (người mở / HR / admin) → hộp xác nhận `confirmDialog` → `POST /sessions/{id}/stop`.
- Vừa kết thúc (≤ 60 phút): dòng tóm tắt lý do — `Stopped` "<người> dừng cuộc họp" · `TurnLimit` "đã dùng hết N lượt" · `TimeLimit` "hết N phút" · `AllPassed` "không còn ai phát biểu" (`utils/labels.ts` → `endReasonText`, khớp `AgentMeetingTurnRules.EndNotice`).
- Phiên mở / kết thúc (đổi `id:status`) → khung chat web tải lại tin để thấy tin hệ thống (tin hệ thống chỉ lưu DB, chưa phát realtime — HUD 3D không hiện tin hệ thống).

## Tin hệ thống

- Mở họp → tin `AgentMeetingTurnRules.OpenNotice`: "<người mở> mở cuộc họp agent "<chủ đề>" — chủ trì: <bot>, N bot dự, tối đa X lượt / Y phút." (TEST-83, cùng đường `PostSystemAsync` với tin kết thúc).
- FE nhận ra tin hệ thống bằng `senderId` rỗng (`00000000-…`, người gửi `OfficeHub`) → `chat/utils/labels.ts` `isSystemMessage`; `MessageItem` hiện dòng giữa khung (nền `info`), không bong bóng / menu.

## Cấu hình trần

Hệ thống → Cấu hình (`/system?tab=config`, trang chỉ admin): thẻ **"Cuộc họp với AI"** (`AgentMeetingSettingsCard`, kiểu thẻ "Giới hạn trợ lý AI") — số lượt / số phút tối đa với khoảng + mặc định từ `GET /agent-settings`, lưu `PUT` (`AuthPolicies.Admin`; người khác 403). Áp dụng cho phiên mở sau đó.

E2E: `scripts/dev/agent-meeting-ui-e2e.ts` ([../e2e.md](../e2e.md)).
