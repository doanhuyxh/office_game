import { useState } from 'react';
import { ExternalLink, KeyRound, Pause, Pencil, Play, RefreshCw, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Textarea } from '@/components/common/textarea';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { formatDate, formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useSocialAccount } from '../../hooks/useAssets';
import type { ISocialAccountDetail } from '../../types/asset.types';
import { employeeOptions, SOCIAL_STATUS, TOKEN_STATUS } from '../../utils/labels';
import { SocialAccountFormDialog } from '../social-account-form-dialog';
import { SocialTokenGuide } from '../social-token-guide';

/** Báo kết quả kiểm tra token sau khi lưu token / đồng bộ. */
const tokenToast = (d: ISocialAccountDetail) =>
  d.account.tokenStatus === 'Valid'
    ? toast.success(`Token hợp lệ · ${d.account.pageCount} trang`)
    : toast.error(`Facebook từ chối token: ${d.account.tokenError ?? 'không rõ lý do'}`);

/** Chi tiết Business Manager (HR): token, đồng bộ trang, bàn giao / thu hồi, ngừng dùng, lịch sử. */
export function SocialAccountSheet({ accountId, onClose }: { accountId: string | null; onClose: () => void }) {
  const { data, isLoading } = useSocialAccount(accountId);
  const employees = useEmployees();
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState('');
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const saveToken = useAssetMutation(() => assetApi.setSocialToken(accountId!, token.trim()));
  const sync = useAssetMutation(() => assetApi.syncSocial(accountId!));
  const assign = useAssetMutation(() => assetApi.assignSocial(accountId!, employeeId!, note.trim() || null));
  const giveBack = useAssetMutation(() => assetApi.returnSocial(accountId!, null));
  const setStatus = useAssetMutation((s: 'Active' | 'Disabled') => assetApi.setSocialStatus(accountId!, s));
  const tokenErrors = fieldErrors(saveToken.error);
  const assignErrors = fieldErrors(assign.error);
  const a = data?.account;
  const active = a?.status === 'Active';

  return (
    <Sheet open={!!accountId} onOpenChange={(o) => { if (!o) { setToken(''); setNote(''); setEmployeeId(null); onClose(); } }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="social-sheet">
        {isLoading || !data || !a ? <div className="p-6"><Spinner /></div> : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">
                {a.name}
                <StatusBadge tone={SOCIAL_STATUS[a.status].tone}>{SOCIAL_STATUS[a.status].label}</StatusBadge>
                <StatusBadge tone={TOKEN_STATUS[a.tokenStatus].tone}>{TOKEN_STATUS[a.tokenStatus].label}</StatusBadge>
              </SheetTitle>
              <SheetDescription>
                Facebook Business Manager{a.externalId ? ` · ID ${a.externalId}` : ''}{a.loginHint ? ` · ${a.loginHint}` : ''}
                {a.ownerDepartmentName ? ` · ${a.ownerDepartmentName}` : ''}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa</Button>
                {a.hasToken && (
                  <Button size="sm" variant="outline" disabled={sync.isPending}
                    onClick={() => sync.mutate(undefined, { onSuccess: tokenToast, onError: (x) => toast.error(errorMessage(x)) })}>
                    <RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> Đồng bộ trang
                  </Button>
                )}
                {active
                  ? <Button size="sm" variant="outline" onClick={async () => {
                    if (!(await confirmDialog({
                      title: `Ngừng dùng ${a.name}?`, destructive: true, confirmText: 'Ngừng dùng',
                      description: 'Không ai đăng bài lên các trang của BM này được nữa; mọi bài hẹn giờ chưa đăng sẽ bị huỷ. Có thể dùng lại sau.',
                    }))) return;
                    setStatus.mutate('Disabled', { onSuccess: () => toast.success('Đã ngừng dùng BM'), onError: (x) => toast.error(errorMessage(x)) });
                  }}><Pause /> Ngừng dùng</Button>
                  : <Button size="sm" variant="outline" disabled={setStatus.isPending}
                    onClick={() => setStatus.mutate('Active', { onSuccess: () => toast.success('Đã dùng lại BM'), onError: (x) => toast.error(errorMessage(x)) })}>
                    <Play /> Dùng lại</Button>}
              </div>
              {a.note && <p className="text-sm whitespace-pre-line text-muted-foreground">{a.note}</p>}

              {/* Token */}
              <section className="grid gap-3 rounded-lg border p-3">
                <h4 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="size-4" /> Token System User</h4>
                <dl className="grid gap-1 text-sm sm:grid-cols-[10rem_1fr]">
                  <dt className="text-muted-foreground">Trạng thái</dt>
                  <dd>{TOKEN_STATUS[a.tokenStatus].label}{a.tokenOwnerName ? ` · ${a.tokenOwnerName}` : ''}</dd>
                  {a.tokenCheckedAt && <><dt className="text-muted-foreground">Kiểm tra lúc</dt><dd>{formatDateTime(a.tokenCheckedAt)}</dd></>}
                  {a.tokenError && <><dt className="text-muted-foreground">Lỗi</dt><dd className="text-destructive">{a.tokenError}</dd></>}
                </dl>
                <form className="grid gap-2" autoComplete="off" onSubmit={(e) => {
                  e.preventDefault();
                  saveToken.mutate(undefined, {
                    onSuccess: (d) => { setToken(''); tokenToast(d); },
                    onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
                  });
                }}>
                  <Label htmlFor="sa-new-token">{a.hasToken ? 'Thay token' : 'Nhập token'}</Label>
                  <Textarea id="sa-new-token" rows={2} className="font-mono text-xs" spellCheck={false} value={token} aria-invalid={!!tokenErrors.token}
                    placeholder={a.hasToken ? 'Token đã lưu (mã hoá, không hiển thị lại). Dán token mới để thay.' : 'EAAG…'}
                    onChange={(e) => setToken(e.target.value)} />
                  {tokenErrors.token && <p className="text-xs text-destructive">{tokenErrors.token}</p>}
                  <div><Button type="submit" size="sm" disabled={!token.trim() || saveToken.isPending}>{saveToken.isPending ? 'Đang kiểm tra…' : 'Lưu và kiểm tra'}</Button></div>
                  <SocialTokenGuide />
                </form>
              </section>

              {/* Bàn giao */}
              <section className="grid gap-3 rounded-lg border p-3">
                <h4 className="text-sm font-semibold">Người giữ</h4>
                {a.holderEmployeeId ? (
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span><b>{a.holderName}</b> ({a.holderCode}) — được đăng bài lên các trang của BM.</span>
                    <Button size="sm" variant="outline" onClick={async () => {
                      if (!(await confirmDialog({
                        title: `Thu hồi ${a.name} từ ${a.holderName}?`, destructive: true, confirmText: 'Thu hồi',
                        description: 'Người này không đăng bài lên các trang của BM được nữa; bài hẹn giờ chưa đăng của họ sẽ bị huỷ.',
                      }))) return;
                      giveBack.mutate(undefined, { onSuccess: () => toast.success('Đã thu hồi BM'), onError: (x) => toast.error(errorMessage(x)) });
                    }}>Thu hồi</Button>
                  </div>
                ) : active ? (
                  <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => {
                    e.preventDefault();
                    assign.mutate(undefined, {
                      onSuccess: () => { toast.success('Đã bàn giao BM'); setEmployeeId(null); setNote(''); },
                      onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
                    });
                  }}>
                    <SearchSelectField id="sa-emp" label="Bàn giao cho *" value={employeeId} onChange={setEmployeeId} options={employeeOptions(employees.data)}
                      error={assignErrors.employeeId} />
                    <FormField id="sa-assign-note" label="Ghi chú" value={note} error={assignErrors.note} onChange={(e) => setNote(e.target.value)} />
                    <div className="sm:col-span-2"><Button type="submit" size="sm" disabled={!employeeId || assign.isPending}><UserPlus /> Bàn giao</Button></div>
                  </form>
                ) : <p className="text-sm text-muted-foreground">BM đã ngừng dùng.</p>}
              </section>

              {/* Trang */}
              <section className="grid gap-2">
                <h4 className="text-sm font-semibold">
                  Trang ({a.pageCount}){a.pagesSyncedAt ? <span className="ml-2 text-xs font-normal text-muted-foreground">đồng bộ {formatDateTime(a.pagesSyncedAt)}</span> : null}
                </h4>
                {data.pages.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {a.hasToken ? 'System User chưa được gán Fanpage nào trong BM.' : 'Nhập token để lấy danh sách trang.'}
                  </p>
                ) : (
                  <ul className="grid gap-2">
                    {data.pages.map((p) => (
                      <li key={p.id} className={`flex items-center gap-3 rounded-md border p-2 text-sm ${p.isActive ? '' : 'opacity-60'}`} data-testid="social-page">
                        {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="size-8 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                          : <div className="size-8 shrink-0 rounded-full bg-muted" />}
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-xs text-muted-foreground">{[p.category, `ID ${p.externalId}`].filter(Boolean).join(' · ')}</div>
                        </div>
                        {!p.isActive ? <StatusBadge tone="muted">Không còn trong BM</StatusBadge>
                          : !p.canPost ? <StatusBadge tone="warning">Thiếu quyền đăng</StatusBadge> : null}
                        {p.link && <a href={p.link} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground" aria-label="Mở trang"><ExternalLink className="size-4" /></a>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* Lịch sử */}
              {data.history.length > 0 && (
                <section className="grid gap-2">
                  <h4 className="text-sm font-semibold">Lịch sử bàn giao</h4>
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Nhận</TableHead><TableHead>Trả</TableHead></TableRow></TableHeader>
                      <TableBody>
                        {data.history.map((h) => (
                          <TableRow key={h.id}>
                            <TableCell>{h.employeeName} <span className="text-xs text-muted-foreground">({h.employeeCode})</span>
                              {h.assignNote ? <div className="text-xs text-muted-foreground">{h.assignNote}</div> : null}</TableCell>
                            <TableCell className="text-xs">{formatDate(h.assignedAt)}{h.assignedByName ? <div className="text-muted-foreground">{h.assignedByName}</div> : null}</TableCell>
                            <TableCell className="text-xs">{h.returnedAt ? <>{formatDate(h.returnedAt)}{h.returnNote ? <div className="text-muted-foreground">{h.returnNote}</div> : null}</> : '—'}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              )}
            </div>
            <SocialAccountFormDialog open={editing} onOpenChange={setEditing} account={a} />
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
