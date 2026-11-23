import { useState } from 'react';
import { ArrowLeft, History, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Markdown } from '@/components/common/markdown';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { wikiApi } from '../../api/wiki.api';
import { useWikiMutation, useWikiVersion, useWikiVersions } from '../../hooks/useWiki';
import type { IWikiPage } from '../../types/wiki.types';

const PAGE_SIZE = 20;

/**
 * Lịch sử phiên bản một trang sổ tay (TEST-217): danh sách mới nhất trước (ai, lúc nào, BOT, ghi chú, độ dài), bấm một bản → xem nội dung.
 * Người quản lý (`page.canManage`) có "Khôi phục bản này" (hộp xác nhận) → server tạo phiên bản mới từ bản cũ.
 */
export function WikiHistorySheet({ projectId, page, open, onClose }: { projectId: string; page: IWikiPage; open: boolean; onClose: () => void }) {
  const [p, setP] = useState(1);
  const [viewing, setViewing] = useState<number | null>(null);
  const list = useWikiVersions(projectId, page.id, p, PAGE_SIZE, open);
  const one = useWikiVersion(projectId, page.id, open ? viewing : null);
  const restore = useWikiMutation(projectId, (n: number) => wikiApi.restore(projectId, page.id, n));
  const pages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const close = () => { setViewing(null); setP(1); onClose(); };

  const doRestore = async (n: number) => {
    const ok = await confirmDialog({
      title: `Khôi phục phiên bản ${n}?`,
      description: 'Nội dung, tiêu đề và tóm tắt của bản này thành một phiên bản mới (bản hiện tại vẫn còn trong lịch sử).',
      confirmText: 'Khôi phục', onConfirm: () => restore.mutateAsync(n),
    });
    if (ok) { toast.success(`Đã khôi phục phiên bản ${n}`); close(); }
  };

  return (
    <Sheet open={open} onOpenChange={(o) => !o && close()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="wiki-history">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2"><History className="size-4" /> Lịch sử · {page.title}</SheetTitle>
          <SheetDescription>Phiên bản hiện tại: {page.version}{list.data && ` · ${list.data.total} phiên bản`}</SheetDescription>
        </SheetHeader>
        <div className="grid gap-3 px-4 pb-4">
          {viewing != null ? <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" variant="ghost" onClick={() => setViewing(null)}><ArrowLeft /> Danh sách</Button>
              {page.canManage && viewing !== page.version && <Button size="sm" variant="outline" onClick={() => void doRestore(viewing)} data-testid="wiki-restore">
                <RotateCcw /> Khôi phục bản này</Button>}
            </div>
            {one.isLoading ? <Spinner /> : one.error ? <p className="text-sm text-destructive">{errorMessage(one.error)}</p> : one.data && <div className="grid gap-2" data-testid="wiki-version-view">
              <div className="text-sm font-semibold">Phiên bản {one.data.version} · {one.data.title}</div>
              <div className="text-xs text-muted-foreground">{one.data.editedByName}{one.data.editedByBot && <BotBadge className="ml-1" />} · {formatDateTime(one.data.editedAt)}
                {one.data.note && <> · {one.data.note}</>}</div>
              {one.data.summary && <p className="text-sm text-muted-foreground">{one.data.summary}</p>}
              <div className="rounded-lg border p-3 wrap-anywhere">{one.data.content.trim() ? <Markdown text={one.data.content} /> : <p className="text-sm text-muted-foreground">Trang trống.</p>}</div>
            </div>}
          </> : list.isLoading ? <Spinner /> : list.error ? <p className="text-sm text-destructive">{errorMessage(list.error)}</p> : <>
            <ul className="grid gap-1" data-testid="wiki-versions">
              {list.data?.items.map((v) => (
                <li key={v.version}>
                  <button type="button" className="grid w-full gap-0.5 rounded-md border px-3 py-2 text-left hover:bg-muted/60" onClick={() => setViewing(v.version)} data-testid="wiki-version-item">
                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className="rounded bg-muted px-1.5 text-xs tabular-nums">v{v.version}</span>
                      {v.version === page.version && <span className="text-xs font-normal text-success">hiện tại</span>}
                      <span className="min-w-0 truncate">{v.title}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">{v.editedByName}{v.editedByBot && <BotBadge className="ml-1" />} · {formatDateTime(v.editedAt)} · {v.contentLength.toLocaleString('vi-VN')} ký tự</span>
                    {v.note && <span className="text-xs">{v.note}</span>}
                  </button>
                </li>
              ))}
            </ul>
            {pages > 1 && <div className="flex items-center justify-end gap-2 text-xs">
              <Button size="sm" variant="outline" disabled={p <= 1} onClick={() => setP(p - 1)}>‹</Button>
              <span className="tabular-nums">{p} / {pages}</span>
              <Button size="sm" variant="outline" disabled={p >= pages} onClick={() => setP(p + 1)}>›</Button>
            </div>}
          </>}
        </div>
      </SheetContent>
    </Sheet>
  );
}
