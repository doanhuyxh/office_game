# Mockup: chat đầy đủ trong văn phòng 3D

Chủ dự án yêu cầu 2026-11-16: ngoài kênh Toàn văn phòng và kênh phòng, văn phòng 3D phải có **chat 1-1 giữa hai người** như trang `/chat`, tức đưa toàn bộ tính năng chat vào văn phòng ảo. Các việc trên bảng dự án TEST trỏ tới thư mục này.

Mở từng file `.html` bằng trình duyệt. File tĩnh, tự chạy, không cần build. Cảnh 3D phía sau chỉ vẽ đơn giản để làm nền; phần **chat / HUD** mới là thiết kế cần làm. Màu và kiểu khung lấy theo HUD hiện có (`frontend/src/features/office/components/office-view/office.css`: nền kính `rgba(15,23,42,.85–.95)`, viền `rgba(148,163,184,.25)`, xanh `#2563eb`, BOT tím `#7c3aed`, @nhắc vàng `#fcd34d`). Biểu tượng là SVG nét (dùng `lucide-react` tương ứng khi làm thật).

| File | Màn hình | Điểm chính |
|---|---|---|
| `01-desktop-chat-1-1.html` | Máy tính — khung chat nổi, hội thoại 1-1 | Khung nổi ~780 × 560 (kéo bằng đầu khung, đổi cỡ góc dưới phải, nút thu danh sách / thu về góc / đóng). Trái: ô tìm + nút "+" (Tin nhắn mới / tạo nhóm) + danh sách hội thoại (Office, 1-1 có chấm online, nhóm, kênh phòng, bot có chip BOT; số chưa đọc; dấu @ khi được nhắc). Phải: `MessagePane` — đầu khung có tên, phòng ban, "đang trong văn phòng · cách bạn 8 m", nút **Đi tới**, tìm; tin có tệp, ảnh, cảm xúc, "đã sửa", "Đã xem"; ô soạn có đính kèm, emoji, gửi. Nút chat trên thẻ trạng thái có số chưa đọc. |
| `02-desktop-kenh-phong.html` | Bước vào phòng họp | Danh sách **thu gọn** thành cột biểu tượng (60 px, mục đang chọn có viền xanh, số chưa đọc). Kênh phòng **tự mở** khi bước vào phòng, dòng báo "Bạn vừa vào Phòng họp nhỏ — đã mở kênh của phòng · Quay lại <hội thoại trước>". Thanh "Họp với AI" giữ nguyên (đang có trong `MessagePane` kênh phòng). Tin @nhắc mình tô vàng. Ô soạn ghi "Chỉ người trong <phòng> thấy…". |
| `03-desktop-bam-nhan-vat.html` | Chat đóng, bấm vào nhân vật | Bấm avatar **người** → menu nhỏ cạnh avatar: tên, phòng ban · mã, **Nhắn tin riêng**, **Đi tới cạnh**. Bấm avatar **bot** → **Xem bot đang làm gì** (hành vi hiện có) + **Nhắn tin riêng**. Chat đóng: nút "Tin nhắn" góc dưới trái có số chưa đọc + "N hội thoại chưa đọc". Tin 1-1 mới → toast góc phải trên "X nhắn bạn" + 1 dòng xem trước + **Trả lời** (mở đúng hội thoại) / **Để sau**. |
| `04-mobile-danh-sach.html` | Điện thoại — danh sách | Khung ~92% rộng, chừa ~200 px dưới cho joystick + nút zoom. Kênh phòng đang đứng xếp đầu, nhãn "ĐANG Ở ĐÂY". Vùng bấm ≥ 44 px. |
| `05-mobile-hoi-thoai.html` | Điện thoại — trong hội thoại | Nút quay lại danh sách, nút Đi tới, ô soạn 44 px. |

Dữ liệu (tên người, tin nhắn, mã việc) chỉ là ví dụ.

Nguồn: canvas thiết kế của chủ dự án trên claude.ai (riêng tư). Sửa thiết kế thì cập nhật lại các file ở đây.
