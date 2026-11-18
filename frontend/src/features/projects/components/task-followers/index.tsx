import { useState } from 'react';
import { Eye, X } from 'lucide-react';
import { toast } from 'sonner';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation } from '../../hooks/useProjects';
import type { IMember, ITaskFollower } from '../../types/project.types';

/**
 * Người theo dõi việc (TEST-160): thành viên dự án (người hoặc bot — nhãn BOT) muốn theo dõi việc không giao cho mình, vd bot DevOps chờ việc xong để deploy.
 * Chọn thành viên → thêm ngay; ✕ → bỏ. Back-end kiểm thành viên dự án + quyền làm việc, ghi lịch sử. Chưa có thông báo riêng cho người theo dõi.
 */
export function TaskFollowers({ taskId, followers, members, canWork }: {
  taskId: string; followers: ITaskFollower[]; members: IMember[]; canWork: boolean;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const add = useProjectMutation((employeeId: string) => projectApi.addFollower(taskId, employeeId));
  const remove = useProjectMutation((employeeId: string) => projectApi.removeFollower(taskId, employeeId));
  const pending = add.isPending || remove.isPending;
  const run = (m: typeof add, employeeId: string) => {
    setBusyId(employeeId);
    m.mutate(employeeId, { onError: (e) => toast.error(errorMessage(e)), onSettled: () => setBusyId(null) });
  };

  const following = new Set(followers.map((f) => f.employeeId));
  const options = members.filter((m) => m.isActive && !following.has(m.employeeId))
    .map((m) => ({ value: m.employeeId, label: m.isBot ? `${m.fullName} (BOT)` : m.fullName, hint: m.code ?? undefined }));
  if (!followers.length && !canWork) return null;
  return (
    <div className="grid gap-2 border-t pt-3" data-testid="task-followers">
      <div className="flex items-center gap-1.5 text-sm font-medium"><Eye className="size-4 text-muted-foreground" aria-hidden /> Người theo dõi ({followers.length})</div>
      {followers.length > 0
        ? <ul className="flex flex-wrap gap-1.5">{followers.map((f) => (
            <li key={f.employeeId} className="flex items-center gap-1 rounded-full border bg-muted/40 py-0.5 pr-1 pl-2.5 text-xs" data-testid="task-follower">
              <span>{f.fullName}</span>{f.isBot && <BotBadge />}
              {canWork
                ? <Button type="button" size="icon" variant="ghost" className="size-5 rounded-full" aria-label={`Bỏ ${f.fullName} khỏi người theo dõi`}
                    loading={busyId === f.employeeId && remove.isPending} disabled={pending} onClick={() => run(remove, f.employeeId)}><X className="size-3" /></Button>
                : <span className="w-1" />}
            </li>
          ))}</ul>
        : <p className="text-xs text-muted-foreground">Chưa có ai theo dõi.</p>}
      {canWork && options.length > 0 && (
        <SearchSelectField id={`follow-${taskId}`} label="Thêm người theo dõi" value={null} options={options} placeholder="Chọn thành viên…"
          searchPlaceholder="Tìm tên hoặc mã…" onChange={(v) => { if (v && !pending) run(add, v); }} />
      )}
    </div>
  );
}
