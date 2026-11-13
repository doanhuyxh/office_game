import { useEffect, useState } from 'react';
import { Bot } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { FormField } from '@/components/common/FormField';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useAgentMeetingSettings, useSaveAgentMeetingSettings } from '../../hooks/useMeetings';

/**
 * "Cuộc họp với AI" (trang Hệ thống → Cấu hình, TEST-83): trần lượt phát biểu / số phút của một phiên họp agent. Chỉ admin — back-end
 * (`AuthPolicies.Admin`) trả 403 cho người khác. Áp dụng cho phiên mở sau đó; phiên đang họp giữ trần lúc mở.
 */
export function AgentMeetingSettingsCard() {
  const { data, isLoading, error } = useAgentMeetingSettings();
  const [f, setF] = useState({ maxTurns: 0, maxMinutes: 0 });
  const save = useSaveAgentMeetingSettings();
  useEffect(() => { if (data) setF({ maxTurns: data.maxTurns, maxMinutes: data.maxMinutes }); }, [data]);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const errors = fieldErrors(save.error);
  const dirty = f.maxTurns !== data.maxTurns || f.maxMinutes !== data.maxMinutes;
  const num = (v: string) => (v === '' ? 0 : Math.trunc(Number(v)));
  return (
    <Card data-testid="agent-meeting-limits">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Bot className="size-4 text-muted-foreground" />Cuộc họp với AI</CardTitle>
        <CardDescription>Trần mỗi phiên họp agent trong phòng họp — hết lượt hoặc hết giờ, phiên tự kết thúc. Áp dụng cho phiên mở sau khi lưu; phiên đang họp giữ trần lúc mở.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid max-w-xl gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate(f, {
            onSuccess: () => toast.success('Đã lưu trần cuộc họp với AI'),
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <FormField id="agent-meeting-turns" label="Số lượt phát biểu tối đa" type="number" required min={data.turnsMin} max={data.turnsMax} step={1}
            value={f.maxTurns || ''} onChange={(e) => setF((x) => ({ ...x, maxTurns: num(e.target.value) }))} error={errors.maxTurns}
            hint={`Từ ${data.turnsMin} đến ${data.turnsMax}, mặc định ${data.defaultMaxTurns}. Lượt của bot chủ trì, bỏ lượt, chỉ định đều tính.`} />
          <FormField id="agent-meeting-minutes" label="Số phút tối đa" type="number" required min={data.minutesMin} max={data.minutesMax} step={1}
            value={f.maxMinutes || ''} onChange={(e) => setF((x) => ({ ...x, maxMinutes: num(e.target.value) }))} error={errors.maxMinutes}
            hint={`Từ ${data.minutesMin} đến ${data.minutesMax}, mặc định ${data.defaultMaxMinutes}.`} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending || !dirty}>Lưu</Button>
            <span className="text-xs text-muted-foreground" data-testid="agent-meeting-limits-updated">
              {data.isDefault ? 'Đang dùng giá trị mặc định.' : `Sửa lần cuối ${data.updatedAt ? formatDateTime(data.updatedAt) : ''}${data.updatedByName ? ` bởi ${data.updatedByName}` : ''}.`}
            </span>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
