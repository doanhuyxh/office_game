import { memo, useState, type ReactNode } from 'react';
import { Markdown } from '@/components/common/markdown';
import type { BotWatchEventDto } from '../../types/office.types';

/** Nhãn + biểu tượng cho từng loại sự kiện (`BotActivityKind`). */
export const BOT_EVENT_LABEL: Record<string, string> = {
  session_start: '▶ Bắt đầu phiên', session_end: '■ Kết thúc phiên', command: '$ Lệnh', file_edit: '✎ Sửa file', file_write: '＋ Ghi file',
  file_read: '👁 Đọc file', search: '🔍 Tìm', thinking: '💭 Suy nghĩ', say: '💬 Agent nói', tool: '🔧 Tool',
};
/** Khối dài hơn bấy nhiêu dòng thì thu gọn, bấm để mở. */
export const BOT_EVENT_FOLD_LINES = 12;

export const formatCost = (usd: number) => `$${usd.toFixed(2)}`;

/**
 * Khối chữ nhiều dòng thu gọn được: quá `BOT_EVENT_FOLD_LINES` dòng → chỉ hiện phần đầu (`keep="head"`) hoặc phần cuối (`keep="tail"` —
 * kết quả lệnh: lỗi thường nằm cuối) + nút mở / thu. `line` vẽ từng dòng (diff tô màu); mặc định chữ thuần.
 */
function Fold({ text, keep = 'head', className, line }: { text: string; keep?: 'head' | 'tail'; className: string; line?: (l: string, i: number) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > BOT_EVENT_FOLD_LINES;
  const shown = !long || open ? lines : keep === 'head' ? lines.slice(0, BOT_EVENT_FOLD_LINES) : lines.slice(-BOT_EVENT_FOLD_LINES);
  const toggle = long && (
    <button type="button" className="bot-act-more" onClick={() => setOpen((o) => !o)} data-testid="office-bot-fold">
      {open ? 'Thu gọn' : `${keep === 'tail' ? '▲' : '▼'} Xem cả ${lines.length} dòng`}
    </button>
  );
  return (
    <>
      {keep === 'tail' && toggle}
      <pre className={className} data-folded={long && !open ? '' : undefined}>
        {line ? shown.map(line) : shown.join('\n')}
      </pre>
      {keep === 'head' && toggle}
    </>
  );
}

/** Một dòng diff unified: `+` xanh, `-` đỏ, `@@` mờ; tiêu đề file `+++` / `---` coi như ngữ cảnh. */
function diffLine(l: string, i: number) {
  const cls = l.startsWith('@@') ? 'hunk' : l.startsWith('+') && !l.startsWith('+++') ? 'add' : l.startsWith('-') && !l.startsWith('---') ? 'del' : undefined;
  return <span key={i} className={cls}>{l || ' '}{'\n'}</span>;
}

type Props = {
  e: BotWatchEventDto;
  /** Phiên còn chạy (bot đang làm, chưa có session_end) → lệnh chưa có kết quả hiện dấu quay. */
  live: boolean;
};

/**
 * Một sự kiện trong dòng thời gian "màn hình của bot" (TEST-98). Nội dung do agent sinh ra → KHÔNG tin cậy: mọi chuỗi vẽ dạng văn bản
 * thuần (nút chữ của React, không `dangerouslySetInnerHTML`, không tự biến chuỗi thành link / ảnh); riêng lời agent (`say`) qua component
 * `Markdown` chung với `noImages` (không HTML thô, không tải ảnh). `memo`: sự kiện không đổi (cùng object) không vẽ lại khi có lô mới.
 */
export const BotActivityEvent = memo(function BotActivityEvent({ e, live }: Props) {
  const failed = e.ok === false;
  const attrs = { 'data-id': e.id, 'data-kind': e.kind };
  const err = failed && <em className="bot-act-err">lỗi</em>;

  switch (e.kind) {
    case 'session_start':
    case 'session_end': {
      const end = e.kind === 'session_end';
      const parts = end
        ? [e.title, e.turns != null ? `${e.turns} lượt` : null, e.costUsd != null ? formatCost(e.costUsd) : null]
        : [e.task ?? e.title, e.model];
      return (
        <div className={`bot-watch-line bot-act-sep${failed ? ' err' : ''}`} {...attrs}>
          <span>{BOT_EVENT_LABEL[e.kind]}{parts.filter(Boolean).map((p, i) => <span key={i}> · {p}</span>)}{failed && <> · {err}</>}</span>
        </div>
      );
    }
    case 'command': {
      const running = live && e.ok == null && e.output == null;
      const status = <>{running && <span className="bot-act-spin" role="status" aria-label="Đang chạy" data-testid="office-bot-running" />}{err}</>;
      return (
        <div className={`bot-watch-line bot-act-term${failed ? ' err' : ''}`} {...attrs}>
          {e.title && <div className="bot-act-term-title">{e.title}{status}</div>}
          <pre className="bot-act-cmd"><span className="prompt">$ </span>{e.text ?? ''}{!e.title && status}</pre>
          {e.output && <Fold text={e.output} keep="tail" className="bot-act-out" />}
        </div>
      );
    }
    case 'file_edit':
    case 'file_write':
      return (
        <div className={`bot-watch-line bot-act-file${failed ? ' err' : ''}`} {...attrs}>
          <div className="bot-act-row"><span>{e.kind === 'file_edit' ? '✎' : '＋'}</span><code>{e.path ?? e.title ?? ''}</code>{err}</div>
          {e.diff && <Fold text={e.diff} className="bot-act-diff" line={diffLine} />}
        </div>
      );
    case 'thinking':
      return (
        <div className="bot-watch-line bot-act-think" {...attrs}>
          <small>💭 Suy nghĩ</small>
          <Fold text={e.text ?? e.title ?? ''} className="bot-act-think-text" />
        </div>
      );
    case 'say':
      return (
        <div className="bot-watch-line bot-act-say" {...attrs}>
          <Markdown text={e.text ?? e.title ?? ''} noImages />
        </div>
      );
    default: {
      // file_read, search, tool (+ loại mới server thêm sau này): một dòng gọn có biểu tượng
      const icon = e.kind === 'file_read' ? '👁' : e.kind === 'search' ? '🔍' : '🔧';
      const main = e.kind === 'tool' ? e.title : e.kind === 'search' ? e.text ?? e.title : null;
      const sub = e.kind === 'tool' ? e.text : null;
      return (
        <div className={`bot-watch-line bot-act-row${failed ? ' err' : ''}`} {...attrs} title={BOT_EVENT_LABEL[e.kind] ?? e.kind}>
          <span>{icon}</span>
          {main && <span className="main">{main}</span>}
          {e.path && <code>{e.path}</code>}
          {!main && !e.path && e.title && <span className="main">{e.title}</span>}
          {sub && <small>{sub}</small>}
          {err}
        </div>
      );
    }
  }
});
