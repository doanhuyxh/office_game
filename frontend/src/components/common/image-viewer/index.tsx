import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, ImageOff, Loader2, X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { Button } from '@/components/common/button';
import { cn } from '@/utils/cn';

/** Một ảnh trong trình xem. `downloadable: false` = ẩn nút tải (vd ảnh của tin đang gửi — blob cục bộ). */
export interface ImageViewerItem {
  id: string;
  url: string;
  fileName: string;
  /** Dòng trên tên tệp (chat: "Người gửi · giờ gửi"). */
  caption?: string;
  downloadable?: boolean;
}

/** Phóng to tối đa 400% kích thước thật; nhỏ nhất = vừa màn hình (ảnh nhỏ: kích thước thật, không phóng to). */
const MAX_SCALE = 4;
const DOUBLE_TAP_MS = 300;
const TAP_SLOP_PX = 8;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Trình xem ảnh toàn màn hình dùng chung (TEST-147): chat (/chat + khung chat 3D) và Bảng tin.
 * Radix Dialog (giữ `role="dialog"` + bẫy tiêu điểm → engine 3D bỏ qua phím, xem `TYPING_SCOPES`) nhưng tự vẽ lớp phủ + nội dung.
 * Nền đen ở mọi theme; thanh trên (chú thích, tên tệp, Tải về / Mở tab mới / Đóng) tách khỏi ảnh; nhiều ảnh → nút hai bên, ← →, "3 / 12".
 * Zoom: nhấp / chạm đúp (vừa màn hình ↔ 100%), lăn chuột quanh con trỏ, kéo khi đang zoom, chụm hai ngón. Đóng: Esc, bấm nền, ✕.
 */
