import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { BotWatchView } from '../../hooks/use-bot-watch';
import { useFloatingPanel, type PanelRect } from '../../hooks/use-floating-panel';
import { BotActSkeleton } from '../bot-act-skeleton';
import { BotActivityEvent, formatCost } from '../bot-activity-event';
import { BotFileList, summarizeFiles } from '../bot-file-list';

const MIN = { w: 320, h: 220 };
/** Cách đáy ≤ bấy nhiêu px thì coi là đang ở cuối (tự cuộn theo sự kiện mới). */
const STICK_PX = 32;
const PHONE = '(max-width: 640px)';
/** Chưa có sự kiện + người xem chưa tự kéo / đổi cỡ bảng → bảng chỉ cao bấy nhiêu px (TEST-190), có sự kiện đầu tiên thì giãn về cỡ mặc định. */
const COMPACT_H = 280;
const subscribePhone = (cb: () => void) => { const m = matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };

/**
 * Vị trí mặc định trên máy tính: cột bên phải, sát trái bản đồ nhỏ (216 px + lề) — nhân vật của mình luôn ở giữa màn hình nên bảng chỉ
 * được lấn tới cách tâm 40 px; cao tới trên thẻ voice / chấm công.
 */
const initialRect = ({ w: vw, h: vh }: { w: number; h: number }): PanelRect => {
  const w = Math.max(MIN.w, Math.min(460, vw / 2 - 240 - 40));
  return { w, h: Math.max(MIN.h, Math.min(620, vh - 56 - 150)), x: vw - 240 - w, y: 56 };
};

