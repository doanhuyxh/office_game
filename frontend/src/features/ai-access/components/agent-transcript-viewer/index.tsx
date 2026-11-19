import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpToLine, FileWarning, RotateCcw, Search } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { useDebounce } from '@/hooks/useDebounce';
import { ApiError } from '@/services/api-client';
import { cn } from '@/utils/cn';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { formatNumber } from '@/utils/number';
import { useTranscriptContent, type TranscriptContentState } from '../../hooks/useTranscriptContent';
import { useVirtualList } from '../../hooks/useVirtualList';
import type { IAgentTranscript } from '../../types/agentTranscript.types';
import { formatBytes, TRANSCRIPT_KIND_LABEL, TRANSCRIPT_VIEW_MAX_BYTES } from '../../utils/agentTranscript';
import { TURN_KIND_LABEL, TURN_KINDS, TURN_KINDS_HIDDEN_BY_DEFAULT, type ITranscriptTurn, type TranscriptTurnKind } from '../../utils/transcriptParse';
import { TRANSCRIPT_COLLAPSED_BY_DEFAULT_HEIGHT, TranscriptTurn, TURN_COLLAPSED_BY_DEFAULT } from '../transcript-turn';

function loadError(s: Extract<TranscriptContentState, { status: 'error' }>) {
  if (s.error instanceof ApiError && s.error.status === 404) return 'Bản transcript đã hết hạn hoặc không còn — đóng bảng và bấm "Làm mới" để cập nhật danh sách.';
  if (s.stage === 'read') return 'Không giải nén / đọc được nội dung transcript (file hỏng hoặc mất kết nối giữa chừng).';
  return errorMessage(s.error, 'Không tải được transcript');
}

