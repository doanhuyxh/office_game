import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { useProjectAppendix } from '../../hooks/useProjects';
import { AppendixDepartments } from '../appendix-departments';
import { AppendixMembers } from '../appendix-members';
import { AppendixOtherAccess } from '../appendix-other-access';

/**
 * Tab "Phụ lục" (TEST-40): phòng ban tham gia + thành viên + quyền hạn từng vai trò. Mọi người xem được dự án đều xem được tab này.
 * Nội dung quyền do back-end sinh từ đúng các hàm phân quyền (ProjectViewer) — FE không viết cứng.
 */
export function ProjectAppendix({ projectId, active }: { projectId: string; active: boolean }) {
  const { data: a, isLoading, error } = useProjectAppendix(projectId, active);
  if (isLoading) return <Spinner />;
  if (error || !a) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const labels = (keys: string[]) => a.capabilities.filter((c) => keys.includes(c.key)).map((c) => c.label);
  return (
    <div className="grid grid-cols-1 gap-6" data-testid="project-appendix">
      <section className="grid gap-2"><h3 className="text-sm font-semibold">Phòng ban tham gia ({a.departments.length})</h3><AppendixDepartments a={a} labels={labels} /></section>
      <section className="grid gap-2"><h3 className="text-sm font-semibold">Thành viên tham gia ({a.members.length})</h3><AppendixMembers a={a} labels={labels} /></section>
      <section className="grid gap-2"><h3 className="text-sm font-semibold">Quyền khác</h3><AppendixOtherAccess a={a} labels={labels} /></section>
    </div>
  );
}
