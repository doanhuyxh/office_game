import { cn } from '@/utils/cn';
import { formatBytes } from '../storage-card';
import type { IServerResources, ResourceLevel } from '../../types/system.types';

const BAR: Record<ResourceLevel, string> = { ok: 'bg-success', warn: 'bg-warning', danger: 'bg-destructive' };
const TEXT: Record<ResourceLevel, string> = { ok: '', warn: 'text-warning', danger: 'text-destructive' };

const num = (v: number, digits = 0) => v.toLocaleString('vi-VN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (v: number) => `${num(Math.round(v))}%`;

/** Một dòng cùng khung với Row của thẻ "Thông tin máy chủ": thanh % màu theo mức (back-end tính) + số cụ thể; không có số → "—". */
function ResourceRow({ label, percent, level, testId, children }: {
  label: string; percent: number | null; level: ResourceLevel | null; testId: string; children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-2 border-b py-2 text-sm last:border-0" data-testid={testId}>
      <span className="text-muted-foreground">{label}</span>
      <div className="grid min-w-0 gap-1.5">
        {percent !== null && level && (
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={label}
            aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}>
            <div className={cn('h-full rounded-full transition-all', BAR[level])} style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
          </div>
        )}
        <span className={cn('break-words', level && TEXT[level])}>{children}</span>
      </div>
    </div>
  );
}

/** CPU / RAM / ổ cứng trong thẻ "Thông tin máy chủ" (Hệ thống → Tổng quan). Chỉ tải cùng /api/system/info (mở trang / "Kiểm tra lại"). */
export function ServerResourceRows({ resources }: { resources: IServerResources }) {
  const { cpu, memory, disks } = resources;
  const cpuText = cpu.percent === null && !cpu.load
    ? '—'
    : [cpu.percent === null ? null : pct(cpu.percent), `${cpu.cores} nhân`, cpu.load && `load ${cpu.load.map((l) => num(l, 2)).join(' / ')}`]
        .filter(Boolean).join(' · ');
  const ramText = memory.totalBytes === null || memory.usedBytes === null || memory.percent === null
    ? `— · Api dùng ${formatBytes(memory.processBytes)}`
    : [`${formatBytes(memory.usedBytes)} / ${formatBytes(memory.totalBytes)} (${pct(memory.percent)})`,
        `Api dùng ${formatBytes(memory.processBytes)}`,
        memory.containerLimitBytes !== null && `giới hạn container ${formatBytes(memory.containerLimitBytes)}`].filter(Boolean).join(' · ');
  return (
    <>
      <ResourceRow label="CPU" percent={cpu.percent} level={cpu.level} testId="system-res-cpu">{cpuText}</ResourceRow>
      <ResourceRow label="RAM" percent={memory.percent} level={memory.level} testId="system-res-ram">{ramText}</ResourceRow>
      {disks.length === 0 ? (
        <ResourceRow label="Ổ cứng" percent={null} level={null} testId="system-res-disk">—</ResourceRow>
      ) : disks.map((d, i) => (
        <ResourceRow key={d.path} label={i === 0 ? 'Ổ cứng' : `Ổ cứng (${d.path})`} percent={d.percent} level={d.level} testId={`system-res-disk${i ? `-${i}` : ''}`}>
          {formatBytes(d.usedBytes)} / {formatBytes(d.totalBytes)} ({pct(d.percent)}) · còn {formatBytes(d.freeBytes)}
        </ResourceRow>
      ))}
    </>
  );
}
