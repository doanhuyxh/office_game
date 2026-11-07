import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { addDays, formatDate, formatDateTime, todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useReview, useReviews, useServices } from '../../hooks/useAssets';
import { DECISION, REVIEW_STATUS } from '../../utils/labels';

/** Tab Rà soát (HR): các đợt rà soát quyền truy cập dịch vụ. Quản lý chọn Giữ / Thu hồi; HR đóng đợt thì các ghế "Thu hồi" bị thu hồi. */
export function ReviewsTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useReviews();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">
        Mỗi đợt chụp mọi ghế đang dùng; quản lý trực tiếp của người giữ ghế (không có thì HR) chọn Giữ hoặc Thu hồi. Đóng đợt → ghế được chọn "Thu hồi" bị thu hồi. Chỉ mở được một đợt tại một thời điểm.
      </p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Đợt rà soát</TableHead><TableHead>Trạng thái</TableHead><TableHead>Hạn</TableHead><TableHead>Đã quyết</TableHead><TableHead className="hidden sm:table-cell">Thu hồi</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={5}><Spinner /></TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Chưa có đợt rà soát nào.</TableCell></TableRow>}
            {data.map((r) => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setOpenId(r.id)} data-testid="review-row">
                <TableCell><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground">Bắt đầu {formatDate(r.startedAt)}{r.startedByName ? ` · ${r.startedByName}` : ''}</div></TableCell>
                <TableCell><StatusBadge tone={REVIEW_STATUS[r.status].tone}>{REVIEW_STATUS[r.status].label}</StatusBadge></TableCell>
                <TableCell>{formatDate(r.dueDate)}</TableCell>
                <TableCell className="tabular-nums">{r.decided}/{r.total}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{r.toRevoke}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ReviewSheet id={openId} onClose={() => setOpenId(null)} />
      <StartReviewDialog open={creating} onClose={onCreatedClose} />
    </div>
  );
}

function StartReviewDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: services = [] } = useServices(open);
  const [title, setTitle] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const start = useAssetMutation(() => assetApi.startReview({ title: title.trim(), dueDate, serviceId }));
  useEffect(() => {
    if (!open) return;
    start.reset();
    const today = todayVn();
    const q = Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
    setTitle(`Rà soát quyền truy cập Quý ${q}/${today.slice(0, 4)}`);
    setDueDate(addDays(today, 14));
    setServiceId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = fieldErrors(start.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bắt đầu đợt rà soát</DialogTitle>
          <DialogDescription>Người rà soát nhận thông báo (chuông + email). Quá hạn mà còn mục chưa quyết sẽ được nhắc một lần.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          start.mutate(undefined, {
            onSuccess: (r) => { toast.success(`Đã chụp ${r.total} ghế để rà soát`); onClose(); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="rv-title" label="Tên đợt *" value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
          <FormField id="rv-due" label="Hạn quyết định *" type="date" value={dueDate} error={errors.dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <SelectField id="rv-service" label="Phạm vi" value={serviceId} onChange={setServiceId} allowEmpty emptyLabel="Mọi dịch vụ đang dùng"
            options={services.filter((s) => s.status === 'Active').map((s) => ({ value: s.id, label: s.name }))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={!title.trim() || !dueDate || start.isPending}>Bắt đầu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ReviewSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useReview(id);
  const [confirm, setConfirm] = useState(false);
  const decide = useAssetMutation((a: { id: string; decision: 'Keep' | 'Revoke' }) => assetApi.decide(a.id, a.decision, null));
  const close = useAssetMutation(() => assetApi.closeReview(id!));
  const r = data?.review;
  const open = r?.status === 'Open';
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" data-testid="review-sheet">
        {isLoading || !data || !r ? <div className="p-6"><Spinner /></div> : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">{r.title}<StatusBadge tone={REVIEW_STATUS[r.status].tone}>{REVIEW_STATUS[r.status].label}</StatusBadge></SheetTitle>
              <SheetDescription>Hạn {formatDate(r.dueDate)} · đã quyết {r.decided}/{r.total} · {r.toRevoke} ghế sẽ thu hồi{r.closedAt ? ` · đóng ${formatDateTime(r.closedAt)}` : ''}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6">
              {open && <Button className="justify-self-start" onClick={() => setConfirm(true)}>Đóng đợt &amp; thu hồi</Button>}
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Dịch vụ / tài khoản</TableHead><TableHead>Nhân viên</TableHead><TableHead className="hidden sm:table-cell">Người rà soát</TableHead><TableHead>Quyết định</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.items.map((i) => (
                      <TableRow key={i.id} data-testid="review-item">
                        <TableCell><div className="font-medium">{i.serviceName}</div><div className="text-xs text-muted-foreground">{i.accountLogin}</div></TableCell>
                        <TableCell>{i.employeeName} <span className="text-xs text-muted-foreground">({i.employeeCode})</span></TableCell>
                        <TableCell className="hidden sm:table-cell">{i.reviewerName ?? 'HR'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge tone={DECISION[i.decision].tone}>{DECISION[i.decision].label}</StatusBadge>
                            {open && (
                              <>
                                <Button size="sm" variant="outline" disabled={decide.isPending || i.decision === 'Keep'}
                                  onClick={() => decide.mutate({ id: i.id, decision: 'Keep' }, { onError: (x) => toast.error(errorMessage(x)) })}>Giữ</Button>
                                <Button size="sm" variant="outline" disabled={decide.isPending || i.decision === 'Revoke'}
                                  onClick={() => decide.mutate({ id: i.id, decision: 'Revoke' }, { onError: (x) => toast.error(errorMessage(x)) })}>Thu hồi</Button>
                              </>
                            )}
                          </div>
                          {i.decidedByName && <div className="text-xs text-muted-foreground">{i.decidedByName}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <AlertDialog open={confirm} onOpenChange={setConfirm}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Đóng đợt rà soát?</AlertDialogTitle>
                  <AlertDialogDescription>{r.toRevoke} ghế được chọn "Thu hồi" sẽ bị thu hồi ngay và người giữ nhận thông báo. Mục chưa quyết coi như giữ.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Không</AlertDialogCancel>
                  <AlertDialogAction onClick={() => close.mutate(undefined, { onSuccess: () => toast.success('Đã đóng đợt rà soát'), onError: (x) => toast.error(errorMessage(x)) })}>Đóng đợt</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
