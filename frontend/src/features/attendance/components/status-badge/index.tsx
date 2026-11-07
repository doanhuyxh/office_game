import { StatusBadge as Badge } from '@/components/common/StatusBadge';
import type { DayStatus } from '../../types/attendance.types';
import { DAY_STATUS } from '../../utils/labels';

export const StatusBadge = ({ status }: { status: DayStatus }) => <Badge tone={DAY_STATUS[status].tone}>{DAY_STATUS[status].label}</Badge>;
