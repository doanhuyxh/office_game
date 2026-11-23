import { Link } from '@tanstack/react-router';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatMoney } from '@/utils/money';
import { useProjectAlerts } from '../../hooks/useFinance';
import { BlockCard } from '../block-card';
import { BlockState } from '../block-state';

/**
 * Dự án đang chạy cần chú ý (lỗ / vượt / sắp vượt ngân sách ngày công). Tải riêng (`/api/projects/financials/alerts` tính nhân công chậm),
 * không chặn phần còn lại của tab. Bấm → tab Tài chính của dự án.
 */
export function ProjectAlertsCard() {
  const q = useProjectAlerts();
  const rows = q.data ?? [];
  return (
    <BlockCard testId="project-alerts-card" title="Dự án cần chú ý" hint="Dự án đang chạy: lỗ, vượt hoặc sắp vượt (≥ 80 %) ngân sách ngày công">
      {q.isLoading || q.error || rows.length === 0
        ? <BlockState loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} empty="Không có dự án cần chú ý" />
        : (
          <ul className="divide-y">
            {rows.map((p) => (
              <li key={p.projectId}>
                <Link to="/projects/$projectId" params={{ projectId: p.projectId }} search={{ tab: 'finance' }} data-testid="project-alert-link"
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none">
                  <span className="min-w-0 grow truncate text-sm"><span className="font-medium">{p.code}</span> · {p.name}{p.kind === 'Internal' && <span className="text-muted-foreground"> (nội bộ)</span>}</span>
                  <span className="flex flex-wrap gap-1">
                    {p.loss && <StatusBadge tone="danger">Lỗ</StatusBadge>}
                    {p.overBudget && <StatusBadge tone="danger">Vượt ngân sách</StatusBadge>}
                    {p.nearBudget && <StatusBadge tone="warning">Sắp vượt</StatusBadge>}
                  </span>
                  <span className="w-full text-xs text-muted-foreground tabular-nums">
                    Lãi <span className={p.profit < 0 ? 'text-destructive' : ''}>{formatMoney(p.profit)}</span>
                    {p.budgetUsedPercent != null && ` · ${p.manDays.toLocaleString('vi-VN')}/${(p.budgetManDays ?? 0).toLocaleString('vi-VN')} ngày công (${p.budgetUsedPercent.toLocaleString('vi-VN')} %)`}
                    {p.hasEstimate && ' · có tháng ước tính'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
    </BlockCard>
  );
}
