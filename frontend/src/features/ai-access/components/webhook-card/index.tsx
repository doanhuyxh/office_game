import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { StatusBadge, type StatusTone } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { accessTokenApi, accessTokenKeys } from '../../api/accessToken.api';
import { useWebhook } from '../../hooks/useAccessTokens';
import { CopyBlock } from '../copy-block';

const STATUS: Record<string, { label: string; tone: StatusTone }> = {
  Pending: { label: 'Đang gửi', tone: 'info' },
  Sent: { label: 'Đã gửi', tone: 'success' },
  Failed: { label: 'Lỗi', tone: 'danger' },
};
const EVENT: Record<string, string> = { notification: 'Thông báo', 'chat.message': 'Tin nhắn 1-1', ping: 'Gửi thử' };

/**
 * Webhook cá nhân ("đánh thức agent"): có thông báo mới hoặc tin nhắn 1-1 → OfficeHub POST JSON tới URL này, ký HMAC-SHA256.
 * Khoá ký chỉ hiện một lần lúc tạo / đổi khoá. Dùng cho tài khoản bot để agent khỏi phải hỏi định kỳ.
 */
export function WebhookCard() {
  const qc = useQueryClient();
  const { data, isLoading } = useWebhook();
  const [url, setUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [secret, setSecret] = useState<string | null>(null);
  useEffect(() => {
    if (data) { setUrl(data.url ?? ''); setEnabled(data.configured ? data.enabled : true); }
  }, [data]);

  const refresh = () => qc.invalidateQueries({ queryKey: accessTokenKeys.webhook });
  const onError = (e: unknown) => toast.error(errorMessage(e));
  const save = useMutation({
    mutationFn: () => accessTokenApi.saveWebhook({ url: url.trim(), enabled }),
    onSuccess: (r) => { if (r.secret) setSecret(r.secret); toast.success('Đã lưu webhook'); void refresh(); }, onError,
  });
  const rotate = useMutation({ mutationFn: accessTokenApi.rotateWebhook, onSuccess: (r) => { setSecret(r.secret); void refresh(); }, onError });
  const test = useMutation({ mutationFn: accessTokenApi.testWebhook, onSuccess: () => { toast.success('Đã xếp lần gửi thử'); void refresh(); }, onError });
  const remove = useMutation({
    mutationFn: accessTokenApi.deleteWebhook,
    onSuccess: () => { setSecret(null); setUrl(''); toast.success('Đã xoá webhook'); void refresh(); }, onError,
  });

  return (
    <Card data-testid="webhook-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base"><Webhook className="size-4" /> Webhook (đánh thức agent)</CardTitle>
        <CardDescription>
          Có thông báo mới (giao việc, bình luận, @nhắc, duyệt…) hoặc tin nhắn 1-1 tới tài khoản này → OfficeHub gửi ngay một yêu cầu POST tới URL của agent,
          agent khỏi phải hỏi định kỳ. Dành cho tài khoản bot; URL phải là https công khai.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {isLoading ? <Spinner /> : (
          <>
            <div className="grid gap-2">
              <Label htmlFor="webhook-url">URL nhận sự kiện</Label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input id="webhook-url" placeholder="https://agent.cong-ty.vn/officehub" value={url} onChange={(e) => setUrl(e.target.value)} />
                <Button onClick={() => save.mutate()} disabled={!url.trim() || save.isPending}>{data?.configured ? 'Lưu' : 'Tạo webhook'}</Button>
              </div>
              {data?.configured && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(v === true)} /> Đang bật (bấm Lưu để áp dụng)
                </label>
              )}
            </div>

            {secret && (
              <div className="grid gap-1.5 rounded-md border border-warning/40 bg-warning/5 p-3">
                <div className="text-sm font-medium">Khoá ký — chỉ hiện một lần, chép vào cấu hình agent</div>
                <CopyBlock value={secret} />
                <p className="text-xs text-muted-foreground">
                  Mỗi yêu cầu có header <code>X-OfficeHub-Signature: sha256=…</code> = HMAC-SHA256(khoá, <code>{'{X-OfficeHub-Timestamp}.{body}'}</code>).
                  Agent tính lại và so sánh để chắc yêu cầu đến từ OfficeHub; bỏ qua yêu cầu có timestamp lệch quá 5 phút.
                </p>
              </div>
            )}

            {data?.configured && (
              <>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  {!data.enabled && <StatusBadge tone="danger">Đang tắt{data.consecutiveFailures >= 20 ? ' (tự tắt vì lỗi liên tiếp)' : ''}</StatusBadge>}
                  {data.lastSuccessAt && <span className="text-muted-foreground">Gửi được lần cuối {formatDateTime(data.lastSuccessAt)}</span>}
                  {data.lastError && <span className="text-destructive">Lỗi gần nhất: {data.lastError}</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => test.mutate()} disabled={test.isPending || !data.enabled}><Send className="size-4" /> Gửi thử</Button>
                  <Button variant="outline" size="sm" onClick={() => rotate.mutate()} disabled={rotate.isPending}>Đổi khoá ký</Button>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => remove.mutate()} disabled={remove.isPending}>
                    <Trash2 className="size-4" /> Xoá webhook
                  </Button>
                </div>
                {data.recent.length > 0 && (
                  <ul className="divide-y rounded-md border text-sm" data-testid="webhook-recent">
                    {data.recent.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                        <StatusBadge tone={STATUS[d.status]?.tone ?? 'muted'}>{STATUS[d.status]?.label ?? d.status}</StatusBadge>
                        <span>{EVENT[d.event] ?? d.event}</span>
                        <span className="text-muted-foreground">{formatDateTime(d.createdAt)}</span>
                        {d.attempts > 1 && <span className="text-muted-foreground">· {d.attempts} lần thử</span>}
                        {d.error && <span className="text-destructive">· {d.error}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
