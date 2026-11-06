# Tiến độ & bàn giao phiên

> Cập nhật **2026-11-06**: production `https://office.lokid.me` (commit `ab8fac0`). Sau đó làm xong (chưa deploy): PWA + mobile, văn phòng 3D (chat phòng, GLB, joystick), **bảng lương** và **ký hợp đồng điện tử**. Đọc file này đầu phiên mới. Chi tiết nghiệp vụ: bảng định tuyến trong [AGENTS.md](../AGENTS.md); kế hoạch tổng: `docs/ARCHITECTURE_V2.md`.

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
| Bảng lương theo luật VN (thông số HR sửa được) · ký hợp đồng nội bộ + OTP email | `payroll`, `contracts-esign` |

Kiểm tra cuối: build ✔, `dotnet test` ✔ (Payroll 13, LaborContracts 50…), `bun run build` ✔, e2e: chat phòng 16/16, PWA cài được + offline, lương / ký (DB tạm + Mailpit) — xem mục Việc tiếp theo.

## Quyết định đã chốt gần đây (đừng hỏi / đề xuất lại)

- Văn phòng 3D: mặt bằng + giả định đã duyệt (camera chéo low-poly, laptop trước, voice ở giai đoạn 3). **Giai đoạn 2 bị bỏ**: không làm gán chỗ ngồi, trạng thái (chấm công / nghỉ phép / vắng) trên avatar, "tìm đồng nghiệp", người offline hiện mờ.
- Hợp đồng: HR quản lý tất cả, nhân viên xem của mình, quản lý **không** xem của cấp dưới; lương mã hoá; nhắc HR + quản lý trực tiếp.
- Thông báo: email + chuông. Tăng ca / nghỉ phép: xem §11 `ARCHITECTURE_V2.md`.

## Việc tiếp theo

1. **Chủ dự án commit + deploy** (migration `InitialPayroll`, `SignRequests` tự chạy khi Api khởi động) rồi chạy `prod-smoke.ts`.
2. **Kế toán đối chiếu thông số lương** (lương cơ sở, lương tối thiểu vùng, giảm trừ gia cảnh, biểu thuế) tại `/payroll` → Thông số trước khi chốt kỳ thật.
3. Model 3D: chủ dự án tải tay Kenney Furniture Kit (kenney.nl, CC0) → `bun scripts/dev/import-furniture.ts <zip>`; chỉnh `rotY` trong manifest nếu đồ quay sai hướng.
4. Đã hoãn: vận hành (giám sát, diễn tập khôi phục backup), webhook máy chấm công (chủ dự án: chưa làm), push PWA (không cần), HR bật / tắt AI theo người.

## Chạy & dữ liệu dev

- Lệnh: [commands.md](commands.md). Dev chạy 3 tiến trình: Api :5080, Realtime :5090, FE :5173 (Vite proxy). Postgres / S3 / SMTP trong `.env` là **dịch vụ thật** (DB công ty ở xa → mỗi API ~1 s).
- **`Encryption__Key`** đã được tạo trong `.env` (lương hợp đồng mã hoá bằng khoá này) — mất khoá = mất lương đã lưu; nhắc chủ dự án sao lưu.
- **Tài khoản thử**: `account.txt` ở gốc repo (gitignore) — 12 nhân viên NV010–NV021 trong 6 phòng ban, email `@officehub.test`, mật khẩu chung ghi trong file. Dùng lại để test, **không** tạo rồi xoá tài khoản. Mỗi người có hợp đồng mẫu (2 cái sắp hết hạn để thử nhắc). **NV001, NV009 (chủ dự án) là dữ liệu thật — không sửa.** Admin seed: `Seed__*` trong `.env` (không có hồ sơ nhân viên).
- Dọn dữ liệu do test tạo (đơn, thông báo…): không có `psql` cục bộ → `docker run --rm --env-file <pg.env> postgres:18-alpine psql …` với thông tin từ `ConnectionStrings__Default`.

Script e2e + cách test trên DB tạm: [e2e.md](e2e.md).

## Bẫy đã gặp

- Body JSON sai trước đây ra **500** ở Development (minimal API ném `BadHttpRequestException`); đã cấu hình `ThrowOnBadRequest` + `StatusCodeSelector` + ProblemDetails trong `AddOfficeHubDefaults` → luôn 400 (thông điệp tiếng Việt cho thời điểm thiếu múi giờ).
- Lịch họp thử phải bắt đầu ≥ hiện tại − 5 phút (quy tắc chống đặt lùi).

- SMTP dev là Gmail thật → email tới địa chỉ thật sẽ gửi thật; tên miền dành riêng bị bỏ qua (`EmailPolicy`).
- S3: bucket riêng `officehubdoanhuyxh` + IAM user `OfficeHub` (chỉ quyền trên `officehub/*`), không public. File upload trước khi đổi vẫn ở bucket cũ `finsplit/officehub/` (chưa chuyển).
- Lần migrate đầu của schema mới, EF log `ERR … __ef_migrations` — bình thường.
- `dotnet ef migrations remove` cần DB → với migration đầu của context, xoá tay 3 file (migration, Designer, Snapshot).
- Sửa `shared/office-map.json` → phải chạy `bun design/tools/render-plan.ts` (ghi lại `office-map.grid.txt`), nếu không test Realtime fail.
- Thêm component shadcn: `bun run ui:add` (trả lời `n` khi hỏi ghi đè).
- Job nền (email, nhắc hợp đồng) giả định **một** instance Api.
- Voice báo "Không kết nối được máy chủ voice" mà token vẫn 200 → lỗi ICE: LiveKit trong Docker báo IP container. Dev compose đã có `--node-ip ${LIVEKIT_NODE_IP:-127.0.0.1}`; đổi xong phải `up -d livekit` để tạo lại container.
