import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useWikiShareViews } from '../../hooks/useWikiShare';
import type { IWikiShare } from '../../types/wiki-share.types';

const PAGE_SIZE = 20;

/** Nhật ký mở một link chia sẻ sổ tay (TEST-229): thời điểm (giờ VN), IP, trình duyệt — mới nhất trước, 20 dòng / trang. */
export function WikiShareViewsDialog({ projectId, share, onClose }: { projectId: string; share: IWikiShare | null; onClose: () => void }) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [share?.id]);
  const q = useWikiShareViews(projectId, share?.id ?? null, page, PAGE_SIZE);
  const total = q.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  return (
    <Dialog open={!!share} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-testid="wiki-share-views">
        <DialogHeader>
          <DialogTitle>Nhật ký xem</DialogTitle>
          <DialogDescription>{share?.recipientName ?? share?.label ?? 'Link chia sẻ'} · {total} lượt mở · giờ Việt Nam</DialogDescription>
        </DialogHeader>
        {q.isPending ? <p className="py-6 text-center text-sm text-muted-foreground">Đang tải…</p>
          : q.isError ? <p className="text-sm text-destructive">{errorMessage(q.error, 'Không tải được nhật ký')}</p>
            : total === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Link chưa được mở lần nào.</p>
              : (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead className="w-36">Thời điểm</TableHead><TableHead className="w-32">IP</TableHead><TableHead>Trình duyệt</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {q.data.items.map((v, i) => (
                      <TableRow key={`${v.at}-${i}`} data-testid="wiki-share-view-row">
                        <TableCell className="whitespace-nowrap">{formatDateTime(v.at)}</TableCell>
                        <TableCell className="font-mono text-xs">{v.ip ?? '—'}</TableCell>
                        <TableCell className="min-w-48 text-xs whitespace-normal text-muted-foreground wrap-anywhere">{v.userAgent ?? '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 text-sm">
            <span className="text-muted-foreground">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {total}</span>
            <Button size="icon-sm" variant="outline" aria-label="Trang trước" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft /></Button>
            <span>{page} / {pages}</span>
            <Button size="icon-sm" variant="outline" aria-label="Trang sau" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight /></Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
