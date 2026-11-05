import { cn } from '@/utils/cn';
import type { DayStatus } from '../types/attendance.types';
import { DAY_STATUS } from '../utils/labels';

export const StatusBadge = ({ status }: { status: DayStatus }) => (
  <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium', DAY_STATUS[status].className)}>{DAY_STATUS[status].label}</span>
);
