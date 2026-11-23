import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';

/**
 * Thẻ nổi của biểu đồ cột vẽ bằng CSS (TEST-224) — thay thuộc tính `title` của trình duyệt.
 * - `useChartHover()` giữ cột đang trỏ: chuột vào / ra, focus bàn phím, chạm trên điện thoại (chạm ra ngoài khung → tắt).
 * - `ChartHoverCard` render qua portal (không bị `overflow-x-auto` cắt), nằm PHÍA TRÊN phần tử neo (cột cao hết vùng vẽ → không che cột
 *   và nhãn trục X), mép trái ở giữa cột; sát mép phải màn hình thì lật sang trái. Hiện ngay, không trễ.
 * - Nội dung: `ChartHoverHeader` (kỳ + tổng) · `ChartHoverRows` + `ChartHoverRow` (ô màu, nhãn, giá trị căn phải, %) · `ChartHoverNote` (cảnh báo).
 */
export function useChartHover<K extends string>() {
  const [active, setActive] = React.useState<{ key: K; anchor: HTMLElement } | null>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!active) return;
    const onDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setActive(null);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setActive(null); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [active]);

  const show = (key: K) => (e: React.SyntheticEvent<HTMLElement>) => setActive({ key, anchor: e.currentTarget });
  const hide = (key: K) => () => setActive((a) => (a?.key === key ? null : a));

  /** Gắn vào từng cột: chuột, focus (cột có `tabIndex=0`), chạm (click). */
  const bind = (key: K) => ({
    tabIndex: 0,
    onMouseEnter: show(key),
    onMouseLeave: hide(key),
    onFocus: show(key),
    onBlur: hide(key),
    onClick: show(key),
  });

  return { activeKey: active?.key ?? null, anchor: active?.anchor ?? null, containerRef, bind };
}

const GAP = 6;
const EDGE = 8;

export function ChartHoverCard({ anchor, className, children, ...props }: React.ComponentProps<'div'> & { anchor: HTMLElement | null }) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null);

  React.useLayoutEffect(() => {
    if (!anchor) { setPos(null); return; }
    const place = () => {
      const card = ref.current;
      if (!card) return;
      const r = anchor.getBoundingClientRect();
      const w = card.offsetWidth, h = card.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const mid = r.left + r.width / 2;
      let left = mid + w + EDGE > vw ? mid - w : mid; // sát mép phải → lật sang trái
      left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
      const top = Math.max(EDGE, r.top - h - GAP);
      setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place); };
  }, [anchor, children]);

  if (!anchor) return null;
  return createPortal(
    <div ref={ref} role="tooltip" data-testid="chart-hover-card" {...props}
      className={cn('pointer-events-none fixed z-50 w-max max-w-[min(22rem,calc(100vw-1rem))] rounded-md border bg-popover p-2.5 text-xs text-popover-foreground shadow-md',
        !pos && 'invisible', className)}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0 }}>
      {children}
    </div>,
    document.body,
  );
}

/** Dòng đầu: kỳ (đầy đủ) · tổng chỉ số đang xem (đậm) · chỉ số phụ (mờ). */
export function ChartHoverHeader({ title, value, extra }: { title: React.ReactNode; value: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <div className="text-muted-foreground">{title}</div>
      <div className="flex items-baseline justify-between gap-4 tabular-nums">
        <span className="text-sm font-semibold">{value}</span>
        {extra != null && <span className="text-muted-foreground">· {extra}</span>}
      </div>
    </div>
  );
}

/** Khung các dòng — lưới 4 cột để giá trị / % thẳng hàng giữa các dòng. */
export function ChartHoverRows({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-t pt-2">{children}</div>;
}

/** Một dòng: ô màu (class nền, vd `bg-violet-500` / `bg-primary`), nhãn, giá trị căn phải, % (tuỳ chọn). */
export function ChartHoverRow({ color, label, value, share }: { color: string; label: React.ReactNode; value: React.ReactNode; share?: React.ReactNode }) {
  return (
    <>
      <span className={cn('size-2.5 rounded-sm', color)} />
      <span className="truncate">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
      <span className="min-w-[3.5rem] text-right text-muted-foreground tabular-nums">{share}</span>
    </>
  );
}

/** Dòng cuối màu cảnh báo (vd "⚠ 2 phiên không có chi phí"). */
export function ChartHoverNote({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 border-t pt-2 text-warning">⚠ {children}</div>;
}
