import { useState } from 'react';
import { Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatMoney } from '@/utils/money';
import { useRecurring } from '../../hooks/useFinance';
import type { IRecurringItem } from '../../types/finance.types';
import { BlockState } from '../block-state';
import { RecurringItemFormDialog } from '../recurring-item-form-dialog';

/** Danh sách "Khoản định kỳ dự kiến" (thuê văn phòng, thuế, điện nước…) — chỉ Quản trị tài chính mở. Thêm / sửa / ngừng; không xoá. */
export function RecurringItemsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const q = useRecurring(open);
  const rows = q.data ?? [];
  const [editing, setEditing] = useState<IRecurringItem | null | undefined>(undefined);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl" data-testid="recurring-items-dialog">
        <DialogHeader>
          <DialogTitle>Khoản định kỳ dự kiến</DialogTitle>
          <DialogDescription>Khoản ngoài hệ thống lặp hằng tháng. Chỉ dùng cho dự báo — không sinh dòng sổ / đề nghị chi. Không xoá, chỉ ngừng.</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setEditing(null)} data-testid="recurring-add"><Plus /> Thêm khoản</Button></div>
        {q.isLoading || q.error
          ? <BlockState loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} />
          : (
            <Table>
              <TableHeader><TableRow><TableHead>Tên</TableHead><TableHead>Loại</TableHead><TableHead className="text-right">Số tiền / tháng</TableHead><TableHead>Ngày</TableHead><TableHead>Mảng</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-12" /></TableRow></TableHeader>
              <TableBody>
                {rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-6 text-center text-muted-foreground">Chưa có khoản nào</TableCell></TableRow>}
                {rows.map((r) => (
                  <TableRow key={r.id} className={r.isActive ? undefined : 'opacity-60'} data-testid="recurring-row">
                    <TableCell className="font-medium">{r.name}{r.note && <div className="text-xs font-normal text-muted-foreground">{r.note}</div>}</TableCell>
                    <TableCell><StatusBadge tone={r.kind === 'Income' ? 'success' : 'danger'}>{r.kind === 'Income' ? 'Thu' : 'Chi'}</StatusBadge></TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.amount)}</TableCell>
                    <TableCell>Ngày {r.dayOfMonth}</TableCell>
                    <TableCell>{r.businessLineName ?? '—'}</TableCell>
                    <TableCell><StatusBadge tone={r.isActive ? 'success' : 'muted'}>{r.isActive ? 'Đang dùng' : 'Ngừng'}</StatusBadge></TableCell>
                    <TableCell><Button variant="ghost" size="icon" aria-label={`Sửa ${r.name}`} onClick={() => setEditing(r)}><Pencil /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        <RecurringItemFormDialog item={editing} onClose={() => setEditing(undefined)} />
      </DialogContent>
    </Dialog>
  );
}
