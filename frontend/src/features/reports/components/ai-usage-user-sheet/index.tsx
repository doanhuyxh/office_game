import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { Spinner } from '@/components/feedback/Spinner';
import { ActivityTable } from '@/features/ai-access';
import { formatDate } from '@/utils/date';
import { useAiUsage } from '../../hooks/useReports';
import type { IAiUsageFilter } from '../../types/report.types';
import { AiUsageBreakdown } from '../ai-usage-breakdown';
import { AiUsageChart } from '../ai-usage-chart';
import { AiUsageStats } from '../ai-usage-stats';

export interface AiUsagePerson { userId: string; name: string; departmentName: string | null }

/** Chi tiết sử dụng AI của một người trong kỳ: số liệu, theo ngày, tool, ứng dụng, IP + nhật ký từng request. */
export function AiUsageUserSheet({ person, filter, onClose }: { person: AiUsagePerson | null; filter: IAiUsageFilter; onClose: () => void }) {
  const { data, isLoading } = useAiUsage(filter, person?.userId ?? null, !!person);
  return (
    <Sheet open={!!person} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-4xl" data-testid="ai-usage-user-sheet">
        {person && (
          <>
            <SheetHeader>
              <SheetTitle>{person.name}</SheetTitle>
              <SheetDescription>
                {person.departmentName ? `${person.departmentName} · ` : ''}Trợ lý AI từ {formatDate(filter.from)} đến {formatDate(filter.to)}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6">
              {isLoading || !data ? <Spinner /> : (
                <>
                  <AiUsageStats s={data.summary} single />
                  <div className="rounded-xl border bg-card p-4"><AiUsageChart days={data.daily} /></div>
                  <AiUsageBreakdown data={data} single />
                </>
              )}
              <div className="rounded-xl border bg-card">
                <div className="px-4 pt-3 text-sm font-medium">Nhật ký (mọi thời điểm, mới nhất trước)</div>
                <div className="px-2"><ActivityTable all userId={person.userId} /></div>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
