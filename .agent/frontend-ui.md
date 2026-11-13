# Front-end: thành phần giao diện (form, bảng, modal, màu)

> Về [frontend.md](frontend.md) · [AGENTS.md](../AGENTS.md).

## Form & nhập liệu

- Form: `FormField` / `SelectField` (`components/common`). `SelectField` dùng giá trị đặc biệt cho "không chọn" (Radix không nhận value rỗng) và trả `null`. Ngày / tháng: dùng `Input type="date"` / `type="month"` như thường — `Input` tự hiện **bộ chọn tiếng Việt** (`components/common/date-picker.tsx`: dd/mm/yyyy, "Tháng 11/2026", tuần bắt đầu T2, bấm tiêu đề → tháng → năm; min / max / required / disabled), `e.target.value` vẫn là `yyyy-MM-dd` / `yyyy-MM`. Không dùng lịch gốc của trình duyệt (hiện tiếng Anh). Tab cấp trang → **`useTabParam(mặc định, [tab được phép])`** (`hooks/useTabParam.ts`): lưu `?tab=` trên URL, reload / gửi link giữ đúng tab (tab trong hộp thoại thì không). Danh sách dài (chọn nhân viên…) → **`SearchSelectField`**: ô tìm không dấu + chỉ hiện 5 kết quả (`limit`), `hint` = chữ phụ (phòng ban); danh sách cây (phòng ban) → `depth` (thụt lề khi chưa tìm) + `path` (đường dẫn cấp trên, hiện khi tìm) từ `departmentTree` / `departmentAncestors` (`@/features/employees`). Ô nhập **tiền** → **`MoneyField` / `MoneyInput`** (`components/common/money-input.tsx`): hiện `15.000.000` khi gõ, `onValueChange(number | null)`, `allowNegative` cho khoản trừ — không dùng `type="number"` cho tiền.

## shadcn/ui, modal, xác nhận

- UI dùng **shadcn/ui** (style `new-york`, Tailwind v4, `components.json`): button, card, dialog, input, label, select, checkbox, radio-group, tabs, table, badge… trong `components/common`. Không dùng `<input type="checkbox|radio">` / `<select>` thuần — dùng `Checkbox` (`onCheckedChange={(c) => set(c === true)}`), `RadioGroup`, `SelectField`.
- Modal (`DialogContent`, `SheetContent`) mặc định **không đóng khi click ra ngoài** (đã chặn `onPointerDownOutside`/`onInteractOutside` trong `components/common`); chỉ đóng bằng Esc, nút X, `DialogClose`. Cần đóng khi click ngoài → truyền `onPointerDownOutside={undefined}` tại chỗ dùng. `AlertDialog` (Radix) vốn đã vậy.
- **Cấm `window.confirm` / `prompt` / `alert`**. Xác nhận / nhập nhanh: `await confirmDialog({ title, description?, confirmText?, destructive? })` → `boolean`, `await promptDialog({ title, label?, multiline?, required? })` → chuỗi đã trim hoặc `null` (`components/common/confirm-dialog.tsx`, `<ConfirmHost />` gắn ở `App.tsx`).
- Thêm component: `bun run ui:add <tên>` (script sửa lỗi registry sinh `from "cn"`). Được chỉnh file trong `components/common` nhưng `--overwrite` sẽ ghi đè.

## Màu & theme token

- Màu dùng token (`bg-background`, `text-muted-foreground`, `border`, `bg-primary`…), không hard-code mã màu → dark mode (`.dark`, nút ở header) chạy đúng. Palette slate theo shadcn-admin; đổi màu chủ đạo: `--primary`/`--ring` trong `global.css`. Animation `animate-in/out` từ `tw-animate-css`. `sonner.tsx` dùng `useTheme` của dự án thay `next-themes`.
- Màu trạng thái: token tự thêm `success` / `warning` / `info` (+ `-foreground`) cạnh `destructive` → `text-success`, `bg-warning/15`… Badge trạng thái dùng `StatusBadge` (`components/common/StatusBadge.tsx`, prop `tone`); map nhãn trong `features/<x>/utils/labels.ts` khai báo `tone`, không khai báo class màu. Sidebar dùng token `sidebar-*`.

