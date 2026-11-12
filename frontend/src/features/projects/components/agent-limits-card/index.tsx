import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { FormField } from '@/components/common/FormField';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useAgentSettings, useProjectMutation } from '../../hooks/useProjects';
import type { IAgentSettingsRequest } from '../../types/project.types';

/**
 * Giới hạn trợ lý AI / bot trên bảng việc (trang Hệ thống → Cấu hình, chỉ admin): số việc một tài khoản được tạo / ngày qua token AI
 * và số lần một việc qua tay bot liên tiếp trước khi phải có người thật xem. Lưu xong áp dụng ngay.
 */
export function AgentLimitsCard() {
  const { data, isLoading, error } = useAgentSettings();
  const [f, setF] = useState<IAgentSettingsRequest>({ maxBotTasksPerDay: 0, maxBotStreak: 0 });
  const save = useProjectMutation(projectApi.saveAgentSettings);
  useEffect(() => { if (data) setF({ maxBotTasksPerDay: data.maxBotTasksPerDay, maxBotStreak: data.maxBotStreak }); }, [data]);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const errors = fieldErrors(save.error);
  const dirty = f.maxBotTasksPerDay !== data.maxBotTasksPerDay || f.maxBotStreak !== data.maxBotStreak;
  const num = (v: string) => (v === '' ? 0 : Math.trunc(Number(v)));
  return (
    <Card data-testid="agent-limits">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4 text-muted-foreground" />Giới hạn trợ lý AI trên bảng việc</CardTitle>
        <CardDescription>Áp dụng cho mọi thao tác qua token AI / MCP (người dùng Claude và tài khoản bot). Lưu xong có hiệu lực ngay.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-xl gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate(f, {
            onSuccess: () => toast.success('Đã lưu giới hạn'),
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <FormField id="agent-tasks" label="Số việc một tài khoản được tạo mỗi ngày" type="number" required min={data.tasksPerDayMin} max={data.tasksPerDayMax} step={1}
            value={f.maxBotTasksPerDay || ''} onChange={(e) => setF((x) => ({ ...x, maxBotTasksPerDay: num(e.target.value) }))} error={errors.maxBotTasksPerDay}
            hint={`Từ ${data.tasksPerDayMin} đến ${data.tasksPerDayMax}, mặc định ${data.defaultTasksPerDay}. Vượt → bot nhận lỗi, chờ hôm sau hoặc tạo trên web.`} />
          <FormField id="agent-streak" label="Số lần liên tiếp một việc qua tay bot" type="number" required min={data.streakMin} max={data.streakMax} step={1}
            value={f.maxBotStreak || ''} onChange={(e) => setF((x) => ({ ...x, maxBotStreak: num(e.target.value) }))} error={errors.maxBotStreak}
            hint={`Từ ${data.streakMin} đến ${data.streakMax}, mặc định ${data.defaultStreak}. Đủ số lần (chuyển trạng thái / giao / bình luận) mà chưa có người thật xem → bot bị chặn trên việc đó.`} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending || !dirty}>Lưu</Button>
            <span className="text-xs text-muted-foreground" data-testid="agent-limits-updated">
              {data.isDefault ? 'Đang dùng giá trị mặc định.' : `Sửa lần cuối ${data.updatedAt ? formatDateTime(data.updatedAt) : ''}${data.updatedByName ? ` bởi ${data.updatedByName}` : ''}.`}
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
