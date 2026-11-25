import { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { BookOpen, Copy, FileStack, History, KeyRound, Link2, Link2Off, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { PickerInput } from '@/components/common/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/common/tooltip';
import { cn } from '@/utils/cn';
import { addDays, formatDateTime, todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { wikiShareApi, wikiShareUrl } from '../../api/wiki-share.api';
import { useWikiShareMutation, useWikiShares } from '../../hooks/useWikiShare';
import type { IWikiShare, IWikiShareCreate, IWikiShareCreated, WikiShareScope, WikiShareStatus } from '../../types/wiki-share.types';
import { selectionPayload, subtreeOf } from '../../utils/wiki-share-selection';
import { flattenWikiTree, type IWikiNode } from '../../utils/wiki-tree';
import { WikiSharePagePicker } from '../wiki-share-page-picker';
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

const SCOPES: { key: WikiShareScope; label: string; hint: string; icon: typeof BookOpen }[] = [
  { key: 'all', label: 'Toàn bộ sổ tay', hint: 'Mọi trang, kể cả trang tạo sau', icon: BookOpen },
  { key: 'pages', label: 'Chọn trang', hint: 'Một hoặc nhiều trang, ở nhánh nào cũng được', icon: FileStack },
];

/** Nhãn phạm vi trong danh sách: "Toàn bộ sổ tay" / "N trang". */
const scopeLabel = (s: Pick<IWikiShare, 'scope' | 'pageCount'>) => (s.scope === 'all' ? 'Toàn bộ sổ tay' : `${s.pageCount} trang`);

/**
 * "Chia sẻ" sổ tay cho khách (TEST-229 / TEST-230, API TEST-228 / TEST-230) — chỉ quản lý dự án / HR (nút hiện theo `canManage`; server vẫn kiểm).
 * Mở từ thanh công cụ tab Sổ tay (`pageId` null → mọi link của dự án) hoặc từ một trang (phạm vi "Chọn trang" tích sẵn trang đó + cây con, danh sách lọc theo trang).
 * Form: phạm vi Toàn bộ sổ tay / Chọn trang (cây có ô tích, tìm theo tiêu đề, "Đã chọn N trang"), người nhận, nhãn, hạn 1 / 7 / 30 ngày hoặc chọn ngày (≤ 90 ngày),
 * mật khẩu tuỳ chọn → tạo xong hiện URL `/s/{token}` + sao chép + QR (token chỉ hiện MỘT lần). Dưới là danh sách link: phạm vi (rê chuột xem tên trang),
 * người nhận, hạn, mật khẩu, lượt xem, lần xem cuối, Thu hồi (xác nhận), Nhật ký xem.
 */
export function WikiShareDialog({ projectId, tree, pageId, open, onClose }: {
  projectId: string; tree: IWikiNode[];
  /** Mở từ một trang → tích sẵn trang đó (kèm cây con) + lọc danh sách link theo trang; null = từ thanh công cụ sổ tay. */
  pageId: string | null; open: boolean; onClose: () => void;
}) {
  const flat = useMemo(() => flattenWikiTree(tree), [tree]);
  const pageNode = pageId ? flat.find((n) => n.page.id === pageId) : undefined;
  const initialSelection = () => new Set(pageNode ? subtreeOf(pageNode) : pageId ? [pageId] : []);
  const [scope, setScope] = useState<WikiShareScope>(pageId ? 'pages' : 'all');
  const [selected, setSelected] = useState<Set<string>>(initialSelection);
  const [filterPage, setFilterPage] = useState<string | null>(pageId);
  const [recipient, setRecipient] = useState('');
  const [label, setLabel] = useState('');
  const [lifetime, setLifetime] = useState<Lifetime>('7');
  const [expiresOn, setExpiresOn] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<IWikiShareCreated | null>(null);
  const [viewsOf, setViewsOf] = useState<IWikiShare | null>(null);
  const links = useWikiShares(projectId, filterPage, open);
  const create = useWikiShareMutation(projectId, (b: IWikiShareCreate) => wikiShareApi.create(projectId, b));
  const revoke = useWikiShareMutation(projectId, (id: string) => wikiShareApi.revoke(projectId, id));

  /** Form trống (mở hộp thoại / "Tạo link khác") — không mang người nhận, nhãn, mật khẩu của link trước sang link sau. */
  const resetForm = () => {
    setCreated(null); setScope(pageId ? 'pages' : 'all'); setSelected(initialSelection()); setRecipient(''); setLabel(''); setLifetime('7'); setExpiresOn('');
    setPassword(''); setErrors({}); create.reset();
  };
  useEffect(() => {
    if (open) { resetForm(); setFilterPage(pageId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pageId]);
  const filterTitle = filterPage ? flat.find((n) => n.page.id === filterPage)?.page.title : undefined;

  const today = todayVn();
  const url = created ? wikiShareUrl(created.token) : '';
  const copy = () => navigator.clipboard.writeText(url).then(() => toast.success('Đã sao chép link'), () => toast.error('Không sao chép được — chọn và sao chép tay'));

  const submit = () => {
    const pages = scope === 'pages' ? selectionPayload(tree, selected) : [];
    const errs: Record<string, string> = {};
    if (lifetime === 'custom' && !expiresOn) errs.expiresOn = 'Chọn ngày hết hạn';
    if (scope === 'pages' && pages.length === 0) errs.pages = 'Chọn ít nhất một trang để chia sẻ';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    create.mutate({
      scope, pages,
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
          <DialogTitle className="wrap-anywhere">Chia sẻ sổ tay</DialogTitle>
          <DialogDescription>Khách mở link xem được các trang (luôn là bản mới nhất) mà không cần tài khoản. Bạn nhận chuông khi link được mở lần đầu / từ thiết bị mới.</DialogDescription>
        </DialogHeader>

        {!created ? (
          <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); submit(); }} data-testid="wiki-share-form">
            <div className="grid gap-1.5">
              <span className="text-sm font-medium">Phạm vi chia sẻ</span>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Phạm vi chia sẻ">
                {SCOPES.map((o) => (
                  <button key={o.key} type="button" role="radio" aria-checked={scope === o.key} data-testid={`wiki-share-scope-${o.key}`}
                    className={cn('flex items-start gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                      scope === o.key && 'border-primary bg-primary/10')}
                    onClick={() => { setScope(o.key); setErrors((e) => ({ ...e, pages: '', scope: '' })); }}>
                    <o.icon className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground', scope === o.key && 'text-primary')} />
                    <span className="grid">
                      <span className={cn('font-medium', scope === o.key && 'text-primary')}>{o.label}</span>
                      <span className="text-xs text-muted-foreground">{o.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              {scope === 'pages' && <WikiSharePagePicker tree={tree} selected={selected} invalid={!!errors.pages}
                onChange={(next) => { setSelected(next); if (errors.pages) setErrors((e) => ({ ...e, pages: '' })); }} />}
              {scope === 'pages' && <p className="text-xs text-muted-foreground">Tích trang cha = kèm cả trang con (trang con thêm sau cũng tự hiện). Trang bị xoá tự ẩn.</p>}
              {(errors.pages || errors.pageId || errors.scope) && <p className="text-xs text-destructive" data-testid="wiki-share-pages-error">{errors.pages || errors.pageId || errors.scope}</p>}
            </div>
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
            <div className="grid gap-1.5">
              <Label htmlFor="wiki-share-password">Mật khẩu <span className="font-normal text-muted-foreground">(tuỳ chọn, 4–100 ký tự)</span></Label>
              <Input id="wiki-share-password" type="password" autoComplete="new-password" value={password} maxLength={100} onChange={(e) => setPassword(e.target.value)}
                aria-invalid={!!errors.password} data-testid="wiki-share-password" />
              {errors.password && <p className="text-xs text-destructive">{errors.password}</p>}
            </div>
            <Button type="submit" data-testid="wiki-share-create" loading={create.isPending} loadingText="Đang tạo…"><Link2 /> Tạo link chia sẻ</Button>
          </form>
        ) : (
          <div className="grid justify-items-center gap-3" data-testid="wiki-share-created">
            <p className="w-full rounded-md bg-warning/15 px-3 py-2 text-sm text-warning">Link chỉ hiện <b>một lần</b> — sao chép hoặc quét mã QR ngay. Đóng hộp thoại là không xem lại được.</p>
            <div className="rounded-lg bg-white p-3" data-testid="wiki-share-qr">
              <QRCodeSVG value={url} size={176} marginSize={0} title="Mã QR link chia sẻ sổ tay" />
            </div>
            <div className="flex w-full gap-1">
              <Input readOnly value={url} aria-label="Link chia sẻ" data-testid="wiki-share-url" onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" aria-label="Sao chép link" title="Sao chép link" onClick={copy} data-testid="wiki-share-copy"><Copy /></Button>
            </div>
            <p className="text-center text-xs text-muted-foreground">
              Hết hạn lúc {formatDateTime(created.expiresAt)} · {scopeLabel(created.share)}{created.share.hasPassword && ' · cần mật khẩu (gửi riêng cho người nhận)'}.
            </p>
            <Button type="button" variant="outline" onClick={resetForm}><Plus /> Tạo link khác</Button>
          </div>
        )}

        <div className="grid gap-1.5 border-t pt-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-medium" data-testid="wiki-share-list-title">
              {filterPage ? <>Link có trang <span className="wrap-anywhere">“{filterTitle ?? 'này'}”</span></> : 'Mọi link của dự án'}{list.length > 0 && ` (${list.length})`}
            </span>
            {pageId && <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setFilterPage((f) => (f ? null : pageId))}
              data-testid="wiki-share-list-filter">{filterPage ? 'Xem mọi link' : 'Chỉ link có trang này'}</Button>}
          </div>
          {links.isPending ? <p className="text-xs text-muted-foreground">Đang tải…</p>
            : links.isError ? <p className="text-xs text-destructive">{errorMessage(links.error, 'Không tải được danh sách link')}</p>
              : list.length === 0 ? <p className="text-xs text-muted-foreground">Chưa có link nào.</p>
                : (
                  <TooltipProvider delayDuration={200}>
                  <ul className="grid gap-1.5" data-testid="wiki-share-list">
                    {list.map((s) => {
                      const st = STATUS[s.status] ?? STATUS.gone;
                      return (
                        <li key={s.id} className="grid gap-1 rounded-md border px-2.5 py-2 text-xs" data-testid="wiki-share-item" data-status={s.status}>
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 truncate text-sm font-medium">{s.recipientName ?? s.label ?? 'Không ghi người nhận'}</span>
                            <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', st.className)} data-testid="wiki-share-status">{st.label}</span>
                            {s.hasPassword && <span className="inline-flex items-center gap-0.5 text-muted-foreground" title="Có mật khẩu"><KeyRound className="size-3" /> Mật khẩu</span>}
                            <ScopeBadge s={s} />
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
                  </TooltipProvider>
                )}
        </div>
        <WikiShareViewsDialog projectId={projectId} share={viewsOf} onClose={() => setViewsOf(null)} />
      </DialogContent>
    </Dialog>
  );
}

/** Cột "Phạm vi" của một link: "Toàn bộ sổ tay" / "N trang" — rê chuột (hoặc focus) xem tên các trang được chọn. */
function ScopeBadge({ s }: { s: IWikiShare }) {
  const badge = (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground" data-testid="wiki-share-scope" data-scope={s.scope}>
      {s.scope === 'all' ? <BookOpen className="size-3" /> : <FileStack className="size-3" />} {scopeLabel(s)}
    </span>
  );
  if (s.scope === 'all' || s.pages.length === 0) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className="rounded focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none" aria-label={`Phạm vi: ${scopeLabel(s)}`}>{badge}</button></TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72" data-testid="wiki-share-scope-pages">
        <ul className="grid gap-0.5">
          {s.pages.map((p) => (
            <li key={p.id} className={cn('wrap-anywhere', p.deleted && 'line-through opacity-70')}>
              {p.title}{p.includeChildren && ' (kèm trang con)'}
            </li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  );
}
