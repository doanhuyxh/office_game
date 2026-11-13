import { useEffect, useRef } from 'react';
import type { BotWatchView } from '../../hooks/use-bot-watch';
import type { BotWatchEventDto } from '../../types/office.types';

/** Nhãn ngắn cho từng loại sự kiện (`BotActivityKind`). */
export const BOT_EVENT_LABEL: Record<string, string> = {
  session_start: '▶ Bắt đầu phiên', session_end: '■ Kết thúc phiên', command: '$ Lệnh', file_edit: '✎ Sửa file', file_write: '＋ Ghi file',
  file_read: '👁 Đọc file', search: '🔍 Tìm', thinking: '💭 Suy nghĩ', say: '💬 Agent nói', tool: '🔧 Tool',
};

/**
 * Bảng TẠM tối giản "màn hình của bot" (TEST-97) — chỉ để thử luồng WatchBot: tên bot, đang làm / rảnh + việc, model / lượt / chi phí,
 * mỗi sự kiện một dòng (nhãn loại, tiêu đề, đường dẫn, 2 dòng đầu nội dung), tự cuộn xuống cuối. Bảng đầy đủ (terminal, diff màu,
 * suy nghĩ, lời agent) là việc TEST-98 — thay component này, giữ nguyên hook `use-bot-watch`.
 */
export function BotWatchPanel({ view, onClose }: { view: BotWatchView | null; onClose: () => void }) {
  const logRef = useRef<HTMLDivElement>(null);
  const lastSeq = view?.events.at(-1)?.seq;
  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [lastSeq]);
  if (!view) return null;
  const state = view.connecting ? 'Đang kết nối…'
    : view.busy === true ? `Đang làm${view.task ? ` · ${view.task}` : ''}`
    : view.busy === false ? 'Đang rảnh' : 'Chưa rõ trạng thái';
  const meta = [view.model, view.turns != null ? `${view.turns} lượt` : null, view.costUsd != null ? `$${view.costUsd.toFixed(2)}` : null]
    .filter(Boolean).join(' · ');
  return (
    <div className="card bot-watch" data-testid="office-bot-watch" data-bot={view.botId}>
      <div className="bot-watch-head">
        <span>🤖 <b>{view.name}</b> · <span data-testid="office-bot-watch-state">{state}</span></span>
        <button type="button" onClick={onClose} data-testid="office-bot-watch-close">✕ Đóng</button>
      </div>
      {meta && <small className="bot-watch-meta">{meta}</small>}
      <div className="bot-watch-log" ref={logRef}>
        {view.events.length === 0 && !view.connecting && <small>Chưa có hoạt động trong phiên này</small>}
        {view.events.map((e) => <Line key={e.id} e={e} />)}
      </div>
    </div>
  );
}

function Line({ e }: { e: BotWatchEventDto }) {
  const body = e.text ?? e.diff ?? e.output ?? '';
  return (
    <div className={`bot-watch-line${e.ok === false ? ' err' : ''}`} data-kind={e.kind} data-id={e.id}>
      <b>{BOT_EVENT_LABEL[e.kind] ?? e.kind}</b> {e.title}
      {e.path && <code> {e.path}</code>}
      {e.ok === false && <em> · lỗi</em>}
      {body && <pre>{body.split('\n').slice(0, 2).join('\n').slice(0, 200)}</pre>}
    </div>
  );
}
