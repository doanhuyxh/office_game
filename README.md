# OfficeHub

**Văn phòng ảo 3D + quản lý nhân sự nội bộ** cho một công ty (~12 nhân sự, một văn phòng, làm việc tại văn phòng hoặc từ xa).

Nhân viên đăng nhập vào một văn phòng 3D để gặp đồng nghiệp, trò chuyện và chấm công. Phía sau là hệ thống nhân sự: hồ sơ nhân viên, phòng ban, ca làm, bảng công, nghỉ phép, phê duyệt.

## Tính năng

| Đã có | Đang làm tiếp |
|---|---|
| Đăng nhập bằng email hoặc mã nhân viên, quên mật khẩu, mời qua email, mật khẩu tạm; khoá tài khoản có hiệu lực ngay | Tăng ca |
| Quản lý nhân viên, phòng ban, chức vụ, vai trò (admin / HR / quản lý / nhân viên) | Thông báo email khi có đơn mới / đơn được duyệt |
| Chấm công trên web hoặc tại máy chấm công trong văn phòng 3D; tự nhận biết làm tại văn phòng hay từ xa | Quy ra tiền phép năm |
| Ca cố định và ca linh hoạt, lịch tuần theo công ty hoặc từng người, ngày lễ | Văn phòng 3D đầy đủ theo mặt bằng thật, voice |
| Bảng công tháng, tình trạng hôm nay, tổng hợp tháng cho quản lý / HR | Hợp đồng lao động, báo cáo, xuất Excel |
| **Phê duyệt** dùng chung: quản lý trực tiếp → HR, không tự duyệt đơn của mình | |
| **Nghỉ phép**: phép năm 12 ngày + thâm niên, cộng dồn tháng, không hết hạn; nghỉ cả ngày / nửa ngày; lịch nghỉ team; HR điều chỉnh quỹ phép | |
| **Giải trình chấm công**: bổ sung giờ vào / ra, duyệt xong bảng công tự cập nhật | |
| Văn phòng 3D: thấy đồng nghiệp di chuyển, chat | |

## Công nghệ

- **Back-end:** ASP.NET Core (.NET 10), PostgreSQL, SignalR.
- **Front-end:** React 19, Vite, TanStack, Tailwind, shadcn/ui, Three.js (chạy bằng bun).
- **Hạ tầng:** Docker Compose trên VPS, Traefik HTTPS, file lưu trên S3.

## Bắt đầu

```bash
cp .env.example .env          # điền key theo chú thích trong file
docker compose --env-file .env -f infra/docker-compose.dev.yml up -d mailpit seq livekit
cd backend && dotnet run --project src/OfficeHub.Api        # và src/OfficeHub.Realtime ở terminal khác
cd frontend && bun install && bun run dev                   # http://localhost:5173
```

Hướng dẫn đầy đủ (biến môi trường, test, migration, deploy): [.agent/commands.md](.agent/commands.md).

## Tài liệu

| Tài liệu | Nội dung |
|---|---|
| [AGENTS.md](AGENTS.md) → [.agent/](.agent/) | Mô tả code **đang chạy**: lệnh, quy ước, kiến trúc, database, nghiệp vụ. Dùng cho cả dev và AI agent |
| [docs/ARCHITECTURE_V2.md](docs/ARCHITECTURE_V2.md) | Thiết kế tổng thể và lộ trình (gồm cả phần chưa làm) |