export function ImageViewer({ images, index, onIndex, onDownload }: {
  images: ImageViewerItem[];
  index: number | null;
  onIndex: (i: number | null) => void;
  onDownload?: (image: ImageViewerItem) => Promise<void> | void;
}) {
  const cur = index !== null ? images[index] ?? null : null;
  const many = images.length > 1;
  const contentRef = useRef<HTMLDivElement>(null);
  const [downloading, setDownloading] = useState(false);

  const go = (d: number) => { if (index !== null && many) onIndex((index + d + images.length) % images.length); };
  const close = () => onIndex(null);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(1); }
  };

  const download = async () => {
    if (!cur || !onDownload) return;
    setDownloading(true);
    try { await onDownload(cur); } finally { setDownloading(false); }
  };

  const iconBtn = 'size-9 shrink-0 text-white hover:bg-white/15 hover:text-white focus-visible:ring-white/50';
  // Bấm vào khoảng trống (không phải nút) ở thanh trên / cột hai bên → đóng
  const closeOnSelf = (e: MouseEvent) => { if (e.target === e.currentTarget) close(); };

  return (
    <DialogPrimitive.Root open={cur !== null} onOpenChange={(o) => !o && close()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay data-slot="image-viewer-overlay" className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={contentRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex flex-col text-white outline-none select-none"
          onOpenAutoFocus={(e) => { e.preventDefault(); contentRef.current?.focus(); }}
          onKeyDown={onKeyDown}
          data-testid="image-viewer"
        >
          <DialogPrimitive.Title className="sr-only">{cur?.fileName ?? 'Ảnh'}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">Xem ảnh toàn màn hình. Nhấp đúp hoặc lăn chuột để phóng to, mũi tên trái / phải để chuyển ảnh, Esc để đóng.</DialogPrimitive.Description>

          <div className="flex shrink-0 items-center gap-2 bg-black/40 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]" onClick={closeOnSelf}>
            <div className="min-w-0 flex-1 leading-tight">
              {cur?.caption && <div className="truncate text-sm font-medium" data-testid="image-viewer-caption">{cur.caption}</div>}
              <div className={cn('truncate', cur?.caption ? 'text-xs text-white/70' : 'text-sm font-medium')} title={cur?.fileName} data-testid="image-viewer-filename">{cur?.fileName}</div>
            </div>
            {many && index !== null && (
              <span className="shrink-0 px-1 text-xs text-white/80 tabular-nums" data-testid="image-viewer-counter">{index + 1} / {images.length}</span>
            )}
            {onDownload && cur && cur.downloadable !== false && (
              <Button type="button" variant="ghost" size="icon" className={iconBtn} loading={downloading} onClick={() => void download()}
                aria-label="Tải về" title="Tải về" data-testid="image-viewer-download"><Download /></Button>
            )}
            {cur && (
              <Button asChild variant="ghost" size="icon" className={iconBtn}>
                <a href={cur.url} target="_blank" rel="noopener noreferrer" aria-label="Mở ảnh trong tab mới" title="Mở ảnh trong tab mới" data-testid="image-viewer-open"><ExternalLink /></a>
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button type="button" variant="ghost" size="icon" className={iconBtn} aria-label="Đóng" title="Đóng (Esc)" data-testid="image-viewer-close"><X /></Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1">
            {many && (
              <div className="flex w-12 shrink-0 items-center justify-center sm:w-16" onClick={closeOnSelf}>
                <Button type="button" variant="ghost" size="icon" className={cn(iconBtn, 'size-10 rounded-full bg-white/10')} onClick={() => go(-1)}
                  aria-label="Ảnh trước" title="Ảnh trước (←)" data-testid="image-viewer-prev"><ChevronLeft className="size-6" /></Button>
              </div>
            )}
            {cur && <Stage key={cur.id} image={cur} onClose={close} />}
            {many && (
              <div className="flex w-12 shrink-0 items-center justify-center sm:w-16" onClick={closeOnSelf}>
                <Button type="button" variant="ghost" size="icon" className={cn(iconBtn, 'size-10 rounded-full bg-white/10')} onClick={() => go(1)}
                  aria-label="Ảnh sau" title="Ảnh sau (→)" data-testid="image-viewer-next"><ChevronRight className="size-6" /></Button>
              </div>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface View { s: number; tx: number; ty: number }

/** Vùng ảnh: tự tính "vừa màn hình", zoom / kéo bằng pointer events + CSS transform. `key` theo ảnh → đổi ảnh là đặt lại zoom. */
function Stage({ image, onClose }: { image: ImageViewerItem; onClose: () => void }) {
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [failed, setFailed] = useState(false);
  // null = vừa màn hình (theo kích thước khung khi đổi cỡ cửa sổ)
  const [zoom, setZoom] = useState<View | null>(null);

  useEffect(() => {
    if (!stage) return;
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(stage);
    return () => ro.disconnect();
  }, [stage]);

  const fit = nat && box.w > 0 && box.h > 0 ? Math.min(1, box.w / nat.w, box.h / nat.h) : 1;
  const view: View = zoom ?? { s: fit, tx: 0, ty: 0 };

  // Giá trị mới nhất cho listener gắn trực tiếp (wheel không passive)
  const live = useRef({ view, fit, box, nat });
  live.current = { view, fit, box, nat };

  /** Đặt zoom quanh điểm (px, py) — toạ độ so với tâm khung; giữ điểm dưới con trỏ đứng yên, kẹp phần kéo trong mép ảnh. */
  const apply = useCallback((s: number, px: number, py: number, base?: View) => {
    const { view: v, fit: f, box: b, nat: n } = live.current;
    if (!n) return;
    const from = base ?? v;
    const ns = clamp(s, f, Math.max(MAX_SCALE, f));
    if (ns <= f + 1e-3) { setZoom(null); return; }
    let tx = px - ((px - from.tx) * ns) / from.s;
    let ty = py - ((py - from.ty) * ns) / from.s;
    const mx = Math.max(0, (n.w * ns - b.w) / 2);
    const my = Math.max(0, (n.h * ns - b.h) / 2);
    tx = clamp(tx, -mx, mx);
    ty = clamp(ty, -my, my);
    setZoom({ s: ns, tx, ty });
  }, []);

  const local = (x: number, y: number) => {
    const r = stage!.getBoundingClientRect();
    return { x: x - r.left - r.width / 2, y: y - r.top - r.height / 2 };
  };

  useEffect(() => {
    if (!stage) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = stage.getBoundingClientRect();
      const { view: v } = live.current;
      apply(v.s * Math.exp(-e.deltaY * 0.0015), e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, [stage, apply]);

  // Pointer: 1 ngón kéo (khi đang zoom), 2 ngón chụm; chạm không di chuyển = "tap" (đúp trên ảnh → zoom, một lần ngoài ảnh → đóng)
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ moved: boolean; onImage: boolean; startX: number; startY: number; pinch?: { d: number; mx: number; my: number; view: View } } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const pinchInfo = () => {
    const [a, b] = [...pts.current.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as Element).closest('button, a')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    stage?.setPointerCapture(e.pointerId);
    const p = local(e.clientX, e.clientY);
    pts.current.set(e.pointerId, p);
    if (pts.current.size === 1) {
      gesture.current = { moved: false, onImage: (e.target as Element).tagName === 'IMG', startX: p.x, startY: p.y };
    } else if (pts.current.size === 2 && gesture.current) {
      gesture.current.moved = true;
      gesture.current.pinch = { ...pinchInfo(), view: live.current.view };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const prev = pts.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    const p = local(e.clientX, e.clientY);
    pts.current.set(e.pointerId, p);
    if (g.pinch && pts.current.size >= 2) {
      const { d, mx, my } = pinchInfo();
      const base = g.pinch.view;
      // Zoom quanh tâm chụm lúc đầu, rồi dời theo tâm chụm hiện tại
      const s = base.s * (d / g.pinch.d);
      apply(s, g.pinch.mx, g.pinch.my, { ...base, tx: base.tx + (mx - g.pinch.mx), ty: base.ty + (my - g.pinch.my) });
      return;
    }
    if (!g.moved && Math.hypot(p.x - g.startX, p.y - g.startY) > TAP_SLOP_PX) g.moved = true;
    const v = live.current.view;
    if (g.moved && v.s > live.current.fit + 1e-3) apply(v.s, 0, 0, { s: v.s, tx: v.tx + p.x - prev.x, ty: v.ty + p.y - prev.y });
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.delete(e.pointerId);
    const g = gesture.current;
    if (pts.current.size > 0) {
      // Nhấc một ngón khi đang chụm → ngón còn lại tiếp tục kéo, không tính là tap
      if (g) g.pinch = undefined;
      return;
    }
    gesture.current = null;
    if (!g || g.moved || e.type === 'pointercancel') return;
    const p = local(e.clientX, e.clientY);
    if (!g.onImage) { lastTap.current = null; onClose(); return; }
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.t < DOUBLE_TAP_MS && Math.hypot(p.x - prev.x, p.y - prev.y) < 30) {
      lastTap.current = null;
      const { view: v, fit: f } = live.current;
      if (v.s > f + 1e-3) setZoom(null);
      else apply(f < 1 ? 1 : 2, p.x, p.y);
    } else {
      lastTap.current = { t: now, x: p.x, y: p.y };
    }
  };

  const zoomed = view.s > fit + 1e-3;
  return (
    <div
      ref={setStage}
      className={cn('relative min-w-0 flex-1 touch-none overflow-hidden', zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="image-viewer-stage"
    >
      {failed ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-white/80" data-testid="image-viewer-error">
          <ImageOff className="size-10" />
          Không tải được ảnh
          <span className="text-xs text-white/60">Liên kết có thể đã hết hạn — đóng rồi mở lại để tải lại.</span>
        </div>
      ) : (
        <>
          {!nat && <Loader2 className="pointer-events-none absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-white/70" />}
          <img
            src={image.url}
            alt={image.fileName}
            draggable={false}
            onLoad={(e) => setNat({ w: e.currentTarget.naturalWidth || 1, h: e.currentTarget.naturalHeight || 1 })}
            onError={() => setFailed(true)}
            className={cn('absolute top-1/2 left-1/2 max-w-none origin-center', nat ? !zoomed && 'cursor-zoom-in' : 'invisible')}
            style={nat ? {
              width: nat.w,
              height: nat.h,
              transform: `translate(-50%, -50%) translate(${view.tx}px, ${view.ty}px) scale(${view.s})`,
            } : undefined}
            data-testid="image-viewer-img"
            data-scale={view.s.toFixed(3)}
            data-fit={fit.toFixed(3)}
          />
        </>
      )}
    </div>
  );
}