## Trang mới: bề ngang

- Không tự đặt `max-w-*` + `mx-auto` ở cấp trang (khung `MainLayout` đã rộng hết + lề theo vùng nội dung); lưới thẻ phải có bậc cột cho `@7xl/content` và `@min-[112rem]/content` (container query, không `xl:` / `2xl:`). Trang đọc một cột: xem 3 nhóm trang ở [frontend-layout.md](frontend-layout.md).

## Bảng

- Bảng dài cần header dính khi cuộn: `<Table containerClassName="max-h-[calc(100vh-…)] overflow-auto">` (khung tự cuộn — sticky không bám theo cuộn trang vì `Table` đã bọc `overflow-x-auto`) + `<TableHeader className="sticky top-0 z-10 bg-background shadow-[inset_0_-1px_0_var(--color-border)] [&_tr]:border-b-0">` (viền dưới bằng shadow). Mẫu: `notification-events-card`.
- Phân trang: [frontend.md](frontend.md) (BE phân trang, `TablePagination`).

### Bảng nhiều cột: nút "Cột"

`components/common/columns` → `useColumns(tableId, COLUMNS)` + `<ColumnsMenu state={cols} />` (đặt ở hàng công cụ của bảng, căn phải). `COLUMNS: ColumnDef[]` khai báo hằng ngoài component (`id` ổn định, `required` = không cho ẩn, `defaultHidden`). Trong bảng: `{v('id') && <TableHead>…}` và ô tương ứng; dòng trống / đang tải dùng `colSpan={cols.span(sốCộtCốĐịnh)}`; footer có colSpan thì tính theo cột đang hiện. Lựa chọn lưu localStorage `officehub.columns.<tableId>` (mỗi trình duyệt). Đang dùng: danh bạ nhân viên, hợp đồng, kỳ lương, chấm công hôm nay / tổng hợp tháng / bảng công tháng, báo cáo tăng ca + phép năm, quỹ phép. Bảng mới ≥ 6 cột dữ liệu → thêm nút này.

## Gợi ý @nhắc (TEST-71)

Dùng chung ở Bảng tin (soạn bài, bình luận), bình luận việc, chat: `utils/mention.ts` + `hooks/useMentionNav.ts` + `components/common/mention-list`.
- Gõ: `nextMentionQuery(trước-con-trỏ, từ-khoá-đang-mở)` — một từ ≤ 20 ký tự; **khi gợi ý đang mở** cho thêm dấu cách (≤ 3 từ / 40 ký tự). Đóng: hai dấu cách liền, xuống dòng, Esc, hoặc từ khoá có dấu cách mà hết người khớp (biến `live` ở ô nhập). Chọn → `replaceMentionQuery(text, caret, query, insert)` thay cả từ khoá; vẫn chèn `@<mã>` (việc, chat) / `@Họ tên` (Bảng tin) như cũ.
- Server tìm (Bảng tin, chat) — [news-extras.md](business/news-extras.md); thành viên dự án lọc ở FE bằng `rankPeople` (bỏ dấu, tách từ, xếp hạng giống `PersonSearch` ở BE). Gọi server sau 200 ms (`useDebounce`).
- `MentionList`: cao ~8 dòng, cuộn, ↑↓ cuộn theo (`data-index` + `scrollIntoView`), tô chữ khớp (`highlightMatches`), dòng phụ `mentionHint(mã, phòng ban, chức danh)`, avatar + chip BOT; prop `open` → "Đang tìm…" / "Không tìm thấy ai"; đủ 20 → "Gõ thêm … để thu hẹp".

## Ảnh / video ngoài

- (TEST-22, `utils/trustedMedia.ts`): Markdown (`components/common/markdown.tsx`) và link media của việc (`task-media`) chỉ tự tải ảnh / file video từ cùng domain hoặc S3 `*.amazonaws.com`; nguồn khác hiện thành link bấm mở (tránh ảnh theo dõi). YouTube / Vimeo / Drive nhúng như cũ.
