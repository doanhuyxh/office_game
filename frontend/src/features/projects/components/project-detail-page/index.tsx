import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { ArrowLeft, FolderOpen, Pencil } from 'lucide-react';
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
import { ProjectFormDialog } from '../project-form-dialog';
import { TaskBoard } from '../task-board';

/** /projects/$projectId: Công việc · Mốc nghiệm thu · Thay đổi (CR) · Thành viên · Ngày công (quản lý dự án / HR / Ban giám đốc) · Tài chính (chỉ quyền Xem tài chính). */
export function ProjectDetailPage() {
  const { projectId } = useParams({ strict: false }) as { projectId: string };
  const { data: d, isLoading, error } = useProject(projectId);
  const finance = useFinancePerms();
  const me = useMe();
  const myEmployeeId = (useEmployees().data ?? []).find((e) => e.userId === me.data?.id)?.id ?? null;
  const canEffort = !!d && (d.project.canManage || finance.view);
  const [tab, setTab] = useTabParam('tasks', ['tasks', 'milestones', 'changes', 'members', ...(canEffort ? ['effort'] : []), ...(finance.view ? ['finance'] : [])]);
  const [editing, setEditing] = useState(false);
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
          <div className="text-sm text-muted-foreground">{PROJECT_KIND[p.kind]}{p.contracts.length > 0 && ` · HĐ ${p.contracts.map((c) => c.code).join(', ')} · ${[...new Set(p.contracts.map((c) => c.customerName))].join(', ')}`}{p.departmentName && ` · ${p.departmentName}`}
            {p.startOn && ` · ${fmtDate(p.startOn)}${p.endOn ? ` → ${fmtDate(p.endOn)}` : ''}`}</div>
          {p.description && <p className="max-w-3xl whitespace-pre-wrap text-sm">{p.description}</p>}
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" asChild><Link to={PATHS.documents} search={{ space: `Project:${p.id}` } as never}><FolderOpen /> Tài liệu dự án</Link></Button>
          {p.canManage && <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>}
        </div>
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <PageToolbar>
          <TabsList>
            <TabsTrigger value="tasks">Công việc ({p.tasks.open})</TabsTrigger>
            <TabsTrigger value="milestones">Mốc ({p.milestonesAccepted}/{p.milestonesOpen + p.milestonesAccepted})</TabsTrigger>
            <TabsTrigger value="changes">Thay đổi</TabsTrigger>
            <TabsTrigger value="members">Thành viên ({p.memberCount})</TabsTrigger>
            {canEffort && <TabsTrigger value="effort">Ngày công</TabsTrigger>}
            {finance.view && <TabsTrigger value="finance">Tài chính</TabsTrigger>}
          </TabsList>
        </PageToolbar>
        <TabsContent value="tasks" className="mt-4"><TaskBoard d={d} myEmployeeId={myEmployeeId} /></TabsContent>
        <TabsContent value="milestones" className="mt-4"><MilestonesPanel d={d} /></TabsContent>
        <TabsContent value="changes" className="mt-4"><ChangeRequestsPanel d={d} /></TabsContent>
        <TabsContent value="members" className="mt-4"><MembersPanel d={d} /></TabsContent>
        {canEffort && <TabsContent value="effort" className="mt-4"><EffortPanel d={d} /></TabsContent>}
        {finance.view && <TabsContent value="finance" className="mt-4"><FinancialsPanel d={d} /></TabsContent>}
      </Tabs>
      <ProjectFormDialog open={editing} project={p} onClose={() => setEditing(false)} />
    </div>
  );
}