/** "3 phút 05 giây" / "1 giờ 02 phút" từ số giây. */
function formatElapsed(sec: number) {
  const s = Math.max(0, Math.floor(sec)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h} giờ ${p2(m)} phút` : m > 0 ? `${m} phút ${p2(s % 60)} giây` : `${s} giây`;
}

/** Thời gian phiên đã chạy: phiên xong → cố định (start → end); còn chạy → đếm mỗi giây (tách component để chỉ dòng này vẽ lại). */
function Elapsed({ from, to }: { from: string; to: string | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (to) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [to]);
  return <span data-testid="office-bot-elapsed">{formatElapsed(((to ? Date.parse(to) : now) - Date.parse(from)) / 1000)}</span>;
}

/**
 * Bảng "Màn hình của bot" (TEST-98): mở khi bấm vào bot trong văn phòng 3D (`use-bot-watch`), đóng bằng ✕ / Esc / khi server ngắt
 * (`BotWatchEnded` → hook đặt `view = null`). Đầu bảng: avatar + tên, nhãn ● Trực tiếp, việc đang làm, model · thời gian · lượt · chi phí.
 * Thân: dòng thời gian tự cuộn xuống cuối; người xem cuộn lên → ngừng tự cuộn + nút "Về mới nhất"; tab thứ hai "File đã sửa" (TEST-100,
 * `bot-file-list`) tính từ chính các sự kiện đang có. Máy tính (> 640 px): bảng nổi dùng chung hook `use-floating-panel` với chat nổi (TEST-102):
 * kéo bằng thanh đầu bảng (nút Đóng không khởi động kéo; hàng tab / thân nằm ngoài vùng kéo nên bấm / cuộn / chọn chữ như thường), đổi cỡ bằng
 * tay nắm góc dưới phải (nhỏ nhất 320 × 220, to nhất = vùng nhìn trừ lề 8 px), luôn nằm trong vùng nhìn (đổi cỡ cửa sổ / xoay / bàn phím ảo →
 * `fit` của hook); pointer capture giữ sự kiện trên bảng nên kéo không làm nhân vật đi / camera xoay. Nhớ vị trí + kích thước theo trình duyệt ở
 * localStorage `officehub.office.agent-screen-panel` (mở bot khác / tải lại vẫn dùng) — KHÔNG lưu sự kiện (chủ dự án: không lưu lịch sử).
 * Điện thoại (≤ 640 px): rộng hết màn hình, vị trí do CSS, không kéo / đổi cỡ.
 * Không để thân trắng (TEST-190): đang kết nối → vòng xoay + skeleton (quá 8 giây → "Kết nối chậm…" + nút Thử lại = `onRetry`); bot đang làm
 * chưa có sự kiện → chấm nhấp nháy "Đang chờ thao tác đầu tiên của bot…" + việc; rảnh → ☕; mất kết nối giữa chừng → giữ sự kiện, làm mờ +
 * dải "Mất kết nối, đang thử lại…". Đầu bảng có chấm màu theo trạng thái. Chưa có sự kiện và chưa tự đổi cỡ → bảng thấp (COMPACT_H).
 */
export function BotActivityPanel({ view, onClose, onRetry }: { view: BotWatchView | null; onClose: () => void; onRetry: () => void }) {
  const phone = useSyncExternalStore(subscribePhone, () => matchMedia(PHONE).matches);
  const panel = useFloatingPanel({ storageKey: 'officehub.office.agent-screen-panel', min: MIN, initial: initialRect });
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [behind, setBehind] = useState(false);
  const [tab, setTab] = useState<'log' | 'files'>('log');
  const open = !!view;
  const botId = view?.botId;

  // Esc đóng bảng — trừ khi đang có hộp thoại (Esc thuộc về hộp thoại) hoặc đang gõ trong ô nhập (chat)
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role=dialog], [role=alertdialog]')) return;
      if ((e.target as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable=true]')) return;
      onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Đổi bot → về tab Hoạt động, chế độ bám cuối
  useEffect(() => { stick.current = true; setBehind(false); setTab('log'); }, [botId]);
  // Có sự kiện mới / cập nhật (mảng mới) hoặc bảng đổi cỡ: đang bám cuối thì cuộn xuống, không thì giữ nguyên chỗ người xem đang đọc
  const events = view?.events;
  const w = panel.rect.w;
  // Chưa có nội dung + chưa tự kéo / đổi cỡ (không có gì ở localStorage) → bảng thấp; có sự kiện đầu tiên → cỡ mặc định
  const h = !panel.floating && !events?.length ? Math.min(panel.rect.h, Math.max(MIN.h, COMPACT_H)) : panel.rect.h;
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [events, w, h, phone, tab]);
  const files = useMemo(() => summarizeFiles(events ?? []), [events]);

  if (!view) return null;

  const onScroll = () => {
    const el = logRef.current;
    if (!el) return;
    const atEnd = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_PX;
    stick.current = atEnd;
    setBehind(!atEnd);
  };
  const toLatest = () => {
    const el = logRef.current;
    if (!el) return;
    stick.current = true;
    setBehind(false);
    el.scrollTop = el.scrollHeight;
  };

  // Về tab Hoạt động: dòng thời gian được dựng lại → bám cuối như lúc mới mở
  const pick = (t: 'log' | 'files') => { if (t === 'log') { stick.current = true; setBehind(false); } setTab(t); };

  const lost = view.lost && view.connecting;
  const state = lost ? 'Mất kết nối, đang thử lại…' : view.connecting ? 'Đang kết nối…'
    : view.busy === true ? `Đang làm${view.task ? ` · ${view.task}` : ''}`
    : view.busy === false ? 'Đang rảnh' : 'Chưa rõ trạng thái';
  const live = !view.connecting && view.busy === true && !view.endedAt;
  const hasMeta = !!view.model || !!view.startedAt || view.turns != null || view.costUsd != null;
  const tone = lost ? 'lost' : view.connecting ? 'connecting' : view.busy === true ? 'busy' : view.busy === false ? 'idle' : 'unknown';
  const empty = view.events.length === 0;
  const initial = view.name.trim().split(/\s+/).at(-1)?.charAt(0).toUpperCase() || '🤖';

  return (
    <div className="card bot-act" data-testid="office-bot-watch" data-bot={view.botId} data-live={live ? '' : undefined} data-tone={tone}
      style={phone ? undefined : { left: panel.rect.x, top: panel.rect.y, width: w, height: h }}>
      <div className="bot-act-head" data-testid="office-bot-drag" {...(phone ? {} : panel.dragProps)}>
        <span className="bot-act-avatar" aria-hidden>{initial}</span>
        <div className="bot-act-who">
          <div className="bot-act-name">
            <b>{view.name}</b>
            {live && <span className="screen-live" data-testid="office-bot-live">● Trực tiếp</span>}
          </div>
          <div className="bot-act-state" title={state}>
            <span className={`bot-act-dot ${tone}`} aria-hidden data-testid="office-bot-dot" />
            <span className="txt" data-testid="office-bot-watch-state">{state}</span>
          </div>
        </div>
        <button type="button" className="bot-act-close" onClick={onClose} aria-label="Đóng" title="Đóng (Esc)" data-testid="office-bot-watch-close">✕</button>
      </div>
      {hasMeta && (
        <small className="bot-watch-meta">
          {view.model && <span>{view.model}</span>}
          {view.startedAt && <Elapsed from={view.startedAt} to={view.endedAt} />}
          {view.turns != null && <span>{view.turns} lượt</span>}
          {view.costUsd != null && <span>{formatCost(view.costUsd)}</span>}
        </small>
      )}
      <div className="bot-act-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'log'} onClick={() => pick('log')} data-testid="office-bot-tab-log">Hoạt động</button>
        <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => pick('files')} data-testid="office-bot-tab-files">
          File đã sửa{files.length > 0 && ` (${files.length})`}
        </button>
      </div>
      {lost && !empty && (
        <div className="bot-act-reconnect" role="status" data-testid="office-bot-reconnect-bar">
          <span className="bot-act-dot lost" aria-hidden /> Mất kết nối, đang thử lại…
        </div>
      )}
      {tab === 'files' ? <BotFileList files={files} connecting={view.connecting && empty} /> : (
        <div className={`bot-act-log${lost && !empty ? ' dim' : ''}`} ref={logRef} onScroll={onScroll} data-testid="office-bot-log">
          {empty && view.connecting && (
            <div className="bot-act-status" role="status" data-testid={view.slow ? 'office-bot-slow' : 'office-bot-connecting'}>
              {view.slow ? (
                <>
                  <p>Kết nối chậm hơn bình thường, vẫn đang thử…</p>
                  <button type="button" className="bot-act-retry" onClick={onRetry} data-testid="office-bot-retry">Thử lại</button>
                </>
              ) : (
                <p><span className="bot-act-spinner" aria-hidden />Đang kết nối tới {view.name}…</p>
              )}
              <BotActSkeleton />
            </div>
          )}
          {empty && !view.connecting && view.busy === false && (
            <div className="bot-act-status idle" data-testid="office-bot-empty">
              <span className="big" aria-hidden>☕</span>
              <p>{view.name} đang nghỉ, chưa có việc nào đang chạy</p>
            </div>
          )}
          {empty && !view.connecting && view.busy !== false && (
            <div className="bot-act-status" role="status" data-testid="office-bot-waiting">
              <p><span className="bot-act-pulse" aria-hidden />Đang chờ thao tác đầu tiên của bot…</p>
              {view.task && <small className="bot-act-task">{view.task}</small>}
            </div>
          )}
          {view.events.map((e) => <BotActivityEvent key={e.id} e={e} live={live} />)}
        </div>
      )}
      {behind && tab === 'log' && <button type="button" className="bot-act-latest" onClick={toLatest} data-testid="office-bot-latest">↓ Về mới nhất</button>}
      {!phone && <span className="resize" {...panel.resizeProps} aria-hidden data-testid="office-bot-resize" />}
    </div>
  );
}
