import { useLayoutEffect, useRef, useState } from 'react';

/** Bề ngang thật (px) của phần tử — biểu đồ SVG vẽ theo px thật để chữ trục không co lại trên điện thoại. */
export function useElementWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth || fallback);
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width) || fallback));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
