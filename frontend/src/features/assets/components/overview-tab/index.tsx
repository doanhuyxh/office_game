import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate, todayVn } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import { useOverview } from '../../hooks/useAssets';
import { DEVICE_STATUS, daysLeft } from '../../utils/labels';
import type { DeviceStatus } from '../../types/asset.types';

const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="rounded-xl border bg-card p-4">
    <div className="text-xs text-muted-foreground">{label}</div>
    <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
  </div>
);

/** Tab Tổng quan (HR): số liệu thiết bị / dịch vụ, bảo hành & gia hạn sắp tới, người nghỉ việc còn giữ tài sản. */
export function OverviewTab() {
  const { data: o, isLoading } = useOverview();
  if (isLoading || !o) return <Spinner />;
  const today = todayVn();
  return (
    <div className="grid grid-cols-1 gap-4" data-testid="assets-overview">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Thiết bị" value={o.deviceTotal} hint={`Tổng giá mua ${formatMoney(o.totalPurchaseValue)}`} />
        <Stat label="Dịch vụ đang dùng" value={o.activeServices} hint={`${o.seatsInUse} ghế đang dùng`} />
        <Stat label="Chi phí dịch vụ / tháng" value={formatMoney(o.monthlyServiceCost)} />
        <Stat label="Nghỉ việc còn giữ tài sản" value={o.resignedHolding.length} />
      </div>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(DEVICE_STATUS) as DeviceStatus[]).map((s) => (
          <StatusBadge key={s} tone={DEVICE_STATUS[s].tone}>{DEVICE_STATUS[s].label}: {o.deviceCounts[s] ?? 0}</StatusBadge>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Sắp hết bảo hành" empty={o.warrantiesDue.length === 0}>
          {o.warrantiesDue.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate"><b>{w.code}</b> · {w.name}{w.holderName ? ` (${w.holderName})` : ''}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(w.warrantyUntil)} · {daysLeft(w.warrantyUntil, today)}</span>
            </li>
          ))}
        </Block>
        <Block title="Sắp đến hạn gia hạn dịch vụ" empty={o.renewalsDue.length === 0}>
          {o.renewalsDue.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{r.name}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{formatDate(r.renewalDate)} · {daysLeft(r.renewalDate, today)}</span>
            </li>
          ))}
        </Block>
      </div>
      <Block title="Nhân viên đã nghỉ việc nhưng còn giữ tài sản" empty={o.resignedHolding.length === 0} emptyText="Không có.">
        {o.resignedHolding.map((r) => (
          <li key={r.employeeId} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate"><b>{r.fullName}</b> ({r.code}){r.leftAt ? ` · nghỉ ${formatDate(r.leftAt)}` : ''}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{r.devices} thiết bị · {r.seats} tài khoản</span>
          </li>
        ))}
      </Block>
    </div>
  );
}

function Block({ title, empty, emptyText = 'Không có gì sắp tới.', children }: { title: string; empty: boolean; emptyText?: string; children: ReactNode }) {
  return (
    <section className="grid content-start gap-2 rounded-xl border bg-card p-4">
      <h3 className="text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-sm text-muted-foreground">{emptyText}</p> : <ul className="grid gap-1.5 text-sm">{children}</ul>}
    </section>
  );
}
