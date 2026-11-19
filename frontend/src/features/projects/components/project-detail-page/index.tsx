import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FolderOpen, Pencil, RefreshCw } from 'lucide-react';
import { type Query, useIsFetching, useQueryClient } from '@tanstack/react-query';
import { Markdown } from '@/components/common/markdown';
import { Button } from '@/components/common/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { cn } from '@/utils/cn';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { PATHS } from '@/config/paths';
import { useMe } from '@/features/auth';
import { fmtDate, useFinancePerms } from '@/features/finance';
import { useEmployees } from '@/features/employees';
import { useTabParam } from '@/hooks/useTabParam';
import { errorMessage } from '@/utils/errors';
import { useProject } from '../../hooks/useProjects';
import { PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';
import { columnGuideId, guidedColumns } from '../../utils/column-guides';
import { markdownHeadings } from '../../utils/headings';
import { markdownSummary } from '../../utils/summary';
import { ChangeRequestsPanel } from '../change-requests-panel';
import { ColumnGuides } from '../column-guides';
import { EffortPanel } from '../effort-panel';
import { FinancialsPanel } from '../financials-panel';
import { MembersPanel } from '../members-panel';
import { MilestonesPanel } from '../milestones-panel';
import { ProjectAppendix } from '../project-appendix';
import { ProjectFormDialog } from '../project-form-dialog';
import { ProjectOverview } from '../project-overview';
import { TaskBoard } from '../task-board';
import { WorkflowSummary } from '../workflow-summary';
import { WorkGuideToc } from '../work-guide-toc';

/**
 * Một tab của trang dự án. Nền sáng (dạng thẻ): đang chọn → nền `muted` + viền, che vạch dưới để nối liền nội dung; số đếm nhãn tròn đảo màu.
 * Nền tối (TEST-193, thiết kế `may-tinh-toi-v2-review`): không viền, không bo góc — tab đang chọn gạch chân `primary` sát đáy, nền chỉ nhỉnh hơn nền trang
 * (`muted/40`); số đếm nhãn nền tối (`background`) chữ `primary`. Mọi tab nền tối có `border-b-2` trong suốt để chiều cao không nhảy.
 */
function ProjectTab({ value, count, children }: { value: string; count?: number | string; children: ReactNode }) {
  return (
    <TabsTrigger value={value} className={cn('group/tab h-auto flex-none gap-2 rounded-b-none rounded-t-lg border border-b-0 border-transparent px-3 py-2',
      'data-[state=active]:border-border data-[state=active]:bg-muted data-[state=active]:shadow-none',
      'dark:rounded-none dark:border-0 dark:border-b-2',
      'dark:data-[state=active]:border-transparent dark:data-[state=active]:border-b-primary dark:data-[state=active]:bg-muted/40')}>
      {children}
      {count !== undefined && <span className={cn('rounded-full bg-muted px-1.5 text-xs leading-5 font-medium text-muted-foreground tabular-nums',
        'group-data-[state=active]/tab:bg-foreground group-data-[state=active]/tab:text-background',
        'dark:group-data-[state=active]/tab:bg-background dark:group-data-[state=active]/tab:text-primary')} data-testid={`tab-count-${value}`}>{count}</span>}
    </TabsTrigger>
  );
}

/** Tiền tố id tiêu đề hướng dẫn (mục lục cuộn tới). */
const GUIDE_HEADING_PREFIX = 'guide';

/** Query của dự án đang xem: mọi key `projectKeys.*` chứa id dự án (detail, tasks, effort, financials, installments, changeRequests, appendix)
 *  + hộp thoại việc đang mở (`projectKeys.task` / `comments` — key theo id việc, chỉ lấy query đang có người dùng). */
const projectQueryFilter = (projectId: string) => ({
  predicate: (q: Query) => q.queryKey[0] === 'projects'
    && (q.queryKey.includes(projectId) || ((q.queryKey[1] === 'task' || q.queryKey[1] === 'comments') && q.getObserversCount() > 0)),
});

/** /projects/$projectId: Công việc · Tổng quan (mô tả Markdown + thông tin nhanh) · Hướng dẫn làm việc · Mốc nghiệm thu · Thay đổi (CR) · Thành viên · Ngày công / Tài chính (theo myAccess) · Phụ lục (phòng ban, thành viên, quyền hạn). */
export function ProjectDetailPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { data: d, isLoading, error } = useProject(projectId);
  const finance = useFinancePerms();
  const me = useMe();
  const myEmployeeId = (useEmployees().data ?? []).find((e) => e.userId === me.data?.id)?.id ?? null;
  const access = d?.myAccess ?? [];
  const canEffort = access.includes('effort');
  const canFinance = access.includes('finance') && finance.view;
  const [tab, setTab] = useTabParam('tasks', ['tasks', 'overview', 'guide', 'milestones', 'changes', 'members', 'appendix', ...(canEffort ? ['effort'] : []), ...(canFinance ? ['finance'] : [])]);
  const [editing, setEditing] = useState(false);
  // "Làm mới" (TEST-150): đánh dấu cũ mọi query của dự án → query đang mở tải lại, query khác chỉ bị đánh dấu (không gọi API thừa).
  // Tab / bộ lọc / vị trí cuộn giữ nguyên vì không remount.
  const qc = useQueryClient();
  const reloading = useIsFetching(projectQueryFilter(projectId)) > 0;
  // Link chuông ?task=… (TEST-66) → luôn ở tab Công việc để hộp thoại việc mở được
  const openTask = (useSearch({ strict: false }) as { task?: string }).task;
  useEffect(() => { if (openTask && tab !== 'tasks') setTab('tasks'); }, [openTask, tab, setTab]);
  if (isLoading) return <Spinner />;
  if (error || !d) return <div className="grid gap-2"><p className="text-sm text-destructive">{errorMessage(error, 'Không tìm thấy dự án')}</p><Link to={PATHS.projects} className="text-sm underline">← Danh sách dự án</Link></div>;
  const p = d.project;
  const summary = markdownSummary(p.description);
  const guideHeadings = markdownHeadings(d.workGuide);
  // TEST-186: hướng dẫn riêng từng cột — dưới hướng dẫn chung, có trong mục lục
  const colToc = guidedColumns(d.columns).map((c) => ({ id: columnGuideId(c.id), text: `Trạng thái: ${c.name}`, color: c.color }));
  const tocCount = guideHeadings.length + colToc.length;
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title={p.name} />
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="grid gap-1">
          <Link to={PATHS.projects} className="flex items-center gap-1 text-xs text-muted-foreground hover:underline"><ArrowLeft className="size-3" /> Dự án</Link>
          <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">{p.name} <span className="text-sm font-normal text-muted-foreground">{p.code}</span>
            <StatusBadge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</StatusBadge></div>
          <div className="text-sm text-muted-foreground">{PROJECT_KIND[p.kind]}{p.contracts.length > 0 && ` · HĐ ${p.contracts.map((c) => c.code).join(', ')} · ${[...new Set(p.contracts.map((c) => c.customerName))].join(', ')}`}{p.departments.length > 0 && ` · ${p.departments.map((x) => (x.isLead ? `${x.name} (chủ trì)` : x.name)).join(', ')}`}
            {p.startOn && ` · ${fmtDate(p.startOn)}${p.endOn ? ` → ${fmtDate(p.endOn)}` : ''}`}</div>
          {summary && <p className="flex max-w-3xl min-w-0 items-baseline gap-2 text-sm" data-testid="project-summary">
            <span className="line-clamp-1 min-w-0 text-muted-foreground" title={summary}>{summary}</span>
            <button type="button" className="shrink-0 text-xs text-primary hover:underline" onClick={() => setTab('overview')}>Xem tổng quan</button></p>}
          {p.viaDepartment && <p className="text-xs text-muted-foreground" data-testid="via-department">Bạn xem dự án này nhờ phòng ban của mình tham gia — chỉ đọc (không tạo / sửa việc, không bình luận). Xem tab "Phụ lục".</p>}
        </div>
        <div className="flex gap-2">
          {access.includes('documents') && <Button size="sm" variant="outline" asChild><Link to={PATHS.documents} search={{ space: `Project:${p.id}` } as never}><FolderOpen /> Tài liệu dự án</Link></Button>}
          {p.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>}
        </div>
      </div>
      <Tabs value={openTask ? 'tasks' : tab} onValueChange={setTab}>
        {/* TEST-192 (thiết kế TEST-191 bản 2): nền sáng tab dạng thẻ — vạch dưới cả hàng, tab đang chọn nền `muted` có viền, nối liền khung công cụ của tab Công việc.
            TEST-193: nền tối tab đang chọn gạch chân `primary`, "Làm mới" nút nhỏ có viền + nền nhẹ. */}
        <div className="relative flex items-end gap-2 after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border" data-testid="project-tabs">
          <TabsList className="relative z-10 min-w-0 flex-1 items-end gap-0.5 rounded-none bg-transparent p-0 group-data-[orientation=horizontal]/tabs:h-auto">
            <ProjectTab value="tasks" count={p.tasks.open}>Công việc</ProjectTab>
            <ProjectTab value="overview">Tổng quan</ProjectTab>
            <ProjectTab value="guide">Hướng dẫn</ProjectTab>
            <ProjectTab value="milestones" count={`${p.milestonesAccepted}/${p.milestonesOpen + p.milestonesAccepted}`}>Mốc</ProjectTab>
            <ProjectTab value="changes">Thay đổi</ProjectTab>
            <ProjectTab value="members" count={p.memberCount}>Thành viên</ProjectTab>
            {canEffort && <ProjectTab value="effort">Ngày công</ProjectTab>}
            {canFinance && <ProjectTab value="finance">Tài chính</ProjectTab>}
            <ProjectTab value="appendix">Phụ lục</ProjectTab>
          </TabsList>
          <Button size="sm" variant="ghost" className="mb-1 shrink-0 dark:border dark:border-border dark:bg-muted/40 dark:hover:bg-muted" disabled={reloading} data-testid="project-reload" aria-label="Làm mới"
            onClick={() => void qc.invalidateQueries(projectQueryFilter(projectId))}>
            <RefreshCw className={reloading ? 'animate-spin' : undefined} /> <span className="hidden sm:inline">Làm mới</span></Button>
        </div>
        <TabsContent value="tasks" className="-mt-2"><TaskBoard d={d} myEmployeeId={myEmployeeId} /></TabsContent>
        <TabsContent value="overview" className="mt-4"><ProjectOverview d={d} onTab={setTab} onEdit={() => setEditing(true)} canEffort={canEffort} /></TabsContent>
        <TabsContent value="guide" className="mt-4">
          {/* TEST-183: 2 cột từ @4xl — trái nội dung, phải (dính khi cuộn) quy trình + mục lục; hẹp → 1 cột, mục lục thu gọn */}
          <div className="grid max-w-[88rem] items-start gap-4 @4xl/content:grid-cols-[minmax(0,1fr)_16rem] @4xl/content:gap-6 @6xl/content:grid-cols-[minmax(0,1fr)_18rem]" data-testid="work-guide">
            <aside className="grid gap-4 rounded-lg border p-4 @4xl/content:sticky @4xl/content:top-20 @4xl/content:col-start-2 @4xl/content:row-start-1 @4xl/content:max-h-[calc(100dvh-6rem)] @4xl/content:overflow-y-auto">
              <WorkflowSummary columns={d.columns} sequential={p.sequential} />
              {tocCount > 0 && <>
                <details className="group @4xl/content:hidden">
                  <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">Mục lục ({tocCount})</summary>
                  <WorkGuideToc headings={guideHeadings} extra={colToc} prefix={GUIDE_HEADING_PREFIX} className="mt-2" />
                </details>
                <div className="hidden gap-2 border-t pt-4 @4xl/content:grid">
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Mục lục</div>
                  <WorkGuideToc headings={guideHeadings} extra={colToc} prefix={GUIDE_HEADING_PREFIX} className="-mx-2" />
                </div>
              </>}
            </aside>
            <div className="grid min-w-0 gap-4 @4xl/content:col-start-1 @4xl/content:row-start-1">
              {d.workGuide ? <div className="min-w-0 rounded-lg border p-4 @4xl/content:p-6"><Markdown text={d.workGuide} headingIds={GUIDE_HEADING_PREFIX} /></div>
                : <p className="text-sm text-muted-foreground">Chưa có hướng dẫn.{p.canManage && ' Bấm "Sửa" để soạn.'}</p>}
              <ColumnGuides columns={d.columns} members={d.members} />
            </div>
          </div>
        </TabsContent>
        <TabsContent value="milestones" className="mt-4"><MilestonesPanel d={d} /></TabsContent>
        <TabsContent value="changes" className="mt-4"><ChangeRequestsPanel d={d} /></TabsContent>
        <TabsContent value="members" className="mt-4"><MembersPanel d={d} /></TabsContent>
        {canEffort && <TabsContent value="effort" className="mt-4"><EffortPanel d={d} /></TabsContent>}
        {canFinance && <TabsContent value="finance" className="mt-4"><FinancialsPanel d={d} /></TabsContent>}
        <TabsContent value="appendix" className="mt-4"><ProjectAppendix projectId={p.id} active={tab === 'appendix'} /></TabsContent>
      </Tabs>
      <ProjectFormDialog open={editing} project={p} workGuide={d.workGuide} onClose={() => setEditing(false)} />
    </div>
  );
}
