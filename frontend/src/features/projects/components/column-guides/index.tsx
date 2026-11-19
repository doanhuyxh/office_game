import { BotBadge } from '@/components/common/bot-badge';
import { Markdown } from '@/components/common/markdown';
import type { IMember, ITaskColumn } from '../../types/project.types';
import { columnGuideId, guidedColumns } from '../../utils/column-guides';
import { ColumnBadge } from '../column-badge';

/**
 * Hướng dẫn riêng từng cột (TEST-186) dưới hướng dẫn chung ở tab Hướng dẫn: tiêu đề = nhãn màu cột + bot được chọn (hoặc "mọi bot theo dõi"),
 * nội dung Markdown — người thật đọc đủ ở một chỗ, bot chỉ đọc hướng dẫn của cột hiện tại (get_task → columnGuide).
 */
export function ColumnGuides({ columns, members }: { columns: ITaskColumn[]; members: IMember[] }) {
  const list = guidedColumns(columns);
  if (list.length === 0) return null;
  return (
    <section className="grid gap-3" data-testid="column-guides">
      <h2 className="text-sm font-semibold">Hướng dẫn theo trạng thái</h2>
      {list.map((c) => {
        const bots = (c.wakeBotIds ?? []).map((id) => members.find((m) => m.employeeId === id)).filter((m): m is IMember => !!m);
        return (
          <article key={c.id} id={columnGuideId(c.id)} className="min-w-0 scroll-mt-20 rounded-lg border p-4 @4xl/content:p-6" data-testid={`column-guide-${c.name}`}>
            <header className="mb-3 flex flex-wrap items-center gap-2 border-b pb-2">
              <ColumnBadge name={c.name} color={c.color} className="text-sm" />
              <span className="text-xs text-muted-foreground">→</span>
              {bots.length === 0
                ? <span className="text-xs text-muted-foreground">mọi bot theo dõi việc</span>
                : bots.map((b) => (
                    <span key={b.employeeId} className="inline-flex items-center gap-1 text-xs">{b.fullName}<BotBadge /></span>
                  ))}
            </header>
            <Markdown text={c.guide!} />
          </article>
        );
      })}
    </section>
  );
}
