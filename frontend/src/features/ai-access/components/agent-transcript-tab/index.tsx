import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { Download, Eye, FileArchive, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Markdown } from '@/components/common/markdown';
import { SearchSelectField, type SearchOption } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { ApiError } from '@/services/api-client';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useAgentTranscripts, useDownloadAgentTranscript } from '../../hooks/useAgentTranscripts';
import type { AgentTranscriptKind, IAgentTranscript, IAgentTranscriptFilter } from '../../types/agentTranscript.types';
import { formatBytes, summaryPreview, TRANSCRIPT_KIND_LABEL } from '../../utils/agentTranscript';

// Bảng xem nội dung (TEST-197) tải lười: chỉ khi bấm "Xem".
const AgentTranscriptViewer = lazy(() => import('../agent-transcript-viewer'));

const KINDS: AgentTranscriptKind[] = ['task', 'chat', 'meeting'];
const ALL = 'all';

const COLUMNS: ColumnDef[] = [
  { id: 'at', label: 'Cập nhật', required: true },
  { id: 'bot', label: 'Bot' },
  { id: 'kind', label: 'Loại' },
  { id: 'key', label: 'Khoá' },
  { id: 'branch', label: 'Nhánh' },
  { id: 'summary', label: 'Bản bàn giao' },
  { id: 'size', label: 'Kích thước' },
  { id: 'expires', label: 'Hạn xoá' },
];

interface TranscriptSearch { bot?: string; tkind?: string }

/** Bộ lọc trên URL (`?tab=transcripts&bot=<userId>&tkind=task`) — tên riêng để không lẫn với bộ lọc tab "Mức dùng AI". */
function useTranscriptFilter() {
  const search = useSearch({ strict: false }) as TranscriptSearch;
  const navigate = useNavigate();
  const bot = typeof search.bot === 'string' && /^[0-9a-f-]{36}$/i.test(search.bot) ? search.bot : null;
  const kind = (KINDS as string[]).includes(search.tkind ?? '') ? (search.tkind as AgentTranscriptKind) : null;
  const filter = useMemo<IAgentTranscriptFilter>(() => ({ userId: bot, kind }), [bot, kind]);
  const set = useCallback((patch: TranscriptSearch) => {
    void navigate({
      to: '.',
      search: ((prev: Record<string, unknown>) => {
        const next = { ...prev, ...patch } as Record<string, unknown>;
        for (const k of Object.keys(patch)) if (!next[k]) delete next[k];
        return next;
      }) as never,
      replace: true,
    });
  }, [navigate]);
  return { filter, set };
}

