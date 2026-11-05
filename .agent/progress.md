# Tiến độ & bàn giao phiên

> Cập nhật **2026-11-05** (sau commit `91a5a58`, working tree sạch). Đọc file này đầu phiên mới. Chi tiết nghiệp vụ: bảng định tuyến trong [AGENTS.md](../AGENTS.md); kế hoạch tổng: `docs/ARCHITECTURE_V2.md` (§0 trạng thái, §11 quyết định đã chốt, §12 lộ trình).

## Đã xong

| Hạng mục | Tài liệu |
|---|---|
| Base: Identity (đăng nhập, mời, quên mật khẩu, khoá tức thì), Organization (phòng ban, chức vụ, nhân viên, cấp tài khoản) | `business/auth.md`, `business/organization.md` |
| Chấm công (web + 3D, ca cố định / linh hoạt, lịch, ngày lễ, bảng công), giải trình | `business/attendance*.md` |
| **Tăng ca**: đăng ký trước / khai bù 7 ngày, tính theo giờ trên đơn, tách 150 / 200 / 300%, cảnh báo 40 giờ/tháng · 200 giờ/năm | `business/attendance-overtime.md` |
| Phê duyệt (quản lý → HR) + Nghỉ phép (quỹ phép cộng dồn, không hết hạn) | `business/approval.md`, `business/leave.md` |
| **Thông báo**: chuông in-app + email gửi nền (hàng đợi trong DB, thử lại, bỏ qua tên miền `.test` / `example.com`) | `business/notifications.md` |
| **Hợp đồng lao động**: loại / thời hạn theo BLLĐ, phụ lục, lương mã hoá AES-GCM, file S3, nhắc 30 / 7 ngày | `business/contracts.md` |
| **Giao diện** theo shadcn-admin: sidebar inset, ⌘K, sáng / tối, `PageHeader`, `StatusBadge` | `frontend.md` |
| **Văn phòng 3D giai đoạn 1**: bản đồ v2 (24 × 16 m, 24 chỗ), engine mới (low-poly, camera chéo, A*, ngồi, minimap), lưới va chạm chung FE / server | `business/office.md`, `business/office-engine.md`, `design/` |
| **Voice (giai đoạn 3)**: LiveKit, khu mở nghe theo khoảng cách (≤ 6 m), phòng có tường = kênh riêng do server chọn theo vị trí (+ `VoiceGuard` đẩy ra), phòng họp chia sẻ màn hình, vòng "đang nói" | `business/office.md#voice`, `business/office-engine.md` |

Kiểm tra cuối: `dotnet build -warnaserror` ✔, `dotnet test` 88 test ✔, `bun run build` ✔, e2e văn phòng 3D 16/16 ✔, e2e voice 26/26 ✔.

## Quyết định đã chốt gần đây (đừng hỏi / đề xuất lại)

- Văn phòng 3D: mặt bằng + giả định đã duyệt (camera chéo low-poly, laptop trước, voice ở giai đoạn 3). **Giai đoạn 2 bị bỏ**: không làm gán chỗ ngồi, trạng thái (chấm công / nghỉ phép / vắng) trên avatar, "tìm đồng nghiệp", người offline hiện mờ.
- Hợp đồng: HR quản lý tất cả, nhân viên xem của mình, quản lý **không** xem của cấp dưới; lương mã hoá; nhắc HR + quản lý trực tiếp.
- Thông báo: email + chuông. Tăng ca / nghỉ phép: xem §11 `ARCHITECTURE_V2.md`.

## Việc tiếp theo — chủ dự án CHƯA chọn (hỏi trước khi làm)

1. **Voice – phần còn lại**: chat theo phòng; deploy thật lên VPS (`sh scripts/deploy.sh`, voice qua `wss://<APP_DOMAIN>/livekit`, mở UDP 50000–60000; TURN chưa bật) — chưa thử trên VPS.
2. **Văn phòng 3D – hình ảnh / thiết bị**: model GLB CC0 thay khối dựng tay (`engine/furniture.ts`), mobile (joystick).
3. **Báo cáo**: trang `/reports` đang `ComingSoon`; xuất Excel bảng công tháng, tổng hợp phép, tăng ca.
4. **Quy ra tiền** phép năm chưa dùng + tăng ca (hệ số 150 / 200 / 300%) từ lương hợp đồng (`ContractDto.currentSalary`).

