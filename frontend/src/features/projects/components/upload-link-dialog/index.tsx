import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Link2Off, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useProjectMutation, useUploadLinks } from '../../hooks/useProjects';
import type { IUploadLinkCreated } from '../../types/project.types';

/** Hạn chọn khi tạo link (phút) — khớp `UploadLinkRules.AllowedMinutes` ở back-end. */
const LIFETIMES = [
  { minutes: 15, label: '15 phút' },
  { minutes: 60, label: '1 giờ' },
  { minutes: 1440, label: '24 giờ' },
] as const;

const fmtTime = (iso: string) => new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/** URL trang công khai của link (route `/u/$token`). */
export const uploadLinkUrl = (token: string) => `${window.location.origin}/u/${token}`;

/**
 * "Tải từ thiết bị khác" (TEST-175): tạo link tải tệp hạn 15 phút / 1 giờ / 24 giờ (mặc định 1 giờ) cho việc → URL + mã QR + sao chép + thu hồi.
 * Mở link trên điện thoại (không cần đăng nhập) → chọn / kéo-thả tệp → gửi thành bình luận đứng tên tôi, nhãn "Qua link tải lên".
 * Token chỉ có lúc vừa tạo (server giữ hash) — đóng hộp thoại thì link vẫn chạy, danh sách bên dưới chỉ còn hạn + số tệp + nút thu hồi.
 */
export function UploadLinkDialog({ taskId, taskCode, open, onClose }: { taskId: string; taskCode: string; open: boolean; onClose: () => void }) {
  const [minutes, setMinutes] = useState(60);
  const [created, setCreated] = useState<IUploadLinkCreated | null>(null);
  const links = useUploadLinks(taskId, open).data ?? [];
  const create = useProjectMutation((m: number) => projectApi.createUploadLink(taskId, m));
  const revoke = useProjectMutation(projectApi.revokeUploadLink);
  useEffect(() => { if (open) { setCreated(null); setMinutes(60); create.reset(); } /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [open]);

  const url = created ? uploadLinkUrl(created.token) : '';
  const copy = () => navigator.clipboard.writeText(url).then(() => toast.success('Đã sao chép link'), () => toast.error('Không sao chép được — chọn và sao chép tay'));
  const askRevoke = async (id: string) => {
    if (await confirmDialog({ title: 'Thu hồi link?', description: 'Thiết bị đang mở link sẽ không gửi được tệp nữa. Tệp đã gửi vẫn giữ trong bình luận.',
      confirmText: 'Thu hồi', destructive: true, onConfirm: () => revoke.mutateAsync(id) })) {
      if (created?.id === id) setCreated(null);
      toast.success('Đã thu hồi link');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-md" data-testid="upload-link-dialog">
        <DialogHeader>
          <DialogTitle>Tải từ thiết bị khác · {taskCode}</DialogTitle>
          <DialogDescription>Mở link hoặc quét mã QR trên điện thoại / máy khác — không cần đăng nhập. Tệp gửi lên thành bình luận đứng tên bạn.</DialogDescription>
        </DialogHeader>
        {!created ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Hạn của link</span>
              <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Hạn của link">
                {LIFETIMES.map((l) => (
                  <button key={l.minutes} type="button" role="radio" aria-checked={minutes === l.minutes} data-testid={`upload-link-ttl-${l.minutes}`}
                    className={cn('rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted', minutes === l.minutes && 'border-primary bg-primary/10 font-medium text-primary')}
                    onClick={() => setMinutes(l.minutes)}>{l.label}</button>
                ))}
              </div>
            </div>
            <Button type="button" data-testid="upload-link-create" loading={create.isPending} loadingText="Đang tạo…"
              onClick={() => create.mutate(minutes, { onSuccess: setCreated, onError: (err) => toast.error(errorMessage(err, 'Không tạo được link')) })}>
              <QrCode /> Tạo link
            </Button>
          </div>
        ) : (
          <div className="grid justify-items-center gap-3" data-testid="upload-link-created">
            <div className="rounded-lg bg-white p-3" data-testid="upload-link-qr">
              <QRCodeSVG value={url} size={192} marginSize={0} title={`Mã QR link tải lên ${taskCode}`} />
            </div>
            <div className="flex w-full gap-1">
              <Input readOnly value={url} aria-label="Link tải lên" data-testid="upload-link-url" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Sao chép link" title="Sao chép link" onClick={copy}><Copy /></Button>
            </div>
            <p className="text-xs text-muted-foreground">Hết hạn lúc {fmtTime(created.expiresAt)}. Ai có link đều gửi được tệp vào việc này cho tới lúc đó.</p>
            <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <Button type="button" variant="outline" onClick={() => setCreated(null)}>Tạo link khác</Button>
              <Button type="button" variant="destructive" data-testid="upload-link-revoke" loading={revoke.isPending && revoke.variables === created.id} disabled={revoke.isPending}
                onClick={() => askRevoke(created.id)}><Link2Off /> Thu hồi</Button>
            </div>
          </div>
        )}
        {links.filter((l) => l.id !== created?.id).length > 0 && (
          <div className="grid gap-1.5 border-t pt-3">
            <span className="text-sm font-medium">Link còn hạn khác của bạn</span>
            <ul className="grid gap-1" data-testid="upload-link-list">
              {links.filter((l) => l.id !== created?.id).map((l) => (
                <li key={l.id} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-xs">
                  <span className="min-w-0 flex-1">Tạo {fmtTime(l.createdAt)} · hết hạn {fmtTime(l.expiresAt)} · {l.fileCount} tệp</span>
                  <Button type="button" size="sm" variant="ghost" className="h-7 text-destructive" loading={revoke.isPending && revoke.variables === l.id} disabled={revoke.isPending}
                    onClick={() => askRevoke(l.id)}>Thu hồi</Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
