import type { ReactNode } from 'react';
import { Badge } from '@/components/common/badge';
import { cn } from '@/utils/cn';

/** Sắc thái trạng thái — map sang token theme (global.css), chạy được cả light/dark. */
export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'muted' | 'faint';

const TONE: Record<StatusTone, string> = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-destructive/10 text-destructive',
  info: 'bg-info/15 text-info',
  primary: 'bg-primary/10 text-primary',
  muted: 'bg-muted text-muted-foreground',
  faint: 'bg-transparent text-muted-foreground/60',
};

/** Badge trạng thái dạng "soft" (nền nhạt + chữ đậm màu). Dùng cho trạng thái ngày công, đơn, phép… */
export function StatusBadge({ tone, className, children }: { tone: StatusTone; className?: string; children: ReactNode }) {
  return (
    <Badge variant="secondary" className={cn(TONE[tone], className)}>
      {children}
    </Badge>
  );
}
