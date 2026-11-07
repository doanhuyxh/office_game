import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Label } from '@/components/common/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate, formatDateTime, todayVn } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useStocktake, useStocktakes } from '../../hooks/useAssets';
import { CHECK_RESULT, REVIEW_STATUS } from '../../utils/labels';

/** Tab Kiểm kê (HR): các đợt kiểm kê thiết bị. Đánh dấu từng thiết bị Có / Không thấy, đóng đợt (tuỳ chọn chuyển "Không thấy" thành Mất). */
export function StocktakesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useStocktakes();
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3">
      <p className="text-sm text-muted-foreground">Mỗi đợt chụp mọi thiết bị trong kho / đang dùng / bảo trì. Chỉ mở được một đợt tại một thời điểm.</p>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Đợt kiểm kê</TableHead><TableHead>Trạng thái</TableHead><TableHead>Đã kiểm</TableHead><TableHead className="hidden sm:table-cell">Không thấy</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={4}><Spinner /></TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Chưa có đợt kiểm kê nào.</TableCell></TableRow>}
            {data.map((s) => (
              <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)} data-testid="stocktake-row">
                <TableCell><div className="font-medium">{s.title}</div><div className="text-xs text-muted-foreground">Bắt đầu {formatDate(s.startedAt)}{s.startedByName ? ` · ${s.startedByName}` : ''}</div></TableCell>
                <TableCell><StatusBadge tone={REVIEW_STATUS[s.status].tone}>{REVIEW_STATUS[s.status].label}</StatusBadge></TableCell>
                <TableCell className="tabular-nums">{s.checked}/{s.total}</TableCell>
                <TableCell className="hidden tabular-nums sm:table-cell">{s.missing}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <StocktakeSheet id={openId} onClose={() => setOpenId(null)} />
      <StartDialog open={creating} onClose={onCreatedClose} />
    </div>
  );
}

function StartDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [title, setTitle] = useState('');
  const start = useAssetMutation(() => assetApi.startStocktake(title.trim()));
  useEffect(() => {
    if (!open) return;
    start.reset();
    const t = todayVn();
    setTitle(`Kiểm kê thiết bị ${t.slice(5, 7)}/${t.slice(0, 4)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const errors = fieldErrors(start.error);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bắt đầu kiểm kê</DialogTitle>
          <DialogDescription>Hệ thống chụp danh sách thiết bị hiện tại (không gồm đã thanh lý / mất) để đối chiếu.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={(e) => {
          e.preventDefault();
          start.mutate(undefined, {
            onSuccess: (s) => { toast.success(`Đã chụp ${s.total} thiết bị để kiểm kê`); onClose(); },
            onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
          });
        }}>
          <FormField id="sk-title" label="Tên đợt *" value={title} error={errors.title} onChange={(e) => setTitle(e.target.value)} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={!title.trim() || start.isPending}>Bắt đầu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StocktakeSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data, isLoading } = useStocktake(id);
  const [closing, setClosing] = useState(false);
  const [markLost, setMarkLost] = useState(false);
  const check = useAssetMutation((a: { id: string; result: 'Found' | 'Missing' }) => assetApi.checkItem(a.id, a.result, null));
  const close = useAssetMutation(() => assetApi.closeStocktake(id!, markLost));
  const s = data?.stocktake;
  const open = s?.status === 'Open';
  const pending = data ? data.items.filter((i) => i.result === 'Pending').length : 0;
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-3xl" data-testid="stocktake-sheet">
        {isLoading || !data || !s ? <div className="p-6"><Spinner /></div> : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">{s.title}<StatusBadge tone={REVIEW_STATUS[s.status].tone}>{REVIEW_STATUS[s.status].label}</StatusBadge></SheetTitle>
              <SheetDescription>Đã kiểm {s.checked}/{s.total} · không thấy {s.missing}{s.closedAt ? ` · đóng ${formatDateTime(s.closedAt)}` : ''}</SheetDescription>
            </SheetHeader>
            <div className="grid gap-4 px-4 pb-6">
              {open && <Button className="justify-self-start" onClick={() => { setMarkLost(false); setClosing(true); }}>Đóng đợt kiểm kê</Button>}
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Thiết bị</TableHead><TableHead className="hidden sm:table-cell">Người giữ</TableHead><TableHead>Kết quả</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {data.items.map((i) => (
                      <TableRow key={i.id} data-testid="stocktake-item">
                        <TableCell><div className="font-medium">{i.deviceName}</div><div className="text-xs text-muted-foreground">{i.deviceCode}{i.serialNumber ? ` · SN ${i.serialNumber}` : ''}</div></TableCell>
                        <TableCell className="hidden sm:table-cell">{i.expectedHolderName ?? '—'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            <StatusBadge tone={CHECK_RESULT[i.result].tone}>{CHECK_RESULT[i.result].label}</StatusBadge>
                            {open && (
                              <>
                                <Button size="sm" variant="outline" disabled={check.isPending || i.result === 'Found'}
                                  onClick={() => check.mutate({ id: i.id, result: 'Found' }, { onError: (x) => toast.error(errorMessage(x)) })}>Có</Button>
                                <Button size="sm" variant="outline" disabled={check.isPending || i.result === 'Missing'}
                                  onClick={() => check.mutate({ id: i.id, result: 'Missing' }, { onError: (x) => toast.error(errorMessage(x)) })}>Không thấy</Button>
                              </>
                            )}
                          </div>
                          {i.checkedByName && <div className="text-xs text-muted-foreground">{i.checkedByName}</div>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <Dialog open={closing} onOpenChange={setClosing}>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Đóng đợt kiểm kê?</DialogTitle>
                  <DialogDescription>{pending > 0 ? `Còn ${pending} thiết bị chưa kiểm — sẽ coi như "Không thấy". ` : ''}Đợt đã đóng không sửa được.</DialogDescription>
                </DialogHeader>
                <div className="flex items-start gap-2">
                  <Checkbox id="sk-lost" checked={markLost} onCheckedChange={(c) => setMarkLost(c === true)} />
                  <Label htmlFor="sk-lost" className="leading-snug">Chuyển các thiết bị "Không thấy" sang trạng thái <b>Mất</b> (đóng giao nhận nếu đang có người giữ)</Label>
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setClosing(false)}>Huỷ</Button>
                  <Button disabled={close.isPending}
                    onClick={() => close.mutate(undefined, { onSuccess: () => { toast.success('Đã đóng đợt kiểm kê'); setClosing(false); }, onError: (x) => toast.error(errorMessage(x)) })}>Đóng đợt</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