## Chạy & dữ liệu dev

- Lệnh: [commands.md](commands.md). Dev chạy 3 tiến trình: Api :5080, Realtime :5090, FE :5173 (Vite proxy). Postgres / S3 / SMTP trong `.env` là **dịch vụ thật** (DB công ty ở xa → mỗi API ~1 s).
- **`Encryption__Key`** đã được tạo trong `.env` (lương hợp đồng mã hoá bằng khoá này) — mất khoá = mất lương đã lưu; nhắc chủ dự án sao lưu.
- **Tài khoản thử**: `account.txt` ở gốc repo (gitignore) — 12 nhân viên NV010–NV021 trong 6 phòng ban, email `@officehub.test`, mật khẩu chung ghi trong file. Dùng lại để test, **không** tạo rồi xoá tài khoản. Mỗi người có hợp đồng mẫu (2 cái sắp hết hạn để thử nhắc). **NV001, NV009 (chủ dự án) là dữ liệu thật — không sửa.** Admin seed: `Seed__*` trong `.env` (không có hồ sơ nhân viên).
- Dọn dữ liệu do test tạo (đơn, thông báo…): không có `psql` cục bộ → `docker run --rm --env-file <pg.env> postgres:18-alpine psql …` với thông tin từ `ConnectionStrings__Default`.

## Công cụ test (`scripts/dev/`, chạy từ gốc repo, `TEST_PASSWORD` = mật khẩu trong `account.txt`)

| Script | Việc |
|---|---|
| `seed-org.ts` | Tạo lại phòng ban + 12 tài khoản thử + ghi `account.txt` (bỏ qua cái đã có) |
| `seed-contracts.ts` | Hợp đồng mẫu cho tài khoản thử |
| `office-e2e.ts` (+ `cdp.ts`) | 2 Chrome headless vào `/office`: tìm đường, va chạm tường, ngồi / đứng, ghế đã có người, đồng bộ vị trí, lỗi console. Dùng hook dev `window.__officeScene` |
| `voice-e2e.ts` | 2 Chrome micro giả: nghe gần / huỷ nhận âm khi xa, phím M, đổi kênh vào phòng họp, server không cấp token phòng khi đứng ngoài, chia sẻ màn hình, `VoiceGuard` đẩy client không đổi kênh. Cần container `livekit` (`docker compose … up -d livekit`). Hook `window.__officeVoice` |

## Bẫy đã gặp

- SMTP dev là Gmail thật → email tới địa chỉ thật sẽ gửi thật; tên miền dành riêng bị bỏ qua (`EmailPolicy`).
- S3: bucket riêng `officehubdoanhuyxh` + IAM user `OfficeHub` (chỉ quyền trên `officehub/*`), không public. File upload trước khi đổi vẫn ở bucket cũ `finsplit/officehub/` (chưa chuyển).
- Lần migrate đầu của schema mới, EF log `ERR … __ef_migrations` — bình thường.
- `dotnet ef migrations remove` cần DB → với migration đầu của context, xoá tay 3 file (migration, Designer, Snapshot).
- Sửa `shared/office-map.json` → phải chạy `bun design/tools/render-plan.ts` (ghi lại `office-map.grid.txt`), nếu không test Realtime fail.
- Thêm component shadcn: `bun run ui:add` (trả lời `n` khi hỏi ghi đè).
- Job nền (email, nhắc hợp đồng) giả định **một** instance Api.
- Voice báo "Không kết nối được máy chủ voice" mà token vẫn 200 → lỗi ICE: LiveKit trong Docker báo IP container. Dev compose đã có `--node-ip ${LIVEKIT_NODE_IP:-127.0.0.1}`; đổi xong phải `up -d livekit` để tạo lại container.
