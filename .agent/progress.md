# Tiến độ & bàn giao phiên

> Cập nhật **2026-11-06 (tối)**: production `https://office.lokid.me` (commit `ab8fac0`). Sau đó làm xong, **chưa commit / deploy**: PWA + mobile, 3D (chat phòng, GLB, joystick), bảng lương, ký điện tử, cấp bậc + chức danh, hướng dẫn phòng ban / chức vụ cho AI, sơ đồ tổ chức, phân quyền UI + danh bạ theo vai trò, hồ sơ cá nhân, nút cấu hình cột. Api dev :5080 đã khởi động lại với code mới (migration đã chạy trên DB thật). Đọc file này đầu phiên mới. Chi tiết: bảng định tuyến [AGENTS.md](../AGENTS.md); kế hoạch tổng `docs/ARCHITECTURE_V2.md`.

## Đã xong

| Hạng mục | Tài liệu (`business/`) |
|---|---|
| Identity, Organization, chấm công + giải trình + tăng ca, phê duyệt, nghỉ phép, thông báo, hợp đồng (+ mẫu Word) | `auth`, `organization`, `attendance*`, `approval`, `leave`, `notifications`, `contracts` |
| Báo cáo + Excel, quy ra tiền tăng ca / phép (khi nghỉ việc) · đặt phòng họp (+ "Đang họp" trong 3D) | `reports`, `meetings` |
| Nhắc quên chấm ra (chuông) · nhập nhân viên từ Excel · lịch sử sửa dữ liệu nhân sự (`[Audited]`, che lương) | `attendance-corrections`, `employee-import`, `audit` |
| Văn phòng 3D giai đoạn 1 (bản đồ v2, engine low-poly, A*, ngồi, minimap) + voice LiveKit (khoảng cách, phòng riêng, chia sẻ màn hình) | `office`, `office-engine`, `design/` |
| Kết nối AI: MCP 34 tool (không hợp đồng / lương, chấm công AI = Remote), token cá nhân + OAuth 2.1, nhật ký AI, HR thu hồi | `mcp`, `mcp-oauth` |
| Giao diện shadcn-admin (sidebar, ⌘K, sáng / tối) · PWA cài được (không push) + giao diện mobile | `../frontend.md` |
| Chat theo phòng, model GLB (chờ bộ Kenney), joystick + zoom cảm ứng | `office`, `office-engine` |
| Bảng lương theo luật VN (thông số HR sửa được; tháng nghỉ không lương ≥ 14 ngày không đóng BH) · ký hợp đồng nội bộ + OTP email | `payroll`, `contracts-esign` |
| Chức vụ = cấp bậc (`Level`, thang 8 bậc, HR quản lý) + chức danh tự do · phòng ban dạng cây, gợi ý quản lý = trưởng phòng · sơ đồ tổ chức (HR) | `organization` |
| Mô tả + hướng dẫn phòng ban / chức vụ (trưởng phòng sửa phòng mình) → MCP `get_my_role`, `list_positions`, `get_department`, `get_position`; thẻ "Vai trò của tôi" | `org-guides`, `mcp` |
| Phân quyền UI: `PAGE_ROLES` (menu + chặn route → "Không có quyền"), 403 → toast · danh bạ theo vai trò (trạng thái / ngày vào làm chỉ HR, chính chủ, quản lý; người đã nghỉ chỉ HR) | `../routes.md`, `organization` |
| Hồ sơ cá nhân `/profile`: liên hệ + ảnh tự sửa; ngày sinh / CCCD / ngân hàng qua HR duyệt (mã hoá, không ra MCP); sheet "Chuyển khoản" trong Excel lương; trường CCCD cho mẫu hợp đồng | `profile` |
| UI: bỏ tiêu đề / mô tả trang (nút hành động ngang hàng tab — `PageToolbar`) · nút "Cột" cho bảng nhiều cột · trang 404 tiếng Việt | `../frontend.md` |

Kiểm tra cuối: `dotnet build -warnaserror` ✔, `dotnet test` ✔ (12 project; Organization 36, Mcp 58, Payroll 15), `bun run build` ✔. E2E trên DB tạm: lương + ký 48/48, quyền tổ chức + hướng dẫn + danh bạ 37/37, hồ sơ cá nhân 34/34; trên bản dev: phân quyền trang 8/8, nút cột 13/13; quét responsive 12 trang × 4 độ rộng sạch.

## Quyết định đã chốt gần đây (đừng hỏi / đề xuất lại)

