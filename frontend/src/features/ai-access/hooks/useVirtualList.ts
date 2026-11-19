import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface Options {
  count: number;
  /** Khoá ổn định của mục thứ `index` (giữ chiều cao đã đo khi danh sách lọc lại). */
  keyOf: (index: number) => number;
  /** Chiều cao ước lượng (px) khi chưa đo. */
  estimate: (index: number) => number;
  /** Vẽ thêm bấy nhiêu px trên / dưới vùng nhìn thấy. */
  overscan?: number;
}

/** Vị trí đầu tiên có `offsets[i] > y` − 1 (mục chứa toạ độ y). */
function indexAt(offsets: Float64Array, count: number, y: number) {
  let lo = 0, hi = count;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid + 1] <= y) lo = mid + 1;
    else hi = mid;
  }
  return Math.min(lo, Math.max(0, count - 1));
}

/**
 * Cuộn ảo chiều cao thay đổi (TEST-197, không thêm thư viện): chỉ dựng các mục đang nhìn thấy (+ `overscan`), đo chiều cao thật bằng
 * `ResizeObserver` (mở / thu gọn một lượt cũng tự cập nhật), mục phía trên vùng nhìn đổi cao → bù `scrollTop` để nội dung đang đọc không nhảy.
 * Gắn `scrollRef` vào khung cuộn, `measureRef` + `data-index` vào từng mục (định vị tuyệt đối theo `offsets[index]`).
 */
export function useVirtualList({ count, keyOf, estimate, overscan = 800 }: Options) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sizes = useRef(new Map<number, number>());
  const [version, setVersion] = useState(0);
  const [view, setView] = useState({ top: 0, height: 600 });

  const offsets = useMemo(() => {
    const o = new Float64Array(count + 1);
    for (let i = 0; i < count; i++) o[i + 1] = o[i] + (sizes.current.get(keyOf(i)) ?? estimate(i));
    return o;
    // version: chiều cao đã đo đổi
  }, [count, keyOf, estimate, version]); // eslint-disable-line react-hooks/exhaustive-deps
  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const observer = useMemo(() => typeof ResizeObserver === 'undefined' ? null : new ResizeObserver((entries) => {
    let changed = false, shift = 0;
    const el = scrollRef.current;
    for (const e of entries) {
      const node = e.target as HTMLElement;
      const index = Number(node.dataset.index);
      const key = Number(node.dataset.key);
      const h = e.borderBoxSize?.[0]?.blockSize ?? node.getBoundingClientRect().height;
      const prev = sizes.current.get(key);
      if (prev !== undefined && Math.abs(prev - h) < 0.5) continue;
      const old = prev ?? (offsetsRef.current[index + 1] - offsetsRef.current[index]);
      sizes.current.set(key, h);
      changed = true;
      // mục nằm hẳn trên vùng đang nhìn → bù độ lệch để không bị kéo
      if (el && offsetsRef.current[index + 1] <= el.scrollTop + 1) shift += h - old;
    }
    if (!changed) return;
    if (el && shift) el.scrollTop += shift;
    setVersion((v) => v + 1);
  }), []);
  useEffect(() => () => observer?.disconnect(), [observer]);

  const measureRef = useCallback((node: HTMLElement | null) => {
    if (!node || !observer) return;
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer]);

  const sync = useCallback(() => {
    const el = scrollRef.current;
    if (el) setView((v) => (v.top === el.scrollTop && v.height === el.clientHeight ? v : { top: el.scrollTop, height: el.clientHeight }));
  }, []);
  const frame = useRef(0);
  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(sync);
  }, [sync]);
  useLayoutEffect(() => {
    sync();
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => ro.disconnect();
  }, [sync]);

  const total = offsets[count] ?? 0;
  const items = useMemo(() => {
    if (!count) return [];
    const start = indexAt(offsets, count, Math.max(0, view.top - overscan));
    const end = indexAt(offsets, count, view.top + view.height + overscan);
    const out: number[] = [];
    for (let i = start; i <= end; i++) out.push(i);
    return out;
  }, [offsets, count, view, overscan]);

  /** Cuộn tới mục `index` (đầu mục ở mép trên). `-1` = cuối danh sách. */
  const scrollTo = useCallback((index: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const go = () => {
      const o = offsetsRef.current;
      el.scrollTop = index < 0 ? el.scrollHeight : o[Math.min(index, o.length - 1)];
    };
    go();
    // chiều cao thật đo xong ở khung sau → chỉnh lại một lần
    requestAnimationFrame(() => requestAnimationFrame(go));
  }, []);

  return { scrollRef, measureRef, onScroll, items, offsets, total, scrollTo, firstVisible: count ? indexAt(offsets, count, view.top) : 0 };
}
