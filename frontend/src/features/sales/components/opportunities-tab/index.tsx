import { useState } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { fmtDate } from '@/features/finance';
import { formatMoney } from '@/utils/money';
import { useOpportunities } from '../../hooks/useSales';
import type { IOpportunity } from '../../types/sales.types';
import { OPEN_STAGES, STAGE } from '../../utils/labels';
import { OpportunityFormDialog } from '../opportunity-form-dialog';

/** Pipeline: 4 cột giai đoạn đang mở (tổng giá trị + giá trị có trọng số), dưới là cơ hội đã đóng gần đây. */
export function OpportunitiesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useOpportunities();
  const [edit, setEdit] = useState<IOpportunity | null>(null);
  if (isLoading) return <Spinner />;
  const open = data.filter((o) => OPEN_STAGES.includes(o.stage));
  const closed = data.filter((o) => !OPEN_STAGES.includes(o.stage)).slice(0, 20);
  const won = data.filter((o) => o.stage === 'Won');
  return (
    <div className="grid grid-cols-1 gap-4">
      <p className="text-sm text-muted-foreground">
        Đang mở: <b>{open.length}</b> cơ hội · tổng <b>{formatMoney(open.reduce((t, o) => t + o.value, 0))}</b> · có trọng số (× xác suất) <b>{formatMoney(open.reduce((t, o) => t + o.weighted, 0))}</b>
        {won.length > 0 && <> · đã thắng {won.length} ({formatMoney(won.reduce((t, o) => t + o.value, 0))})</>}
      </p>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {OPEN_STAGES.map((s) => {
          const col = open.filter((o) => o.stage === s);
          return (
            <div key={s} className="flex min-h-40 flex-col gap-2 rounded-xl border bg-muted/30 p-2" data-testid={`stage-${s}`}>
              <div className="flex items-center justify-between px-1 text-sm">
                <span className="font-medium">{STAGE[s].label} <span className="text-muted-foreground">({col.length})</span></span>
                <span className="tabular-nums text-xs text-muted-foreground">{formatMoney(col.reduce((t, o) => t + o.value, 0))}</span>
              </div>
              {col.map((o) => (
                <button key={o.id} type="button" onClick={() => setEdit(o)} className="grid gap-1 rounded-lg border bg-card p-2 text-left text-sm shadow-xs hover:border-primary/50">
                  <span className="font-medium">{o.title}</span>
                  <span className="text-xs text-muted-foreground">{o.customerName}</span>
                  <span className="flex items-center justify-between text-xs"><span className="tabular-nums">{formatMoney(o.value)}</span><span className="text-muted-foreground">{o.probability}%</span></span>
                  <span className="text-xs text-muted-foreground">{o.ownerName}{o.expectedCloseOn && ` · chốt ${fmtDate(o.expectedCloseOn)}`}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
      {closed.length > 0 && (
        <div className="grid gap-2">
          <div className="text-sm font-medium">Đã đóng gần đây</div>
          {closed.map((o) => (
            <button key={o.id} type="button" onClick={() => setEdit(o)} className="flex items-center justify-between gap-2 rounded-lg border bg-card p-2 text-left text-sm">
              <span><span className="font-medium">{o.title}</span> · {o.customerName}{o.lostReason && <span className="text-xs text-muted-foreground"> — {o.lostReason}</span>}</span>
              <span className="flex items-center gap-2"><span className="tabular-nums">{formatMoney(o.value)}</span><StatusBadge tone={STAGE[o.stage].tone}>{STAGE[o.stage].label}</StatusBadge></span>
            </button>
          ))}
        </div>
      )}
      <OpportunityFormDialog opportunity={creating ? null : edit ?? undefined} onClose={() => { setEdit(null); onCreatedClose(); }} />
    </div>
  );
}
