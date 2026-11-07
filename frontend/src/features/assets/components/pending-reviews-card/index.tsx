import { ClipboardCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { errorMessage } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, usePendingReviews } from '../../hooks/useAssets';
import { DECISION } from '../../utils/labels';

/** "Việc cần rà soát": các ghế dịch vụ của cấp dưới đang chờ MÌNH chọn Giữ / Thu hồi (đợt rà soát đang mở). Không có việc → ẩn. */
export function PendingReviewsCard() {
  const { data = [] } = usePendingReviews();
  const decide = useAssetMutation((a: { id: string; decision: 'Keep' | 'Revoke' }) => assetApi.decide(a.id, a.decision, null));
  const todo = data.filter((i) => i.decision === 'Pending');
  if (data.length === 0) return null;
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-4" data-testid="pending-reviews">
      <h3 className="flex items-center gap-2 text-sm font-semibold"><ClipboardCheck className="size-4 text-warning" /> Việc cần rà soát ({todo.length}/{data.length})</h3>
      <p className="text-xs text-muted-foreground">Chọn <b>Giữ</b> nếu người này còn cần tài khoản, <b>Thu hồi</b> nếu không. HR sẽ thu hồi khi đóng đợt rà soát.</p>
      <ul className="grid gap-2">
        {data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{i.serviceName} · {i.accountLogin}</div>
              <div className="truncate text-xs text-muted-foreground">{i.employeeName} ({i.employeeCode}) · {i.reviewTitle}</div>
            </div>
            {i.decision !== 'Pending' && <StatusBadge tone={DECISION[i.decision].tone}>{DECISION[i.decision].label}</StatusBadge>}
            <div className="flex gap-1">
              <Button size="sm" variant={i.decision === 'Keep' ? 'default' : 'outline'} disabled={decide.isPending}
                onClick={() => decide.mutate({ id: i.id, decision: 'Keep' }, { onError: (e) => toast.error(errorMessage(e)) })}>Giữ</Button>
              <Button size="sm" variant={i.decision === 'Revoke' ? 'destructive' : 'outline'} disabled={decide.isPending}
                onClick={() => decide.mutate({ id: i.id, decision: 'Revoke' }, { onError: (e) => toast.error(errorMessage(e)) })}>Thu hồi</Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
