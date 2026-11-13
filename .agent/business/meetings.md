# Đặt phòng họp (module Meetings)

> Nguồn sự thật là code: `backend/src/Modules/Meetings/`, `frontend/src/features/meetings/`. Về [README.md](README.md).

Chủ dự án chốt (2026-11-06): **lịch đặt + hiển thị trong 3D**, mời người (chuông + email), **không chặn** ai vào phòng / kênh voice.

- **Phòng** = `rooms[kind = "meeting"]` trong `shared/office-map.json` (đọc qua `Realtime__MapPath`, cùng nguồn với văn phòng 3D): `meeting-hall` (Hội trường, 20 chỗ), `meeting-large` (10 chỗ), `meeting-small` (6 chỗ). Thêm phòng họp = sửa bản đồ (`design/tools/gen-map-1500.ts`).
- **Bảng** `meetings.bookings` (+ `attendees`): `RoomId`, `Title`, `StartAt` / `EndAt` (timestamptz UTC), người đặt, ghi chú, `CancelledAt` (huỷ = đặt giá trị, giữ lịch sử).
- **Quy tắc** (`Domain/Booking.cs` `BookingRules`, test `tests/OfficeHub.Modules.Meetings.Tests`): 15 phút ≤ thời lượng ≤ 8 giờ; không đặt quá khứ (cho lùi 5 phút); tối đa trước 60 ngày; ≤ 50 người mời (đang làm). Trùng = khoảng nửa mở `[start, end)` giao nhau — sát nhau (10:00 / 10:00) không trùng.
- **Chặn trùng khi đặt đồng thời**: transaction + `pg_advisory_xact_lock(hashtext('meetings:' + roomId))` rồi mới kiểm tra trùng → 409 kèm lịch đang chiếm.
- Vượt sức chứa → vẫn đặt được, trả `warnings`.
- Người đặt cần hồ sơ nhân viên (409 nếu không có). Huỷ: người đặt hoặc HR, lịch chưa kết thúc. Thông báo `meeting_invited` / `meeting_cancelled` (`INotifier`, link `/meetings`); HR huỷ hộ → báo cả người đặt.

## Endpoint (`/api/meetings`, đăng nhập)

| Method | Path | Ghi chú |
|---|---|---|
| GET | `/rooms` | `[{ id, name, capacity }]` |
| GET | `/bookings?from=&to=&roomId=&mine=true` | `from` / `to` ISO 8601 **kèm múi giờ** (thiếu → 400); mặc định hôm nay (giờ VN) → +7 ngày; ≤ 62 ngày. `isMine`, `canCancel` |
| GET | `/bookings/now` | Mỗi phòng: lịch đang diễn ra + lịch kế tiếp trong hôm nay (văn phòng 3D) |
| POST | `/bookings` | `{ roomId, title, startAt, endAt, attendeeIds?, note? }` → `{ booking, warnings }` |
| DELETE | `/bookings/{id}` | 204 |

Phiên họp agent (`/sessions`, trần `/agent-settings`) — [meetings-agents.md](meetings-agents.md).

Token AI được gọi các route này (tool `list_meeting_rooms`, `list_meetings`, `book_meeting_room`, `cancel_meeting` — [mcp.md](mcp.md)); tool nhận ngày + giờ VN rồi tự gắn `+07:00`.

## FE

- `/meetings` (menu Công việc → Phòng họp): dòng thời gian 7h–21h từng phòng (bấm chỗ trống để đặt nhanh, vạch đỏ = giờ hiện tại), danh sách lịch trong ngày, "Lịch của tôi" 14 ngày. Form gửi `vnInstant(date, time)` = `…+07:00`.
- Văn phòng 3D: `OfficeView` hỏi `/bookings/now` mỗi phút → `OfficeScene.setRoomStatus` treo bảng nhỏ ngay **trên cửa** phòng (cửa đầu tiên trong `office-map.json`, lệch 0,15 m ra hành lang, cao 2,5 m; không có cửa → giữa cạnh nam), chỉ trạng thái ngắn ≤ 24 ký tự, không tiêu đề: đỏ "Đang họp · đến HH:mm", xám "Trống · HH:mm kế tiếp". Bảng vẽ có depthTest + renderOrder 5 (dưới nhãn tên / bong bóng 10) → không đè lên avatar (TEST-87).
