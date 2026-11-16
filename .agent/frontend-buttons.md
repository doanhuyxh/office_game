# Nút bấm: trạng thái đang xử lý (loading)

> Về [frontend-ui.md](frontend-ui.md) · [AGENTS.md](../AGENTS.md). Code: `frontend/src/components/common/button.tsx`, `confirm-dialog.tsx`, `settings-form-footer.tsx`.

## Luật

- **Nút gửi dữ liệu dùng `loading={mutation.isPending}`**, không dùng `disabled={isPending}` trơn (chỉ mờ, người dùng tưởng nút hỏng). Điều kiện khác (form chưa sửa, thiếu trường…) vẫn để ở `disabled`:
  `<Button type="submit" disabled={!dirty} loading={save.isPending} loadingText="Đang lưu…"><Save /> Lưu</Button>`
- `Button` (TEST-131): `loading` → disabled (chặn bấm lần hai) + `aria-busy` + `data-loading` + vòng xoay thay icon đầu nút (không icon thì chèn trước chữ), mờ nhẹ + con trỏ chờ; đã truyền `loading` (kể cả `false`) thì bề ngang không đổi khi bật / tắt (lớp ẩn giữ chỗ — e2e đọc chữ nút bằng `innerText` hoặc `data-testid`, **không** `textContent`). Trình đọc màn hình nghe "Đang xử lý…". `asChild` + `loading` chỉ đặt `aria-busy`.
- `loadingText` (TEST-132): Lưu → "Đang lưu…", Gửi → "Đang gửi…", Tạo → "Đang tạo…", Duyệt / Từ chối / Xoá / Huỷ / Thu hồi trong hộp xác nhận → "Đang xử lý…"; ngữ cảnh rõ hơn thì giữ chữ riêng ("Đang kiểm tra…", "Đang ký…", "Đang tải…", "Đang đặt…"). Nút icon (`size="icon*"`) không có chữ. Đăng nhập / 2FA / mật khẩu: chỉ "Đang đăng nhập…" / "Đang kiểm tra…" / "Đang lưu…", không lộ thông tin.
- Không tự chèn `Loader2` vào nút — dùng `loading`. Vòng xoay ngoài nút (tải tin cũ, "Xem thêm bình luận", thứ tự cột kanban, hàng đợi tải lên) giữ nguyên.
- **Nhiều nút dùng chung một mutation** (dòng trong bảng, Giữ / Thu hồi, Có / Không thấy, Tính lại / Chốt / Mở lại): chỉ nút được bấm xoay, nút khác vẫn khoá:
  `loading={m.isPending && m.variables === row.id} disabled={m.isPending}` (biến là object → so `m.variables?.id`, thêm trường phân biệt nút). Mutation nhận hàm (`device-sheet`) → thêm `key` vào biến.
- **Hộp xác nhận**: xác nhận rồi mới gọi API → `confirmDialog({ …, onConfirm: () => m.mutateAsync(arg) })` (cả `promptDialog`, `onConfirm` nhận chuỗi đã trim): hộp giữ mở, nút đồng ý xoay "Đang xử lý…", nút Huỷ / Esc bị chặn; lỗi → hộp tự toast `errorMessage`, hộp vẫn mở (chỗ gọi **không** toast lỗi thêm, mutation không có `onError` toast riêng); xong → `true` → chỗ gọi toast thành công / đóng sheet. `AlertDialog` tự viết: không dùng `AlertDialogAction` cho thao tác gọi API (Action đóng hộp ngay) — dùng `<Button loading=…>` + đóng hộp trong `onSuccess`, `AlertDialogCancel disabled={m.isPending}`.
- `SettingsFormFooter` (trang Hệ thống → Cấu hình) có `saving={save.isPending}`; `saveDisabled` chỉ chứa điều kiện khác.
- Nút chính (`default` / `destructive`, cỡ `default` / `lg`) tối thiểu 96 px (`min-w-24`); trong `DialogFooter` / `AlertDialogFooter` trên điện thoại (< 640 px) các nút xếp dọc, rộng hết khung.

## Chặn tái phạm

`frontend/scripts/check-button-loading.ts` chạy đầu `bun run build` (CI job `frontend` + Dockerfile web): báo lỗi + thoát 1 khi thẻ `<Button …>` có `disabled={…isPending…}` mà không có prop `loading`. Chạy riêng: `bun run check:buttons` (hoặc `bun scripts/check-button-loading.ts <file…>`). Dự án không có ESLint nên dùng script quét thẻ JSX.

## Đã áp (TEST-132, 2026-11-17)

~160 nút trên toàn web (đếm theo module ở bình luận TEST-132): mọi `disabled={x.isPending}` → `loading`; ternary `{x.isPending ? 'Đang…' : '…'}` → `loadingText`; `Loader2` tự chèn trong nút (sửa tin chat, gửi tin / bình luận, đăng bài, tải tệp bảng tin) → `loading`; ~30 chỗ `confirmDialog` rồi `mutate` → `onConfirm`; 7 `AlertDialogAction` gọi API → `Button loading` (xoá phòng ban, đặt lại 2FA, thu hồi token AI, xoá thiết bị, đóng rà soát, huỷ dịch vụ, xoá bài viết); nút dùng state riêng (`busy` / `saving` / `pending`: đồng ý OAuth, nhập Excel, nghỉ việc, chứng từ, hộp lý do…) cũng có `loading`. E2E: `scripts/dev/button-loading-e2e.ts` (mạng chậm giả lập — xem [e2e.md](e2e.md)).
