import { useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Plus } from 'lucide-react';
import { Button } from '@/components/common/button';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Tabs, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { useMe } from '@/features/auth';
import { useTabParam } from '@/hooks/useTabParam';
import { fmtDate, useFinancePerms } from '@/features/finance';
import { useMyTasks, useProjectList } from '../../hooks/useProjects';
import { PROJECT_HEALTH, PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';
import { ColumnBadge } from '../column-badge';
import { ProgressBar } from '../progress-bar';
import { ProjectsOverview } from '../projects-overview';
import { ProfitTable } from '../profit-table';
import { ProjectFormDialog } from '../project-form-dialog';

/** Danh sách dự án (của tôi / tất cả với HR, Ban giám đốc) + việc được giao cho tôi ở mọi dự án · Tổng quan tiến độ · Lãi / lỗ (chỉ quyền Xem tài chính). */
export function ProjectsPage() {
  const me = useMe();
  const roles = me.data?.roles ?? [];
  const canCreate = roles.some((r) => r === 'admin' || r === 'hr' || r === 'manager');
  const finance = useFinancePerms();
  const [scope, setScope] = useTabParam('mine', finance.view ? ['mine', 'all', 'overview', 'profit'] : ['mine', 'all', 'overview']);
  const [showClosed, setShowClosed] = useState(false);
  const { data = [], isLoading } = useProjectList(scope === 'mine');
  const myTasks = useMyTasks().data ?? [];
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const [dept, setDept] = useState<string | null>(null);
  const deptOptions = [...new Map(data.flatMap((p) => p.departments).map((d) => [d.id, d.name])).entries()]
    .map(([value, label]) => ({ value, label })).sort((a, b) => a.label.localeCompare(b.label, 'vi'));
  const shown = data.filter((p) => (showClosed || p.status === 'Active') && (!dept || p.departments.some((d) => d.id === dept)));
  return (
    <div className="grid grid-cols-1 gap-4">
      <PageHeader title="Dự án" />
      <PageToolbar actions={canCreate && <Button size="sm" onClick={() => setCreating(true)}><Plus /> Dự án mới</Button>}>
        <Tabs value={scope} onValueChange={setScope}>
          <TabsList><TabsTrigger value="mine">Của tôi</TabsTrigger><TabsTrigger value="all">Tất cả tôi xem được</TabsTrigger><TabsTrigger value="overview">Tổng quan tiến độ</TabsTrigger>
            {finance.view && <TabsTrigger value="profit">Lãi / lỗ</TabsTrigger>}</TabsList>
        </Tabs>
      </PageToolbar>
      {scope === 'profit' ? <ProfitTable /> : scope === 'overview' ? <ProjectsOverview /> : <>
      {myTasks.length > 0 && (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-sm font-medium">Việc của tôi ({myTasks.length}) {myTasks.some((t) => t.overdue) && <StatusBadge tone="danger">{myTasks.filter((t) => t.overdue).length} quá hạn</StatusBadge>}</div>
          <ul className="grid gap-1 text-sm">
            {myTasks.slice(0, 8).map((t) => (
              <li key={t.id}><Link to="/projects/$projectId" params={{ projectId: t.projectId }} search={{ task: t.id }} className="hover:underline">
                <span className="text-muted-foreground">{t.code}</span> {t.title} <span className="text-xs text-muted-foreground">· {t.projectName}</span>
                {t.dueOn && <span className={`text-xs ${t.overdue ? 'text-rose-600' : 'text-muted-foreground'}`}> · hạn {fmtDate(t.dueOn)}</span>}
                <ColumnBadge name={t.columnName} color={t.columnColor} className="ml-2" />
              </Link></li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-4">
        {deptOptions.length > 0 && <div className="w-64"><SelectField id="pj-filter-dept" label="Phòng ban tham gia" allowEmpty emptyLabel="— Tất cả —" value={dept}
          onChange={setDept} options={deptOptions} /></div>}
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} /> Hiện dự án đã đóng</label>
      </div>
      {isLoading ? <Spinner /> : shown.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có dự án{canCreate ? ' — bấm "Dự án mới"' : ''}.</p> : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <button key={p.id} type="button" onClick={() => void navigate({ to: '/projects/$projectId', params: { projectId: p.id } })} data-testid="project-card"
              className="grid gap-2 rounded-xl border bg-card p-4 text-left hover:border-primary/50">
              <div className="flex items-start justify-between gap-2">
                <div><div className="text-xs text-muted-foreground">{p.code} · {PROJECT_KIND[p.kind]}</div><div className="font-semibold">{p.name}</div></div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {p.progress.health ? <StatusBadge tone={PROJECT_HEALTH[p.progress.health].tone}>{PROJECT_HEALTH[p.progress.health].label}</StatusBadge>
                    : <StatusBadge tone={PROJECT_STATUS[p.status].tone}>{PROJECT_STATUS[p.status].label}</StatusBadge>}
                </div>
              </div>
              <ProgressBar p={p.progress} />
              {p.departments.length > 0 && <div className="text-xs text-muted-foreground" data-testid="project-departments">
                {p.departments.map((d) => (d.isLead ? `${d.name} (chủ trì)` : d.name)).join(', ')}</div>}
              {p.contracts.length > 0 && <div className="text-xs text-muted-foreground">HĐ {p.contracts.map((c) => c.code).join(', ')} · {[...new Set(p.contracts.map((c) => c.customerName))].join(', ')}</div>}
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{p.memberCount} thành viên</span>
                <span>{p.tasks.open} việc mở · {p.tasks.done} xong</span>
                {p.tasks.overdue > 0 && <span className="text-rose-600">{p.tasks.overdue} quá hạn</span>}
                {(p.milestonesOpen + p.milestonesAccepted) > 0 && <span>Mốc {p.milestonesAccepted}/{p.milestonesOpen + p.milestonesAccepted}</span>}
              </div>
              {(p.progress.nextMilestone || p.endOn) && <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                {p.progress.nextMilestone && <span className={p.progress.nextMilestone.overdue ? 'text-rose-600' : ''}>
                  Mốc tiếp: {p.progress.nextMilestone.title}{p.progress.nextMilestone.dueOn && ` (${fmtDate(p.progress.nextMilestone.dueOn)})`}</span>}
                {p.endOn && <span>Kết thúc {fmtDate(p.endOn)}</span>}
              </div>}
              {p.myRole && <div className="text-xs">{p.myRole === 'Manager' ? 'Bạn là quản lý dự án' : 'Bạn là thành viên'}</div>}
              {p.viaDepartment && <div className="text-xs text-muted-foreground">Xem nhờ phòng ban — chỉ đọc</div>}
            </button>
          ))}
        </div>
      )}
      </>}
      <ProjectFormDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => void navigate({ to: '/projects/$projectId', params: { projectId: id } })} />
    </div>
  );
}