/** Danh sách lượt (cuộn ảo) + công cụ tìm / lọc / nhảy đầu cuối. Chỉ dựng khi đã tải xong. */
function TurnList({ turns }: { turns: ITranscriptTurn[] }) {
  const [hidden, setHidden] = useState<Set<TranscriptTurnKind>>(() => new Set(TURN_KINDS_HIDDEN_BY_DEFAULT));
  const [q, setQ] = useState('');
  const query = useDebounce(q.trim().toLowerCase(), 250);
  // lượt người xem đã bấm mở / thu (đảo so với mặc định) và lượt bấm "Xem đủ" — giữ ở đây vì cuộn ảo bỏ mục khuất khỏi DOM
  const [toggled, setToggled] = useState<Set<number>>(() => new Set());
  const [full, setFull] = useState<Set<number>>(() => new Set());

  const counts = useMemo(() => {
    const c = Object.fromEntries(TURN_KINDS.map((k) => [k, 0])) as Record<TranscriptTurnKind, number>;
    for (const t of turns) c[t.kind]++;
    return c;
  }, [turns]);

  const shown = useMemo(() => turns.filter((t) => !hidden.has(t.kind)
    && (!query || t.text.toLowerCase().includes(query) || (t.title?.toLowerCase().includes(query) ?? false))), [turns, hidden, query]);

  const keyOf = useCallback((i: number) => shown[i].i, [shown]);
  const estimate = useCallback((i: number) => {
    const t = shown[i];
    return TURN_COLLAPSED_BY_DEFAULT(t.kind) !== toggled.has(t.i) ? TRANSCRIPT_COLLAPSED_BY_DEFAULT_HEIGHT : 140;
  }, [shown, toggled]);
  const v = useVirtualList({ count: shown.length, keyOf, estimate });

  const onToggle = useCallback((i: number, what: 'open' | 'full') => {
    const set = what === 'open' ? setToggled : setFull;
    set((s) => {
      const n = new Set(s);
      if (!n.delete(i)) n.add(i);
      return n;
    });
  }, []);
  const toggleKind = (k: TranscriptTurnKind) => setHidden((s) => {
    const n = new Set(s);
    if (!n.delete(k)) n.add(k);
    return n;
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm trong nội dung…" className="pl-8" aria-label="Tìm trong nội dung transcript"
            data-testid="transcript-search" />
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" onClick={() => v.scrollTo(0)} disabled={!shown.length} data-testid="transcript-top">
            <ArrowUpToLine className="size-4" /> Về đầu
          </Button>
          <Button size="sm" variant="outline" onClick={() => v.scrollTo(-1)} disabled={!shown.length} data-testid="transcript-bottom">
            <ArrowDownToLine className="size-4" /> Xuống cuối
          </Button>
        </div>
        <div className="ml-auto text-xs text-muted-foreground tabular-nums" data-testid="transcript-count">
          {shown.length === turns.length
            ? `${formatNumber(turns.length, 0)} lượt`
            : `Đang hiện ${formatNumber(shown.length, 0)} / ${formatNumber(turns.length, 0)} lượt`}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc theo loại lượt">
        {TURN_KINDS.filter((k) => counts[k] > 0).map((k) => {
          const on = !hidden.has(k);
          return (
            <button key={k} type="button" aria-pressed={on} onClick={() => toggleKind(k)} data-testid="transcript-kind" data-kind={k}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                on ? 'border-primary/40 bg-primary/10 font-medium text-foreground' : 'border-dashed text-muted-foreground hover:bg-muted')}>
              {TURN_KIND_LABEL[k]} <span className="tabular-nums opacity-70">{formatNumber(counts[k], 0)}</span>
            </button>
          );
        })}
      </div>
      <div ref={v.scrollRef} onScroll={v.onScroll} className="relative min-h-0 flex-1 overflow-y-auto rounded-md border bg-background"
        data-testid="transcript-scroll">
        {shown.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground" data-testid="transcript-no-match">
            {turns.length === 0 ? 'Transcript không có lượt nào.' : 'Không có lượt nào khớp tìm kiếm / bộ lọc.'}
          </div>
        ) : (
          <div style={{ height: v.total, position: 'relative' }}>
            {v.items.map((idx) => {
              const t = shown[idx];
              return (
                <div key={t.i} ref={v.measureRef} data-index={idx} data-key={t.i} className="absolute inset-x-0 px-2 pt-2"
                  style={{ top: v.offsets[idx] }}>
                  <TranscriptTurn t={t} open={TURN_COLLAPSED_BY_DEFAULT(t.kind) === toggled.has(t.i)} full={full.has(t.i)} onToggle={onToggle} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

type Props = {
  t: IAgentTranscript;
  onClose: () => void;
  /** Nút "Tải về" (cùng trạng thái loading với bảng). */
  download: ReactNode;
};

/**
 * Bảng xem nhanh transcript ngay trên web (TEST-197, chỉ admin / HR — quyền ở back-end): giải nén theo luồng trên trình duyệt, từng lượt
 * người dùng / assistant / suy nghĩ / gọi tool / kết quả tool (dòng lạ → JSON thô), cuộn ảo. File > {@link TRANSCRIPT_VIEW_MAX_BYTES} (bản nén)
 * không tự mở: báo + Tải về / "Vẫn mở". Chỉ dựng khi đang mở → đóng là bỏ toàn bộ dữ liệu (không cache, không localStorage).
 */
export function AgentTranscriptViewer({ t, onClose, download }: Props) {
  const tooBig = t.sizeBytes > TRANSCRIPT_VIEW_MAX_BYTES;
  const [force, setForce] = useState(false);
  const { state, retry } = useTranscriptContent(t, !tooBig || force);
  const waiting = tooBig && !force;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[90dvh] max-w-[calc(100%-1rem)] flex-col gap-3 p-4 sm:max-w-5xl sm:p-6" data-testid="transcript-viewer">
        <DialogHeader className="pr-6">
          <DialogTitle>Transcript — {TRANSCRIPT_KIND_LABEL[t.kind] ?? t.kind} {t.key}</DialogTitle>
          <DialogDescription>
            {`${t.fullName ?? t.userName ?? 'Bot'} · cập nhật ${formatDateTime(t.updatedAt)} · ${formatBytes(t.sizeBytes)} (nén)`}
            {t.branch ? ` · nhánh ${t.branch}` : ''}
            {state.status === 'done' && <span data-testid="transcript-load-ms"> · tải + giải nén {formatNumber(state.ms, 0)} ms</span>}
          </DialogDescription>
        </DialogHeader>

        {waiting ? (
          <div className="grid flex-1 place-content-center justify-items-center gap-3 text-center" data-testid="transcript-too-big">
            <FileWarning className="size-10 text-warning" />
            <div className="max-w-md text-sm">
              Transcript này {formatBytes(t.sizeBytes)} (nén), lớn hơn ngưỡng xem nhanh {formatBytes(TRANSCRIPT_VIEW_MAX_BYTES)} — mở trên web có thể chậm
              và tốn bộ nhớ. Nên tải về để đọc.
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {download}
              <Button size="sm" variant="ghost" onClick={() => setForce(true)} data-testid="transcript-force-open">Vẫn mở trên web</Button>
            </div>
          </div>
        ) : state.status === 'loading' ? (
          <div className="grid flex-1 place-content-center gap-2 text-center" data-testid="transcript-loading" role="status">
            <div className="text-sm">Đang tải và giải nén transcript…</div>
            <div className="h-2 w-72 max-w-full overflow-hidden rounded-full bg-muted" aria-hidden>
              <div className="h-full rounded-full bg-primary transition-[width]"
                style={{ width: `${Math.min(100, state.total ? (state.loaded / state.total) * 100 : 0)}%` }} />
            </div>
            <div className="text-xs text-muted-foreground tabular-nums" data-testid="transcript-progress">
              {formatBytes(state.loaded)} / {formatBytes(state.total)} · {formatNumber(state.turns, 0)} lượt
            </div>
          </div>
        ) : state.status === 'error' ? (
          <div className="grid flex-1 place-content-center justify-items-center gap-3 text-center" data-testid="transcript-error">
            <div className="max-w-md text-sm text-destructive">{loadError(state)}</div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={retry}><RotateCcw className="size-4" /> Thử lại</Button>
              {!(state.error instanceof ApiError && state.error.status === 404) && download}
            </div>
          </div>
        ) : (
          <TurnList turns={state.turns} />
        )}

        {!waiting && state.status === 'done' && <div className="flex justify-end">{download}</div>}
      </DialogContent>
    </Dialog>
  );
}

export default AgentTranscriptViewer;
