import type { ReactNode } from 'react';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import type { IHealthItem } from '../../types/system.types';

const HEALTH_NAME: Record<string, string> = { postgres: 'Cơ sở dữ liệu (PostgreSQL)', s3: 'Lưu trữ file (S3)', smtp: 'Máy chủ gửi mail (SMTP)' };
const HEALTH: Record<string, { tone: StatusTone; label: string }> = {
  Healthy: { tone: 'success', label: 'Hoạt động' },
  Degraded: { tone: 'warning', label: 'Chậm / một phần' },
  Unhealthy: { tone: 'danger', label: 'Lỗi' },
};

/** Một dòng tình trạng dịch vụ (`/api/system/info` → `health`): tên, nhãn trạng thái, thời gian kiểm tra, lỗi nếu có. */
export function HealthRow({ h }: { h: IHealthItem }) {
  const s = HEALTH[h.status] ?? { tone: 'muted' as const, label: h.status };
  return (
    <div className="flex flex-wrap items-center gap-2 border-b py-2.5 last:border-0" data-testid={`system-health-${h.name}`}>
      <span className="font-medium">{HEALTH_NAME[h.name] ?? h.name}</span>
      <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
      <span className="ms-auto text-xs text-muted-foreground">{h.durationMs} ms</span>
      {h.detail && <p className="basis-full text-sm text-destructive">{h.detail}</p>}
    </div>
  );
}

/** Dòng "nhãn — giá trị" của khung thông tin. */
export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,8.75rem)_minmax(0,1fr)] gap-2 border-b py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="break-all">{children}</span>
    </div>
  );
}
