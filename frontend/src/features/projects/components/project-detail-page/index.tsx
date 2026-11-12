import { useEffect, useState } from 'react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { ArrowLeft, FolderOpen, Pencil } from 'lucide-react';
import { Markdown } from '@/components/common/markdown';
import { Button } from '@/components/common/button';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader, PageToolbar } from '@/components/layout/PageHeader';
import { PATHS } from '@/config/paths';
import { useMe } from '@/features/auth';
import { fmtDate, useFinancePerms } from '@/features/finance';
import { useEmployees } from '@/features/employees';
import { useTabParam } from '@/hooks/useTabParam';
import { errorMessage } from '@/utils/errors';
import { useProject } from '../../hooks/useProjects';
import { PROJECT_KIND, PROJECT_STATUS } from '../../utils/labels';
import { ChangeRequestsPanel } from '../change-requests-panel';
import { EffortPanel } from '../effort-panel';
import { FinancialsPanel } from '../financials-panel';
import { MembersPanel } from '../members-panel';
import { MilestonesPanel } from '../milestones-panel';
import { ProjectAppendix } from '../project-appendix';
import { ProjectFormDialog } from '../project-form-dialog';
import { TaskBoard } from '../task-board';

/** /projects/$projectId: Công việc · Hướng dẫn làm việc · Mốc nghiệm thu · Thay đổi (CR) · Thành viên · Ngày công / Tài chính (theo myAccess) · Phụ lục (phòng ban, thành viên, quyền hạn). */
export function ProjectDetailPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { data: d, isLoading, error } = useProject(projectId);
  const finance = useFinancePerms();
  const me = useMe();
  const myEmployeeId = (useEmployees().data ?? []).find((e) => e.userId === me.data?.id)?.id ?? null;
  const access = d?.myAccess ?? [];
  const canEffort = access.includes('effort');
  const canFinance = access.includes('finance') && finance.view;
  const [tab, setTab] = useTabParam('tasks', ['tasks', 'guide', 'milestones', 'changes', 'members', 'appendix', ...(canEffort ? ['effort'] : []), ...(canFinance ? ['finance'] : [])]);
  const [editing, setEditing] = useState(false);
  // Link chuông ?task=… (TEST-66) → luôn ở tab Công việc để hộp thoại việc mở được
  const openTask = (useSearch({ strict: false }) as { task?: string }).task;
  useEffect(() => { if (openTask && tab !== 'tasks') setTab('tasks'); }, [openTask, tab, setTab]);
  if (isLoading) return <Spinner />;
  if (error || !d) return <div className="grid gap-2"><p className="text-sm text-destructive">{errorMessage(error, 'Không tìm thấy dự án')}</p><Link to={PATHS.projects} className="text-sm underline">← Danh sách dự án</Link></div>;
  const p = d.project;
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
          {p.description && <p className="max-w-3xl whitespace-pre-wrap text-sm">{p.description}</p>}
          {p.viaDepartment && <p className="text-xs text-muted-foreground" data-testid="via-department">Bạn xem dự án này nhờ phòng ban của mình tham gia — chỉ đọc (không tạo / sửa việc, không bình luận). Xem tab "Phụ lục".</p>}
        </div>
        <div className="flex gap-2">
          {access.includes('documents') && <Button size="sm" variant="outline" asChild><Link to={PATHS.documents} search={{ space: `Project:${p.id}` } as never}><FolderOpen /> Tài liệu dự án</Link></Button>}
          {p.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>}
        </div>
      </div>
      <Tabs value={openTask ? 'tasks' : tab} onValueChange={setTab}>
        <PageToolbar>
          <TabsList>
            <TabsTrigger value="tasks">Công việc ({p.tasks.open})</TabsTrigger>
            <TabsTrigger value="guide">Hướng dẫn</TabsTrigger>
            <TabsTrigger value="milestones">Mốc ({p.milestonesAccepted}/{p.milestonesOpen + p.milestonesAccepted})</TabsTrigger>
            <TabsTrigger value="changes">Thay đổi</TabsTrigger>
            <TabsTrigger value="members">Thành viên ({p.memberCount})</TabsTrigger>
            {canEffort && <TabsTrigger value="effort">Ngày công</TabsTrigger>}
            {canFinance && <TabsTrigger value="finance">Tài chính</TabsTrigger>}
            <TabsTrigger value="appendix">Phụ lục</TabsTrigger>
          </TabsList>
        </PageToolbar>
        <TabsContent value="tasks" className="mt-4"><TaskBoard d={d} myEmployeeId={myEmployeeId} /></TabsContent>
        <TabsContent value="guide" className="mt-4">
          <div className="grid max-w-3xl gap-3" data-testid="work-guide">
            <p className="text-sm text-muted-foreground">{`Quy trình: ${d.columns.map((c) => c.name).join(' → ')}${p.sequential ? ', đi lần lượt; chuyển lùi phải ghi lý do' : ', kéo thả tự do'}`}
              {d.columns.some((c) => c.approverOnly) && `; chỉ quản lý dự án chuyển sang ${d.columns.filter((c) => c.approverOnly).map((c) => `"${c.name}"`).join(', ')}`}. Thành viên và BOT (qua MCP) đọc hướng dẫn này trước khi làm việc.</p>
            {d.workGuide ? <div className="rounded-lg border p-4"><Markdown text={d.workGuide} /></div>
              : <p className="text-sm text-muted-foreground">Chưa có hướng dẫn.{p.canManage && ' Bấm "Sửa" để soạn.'}</p>}
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
