# Nhắc hợp đồng sắp hết hạn / hết thử việc (module LaborContracts)

> Nguồn sự thật là code (`LaborContracts/.../Infrastructure/ContractReminderJob.cs`, `Domain/ContractRules.cs`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [contracts.md](contracts.md).

`ContractReminderJob` (`BackgroundService` trong Api): chạy 30 giây sau khởi động rồi **mỗi giờ**. Người nhận: **HR** (`ListByRoleAsync(hr)`, không có → admin) + **quản lý trực tiếp** của nhân viên, bỏ chính nhân viên đó; chỉ nhân viên còn làm; email + chuông, link `/contracts`. Mỗi lần nhắc lưu cờ ngay sau khi gửi → khởi động lại không nhắc lặp. Giả định **một** instance Api.

## Hợp đồng thường (`Fixed`, `Indefinite` không có hạn) — `contract_expiring`

Chưa chấm dứt, `EndDate` trong `[hôm nay, hôm nay + 30]` → `ContractRules.DueReminder`: còn ≤ 7 ngày & chưa nhắc 7 → nhắc 7 (đặt cả cờ 30); còn 8–30 ngày & chưa nhắc 30 → nhắc 30. Cờ `Reminded30At`, `Reminded7At`.

## Thử việc (`Probation`) — `probation_ending` (chủ dự án duyệt 2026-11-07)

Hợp đồng thử việc **không** còn nhắc chung 30 / 7 ngày (thay hẳn bằng nhắc riêng — tránh hai thông báo cho cùng một việc). `ContractRules.DueProbationReminder(c, hợp đồng cùng nhân viên, hôm nay)`:

| Điều kiện | Kết quả |
|---|---|
| Đã chấm dứt (`TerminatedOn`), đã xoá, hoặc nhân viên đã có hợp đồng khác (chưa xoá) **bắt đầu từ ngày kết thúc thử việc trở đi** | Không nhắc |
| Còn 4–7 ngày, chưa nhắc 7 | Nhắc 7 ngày |
| Còn 0–3 ngày, chưa nhắc 3 | Nhắc 3 ngày (tạo muộn chỉ nhắc mốc gần nhất) |
| Đã qua ngày kết thúc 1–7 ngày, chưa cảnh báo | **Quá hạn** — gửi một lần (bù tối đa 7 ngày nếu job không chạy đúng hôm sau; sau đó bỏ, không cảnh báo hợp đồng cũ) |

Cờ: `Reminded7At` (dùng chung), `Reminded3At`, `OverdueRemindedAt` (migration `ProbationReminders`); mốc sau đặt luôn cờ mốc trước. Các cờ nằm trong danh sách bỏ qua của lịch sử sửa.

Nội dung (tiếng Việt): mã · tên · phòng, số hợp đồng + khoảng thử việc, "Chưa có hợp đồng lao động tiếp theo", việc cần làm theo **BLLĐ 2019 Điều 27**: (1) đánh giá kết quả thử việc, (2) thông báo kết quả cho người lao động, (3) đạt → ký HĐLĐ; không đạt → chấm dứt hợp đồng thử việc. Quá hạn: "Quá hạn: thử việc của X đã kết thúc dd/MM/yyyy, chưa có hợp đồng mới".

Test: `tests/OfficeHub.Modules.LaborContracts.Tests/ProbationReminderTests.cs`; e2e pha b của `scripts/dev/approval-delegation-e2e.ts`.

**Lưu ý triển khai:** lần chạy đầu sau khi deploy, hợp đồng thử việc đã hết trong 7 ngày qua mà chưa có hợp đồng tiếp theo sẽ nhận cảnh báo "quá hạn" một lần.
