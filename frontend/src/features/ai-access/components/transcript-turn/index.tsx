import { memo, type ReactNode } from 'react';
import { Bot, Braces, Brain, ChevronRight, CornerDownRight, Settings2, User, Wrench, type LucideIcon } from 'lucide-react';
import { Markdown } from '@/components/common/markdown';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { formatNumber } from '@/utils/number';
import { prettyJson, toolLabel, TURN_KIND_LABEL, TURN_TEXT_CUT, turnPreview, type ITranscriptTurn, type TranscriptTurnKind } from '../../utils/transcriptParse';

/** Màu (token) + biểu tượng từng loại lượt — chạy đúng cả nền sáng / tối. */
const STYLE: Record<TranscriptTurnKind, { tone: StatusTone; bar: string; icon: LucideIcon }> = {
  user: { tone: 'info', bar: 'border-l-info bg-info/5', icon: User },
  assistant: { tone: 'primary', bar: 'border-l-primary bg-card', icon: Bot },
  thinking: { tone: 'muted', bar: 'border-l-muted-foreground/40 bg-muted/30', icon: Brain },
  tool_call: { tone: 'warning', bar: 'border-l-warning bg-warning/5', icon: Wrench },
  tool_result: { tone: 'success', bar: 'border-l-success bg-success/5', icon: CornerDownRight },
  meta: { tone: 'faint', bar: 'border-l-border bg-muted/20', icon: Settings2 },
  raw: { tone: 'muted', bar: 'border-l-muted-foreground/40 border-dashed bg-muted/20', icon: Braces },
};

/** Lượt thu gọn sẵn (bấm đầu lượt để mở); người dùng / assistant mở sẵn. */
export const TURN_COLLAPSED_BY_DEFAULT = (k: TranscriptTurnKind) => k !== 'user' && k !== 'assistant';

/** Chiều cao ước lượng (px, gồm khoảng cách) của một lượt đang thu gọn — cho cuộn ảo trước khi đo. */
export const TRANSCRIPT_COLLAPSED_BY_DEFAULT_HEIGHT = 48;

/** Văn bản dài hơn bấy nhiêu dòng (người dùng) thì chỉ hiện phần đầu + nút "Xem cả N dòng". */
const FOLD_LINES = 12;

const PRE = 'font-mono text-xs leading-5 whitespace-pre-wrap break-words';

/** Đoạn chữ dài: cắt ở `TURN_TEXT_CUT` ký tự + nút "Xem đủ" (bấm lại để thu). */
function Cut({ text, full, onFull, className }: { text: string; full: boolean; onFull: () => void; className?: string }) {
  const long = text.length > TURN_TEXT_CUT;
  return (
    <>
      <pre className={cn(PRE, className)}>{long && !full ? `${text.slice(0, TURN_TEXT_CUT)}…` : text}</pre>
      {long && <MoreButton onClick={onFull}>{full ? 'Thu gọn' : `Xem đủ (${formatNumber(text.length, 0)} ký tự)`}</MoreButton>}
    </>
  );
}

function MoreButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} data-testid="transcript-turn-more"
      className="mt-1 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
      {children}
    </button>
  );
}

/** Diff gọn từ old_string / new_string của tool Edit: dòng bỏ đỏ, dòng thêm xanh (như "Màn hình của bot"). */
function EditDiff({ before, after }: { before: string; after: string }) {
  const del = before ? before.split('\n') : [];
  const add = after ? after.split('\n') : [];
  return (
    <pre className={cn(PRE, 'overflow-hidden rounded-md bg-muted/60 py-1')}>
      {del.map((l, i) => <span key={`d${i}`} className="block bg-destructive/10 px-2 text-destructive">-{l || ' '}</span>)}
      {add.map((l, i) => <span key={`a${i}`} className="block bg-success/15 px-2 text-success">+{l || ' '}</span>)}
    </pre>
  );
}

