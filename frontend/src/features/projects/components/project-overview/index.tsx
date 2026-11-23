import type { ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Markdown } from '@/components/common/markdown';
import { StatusBadge } from '@/components/common/StatusBadge';
import { fmtDate } from '@/features/finance';
import { cn } from '@/utils/cn';
import type { IProjectDetail } from '../../types/project.types';
import { PROJECT_HEALTH, PROJECT_KIND } from '../../utils/labels';
import { ProgressBar } from '../progress-bar';

/** Một mục thông tin nhanh; có `tab` → nhãn thành link sang tab tương ứng. */
function Item({ label, tab, onTab, children, testId }: { label: string; tab?: string; onTab: (t: string) => void; children: ReactNode; testId?: string }) {
  return (
    <div className="grid gap-0.5" data-testid={testId}>
      {tab
        ? <button type="button" className="w-fit text-left text-xs text-muted-foreground hover:text-foreground hover:underline" onClick={() => onTab(tab)}>{label} →</button>
        : <span className="text-xs text-muted-foreground">{label}</span>}
      <div className="text-sm">{children}</div>
    </div>
  );
}

/**
 * Tab "Tổng quan" (TEST-138): dự án là gì — trái mô tả Markdown, phải thông tin nhanh (loại, phòng ban, hợp đồng, thời gian, ngân sách,
 * tiến độ, mốc tiếp, thành viên; mỗi mục link sang tab). Hướng dẫn làm việc (làm thế nào) vẫn ở tab "Hướng dẫn".
 */
export function ProjectOverview({ d, onTab, onEdit, canEffort }: { d: IProjectDetail; onTab: (t: string) => void; onEdit: () => void; canEffort: boolean }) {
  const p = d.project;
  const g = p.progress;
  const h = g.health ? PROJECT_HEALTH[g.health] : null;
  return (
    <div className="grid items-start gap-4 @min-[60rem]/content:grid-cols-[minmax(0,48rem)_minmax(16rem,22rem)] @min-[60rem]/content:gap-6" data-testid="project-overview">
      <section className="grid min-w-0 gap-2">
        <h3 className="text-sm font-semibold">Mô tả</h3>
        {p.description?.trim()
          ? <div className="rounded-lg border p-4 wrap-anywhere" data-testid="overview-description"><Markdown text={p.description} /></div>
          : <div className="grid justify-items-start gap-2 rounded-lg border border-dashed p-4" data-testid="overview-no-description">
              <p className="text-sm text-muted-foreground">Chưa có mô tả.</p>
              {p.canManage && <Button size="sm" variant="outline" onClick={onEdit}><Plus /> Thêm mô tả</Button>}
            </div>}
      </section>
      <aside className="grid gap-3 rounded-lg border p-4" data-testid="overview-facts">
        <Item label="Loại dự án" onTab={onTab}>{PROJECT_KIND[p.kind]}</Item>
        {p.departments.length > 0 && <Item label="Phòng ban" tab="appendix" onTab={onTab}>
          {p.departments.map((x, i) => <span key={x.id}>{i > 0 && ', '}{x.isLead ? <b>{x.name} (chủ trì)</b> : x.name}</span>)}
        </Item>}
        {p.contracts.length > 0 && <Item label="Hợp đồng bán" onTab={onTab}>
          {p.contracts.map((c) => <div key={c.id}><b>{c.code}</b> · {c.customerName}</div>)}
        </Item>}
        <Item label="Thời gian" onTab={onTab}>{p.startOn ? fmtDate(p.startOn) : '—'} → {p.endOn ? fmtDate(p.endOn) : 'chưa đặt'}</Item>
        {p.budgetManDays != null && <Item label="Ngân sách" tab={canEffort ? 'effort' : undefined} onTab={onTab}>{p.budgetManDays} ngày công</Item>}
        <Item label="Tiến độ" tab="tasks" onTab={onTab} testId="overview-progress">
          <ProgressBar p={g} />
          <div className="mt-1 text-xs text-muted-foreground">
            {p.tasks.open} đang mở · {p.tasks.done} xong{p.tasks.overdue > 0 && <> · <span className="text-destructive">{p.tasks.overdue} quá hạn</span></>}
          </div>
          {h && <div className="mt-1"><StatusBadge tone={h.tone}>{h.label}</StatusBadge></div>}
          {g.healthReasons.map((r) => <div key={r} className="mt-1 text-xs text-muted-foreground">{r}</div>)}
        </Item>
        {(g.nextMilestone || p.milestonesOpen + p.milestonesAccepted > 0) && <Item label="Mốc tiếp theo" tab="milestones" onTab={onTab}>
          {g.nextMilestone ? <>{g.nextMilestone.title}{g.nextMilestone.dueOn && <span className={cn('ml-1 text-xs', g.nextMilestone.overdue ? 'text-destructive' : 'text-muted-foreground')}>
            ({g.nextMilestone.overdue ? 'quá hạn ' : 'hạn '}{fmtDate(g.nextMilestone.dueOn)})</span>}</> : <span className="text-muted-foreground">—</span>}
          <div className="text-xs text-muted-foreground">Đã nghiệm thu {p.milestonesAccepted}/{p.milestonesOpen + p.milestonesAccepted}</div>
        </Item>}
        <Item label="Sổ tay" tab="wiki" onTab={onTab} testId="overview-wiki">{p.wikiPages > 0 ? `${p.wikiPages} trang` : <span className="text-muted-foreground">Chưa có trang</span>}</Item>
        <Item label="Thành viên" tab="members" onTab={onTab}>{p.memberCount} người</Item>
      </aside>
    </div>
  );
}
