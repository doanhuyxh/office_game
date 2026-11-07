# Uỷ quyền duyệt (module Approval)

> Nguồn sự thật là code (`Approval/.../Domain/ApprovalRules.cs`, `Features/DelegationEndpoints.cs`, `Infrastructure/DelegationLookup.cs`, `frontend/src/features/approvals/`); nếu code khác tài liệu, tin code và sửa tài liệu. Về [approval.md](approval.md).

Chủ dự án chốt 2026-11-07: **quản lý tự uỷ quyền theo khoảng ngày**. Bảng `approval.delegations` ([database-workflow.md](../database-workflow.md)).

## Quy tắc (`DelegationRules`, test `tests/OfficeHub.Modules.Approval.Tests`)

- Người uỷ quyền (`Delegator`) = nhân viên **đang làm và có cấp dưới** (`GetSubordinateIdsAsync` khác rỗng) — dựa trên hồ sơ, không dựa vai trò. Người được uỷ quyền (`Delegate`) = **một** nhân viên đang làm, có tài khoản.
- Khoảng `[FromDate, ToDate]` là ngày địa phương (`Office__TimeZone`), tính cả hai đầu. `ToDate ≥ hôm nay` (`FromDate` được trước hôm nay, chỉ phần từ hôm nay có tác dụng), `ToDate ≥ FromDate`, **tối đa 90 ngày** (`MaxDays`; lâu hơn thì nên đổi quản lý trực tiếp).
- Lỗi 400 theo field: `"Không thể uỷ quyền cho chính mình"`, `"Người được uỷ quyền phải là nhân viên đang làm việc"`, `"… chưa có tài khoản đăng nhập"`, `"Không tạo uỷ quyền cho khoảng ngày đã qua"`, `"Uỷ quyền tối đa 90 ngày"`, `"Trùng thời gian với uỷ quyền dd/MM/yyyy–dd/MM/yyyy đang có"` (key `fromDate`), không có cấp dưới (key `delegatorEmployeeId`).
- **Không trùng**: mỗi người uỷ quyền chỉ một uỷ quyền chưa thu hồi + chưa hết hạn phủ một ngày. Kiểm tra trong transaction + `pg_advisory_xact_lock` theo người uỷ quyền.
- **Không bắc cầu**: chỉ uỷ quyền trực tiếp của `ApproverEmployeeId` có tác dụng (A → B, B → C: C không duyệt đơn của A).
- Uỷ quyền **cộng thêm** quyền: người quản lý vẫn duyệt được. Chỉ bước `Manager`; bước `Hr` không đổi. **Không tự duyệt** vẫn giữ (người được uỷ quyền gửi đơn thì không duyệt được đơn đó).
- Hiệu lực tính lúc gọi API (`DelegationLookup.Today()`): hết hạn / thu hồi → mất ngay quyền duyệt, đơn biến khỏi hộp duyệt, `GET /{id}` → 403 (trừ đơn đã tự tay duyệt thay).
- Trạng thái (tính lúc đọc): `Revoked` (có `RevokedAt`) / `Upcoming` / `Active` / `Expired`. Thu hồi = đặt `RevokedAt/ById/ByName` (không xoá dòng), chỉ khi `Active` / `Upcoming`; đã thu hồi / hết hạn → 409.

## Endpoint (`/api/approval/delegations`, đăng nhập)

| Method | Path | Quyền / ghi chú |
|---|---|---|
| GET | `/` | Của tôi: `{ employeeId, canDelegate, given[], received[] }` (200 dòng mới nhất) |
| GET | `/all?status=current\|all&page=&pageSize=` | HR — `current` (mặc định) = chưa thu hồi + chưa hết hạn |
| POST | `/` | `{ delegatorEmployeeId?, delegateEmployeeId, fromDate, toDate, note? }` — `delegatorEmployeeId` trống = tôi; người khác → chỉ HR (403 `"Chỉ HR được tạo uỷ quyền thay người khác"`) |
| POST | `/{id}/revoke` | Người uỷ quyền hoặc HR (403 `"Chỉ người uỷ quyền hoặc HR được thu hồi"`) |

DTO `DelegationDto`: người uỷ quyền / được uỷ quyền (`PersonBrief`), ngày, ghi chú (≤ 500), `status`, người tạo / thu hồi, `canRevoke`. **Token AI**: chỉ GET (POST bị `AccessTokenAuth.IsAllowed` chặn — trao quyền duyệt chỉ làm trên web). Tool MCP duyệt đơn đi qua API nên tự theo quy tắc mới (`list_approval_inbox` có cả đơn duyệt thay, `decideOnBehalfOfName`).

## Thông báo (`ApprovalNotifications`, `Category = approval_delegation`, link `/approvals`)

| Khi | Ai nhận | Kênh |
|---|---|---|
| Tạo uỷ quyền | Người được uỷ quyền (kèm số đơn đang chờ nếu hiệu lực ngay) | email + app |
| ″ do HR tạo thay | + người uỷ quyền | chỉ app |
| Thu hồi | Người được uỷ quyền | email + app |
| ″ do người khác (HR) thu hồi | + người uỷ quyền | chỉ app |
| Gửi đơn / chuyển tới bước `Manager` khi đang có uỷ quyền | Người quản lý **và** người được uỷ quyền (`approval_requested`) | email + app |
| Duyệt thay | Tên người quyết định trong thông báo cho người gửi: `"X (duyệt thay Y)"` | như duyệt thường |

Bỏ người thao tác (không tự báo mình).

## UI (`features/approvals`)

Tab "Uỷ quyền" (`DelegationsTab`): "Tôi uỷ quyền cho" (khi có cấp dưới hoặc đã từng giao), "Tôi được uỷ quyền duyệt thay", HR thêm "Toàn công ty" (ô "Gồm cả đã hết hạn / thu hồi"). Bảng `DelegationList` có nút "Thu hồi" theo `canRevoke`. `DelegationDialog`: HR chọn người uỷ quyền (chỉ người có cấp dưới), người duyệt thay (`SearchSelectField`, bỏ chính người uỷ quyền), từ / đến ngày (bộ chọn ngày tiếng Việt), ghi chú. E2E: `scripts/dev/approval-delegation-e2e.ts` ([e2e.md](../e2e.md)).
