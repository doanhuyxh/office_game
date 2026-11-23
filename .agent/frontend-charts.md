# Front-end: biểu đồ vẽ bằng CSS + thẻ nổi

> Về [frontend-ui.md](frontend-ui.md) · [frontend.md](frontend.md).

Biểu đồ cột trong app vẽ bằng `div` + Tailwind (chiều cao theo %), **không thêm thư viện biểu đồ**: Kết nối AI → "Mức dùng AI" (`features/ai-access/components/ai-usage-chart`), Báo cáo → Trợ lý AI (`features/reports/components/ai-usage-chart`, cả sheet chi tiết người dùng).

## Thẻ nổi khi trỏ cột — `components/common/chart-hover-card.tsx` (TEST-224)

Không dùng thuộc tính `title` của trình duyệt (chậm ~1 giây, không theo theme, không chạy trên điện thoại / bàn phím).

- `const hover = useChartHover<string>()` → `ref={hover.containerRef}` ở khung biểu đồ; mỗi cột `{...hover.bind(key)}` (gồm `tabIndex=0`, chuột vào / ra, focus / blur, click = chạm) + `role="button"` + `aria-label` mang nội dung tương đương thẻ. `hover.activeKey` = cột đang trỏ → cột khác `opacity-40` (cột đang trỏ giữ màu). Chạm / bấm ra ngoài khung hoặc Esc → tắt.
- `<ChartHoverCard anchor={hover.anchor}>` render qua **portal** vào `body` (khung biểu đồ `overflow-x-auto` không cắt thẻ), `position: fixed`, `pointer-events-none`, hiện ngay không trễ. Vị trí: **phía trên** phần tử neo — cột cao hết vùng vẽ nên thẻ không che cột và nhãn trục X; mép trái ở giữa cột, sát mép phải màn hình thì lật sang trái; kẹp trong màn hình (lề 8 px); tự đặt lại khi cuộn (kể cả cuộn ngang biểu đồ) / đổi cỡ.
- Nội dung: `ChartHoverHeader` (kỳ · tổng đậm · chỉ số phụ mờ) → `ChartHoverRows` (lưới 4 cột để thẳng hàng) + `ChartHoverRow` (ô màu = class nền giống chú thích, nhãn, giá trị `tabular-nums` căn phải, %) → `ChartHoverNote` (dòng ⚠ màu `text-warning`).
- Màu chỉ dùng token theme (`bg-popover`, `border`, `text-muted-foreground`, `text-warning`) → sáng / tối tự đúng.
- Mức dùng AI: số rút gọn `formatTokensShort` ("124,3 tr"), chữ "token" chỉ ở dòng tổng, kỳ đầy đủ `bucketLongLabel` ("Thứ Ba, 17/11/2026" · "Tháng 11/2026" · "Năm 2026"), model sắp giảm dần, model đang ẩn ở chú thích không hiện, phiên thiếu chi phí = một dòng ⚠ tổng của kỳ.
- E2E đọc thẻ qua `[data-testid="chart-hover-card"]` (trỏ chuột bằng CDP `Input.dispatchMouseEvent` mouseMoved; điện thoại `Input.dispatchTouchEvent` + `Emulation.setTouchEmulationEnabled`) — mẫu `scripts/dev/ai-usage-ui-e2e.ts`.
