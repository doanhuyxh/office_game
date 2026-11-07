# Tài sản công ty — rà soát quyền, kiểm kê, xuất Excel, MCP (module Assets)

> Nguồn sự thật là code. Phần lõi (thiết bị, dịch vụ, ghế, thông báo, quyền): [assets.md](assets.md). Bảng thuộc schema `assets`.

## Rà soát quyền truy cập (`access_reviews`, `access_review_items`)

- HR bắt đầu `POST /reviews { title, dueDate, serviceId? }` (bỏ `serviceId` = mọi dịch vụ `Active`): **chụp** mọi ghế đang dùng thành các mục (tên dịch vụ, tên đăng nhập, nhân viên). Người rà soát = **quản lý trực tiếp** của người giữ ghế; không có quản lý → HR (`ReviewerEmployeeId = null`). Chỉ một đợt `Open` tại một thời điểm.
- Người rà soát chọn `Keep` hoặc `Revoke` (kèm ghi chú) cho từng mục — **chưa thu hồi ngay**. HR quyết định thay được mọi mục.
- HR đóng đợt (`POST /reviews/{id}/close`): mọi mục `Revoke` được thu hồi ghế (đúng quy tắc thu hồi, báo nhân viên `asset_returned`), mục chưa quyết coi như giữ. Ghế đã thu hồi trong lúc rà soát → bỏ qua.
- Thông báo `asset_review` (chuông + email) cho người rà soát khi bắt đầu; job nhắc **một lần** (cờ `RemindedAt`) khi tới `DueDate` mà còn mục chưa quyết.
- Quyền: quản lý chỉ thấy / quyết mục của mình; `GET /reviews/pending` = mục chờ tôi quyết trong đợt đang mở.

## Kiểm kê (`stocktakes`, `stocktake_items`)

- HR `POST /stocktakes { title }`: chụp mọi thiết bị `InStock` / `InUse` / `Repair` (không `Retired`/`Lost`, không đã xoá) kèm người giữ lúc đó. Chỉ một đợt `Open`.
- HR đánh dấu từng mục `Found` / `Missing` (+ ghi chú) bằng `POST /stocktakes/items/{id}/check`; có thể sửa lại khi đợt còn mở.
- Đóng đợt `POST /stocktakes/{id}/close { markMissingAsLost }`: mục chưa kiểm được ghi là `Missing` (không đổi thiết bị). `markMissingAsLost = true` chỉ cho khi **đã kiểm hết** (còn mục chưa kiểm → 409, tránh chuyển nhầm sang Mất) → thiết bị `Missing` chuyển `Lost` (lý do "Kiểm kê không thấy", đóng bản ghi giao nhận, báo người đang giữ).

## Xuất Excel (HR, ClosedXML)

`GET /export/devices` (mã, loại, tên, hãng, model, serial, ngày mua, giá mua, bảo hành, trạng thái, người giữ) · `GET /export/services` (sheet "Dịch vụ" + sheet "Ghế đang dùng"). Tên file `thiet-bi-yyyy-MM-dd.xlsx`, `dich-vu-yyyy-MM-dd.xlsx`.

## Tool MCP (chỉ đọc; token AI chỉ gọi được 2 route này)

`get_my_assets` → `GET /api/assets/my` · `get_employee_assets` → `GET /api/assets/employees/{id}/holdings` (quyền như web: quản lý của người đó / HR). Đã thêm vào `AccessTokenAuth.Allowed`, catalog `/mcp-tools`, số tool trong [mcp.md](mcp.md).
