import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { OfficeScene } from '../../engine/OfficeScene';
import { useOffice, type BotAttention } from '../../store/office.store';
import type { BotAlertDto, BotAlertItemDto } from '../../types/office.types';

/** Chỉ mở link nội bộ dạng "/projects/…" (server đặt) — chặn "//host" / "javascript:" phòng dữ liệu lạ. */
const safeLink = (link?: string | null) => (link && link.startsWith('/') && !link.startsWith('//') ? link : null);

/** "WEB-12 · Tên việc" → "Tên việc" khi đầu chuỗi là mã việc. */
const stripCode = (title: string, code?: string | null) => (code && title.startsWith(`${code} · `) ? title.slice(code.length + 3) : title);

/** Loại lỗi ngắn lấy từ dòng bong bóng "⚠ WEB-12 · Hết giờ" / "⚠ Hết giờ" (BotPresence.AttentionBubble). */
function errorType(alert: BotAlertDto, code?: string | null) {
  const t = alert.text.replace(/^⚠\s*/, '');
  return code && t.startsWith(`${code} · `) ? t.slice(code.length + 3) : t || 'Lỗi';
}

function itemLabel(alert: BotAlertDto, it: BotAlertItemDto) {
  if (it.kind === 'approval') return 'Chờ duyệt';
  if (it.kind === 'reply') return 'Chờ phản hồi';
  return errorType(alert, it.code);
}

/** Đếm cho thanh trạng thái: số bot lỗi, số bot chỉ chờ người (+ tất cả đều chờ duyệt?). */
export function countAttention(alerts: Record<string, BotAttention>) {
  let errors = 0, waiting = 0, allApproval = true;
  for (const { alert } of Object.values(alerts)) {
    if (alert.kind === 'error') { errors++; continue; }
    waiting++;
    if (alert.items.some((i) => i.kind !== 'approval')) allApproval = false;
  }
  return { errors, waiting, waitingLabel: allApproval ? 'chờ duyệt' : 'chờ người' };
}

/**
 * Bot cần chú ý trên thanh trạng thái (TEST-122): "· 1 lỗi · 2 chờ duyệt" (chỉ phần > 0, đỏ / vàng) — bấm mở bảng nhỏ liệt kê bot: tên,
 * ⚠ / ⏳, các việc (mã · tên · Chờ duyệt / Chờ phản hồi / loại lỗi). Bấm tên bot → đi bộ tới cạnh bot; bấm việc → mở việc ở tab mới (văn phòng
 * giữ kết nối, như chuông TEST-109). Nội dung tên / việc là dữ liệu người dùng → chỉ render văn bản thuần. Đóng bằng ✕ / Esc / bấm ra ngoài.
 * TEST-130: bảng render vào `.hud` (portal — thẻ trạng thái có backdrop-filter nên con fixed / absolute bị neo theo thẻ) và mở sang trái cột
 * bản đồ nhỏ / camera, không che; bấm bản đồ nhỏ / nút camera khi bảng mở không đóng bảng (vừa xem danh sách vừa bấm bản đồ đi tới).
 */
export function BotAttentionStatus({ scene }: { scene: OfficeScene | null }) {
  const alerts = useOffice((s) => s.alerts);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const { errors, waiting, waitingLabel } = useMemo(() => countAttention(alerts), [alerts]);
  const list = useMemo(() => Object.entries(alerts).sort(([, a], [, b]) =>
    (a.alert.kind === b.alert.kind ? 0 : a.alert.kind === 'error' ? -1 : 1) || a.name.localeCompare(b.name, 'vi')), [alerts]);
  const any = errors + waiting > 0;

  useEffect(() => { if (!any) setOpen(false); }, [any]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (ref.current?.contains(t) || panelRef.current?.contains(t)) return;
      if (t instanceof Element && t.closest('.minimap, .camera')) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return;
      setOpen(false);
    };
    addEventListener('pointerdown', onDown, true);
    addEventListener('keydown', onKey);
    return () => { removeEventListener('pointerdown', onDown, true); removeEventListener('keydown', onKey); };
  }, [open]);

  if (!any) return null;
  const portal = (node: React.ReactNode) => (host ? createPortal(node, host) : node);
  const goTo = (id: string) => {
    if (scene?.walkToPlayer(id)) setOpen(false);
  };

  return (
    <span ref={ref} className="bot-attn">
      <button type="button" className="bot-attn-toggle" aria-expanded={open} onClick={(e) => {
          setHost(e.currentTarget.closest<HTMLElement>('.hud'));
          setOpen((o) => !o);
        }} data-testid="office-bot-attention"
        title="Bot cần chú ý">
        {errors > 0 && <span className="err">· {errors} lỗi</span>}
        {waiting > 0 && <span className="wait">· {waiting} {waitingLabel}</span>}
      </button>
      {open && portal(
        <div ref={panelRef} className={`card bot-attn-panel${errors > 0 ? ' error' : ''}`} role="region" aria-label="Bot cần chú ý" data-testid="office-bot-attention-panel">
          <div className="bot-attn-head">
            <b>Bot cần chú ý</b>
            <button type="button" onClick={() => setOpen(false)} aria-label="Đóng">✕</button>
          </div>
          <ul>
            {list.map(([id, { name, alert }]) => (
              <li key={id} className={alert.kind}>
                <button type="button" className="bot-attn-bot" onClick={() => goTo(id)} title="Đi tới cạnh bot">
                  <span aria-hidden>{alert.kind === 'error' ? '⚠' : '⏳'}</span> {name}
                </button>
                <ul>
                  {alert.items.map((it, i) => {
                    const href = safeLink(it.link);
                    const body = <>
                      {it.code && <b>{it.code}</b>}
                      <span className="title">{it.kind === 'error' && !it.code ? 'Phiên làm việc' : stripCode(it.title, it.code)}</span>
                      <span className={`tag ${it.kind}`}>{itemLabel(alert, it)}</span>
                    </>;
                    return (
                      <li key={`${it.kind}-${it.code ?? ''}-${i}`}>
                        {href ? <a href={href} target="_blank" rel="noopener" title="Mở việc ở tab mới">{body}</a> : <span className="row">{body}</span>}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        </div>,
      )}
    </span>
  );
}