/** Ô chọn bot: chỉ tài khoản bot trong danh bạ; "Tất cả" = mọi bot. */
function BotPicker({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const employees = useEmployees();
  const options = useMemo<SearchOption[]>(() => [
    { value: ALL, label: 'Tất cả' },
    ...(employees.data ?? []).filter((e) => e.userId && e.account?.isBot).map((e) => ({
      value: e.userId!, label: `${e.code} · ${e.fullName}`, hint: e.departmentName ?? undefined,
    })),
  ], [employees.data]);
  return (
    <div className="w-64 min-w-0" data-testid="agent-transcript-bot">
      <SearchSelectField id="agent-transcript-bot-select" label="Bot" value={value ?? ALL} options={options}
        onChange={(v) => onChange(v && v !== ALL ? v : null)} />
    </div>
  );
}

function downloadError(err: unknown) {
  if (err instanceof ApiError && err.status === 404) return 'Bản transcript đã hết hạn hoặc không còn — bấm "Làm mới" để cập nhật danh sách.';
  return errorMessage(err, 'Không tải được transcript');
}

/**
 * Kết nối AI → tab "Transcript agent" (TEST-145, chỉ admin / HR): transcript phiên agent lưu trên cloud (TEST-144, 90 ngày),
 * lọc theo bot + loại (lưu trên URL), BE phân trang; xem đủ bản bàn giao; tải về `.jsonl.gz`. Quyền thật ở back-end.
 */
export function AgentTranscriptTab() {
  const { filter, set } = useTranscriptFilter();
  const pg = usePageState('agent-transcripts', JSON.stringify(filter));
  const list = useAgentTranscripts(filter, pg.query);
  const cols = useColumns('agent-transcripts', COLUMNS);
  const download = useDownloadAgentTranscript();
  const [open, setOpen] = useState<IAgentTranscript | null>(null);
  const [viewing, setViewing] = useState<IAgentTranscript | null>(null);
  const v = cols.show;
  const span = cols.span(1);
  // Lỗi (cả khi đổi bộ lọc mà còn dữ liệu cũ giữ chỗ) → báo lỗi thay vì để người xem tưởng danh sách cũ là kết quả mới.
  const rows = list.isError ? [] : (list.data?.items ?? []);
  const filtered = !!(filter.userId || filter.kind);

  const onDownload = (t: IAgentTranscript) => download.mutate(t, { onError: (err) => toast.error(downloadError(err)) });
  const downloadButton = (t: IAgentTranscript, label: string, testId?: string) => (
    <Button size="sm" variant="outline" data-testid={testId} onClick={() => onDownload(t)}
      loading={download.isPending && download.variables?.id === t.id} loadingText="Đang tải…" disabled={download.isPending}>
      <Download className="size-4" /> {label}
    </Button>
  );

  return (
    <div className="grid grid-cols-1 gap-4" data-testid="agent-transcript-tab">
      <div className="flex flex-wrap items-end gap-3">
        <BotPicker value={filter.userId} onChange={(b) => set({ bot: b ?? undefined })} />
        <div className="w-40">
          <SelectField id="agent-transcript-kind" label="Loại" allowEmpty emptyLabel="Mọi loại" value={filter.kind}
            onChange={(k) => set({ tkind: k ?? undefined })} options={KINDS.map((k) => ({ value: k, label: TRANSCRIPT_KIND_LABEL[k] }))} />
        </div>
        {filtered && (
          <Button variant="ghost" size="sm" className="h-9" onClick={() => set({ bot: undefined, tkind: undefined })}>
            <RotateCcw className="size-4" /> Bỏ lọc
          </Button>
        )}
      </div>

      <div className="grid gap-2 rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-sm font-medium">Transcript phiên agent</div>
            <p className="text-xs text-muted-foreground">
              Toàn bộ hội thoại của bot (đã che bí mật, mã hoá; giữ 90 ngày từ lần cập nhật cuối) — chỉ admin / HR xem để tra soát.
            </p>
          </div>
          <ColumnsMenu state={cols} />
        </div>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Cập nhật</TableHead>
                {v('bot') && <TableHead>Bot</TableHead>}
                {v('kind') && <TableHead>Loại</TableHead>}
                {v('key') && <TableHead>Khoá</TableHead>}
                {v('branch') && <TableHead>Nhánh</TableHead>}
                {v('summary') && <TableHead>Bản bàn giao</TableHead>}
                {v('size') && <TableHead className="text-right">Kích thước</TableHead>}
                {v('expires') && <TableHead>Hạn xoá</TableHead>}
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.isLoading && (
                <TableRow><TableCell colSpan={span}><div className="py-6" data-testid="agent-transcript-loading"><Spinner /></div></TableCell></TableRow>
              )}
              {list.isError && (
                <TableRow>
                  <TableCell colSpan={span} className="py-6 text-center" data-testid="agent-transcript-error">
                    <div className="text-sm text-destructive">{errorMessage(list.error, 'Không tải được danh sách transcript.')}</div>
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => void list.refetch()} loading={list.isFetching} loadingText="Đang tải…">
                      <RotateCcw className="size-4" /> Thử lại
                    </Button>
                  </TableCell>
                </TableRow>
              )}
              {list.data && !list.isError && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={span} className="py-10 text-center text-sm text-muted-foreground" data-testid="agent-transcript-empty">
                    <FileArchive className="mx-auto mb-2 size-8" />
                    {filtered
                      ? 'Không có transcript nào khớp bộ lọc.'
                      : 'Chưa có transcript nào — agent-runner gửi lên sau mỗi phiên của bot (việc / chat / họp).'}
                  </TableCell>
                </TableRow>
              )}
              {rows.map((t) => (
                <TableRow key={t.id} data-testid="agent-transcript-row">
                  <TableCell className="whitespace-nowrap" title={`Tạo ${formatDateTime(t.createdAt)}`}>{formatDateTime(t.updatedAt)}</TableCell>
                  {v('bot') && (
                    <TableCell>
                      <div className="font-medium">{t.fullName ?? t.userName ?? '—'}</div>
                      {t.fullName && t.userName && <div className="text-xs text-muted-foreground">{t.userName}</div>}
                    </TableCell>
                  )}
                  {v('kind') && <TableCell><StatusBadge tone="muted">{TRANSCRIPT_KIND_LABEL[t.kind] ?? t.kind}</StatusBadge></TableCell>}
                  {v('key') && <TableCell className="max-w-48 truncate font-mono text-xs" title={t.key}>{t.key}</TableCell>}
                  {v('branch') && <TableCell className="max-w-40 truncate font-mono text-xs" title={t.branch ?? undefined}>{t.branch ?? '—'}</TableCell>}
                  {v('summary') && (
                    <TableCell className="w-80 min-w-64 max-w-md whitespace-normal">
                      {t.summary ? (
                        <button type="button" onClick={() => setOpen(t)} title="Xem đủ bản bàn giao" data-testid="agent-transcript-summary"
                          className="line-clamp-2 w-full break-words text-left text-sm whitespace-normal hover:underline focus-visible:underline focus-visible:outline-none">
                          {summaryPreview(t.summary)}
                        </button>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  )}
                  {v('size') && <TableCell className="whitespace-nowrap text-right tabular-nums">{formatBytes(t.sizeBytes)}</TableCell>}
                  {v('expires') && <TableCell className="whitespace-nowrap">{formatDate(t.expiresAt)}</TableCell>}
                  <TableCell>
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => setViewing(t)} data-testid="agent-transcript-view" title="Xem nội dung phiên ngay trên web">
                        <Eye className="size-4" /> Xem
                      </Button>
                      {downloadButton(t, 'Tải về', 'agent-transcript-download')}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {!list.isError && <TablePagination state={pg} total={list.data?.total} unit="transcript" />}
      </div>

      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-2xl" data-testid="agent-transcript-summary-dialog">
          <DialogHeader>
            <DialogTitle>Bản bàn giao — {open ? `${TRANSCRIPT_KIND_LABEL[open.kind] ?? open.kind} ${open.key}` : ''}</DialogTitle>
            <DialogDescription>
              {open ? `${open.fullName ?? open.userName ?? 'Bot'} · cập nhật ${formatDateTime(open.updatedAt)}${open.branch ? ` · nhánh ${open.branch}` : ''}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] overflow-y-auto rounded-md border bg-muted/30 p-3 text-sm">
            {open?.summary && <Markdown text={open.summary} noImages />}
          </div>
          {open && <div className="flex justify-end">{downloadButton(open, 'Tải transcript')}</div>}
        </DialogContent>
      </Dialog>

      {viewing && (
        <Suspense fallback={null}>
          <AgentTranscriptViewer key={viewing.id} t={viewing} onClose={() => setViewing(null)}
            download={downloadButton(viewing, 'Tải về', 'transcript-viewer-download')} />
        </Suspense>
      )}
    </div>
  );
}

export default AgentTranscriptTab;
