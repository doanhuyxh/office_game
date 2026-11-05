# Giải trình chấm công (module Attendance)

> Nguồn sự thật là code (`backend/src/Modules/Attendance/OfficeHub.Modules.Attendance/Features/Corrections/CorrectionEndpoints.cs`, `frontend/src/features/attendance/components/CorrectionDialog.tsx`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [README.md](README.md).

Nhân viên quên chấm hoặc chấm sai → khai **một** lần chấm (vào hoặc ra) với giờ thực tế → duyệt qua [approval.md](approval.md) (`ApprovalTypes.AttendanceCorrection`, bước `[Manager, Hr]`) → hệ thống **thêm** sự kiện `Manual`. Không sửa / xoá sự kiện cũ (nguyên tắc [attendance.md](attendance.md#nguyên-tắc)).

## Endpoint (`/api/attendance`, nhân viên)

| Method | Path | Ghi chú |
|---|---|---|
| POST | `/corrections` | `{ workDate, type: "In"\|"Out", time: "HH:mm", workMode: "Onsite"\|"Remote", reason }` → `CorrectionDto` |
| GET | `/corrections/my?month=yyyy-MM` | 200 dòng mới nhất |

Không có API sửa / xoá giải trình; huỷ qua `/api/approval/{id}/cancel`.

## Validate (400 theo field) — giữ nguyên thứ tự gửi

| Field | Lỗi |
|---|---|
| `type` | `"Chọn giờ vào hoặc giờ ra"`; trùng giải trình cùng ngày, cùng loại đang chờ → `"Đã có giải trình cùng ngày, cùng loại đang chờ duyệt"` |
| `time` | `"Giờ phải có dạng HH:mm"`; hôm nay mà giờ chưa tới → `"Giờ giải trình chưa tới"` |
| `workMode` | `"Chọn hình thức làm việc"` |
| `reason` | bắt buộc, ≤ 500 |
| `workDate` | `"Không giải trình cho ngày trong tương lai"`, `"Chỉ giải trình được trong 31 ngày gần nhất"` (`MaxDaysBack = 31`), `"Ngày giải trình trước ngày vào làm"` |

Sau validate: lưu `Pending` → `SubmitAsync` → lưu `ApprovalRequestId`; gửi duyệt lỗi → xoá bản ghi vừa tạo.

## Khi được duyệt (`CorrectionApprovalHandler.OnApprovedAsync`)

1. Bỏ qua nếu giải trình không còn `Pending`.
2. Nếu chưa có sự kiện `IdempotencyKey = "correction:{Id}"` → thêm `AttendanceEvent { Source = Manual, Type, WorkMode, Note = reason, OccurredAt = giờ địa phương đổi sang **UTC** }`.
3. `Status = Approved`, lưu.

`OccurredAt` **phải** `.ToUniversalTime()` — Npgsql từ chối `DateTimeOffset` có offset khác 0 cho `timestamptz` (lỗi 500 đã gặp).

Bảng công tính lại khi đọc nên tự đúng ngay. Giải trình một lần chấm `Out` cho ngày `MissingCheckout` sẽ đóng phiên mở; giải trình `In` + `Out` cho ngày `Absent` tạo một phiên mới.

## UI

- `MonthTimesheet` nhận `onCorrect` (chỉ ở tab "Của tôi" của `AttendancePage`): nút "Giải trình" (`data-testid="correct-yyyy-MM-dd"`) cho ngày trong 31 ngày gần nhất, không phải `NotYet` / `NotEmployed`. Dưới trạng thái ngày hiện "Giải trình vào/ra HH:mm ⏳ chờ duyệt / ✓ đã duyệt / ✕ bị từ chối".
- `CorrectionDialog` gợi ý loại (đã có giờ vào → "Giờ ra") và giờ (08:30 / 17:30), mặc định "Tại văn phòng".
