import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, History, KeyRound, Link2, Link2Off, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { PickerInput } from '@/components/common/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { cn } from '@/utils/cn';
import { addDays, formatDateTime, todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { wikiShareApi, wikiShareUrl } from '../../api/wiki-share.api';
import { useWikiShareMutation, useWikiShares } from '../../hooks/useWikiShare';
import type { IWikiShare, IWikiShareCreate, IWikiShareCreated, WikiShareStatus } from '../../types/wiki-share.types';
import { WikiShareViewsDialog } from '../wiki-share-views-dialog';

/** Hạn chọn sẵn (ngày) — khớp `WikiShareRules.AllowedDays`; 'custom' = chọn ngày (hết hiệu lực cuối ngày đó, ≤ 90 ngày). */
const LIFETIMES = [
  { key: '1', label: '1 ngày' },
  { key: '7', label: '7 ngày' },
  { key: '30', label: '30 ngày' },
  { key: 'custom', label: 'Chọn ngày' },
] as const;
type Lifetime = (typeof LIFETIMES)[number]['key'];

const STATUS: Record<WikiShareStatus, { label: string; className: string }> = {
  active: { label: 'Còn hạn', className: 'bg-success/15 text-success' },
  expired: { label: 'Hết hạn', className: 'bg-muted text-muted-foreground' },
  revoked: { label: 'Đã thu hồi', className: 'bg-destructive/10 text-destructive' },
  gone: { label: 'Không còn hiệu lực', className: 'bg-muted text-muted-foreground' },
};

/**
 * "Chia sẻ" trang sổ tay cho khách (TEST-229, API TEST-228) — chỉ quản lý dự án / HR (nút hiện theo `page.canManage`; server vẫn kiểm).
 * Form: người nhận, nhãn, hạn 1 / 7 / 30 ngày hoặc chọn ngày (≤ 90 ngày), kèm trang con, mật khẩu tuỳ chọn → tạo xong hiện URL `/s/{token}` + sao chép + QR
 * (token chỉ hiện MỘT lần). Dưới là danh sách link của trang: người nhận, hạn, mật khẩu, lượt xem, lần xem cuối, Thu hồi (xác nhận), Nhật ký xem.
 */
export function WikiShareDialog({ projectId, pageId, pageTitle, hasChildren, open, onClose }: {
  projectId: string; pageId: string; pageTitle: string; hasChildren: boolean; open: boolean; onClose: () => void;
}) {
  const [recipient, setRecipient] = useState('');
  const [label, setLabel] = useState('');
  const [lifetime, setLifetime] = useState<Lifetime>('7');
  const [expiresOn, setExpiresOn] = useState('');
  const [children, setChildren] = useState(hasChildren);
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<IWikiShareCreated | null>(null);
  const [viewsOf, setViewsOf] = useState<IWikiShare | null>(null);
  const links = useWikiShares(projectId, pageId, open);
  const create = useWikiShareMutation(projectId, (b: IWikiShareCreate) => wikiShareApi.create(projectId, b));
  const revoke = useWikiShareMutation(projectId, (id: string) => wikiShareApi.revoke(projectId, id));

  /** Form trống (mở hộp thoại / "Tạo link khác") — không mang người nhận, nhãn, mật khẩu của link trước sang link sau. */
  const resetForm = () => {
    setCreated(null); setRecipient(''); setLabel(''); setLifetime('7'); setExpiresOn(''); setChildren(hasChildren); setPassword(''); setErrors({}); create.reset();
  };
  useEffect(() => {
    if (open) resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);

  const today = todayVn();
  const url = created ? wikiShareUrl(created.token) : '';
  const copy = () => navigator.clipboard.writeText(url).then(() => toast.success('Đã sao chép link'), () => toast.error('Không sao chép được — chọn và sao chép tay'));

  const submit = () => {
    if (lifetime === 'custom' && !expiresOn) { setErrors({ expiresOn: 'Chọn ngày hết hạn' }); return; }
    setErrors({});
    create.mutate({
      pageId, includeChildren: hasChildren && children,
      days: lifetime === 'custom' ? null : Number(lifetime), expiresOn: lifetime === 'custom' ? expiresOn : null,
      label: label.trim() || null, recipientName: recipient.trim() || null, password: password || null,
    }, {
      onSuccess: (r) => { setCreated(r); setPassword(''); },
      onError: (err) => { const f = fieldErrors(err); if (Object.keys(f).length) setErrors(f); else toast.error(errorMessage(err, 'Không tạo được link')); },
    });
  };
  const askRevoke = async (s: IWikiShare) => {
    if (await confirmDialog({
      title: 'Thu hồi link chia sẻ?',
      description: `Người nhận${s.recipientName ? ` (${s.recipientName})` : ''} sẽ không mở được trang nữa. Không hoàn tác được — muốn chia sẻ lại thì tạo link mới.`,
      confirmText: 'Thu hồi', destructive: true, onConfirm: () => revoke.mutateAsync(s.id),
    })) {
      if (created?.id === s.id) setCreated(null);
      toast.success('Đã thu hồi link');
    }
  };

  const list = links.data ?? [];
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-xl" data-testid="wiki-share-dialog">
        <DialogHeader>
          <DialogTitle className="wrap-anywhere">Chia sẻ trang · {pageTitle}</DialogTitle>
          <DialogDescription>Khách mở link xem được trang (luôn là bản mới nhất) mà không cần tài khoản. Bạn nhận chuông khi link được mở lần đầu / từ thiết bị mới.</DialogDescription>
        </DialogHeader>

        {!created ? (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="wiki-share-form">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="wiki-share-recipient">Người nhận</Label>
                <Input id="wiki-share-recipient" value={recipient} maxLength={200} placeholder="vd Anh Minh — Công ty ABC" onChange={(e) => setRecipient(e.target.value)}
                  aria-invalid={!!errors.recipientName} data-testid="wiki-share-recipient" />
                {errors.recipientName && <p className="text-xs text-destructive">{errors.recipientName}</p>}
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="wiki-share-label">Nhãn <span className="font-normal text-muted-foreground">(tuỳ chọn)</span></Label>
                <Input id="wiki-share-label" value={label} maxLength={200} placeholder="vd Bản nháp đặc tả" onChange={(e) => setLabel(e.target.value)}
                  aria-invalid={!!errors.label} data-testid="wiki-share-label" />
                {errors.label && <p className="text-xs text-destructive">{errors.label}</p>}
              </div>
            </div>
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Hạn của link</span>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Hạn của link">
                {LIFETIMES.map((l) => (
                  <button key={l.key} type="button" role="radio" aria-checked={lifetime === l.key} data-testid={`wiki-share-ttl-${l.key}`}
                    className={cn('rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted', lifetime === l.key && 'border-primary bg-primary/10 font-medium text-primary')}
                    onClick={() => setLifetime(l.key)}>{l.label}</button>
                ))}
              </div>
              {lifetime === 'custom' && (
                <div className="grid gap-1" data-testid="wiki-share-expires-on">
                  <PickerInput kind="date" value={expiresOn} min={today} max={addDays(today, 89)} onChange={(e) => setExpiresOn(e.target.value)}
                    aria-label="Ngày hết hạn" aria-invalid={!!errors.expiresOn} />
                  <p className="text-xs text-muted-foreground">Link hết hiệu lực khi hết ngày đã chọn (giờ Việt Nam), tối đa 90 ngày.</p>
                </div>
              )}
              {(errors.expiresOn || errors.days) && <p className="text-xs text-destructive">{errors.expiresOn ?? errors.days}</p>}
            </div>
            {hasChildren && (
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={children} onCheckedChange={(v) => setChildren(v === true)} data-testid="wiki-share-children" className="mt-0.5" />
                <span>Kèm các trang con <span className="block text-xs text-muted-foreground">Trang con thêm sau cũng tự hiện; trang bị xoá tự ẩn.</span></span>
              </label>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="wiki-share-password">Mật khẩu <span className="font-normal text-muted-foreground">(tuỳ chọn, 4–100 ký tự)</span></Label>
              <Input id="wiki-share-password" type="password" autoComplete="new-password" value={password} maxLength={100} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password} data-testid="wiki-share-password" />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
              {errors.pageId && <p className="text-xs text-destructive">{errors.pageId}</p>}
            </div>
            <Button type="submit" data-testid="wiki-share-create" loading={create.isPending} loadingText="Đang tạo…"><Link2 /> Tạo link chia sẻ</Button>
          </form>
        ) : (
          <div className="grid justify-items-center gap-3" data-testid="wiki-share-created">
            <p className="w-full rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">Link chỉ hiện <b>một lần</b> — sao chép hoặc quét mã QR ngay. Đóng hộp thoại là không xem lại được.</p>
            <div className="rounded-lg bg-white p-3" data-testid="wiki-share-qr">
              <QRCodeSVG value={url} size={176} marginSize={0} title={`Mã QR link chia sẻ ${pageTitle}`} />
            </div>
            <div className="flex w-full gap-1">
              <Input readOnly value={url} aria-label="Link chia sẻ" data-testid="wiki-share-url" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Sao chép link" title="Sao chép link" onClick={copy} data-testid="wiki-share-copy"><Copy /></Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Hết hạn lúc {formatDateTime(created.expiresAt)}{created.share.hasPassword && ' · cần mật khẩu (gửi riêng cho người nhận)'}{created.share.includeChildren && ' · kèm trang con'}.
            </p>
            <Button type="button" variant="outline" onClick={resetForm}><Plus /> Tạo link khác</Button>
          </div>
        )}

        <div className="grid gap-1.5 border-t pt-3">
          <span className="text-sm font-medium">Link của trang này{list.length > 0 && ` (${list.length})`}</span>
          {links.isPending ? <p className="text-xs text-muted-foreground">Đang tải…</p>
            : links.isError ? <p className="text-xs text-destructive">{errorMessage(links.error, 'Không tải được danh sách link')}</p>
              : list.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có link nào.</p>
                : (
                  <ul className="grid gap-1.5" data-testid="wiki-share-list">
                    {list.map((s) => {
                      const st = STATUS[s.status] ?? STATUS.gone;
                      return (
                        <li key={s.id} className="grid gap-1 rounded-md border px-2.5 py-2 text-xs" data-testid="wiki-share-item" data-status={s.status}>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 truncate text-sm font-medium">{s.recipientName ?? s.label ?? 'Không ghi người nhận'}</span>
                            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', st.className)} data-testid="wiki-share-status">{st.label}</span>
                            {s.hasPassword && <span className="inline-flex items-center gap-0.5 text-muted-foreground" title="Có mật khẩu"><KeyRound className="size-3" /> Mật khẩu</span>}
                            {s.includeChildren && <span className="text-muted-foreground">· kèm trang con</span>}
                          </div>
                          {s.recipientName && s.label && <span className="text-muted-foreground">{s.label}</span>}
                          <span className="text-muted-foreground">
                            {s.status === 'revoked' && s.revokedAt ? `Thu hồi ${formatDateTime(s.revokedAt)}${s.revokedByName ? ` bởi ${s.revokedByName}` : ''}` : `Hết hạn ${formatDateTime(s.expiresAt)}`}
                            {' · '}{s.viewCount} lượt xem{s.lastViewedAt && ` · xem cuối ${formatDateTime(s.lastViewedAt)}`}
                            {' · '}tạo bởi {s.createdByName}
                          </span>
                          <div className="flex flex-wrap justify-end gap-1">
                            <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => setViewsOf(s)} data-testid="wiki-share-views-open"><History /> Nhật ký xem</Button>
                            {s.status === 'active' && (
                              <Button type="button" size="sm" variant="ghost" className="h-7 text-destructive" loading={revoke.isPending && revoke.variables === s.id}
                                disabled={revoke.isPending} onClick={() => void askRevoke(s)} data-testid="wiki-share-revoke"><Link2Off /> Thu hồi</Button>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
        </div>
        <WikiShareViewsDialog projectId={projectId} share={viewsOf} onClose={() => setViewsOf(null)} />
      </DialogContent>
    </Dialog>
  );
}