- Văn phòng 3D: mặt bằng + giả định đã duyệt (camera chéo low-poly, laptop trước, voice ở giai đoạn 3). **Giai đoạn 2 bị bỏ**: không làm gán chỗ ngồi, trạng thái (chấm công / nghỉ phép / vắng) trên avatar, "tìm đồng nghiệp", người offline hiện mờ.
- Hợp đồng: HR quản lý tất cả, nhân viên xem của mình, quản lý **không** xem của cấp dưới; lương mã hoá; nhắc HR + quản lý trực tiếp.
- Thông báo: email + chuông. Tăng ca / nghỉ phép: xem §11 `ARCHITECTURE_V2.md`.
- Lương: đầy đủ luật VN, HR sửa thông số; ký điện tử = nội bộ + OTP email (không CA); **chưa làm** máy chấm công; PWA **không** push.
- Tổ chức: phòng ban mở rộng tự do, chức vụ = cấp bậc bắt buộc có cấp (HR thêm / sửa / xoá); "Lễ tân" là chức danh. Danh bạ: nhân viên thấy liên lạc, không thấy trạng thái / ngày vào làm / người đã nghỉ.
- Hồ sơ cá nhân: liên hệ + ảnh hiệu lực ngay; ngày sinh / CCCD / ngân hàng cần HR duyệt; **email chỉ HR đổi**.
- Giao diện: **không** hiện tiêu đề / mô tả đầu trang; nút hành động ngang hàng thanh tab.

## Việc tiếp theo

1. **Chủ dự án commit + deploy** (migration mới tự chạy khi Api khởi động: `InitialPayroll`, `SignRequests`, `PositionLevelJobTitle`, `OrgGuides`, `PersonalProfile`) rồi chạy `prod-smoke.ts`. Thêm `api-dev.log` vào `.gitignore` hoặc đừng commit nó.
2. **Kế toán đối chiếu thông số lương** tại `/payroll` → Thông số trước khi chốt kỳ thật. **HR / trưởng phòng soạn mô tả + hướng dẫn** phòng ban / chức vụ (AI mới có nội dung). Kiểm tra lại cấp của từng chức vụ ở tab Chức vụ.
3. Model 3D: chủ dự án tải tay Kenney Furniture Kit (kenney.nl, CC0) → `bun scripts/dev/import-furniture.ts <zip>`.
4. Đề xuất chưa làm (hỏi trước): 2FA cho admin / HR, chốt công tháng, nhắc hết thử việc, chống CSRF, ca qua đêm, API loại phép, uỷ quyền duyệt, tắt email theo người, xuất sơ đồ tổ chức ra ảnh / PDF. Lỗi nhỏ đã biết: thẻ phép năm hiện "−0" khi bằng 0.
5. Đã hoãn: vận hành (giám sát, diễn tập khôi phục backup), webhook máy chấm công, push PWA, HR bật / tắt AI theo người.

## Chạy & dữ liệu dev

- Lệnh: [commands.md](commands.md). Dev chạy 3 tiến trình: Api :5080, Realtime :5090, FE :5173 (Vite proxy). Postgres / S3 / SMTP trong `.env` là **dịch vụ thật** (DB công ty ở xa → mỗi API ~1 s).
- **`Encryption__Key`** đã được tạo trong `.env` (lương hợp đồng mã hoá bằng khoá này) — mất khoá = mất lương đã lưu; nhắc chủ dự án sao lưu.
- **Tài khoản thử**: `account.txt` ở gốc repo (gitignore) — 12 nhân viên NV010–NV021 trong 6 phòng ban, email `@officehub.test`, mật khẩu chung ghi trong file. Dùng lại để test, **không** tạo rồi xoá tài khoản. Mỗi người có hợp đồng mẫu (2 cái sắp hết hạn để thử nhắc). **NV001, NV009 (chủ dự án) là dữ liệu thật — không sửa** (ngoại lệ đã được cho phép một lần: chuyển "Lễ Tân" → chức danh; NV001 hiện ở trạng thái Đã nghỉ do chủ dự án đặt). Admin seed: `Seed__*` trong `.env` (không có hồ sơ nhân viên).
- Dọn dữ liệu do test tạo (đơn, thông báo…): không có `psql` cục bộ → `docker run --rm --env-file <pg.env> postgres:18-alpine psql …` với thông tin từ `ConnectionStrings__Default`.

Script e2e + cách test trên DB tạm: [e2e.md](e2e.md).

## Bẫy đã gặp

Xem [pitfalls.md](pitfalls.md) — đọc trước khi debug lỗi lạ (Api cũ chưa khởi động lại, route lazy, SMTP / S3 thật, migration…).
