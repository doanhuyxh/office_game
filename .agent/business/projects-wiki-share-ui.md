# Chia sẻ sổ tay — giao diện (TEST-229, phạm vi TEST-230)

> Về [projects-wiki-share.md](projects-wiki-share.md) (quy tắc, API — TEST-228) · tab Sổ tay [projects-wiki-ui.md](projects-wiki-ui.md) · mẫu trang công khai `/u/$token`
> [projects-comment-upload-links.md](projects-comment-upload-links.md) · e2e `scripts/dev/wiki-share-ui-e2e.ts` ([../e2e.md](../e2e.md)).

- **Tab Sổ tay** (`features/projects`): nút **"Chia sẻ"** trên thanh công cụ sổ tay (cạnh "Trang mới", cả màn sổ tay trống — `tree.canManage`, TEST-230) → hộp thoại
  quản lý **mọi link của dự án**, mặc định phạm vi "Toàn bộ sổ tay"; nút "Chia sẻ" trên từng trang (`page.canManage`) vẫn giữ — mở sẵn "Chọn trang" với trang đó + cây con
  đã tích, danh sách lọc theo trang (nút "Xem mọi link" / "Chỉ link có trang này"). Server vẫn kiểm quyền.
  Hộp thoại `components/wiki-share-dialog`: **Phạm vi** Toàn bộ sổ tay / Chọn trang — "Chọn trang" hiện `components/wiki-share-page-picker` (cây có ô tích: tích trang cha
  = tích cả cây con → `includeChildren`; bỏ tích một con → cha gạch ngang (indeterminate), gửi từng trang đang tích; ô tìm theo tiêu đề không dấu giữ trang cha;
  "Đã chọn N trang"; chưa chọn → lỗi). Logic chọn ở `utils/wiki-share-selection.ts`. Tiếp: người nhận, nhãn, hạn 1 / 7 / 30 ngày / "Chọn ngày" (`PickerInput`,
  tối đa hôm nay + 89 ngày), mật khẩu tuỳ chọn; lỗi theo field dưới ô. Tạo xong: URL `/s/{token}` + sao chép + QR (`qrcode.react`) + cảnh báo
  "chỉ hiện một lần"; "Tạo link khác" làm trống form. Dưới là danh sách link (`GET …/shares[?pageId=]`, mới nhất trước): người nhận / nhãn, **phạm vi** ("Toàn bộ sổ tay" / "N trang" — rê chuột / focus xem tên trang, trang đã xoá gạch), trạng thái
  (Còn hạn / Hết hạn / Đã thu hồi / Không còn hiệu lực), mật khẩu, hạn hoặc lúc thu hồi, lượt xem, xem cuối, người tạo; **Thu hồi** (`confirmDialog`, nút `loading`)
  với link còn hạn; **Nhật ký xem** (`wiki-share-views-dialog`: bảng thời điểm giờ VN / IP / trình duyệt, 20 dòng / trang). Code: `api/wiki-share.api.ts`
  (key dưới `['projects','wiki',id,'shares']`), `hooks/useWikiShare.ts`, `types/wiki-share.types.ts`.
- **Chuông**: `wiki_share_viewed` có icon + nhãn "Khách đã mở link chia sẻ sổ tay" (`features/notifications/utils/labels.ts` → `CATEGORY[].label`, hiện ở chuông +
  trang Thông báo); bấm → `/projects/{id}?tab=wiki&page={root}`.
- **Trang công khai `/s/$token`** (`features/wiki-share`, route ngoài `protectedRoute`, gói tải riêng như `/u/$token`): thanh đầu logo + tên dự án + "Hết hạn sau …"
  (đếm từng giây) + nút sáng / tối; `<meta name="robots" content="noindex, nofollow">`. Link có mật khẩu → ô nhập (400 "Mật khẩu không đúng.", 429 "chờ 15 phút");
  mở khoá xong gọi lại info (cookie riêng của link). Từ 2 trang trở lên → cây bên trái (≥ `lg`, nhiều gốc khi trang rải rác), điện thoại thành ngăn kéo (`Sheet` trái, nút ☰); chọn trang qua `?page=`
  (id lạ → trang đầu). Phạm vi toàn bộ sổ tay mà sổ tay trống → thẻ "Chưa có trang nào" (TEST-230). Nội dung dùng `components/common/markdown.tsx` với `renderLink` + `keepUrl`: link `/s/{token}?page=` mở tại chỗ, `wiki-share:not-shared` →
  chữ thường + "(không thuộc bản xem trước)". Watermark mờ "Bản xem trước cho <người nhận>" phủ cả trang. 404 → "Link không tồn tại"; 410 hoặc đếm ngược về 0
  → "Link đã hết hạn hoặc bị thu hồi". Info được gọi **một lần** (`staleTime: Infinity`) vì mỗi lần gọi server ghi nhật ký mở. Trang 401 (cookie mở khoá hết hạn) được
  đổi thành trạng thái `locked` ngay trong `queryFn` — không để 401 lọt ra QueryCache (App.tsx coi 401 là hết phiên → đẩy về /login).

## Kiểm thử

`scripts/dev/wiki-share-ui-e2e.ts` (Chrome headless, 3 phiên PM / thành viên / khách, **chỉ DB tạm**, lệnh ở đầu file) — 59/59 (2026-11-25): máy tính 1440 + điện thoại 390×844, sáng + tối.
`scripts/dev/wiki-share-scope-ui-e2e.ts` (TEST-230: nút thanh công cụ, phạm vi, cây chọn trang, cột phạm vi, nút trên trang, khách: trang rải rác / toàn bộ / sổ tay trống) — 28/28 (2026-11-25).
