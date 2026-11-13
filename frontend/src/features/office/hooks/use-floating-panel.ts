import { useEffect, useRef, useState } from 'react';

export type PanelRect = { x: number; y: number; w: number; h: number };
type Size = { w: number; h: number };
/** Vùng đang nhìn thấy (toạ độ theo layout viewport): `visualViewport` khi có — bàn phím ảo mở thì vùng này thấp lại. */
type Viewport = { left: number; top: number; w: number; h: number };

const MARGIN = 8;
const viewport = (): Viewport => {
  const v = typeof visualViewport !== 'undefined' ? visualViewport : null;
  return v ? { left: v.offsetLeft, top: v.offsetTop, w: v.width, h: v.height } : { left: 0, top: 0, w: innerWidth, h: innerHeight };
};
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/** Đưa bảng vào trong vùng nhìn: kích thước trong [min, màn hình], vị trí không lọt ra ngoài. */
function fit(r: PanelRect, vp: Viewport, min: Size): PanelRect {
  const maxW = vp.w - 2 * MARGIN, maxH = vp.h - 2 * MARGIN;
  const w = Math.min(Math.max(r.w, min.w), maxW), h = Math.min(Math.max(r.h, min.h), maxH);
  return {
    w, h,
    x: clamp(r.x, vp.left + MARGIN, vp.left + vp.w - w - MARGIN),
    y: clamp(r.y, vp.top + MARGIN, vp.top + vp.h - h - MARGIN),
  };
}

type Saved = { floating: boolean; rect: PanelRect | null };
function load(key: string): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null') as Partial<Saved> | null;
    const r = v?.rect;
    const ok = !!r && [r.x, r.y, r.w, r.h].every((n) => typeof n === 'number' && Number.isFinite(n));
    return { floating: v?.floating === true, rect: ok ? r : null };
  } catch { return { floating: false, rect: null }; }
}
function save(key: string, s: Saved) {
  try { localStorage.setItem(key, JSON.stringify(s)); } catch { /* bỏ qua */ }
}
/** Vị trí đã lưu còn hợp lệ với màn hình hiện tại (nằm trọn trong cửa sổ, không nhỏ hơn mức tối thiểu)? So với cả cửa sổ,
 *  không với `visualViewport` — bàn phím ảo mở không làm mất vị trí đã lưu (khi đó `fit` chỉ tạm đẩy bảng vào vùng nhìn). */
const stillValid = (r: PanelRect | null, min: Size): r is PanelRect =>
  !!r && r.w >= min.w && r.h >= min.h && r.x >= 0 && r.y >= 0 && r.x + r.w <= innerWidth && r.y + r.h <= innerHeight;

type Options = {
  /** Khoá localStorage nhớ chế độ + vị trí + kích thước. */
  storageKey: string;
  min: Size;
  /** Vị trí + kích thước mặc định (lần đầu nổi / giá trị đã lưu không còn hợp lệ) theo vùng nhìn hiện tại. */
  initial: (vp: { w: number; h: number }) => PanelRect;
};

/**
 * Bảng nổi kéo di chuyển + kéo đổi kích thước (pointer events + setPointerCapture — chuột và cảm ứng dùng chung, không thư viện).
 * `rect` luôn nằm trong vùng nhìn (đổi cỡ cửa sổ / xoay máy / bàn phím ảo → tự đưa vào lại). Gắn `dragProps` lên vùng kéo
 * (bấm vào nút / ô nhập trong vùng đó không tính là kéo), `resizeProps` lên tay nắm góc dưới phải.
 */
export function useFloatingPanel({ storageKey, min, initial }: Options) {
  const [saved, setSaved] = useState<Saved>(() => load(storageKey));
  const [vp, setVp] = useState<Viewport>(viewport);
  const gesture = useRef<{ kind: 'move' | 'resize'; px: number; py: number; start: PanelRect } | null>(null);
  // Đang kéo: vị trí tạm (state để vẽ lại, ref để lưu khi thả tay)
  const [live, setLiveState] = useState<PanelRect | null>(null);
  const liveRef = useRef<PanelRect | null>(null);
  const setLive = (r: PanelRect | null) => { liveRef.current = r; setLiveState(r); };

  useEffect(() => {
    const update = () => setVp(viewport());
    addEventListener('resize', update);
    visualViewport?.addEventListener('resize', update);
    visualViewport?.addEventListener('scroll', update);
    return () => {
      removeEventListener('resize', update);
      visualViewport?.removeEventListener('resize', update);
      visualViewport?.removeEventListener('scroll', update);
    };
  }, []);

  const base = stillValid(saved.rect, min) ? saved.rect : initial({ w: innerWidth, h: innerHeight });
  const rect = fit(live ?? base, vp, min);

  const setFloating = (floating: boolean) => {
    const next = { floating, rect: stillValid(saved.rect, min) ? saved.rect : null };
    setSaved(next);
    save(storageKey, next);
  };

  const begin = (kind: 'move' | 'resize') => (e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    if (kind === 'move' && (e.target as HTMLElement).closest('button, input, textarea, select, a')) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { kind, px: e.clientX, py: e.clientY, start: rect };
    setLive(rect);
  };
  const move = (e: React.PointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - g.px, dy = e.clientY - g.py, s = g.start;
    setLive(fit(g.kind === 'move' ? { ...s, x: s.x + dx, y: s.y + dy } : { ...s, w: s.w + dx, h: s.h + dy }, viewport(), min));
  };
  const end = () => {
    if (!gesture.current) return;
    gesture.current = null;
    const r = liveRef.current;
    setLive(null);
    if (!r) return;
    const next = { floating: true, rect: r };
    setSaved(next);
    save(storageKey, next);
  };
  const handlers = (kind: 'move' | 'resize') => ({
    onPointerDown: begin(kind), onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end,
  });

  return { floating: saved.floating, setFloating, rect, dragProps: handlers('move'), resizeProps: handlers('resize') };
}
