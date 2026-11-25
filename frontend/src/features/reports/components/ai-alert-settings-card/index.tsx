import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { FormField } from '@/components/common/FormField';
import { SettingsFormFooter } from '@/components/common/settings-form-footer';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useAiAlertSettings, useResetAiAlertSettings, useSaveAiAlertSettings } from '../../hooks/useReports';
import type { IAiAlertSettingsRequest } from '../../types/report.types';

type Key = keyof IAiAlertSettingsRequest;

/** Thứ tự + nhãn + giải thích từng ô (luật tương ứng trong AiAlertRules). */
const FIELDS: { key: Key; label: string; hint: string }[] = [
  { key: 'windowMinutes', label: 'Cửa sổ thời gian (phút)', hint: 'Khoảng thời gian gần nhất được đếm mỗi lần quét.' },
  { key: 'cooldownMinutes', label: 'Chống lặp (phút)', hint: 'Cùng người, cùng luật chỉ báo lại sau khoảng này.' },
  { key: 'errorsThreshold', label: 'Số lệnh lỗi', hint: 'Báo khi số lệnh lỗi (trừ 403 / 429) đạt ngưỡng và vượt tỉ lệ ở ô bên cạnh.' },
  { key: 'errorsPercent', label: 'Tỉ lệ lỗi tối thiểu (%)', hint: 'Lỗi phải chiếm hơn số % này trên tổng lệnh. 0 = chỉ xét số lệnh lỗi.' },
  { key: 'blockedThreshold', label: 'Số lệnh bị chặn (403 / 429)', hint: 'Báo khi một tài khoản bị chặn từ số lệnh này trở lên trong cửa sổ.' },
  { key: 'burstWritesThreshold', label: 'Số lệnh ghi', hint: 'Báo khi một tài khoản ghi dữ liệu (tạo / sửa / xoá) từ số lệnh này trở lên.' },
  { key: 'chatSpamThreshold', label: 'Số tin chat', hint: 'Báo khi một tài khoản gửi từ số tin này trở lên (hạn mức cứng vẫn là 60 tin / giờ).' },
];

const EMPTY: IAiAlertSettingsRequest = {
  blockedThreshold: 0, errorsThreshold: 0, errorsPercent: 0, burstWritesThreshold: 0, chatSpamThreshold: 0, windowMinutes: 0, cooldownMinutes: 0,
};

const pick = (d: IAiAlertSettingsRequest): IAiAlertSettingsRequest =>
  Object.fromEntries(FIELDS.map(({ key }) => [key, d[key]])) as unknown as IAiAlertSettingsRequest;

/**
 * Ngưỡng cảnh báo trợ lý AI bất thường (TEST-232, trang Hệ thống → Cấu hình, chỉ admin). Job quét đọc lại cấu hình mỗi lần chạy
 * → lưu xong áp dụng ở lần quét kế tiếp. Chỉ cảnh báo, không tự chặn bot; "Bot gọi duyệt / từ chối đơn" luôn bật.
 */
export function AiAlertSettingsCard() {
  const { data, isLoading, error } = useAiAlertSettings();
  const [f, setF] = useState<IAiAlertSettingsRequest>(EMPTY);
  const save = useSaveAiAlertSettings();
  const reset = useResetAiAlertSettings();
  useEffect(() => { if (data) setF(pick(data)); }, [data]);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const errors = fieldErrors(save.error);
  const dirty = FIELDS.some(({ key }) => f[key] !== data[key]);
  const num = (v: string) => (v === '' ? NaN : Math.trunc(Number(v)));
  const onReset = () => confirmDialog({
    title: 'Khôi phục ngưỡng mặc định?',
    description: `Mọi ngưỡng trở về giá trị gốc (bị chặn ${data.defaults.blockedThreshold}, lỗi ${data.defaults.errorsThreshold} và > ${data.defaults.errorsPercent} %, ghi ${data.defaults.burstWritesThreshold}, chat ${data.defaults.chatSpamThreshold}, cửa sổ ${data.defaults.windowMinutes} phút, chống lặp ${data.defaults.cooldownMinutes} phút).`,
    confirmText: 'Khôi phục',
    onConfirm: () => reset.mutateAsync().then(() => { save.reset(); toast.success('Đã khôi phục mặc định'); }),
  });
  return (
    <Card data-testid="ai-alert-settings">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><ShieldAlert className="size-4 text-muted-foreground" />Ngưỡng cảnh báo trợ lý AI</CardTitle>
        <CardDescription>
          Mỗi {data.intervalMinutes} phút hệ thống đếm lệnh qua token AI của từng người trong cửa sổ thời gian; vượt ngưỡng → báo cho quản trị viên
          (Báo cáo → Trợ lý AI). Chỉ cảnh báo, không tự chặn bot. Cảnh báo bot gọi duyệt / từ chối đơn luôn bật. Lưu xong áp dụng ở lần quét kế tiếp.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          save.mutate(f, {
            onSuccess: () => toast.success('Đã lưu ngưỡng cảnh báo'),
            onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
          });
        }}>
          <div className="grid items-start gap-4 sm:grid-cols-2">
            {FIELDS.map(({ key, label, hint }) => {
              const r = data.ranges[key];
              return (
                <FormField key={key} id={`ai-alert-${key}`} label={label} type="number" required min={r.min} max={r.max} step={1}
                  value={Number.isNaN(f[key]) ? '' : f[key]} onChange={(e) => setF((x) => ({ ...x, [key]: num(e.target.value) }))} error={errors[key]}
                  hint={`${hint} Từ ${r.min} đến ${r.max}, mặc định ${data.defaults[key]}.`} />
              );
            })}
          </div>
          <SettingsFormFooter saveDisabled={!dirty} saving={save.isPending} noteTestId="ai-alert-settings-updated"
            note={data.isDefault ? 'Đang dùng giá trị mặc định.' : `Sửa lần cuối ${data.updatedAt ? formatDateTime(data.updatedAt) : ''}${data.updatedByName ? ` bởi ${data.updatedByName}` : ''}.`}>
            <Button type="button" variant="outline" disabled={data.isDefault || save.isPending} loading={reset.isPending} loadingText="Đang xử lý…"
              onClick={onReset} data-testid="ai-alert-settings-reset">Khôi phục mặc định</Button>
          </SettingsFormFooter>
        </form>
      </CardContent>
    </Card>
  );
}
