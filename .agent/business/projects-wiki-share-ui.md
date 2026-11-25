# Chia sẻ sổ tay — giao diện (TEST-229)

> Về [projects-wiki-share.md](projects-wiki-share.md) (quy tắc, API — TEST-228) · tab Sổ tay [projects-wiki-ui.md](projects-wiki-ui.md) · mẫu trang công khai `/u/$token`
> [projects-comment-upload-links.md](projects-comment-upload-links.md) · e2e `scripts/dev/wiki-share-ui-e2e.ts` ([../e2e.md](../e2e.md)).

- **Tab Sổ tay** (`features/projects`): nút **"Chia sẻ"** trên thanh nút trang, chỉ khi `page.canManage` (quản lý dự án / HR, dự án đang chạy; server vẫn kiểm).
  Hộp thoại `components/wiki-share-dialog`: người nhận, nhãn, hạn 1 / 7 / 30 ngày / "Chọn ngày" (`PickerInput`, tối đa hôm nay + 89 ngày), "Kèm các trang con"
  (chỉ hiện khi trang có con, mặc định tích), mật khẩu tuỳ chọn; lỗi theo field dưới ô. Tạo xong: URL `/s/{token}` + sao chép + QR (`qrcode.react`) + cảnh báo
  "chỉ hiện một lần"; "Tạo link khác" làm trống form. Dưới là danh sách link của trang (`GET …/shares?pageId=`, mới nhất trước): người nhận / nhãn, trạng thái
  (Còn hạn / Hết hạn / Đã thu hồi / Không còn hiệu lực), mật khẩu, kèm con, hạn hoặc lúc thu hồi, lượt xem, xem cuối, người tạo; **Thu hồi** (`confirmDialog`, nút `loading`)
  với link còn hạn; **Nhật ký xem** (`wiki-share-views-dialog`: bảng thời điểm giờ VN / IP / trình duyệt, 20 dòng / trang). Code: `api/wiki-share.api.ts`
  (key dưới `['projects','wiki',id,'shares']`), `hooks/useWikiShare.ts`, `types/wiki-share.types.ts`.
- **Chuông**: `wiki_share_viewed` có icon + nhãn "Khách đã mở link chia sẻ sổ tay" (`features/notifications/utils/labels.ts` → `CATEGORY[].label`, hiện ở chuông +
  trang Thông báo); bấm → `/projects/{id}?tab=wiki&page={root}`.
- **Trang công khai `/s/$token`** (`features/wiki-share`, route ngoài `protectedRoute`, gói tải riêng như `/u/$token`): thanh đầu logo + tên dự án + "Hết hạn sau …"
  (đếm từng giây) + nút sáng / tối; `<meta name="robots" content="noindex, nofollow">`. Link có mật khẩu → ô nhập (400 "Mật khẩu không đúng.", 429 "chờ 15 phút");
  mở khoá xong gọi lại info (cookie riêng của link). Kèm trang con → cây bên trái (≥ `lg`), điện thoại thành ngăn kéo (`Sheet` trái, nút ☰); chọn trang qua `?page=`
  (id lạ → trang gốc). Nội dung dùng `components/common/markdown.tsx` với `renderLink` + `keepUrl`: link `/s/{token}?page=` mở tại chỗ, `wiki-share:not-shared` →
  chữ thường + "(không thuộc bản xem trước)". Watermark mờ "Bản xem trước cho <người nhận>" phủ cả trang. 404 → "Link không tồn tại"; 410 hoặc đếm ngược về 0
  → "Link đã hết hạn hoặc bị thu hồi". Info được gọi **một lần** (`staleTime: Infinity`) vì mỗi lần gọi server ghi nhật ký mở. Trang 401 (cookie mở khoá hết hạn) được
  đổi thành trạng thái `locked` ngay trong `queryFn` — không để 401 lọt ra QueryCache (App.tsx coi 401 là hết phiên → đẩy về /login).

## Kiểm thử

`scripts/dev/wiki-share-ui-e2e.ts` (Chrome headless, 3 phiên PM / thành viên / khách, **chỉ DB tạm**, lệnh ở đầu file) — 59/59 (2026-11-25): máy tính 1440 + điện thoại 390×844, sáng + tối.
