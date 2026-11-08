import { confirmDialog } from '@/components/common/confirm-dialog';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useRevokeDelegation } from '../../hooks/useApprovals';
import type { IDelegation, IPersonBrief } from '../../types/approval.types';
import { DELEGATION_STATUS } from '../../utils/labels';

const person = (p: IPersonBrief) => `${p.code} · ${p.fullName}`;

/** Bảng uỷ quyền duyệt. `show` = cột người cần hiện (đã giao → người nhận; được nhận → người uỷ quyền; HR → cả hai). */
export function DelegationList({ items, loading, empty, show }: {
  items: IDelegation[];
  loading: boolean;
  empty: string;
  show: 'delegate' | 'delegator' | 'both';
}) {
  const revoke = useRevokeDelegation();
  const onRevoke = async (d: IDelegation) => {
    if (!(await confirmDialog({ title: `Thu hồi uỷ quyền cho ${d.delegate.fullName}?`, description: `Uỷ quyền ${formatDate(d.fromDate)} – ${formatDate(d.toDate)} sẽ hết hiệu lực ngay.`, confirmText: 'Thu hồi', destructive: true }))) return;
    revoke.mutate(d.id, { onSuccess: () => toast.success('Đã thu hồi uỷ quyền'), onError: (e) => toast.error(errorMessage(e)) });
  };
  if (loading) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (items.length === 0) return <p className="rounded-xl border bg-card p-6 text-center text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <Table>
        <TableHeader>
          <TableRow>
            {show !== 'delegate' && <TableHead>Người uỷ quyền</TableHead>}
            {show !== 'delegator' && <TableHead>Người duyệt thay</TableHead>}
            <TableHead>Thời gian</TableHead>
            <TableHead>Trạng thái</TableHead>
            <TableHead>Ghi chú</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((d) => (
            <TableRow key={d.id} data-testid="delegation-row">
              {show !== 'delegate' && <TableCell className="whitespace-nowrap">{person(d.delegator)}</TableCell>}
              {show !== 'delegator' && <TableCell className="whitespace-nowrap">{person(d.delegate)}</TableCell>}
              <TableCell className="whitespace-nowrap tabular-nums">{formatDate(d.fromDate)} – {formatDate(d.toDate)}</TableCell>
              <TableCell>
                <StatusBadge tone={DELEGATION_STATUS[d.status].tone}>{DELEGATION_STATUS[d.status].label}</StatusBadge>
              </TableCell>
              <TableCell className="max-w-72 text-sm text-muted-foreground">
                <div className="truncate" title={d.note ?? undefined}>{d.note}</div>
                <div className="text-xs">
                  Tạo bởi {d.createdByName} · {formatDateTime(d.createdAt)}
                  {d.revokedAt && ` · thu hồi bởi ${d.revokedByName} · ${formatDateTime(d.revokedAt)}`}
                </div>
              </TableCell>
              <TableCell>
                {d.canRevoke && (
                  <Button size="sm" variant="outline" disabled={revoke.isPending} onClick={() => onRevoke(d)}>Thu hồi</Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