/** Tham số gọi tool: Bash → khung lệnh; Edit / Write / Read → đường dẫn + diff / nội dung; còn lại → JSON. */
function ToolInput({ t, full, onFull }: { t: ITranscriptTurn; full: boolean; onFull: () => void }) {
  const inp = t.input ?? {};
  const s = (k: string) => (typeof inp[k] === 'string' ? (inp[k] as string) : null);
  const name = t.title ?? '';
  if (name === 'Bash' && s('command') !== null) {
    return (
      <div className="grid gap-1">
        {s('description') && <div className="text-xs text-muted-foreground">{s('description')}</div>}
        <pre className={cn(PRE, 'rounded-md bg-muted px-3 py-2')}><span className="text-muted-foreground select-none">$ </span>{s('command')}</pre>
      </div>
    );
  }
  if ((name === 'Edit' || name === 'MultiEdit' || name === 'Write' || name === 'Read') && s('file_path')) {
    const edits = name === 'MultiEdit' && Array.isArray(inp.edits) ? (inp.edits as Record<string, unknown>[]) : name === 'Edit' ? [inp] : [];
    return (
      <div className="grid gap-1">
        <code className="font-mono text-xs break-all">{s('file_path')}</code>
        {edits.map((e, i) => <EditDiff key={i} before={String(e.old_string ?? '')} after={String(e.new_string ?? '')} />)}
        {name === 'Write' && s('content') !== null && <Cut text={s('content')!} full={full} onFull={onFull} className="rounded-md bg-muted/60 px-2 py-1" />}
        {name === 'Read' && (inp.offset != null || inp.limit != null) && (
          <div className="text-xs text-muted-foreground">dòng {String(inp.offset ?? 1)} · {String(inp.limit ?? 'hết')} dòng</div>
        )}
      </div>
    );
  }
  return <Cut text={t.text} full={full} onFull={onFull} className="rounded-md bg-muted/60 px-2 py-1" />;
}

function Body({ t, full, onFull }: { t: ITranscriptTurn; full: boolean; onFull: () => void }) {
  switch (t.kind) {
    case 'assistant':
      return <div className="text-sm"><Markdown text={t.text} noImages /></div>;
    case 'user': {
      const lines = t.text.split('\n');
      const long = lines.length > FOLD_LINES;
      return (
        <>
          <pre className={cn(PRE, 'font-sans text-sm')}>{long && !full ? `${lines.slice(0, FOLD_LINES).join('\n')}…` : t.text}</pre>
          {long && <MoreButton onClick={onFull}>{full ? 'Thu gọn' : `Xem cả ${formatNumber(lines.length, 0)} dòng`}</MoreButton>}
        </>
      );
    }
    case 'thinking':
      return t.text.trim()
        ? <Cut text={t.text} full={full} onFull={onFull} className="font-sans text-sm text-muted-foreground italic" />
        : <div className="text-xs text-muted-foreground italic">Không lưu nội dung suy nghĩ (chỉ có chữ ký mã hoá).</div>;
    case 'tool_call':
      return <ToolInput t={t} full={full} onFull={onFull} />;
    case 'tool_result':
      return t.text ? <Cut text={t.text} full={full} onFull={onFull} className="rounded-md bg-muted/60 px-2 py-1" />
        : <div className="text-xs text-muted-foreground">(không có nội dung)</div>;
    default:
      return <Cut text={prettyJson(t.text)} full={full} onFull={onFull} className="rounded-md bg-muted/60 px-2 py-1" />;
  }
}

type Props = {
  t: ITranscriptTurn;
  open: boolean;
  full: boolean;
  onToggle: (i: number, what: 'open' | 'full') => void;
};

/**
 * Một lượt trong bảng xem transcript (TEST-197). Nội dung do agent sinh ra → KHÔNG tin cậy: vẽ dạng chữ thuần (React text node),
 * riêng lời assistant qua `Markdown` chung với `noImages` (không HTML thô, không tải ảnh) — như "Màn hình của bot".
 */
export const TranscriptTurn = memo(function TranscriptTurn({ t, open, full, onToggle }: Props) {
  const st = STYLE[t.kind];
  const Icon = st.icon;
  const err = t.isError;
  const label = t.kind === 'tool_call' || t.kind === 'tool_result' ? (t.title ? toolLabel(t.title) : null) : t.title ?? null;
  const preview = open ? null : turnPreview(t);
  return (
    <div className={cn('rounded-md border border-l-4 px-3 py-2', st.bar, err && 'border-l-destructive bg-destructive/5')}
      data-testid="transcript-turn" data-kind={t.kind} data-open={open ? '' : undefined}>
      <button type="button" onClick={() => onToggle(t.i, 'open')} aria-expanded={open} data-testid="transcript-turn-head"
        className="flex w-full min-w-0 items-center gap-2 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <ChevronRight className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <StatusBadge tone={err ? 'danger' : st.tone} className="shrink-0 gap-1">
          <Icon className="size-3" /> {TURN_KIND_LABEL[t.kind]}{err ? ' · lỗi' : ''}
        </StatusBadge>
        {t.sidechain && <StatusBadge tone="muted" className="shrink-0">agent con</StatusBadge>}
        {label && <span className="shrink-0 font-mono text-xs font-medium">{label}</span>}
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{preview}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums" title={`Dòng ${t.line} trong file .jsonl`}>
          {t.at ? formatTime(t.at) : ''} · #{t.line}
        </span>
      </button>
      {open && (
        <div className="mt-2 min-w-0 pl-6" data-testid="transcript-turn-body">
          <Body t={t} full={full} onFull={() => onToggle(t.i, 'full')} />
        </div>
      )}
    </div>
  );
});
