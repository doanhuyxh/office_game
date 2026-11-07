import { useState } from 'react';
import { Pencil, Plus, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { FormField } from '@/components/common/FormField';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/common/sheet';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { useEmployees } from '@/features/employees';
import { formatDate } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { assetApi } from '../../api/asset.api';
import { useAssetMutation, useSeats, useServices } from '../../hooks/useAssets';
import { employeeOptions, SERVICE_STATUS } from '../../utils/labels';
import { ServiceFormDialog } from '../service-form-dialog';

/** Ghế (tài khoản) của một dịch vụ: cấp / thu hồi, sửa dịch vụ, huỷ dịch vụ. */
export function SeatsSheet({ serviceId, onClose }: { serviceId: string | null; onClose: () => void }) {
  const { data: services = [] } = useServices();
  const service = services.find((s) => s.id === serviceId) ?? null;
  const seats = useSeats(serviceId);
  const employees = useEmployees();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [login, setLogin] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const grant = useAssetMutation(() => assetApi.grantSeat(serviceId!, { employeeId: employeeId!, accountLogin: login.trim(), role: role.trim() || null, note: null }));
  const revoke = useAssetMutation((id: string) => assetApi.revokeSeat(id));
  const cancel = useAssetMutation(() => assetApi.cancelService(serviceId!));
  const errors = fieldErrors(grant.error);
  const active = service?.status === 'Active';
  const rows = [...(seats.data ?? [])].sort((a, b) => Number(!!a.revokedAt) - Number(!!b.revokedAt));
  return (
    <Sheet open={!!serviceId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl" data-testid="seats-sheet">
        {!service ? <div className="p-6"><Spinner /></div> : (
          <>
            <SheetHeader>
              <SheetTitle className="flex flex-wrap items-center gap-2">{service.name}<StatusBadge tone={SERVICE_STATUS[service.status].tone}>{SERVICE_STATUS[service.status].label}</StatusBadge></SheetTitle>
              <SheetDescription>
                {[service.vendor, service.plan].filter(Boolean).join(' · ') || 'Dịch vụ'} · Ghế: {service.seatsUsed}{service.seatLimit != null ? `/${service.seatLimit}` : ''}
              </SheetDescription>
            </SheetHeader>
            <div className="grid gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil /> Sửa dịch vụ</Button>
                {active && <Button size="sm" variant="outline" onClick={() => setConfirmCancel(true)}><XCircle /> Huỷ dịch vụ</Button>}
              </div>
              {active && (
                <form className="grid gap-3 rounded-lg border p-3 sm:grid-cols-2" onSubmit={(e) => {
                  e.preventDefault();
                  grant.mutate(undefined, {
                    onSuccess: () => { toast.success('Đã cấp tài khoản'); setEmployeeId(null); setLogin(''); setRole(''); },
                    onError: (x) => !Object.keys(fieldErrors(x)).length && toast.error(errorMessage(x)),
                  });
                }}>
                  <h4 className="text-sm font-semibold sm:col-span-2">Cấp tài khoản (ghế)</h4>
                  <SearchSelectField id="st-emp" label="Nhân viên *" value={employeeId} onChange={setEmployeeId} options={employeeOptions(employees.data)} error={errors.employeeId} />
                  <FormField id="st-login" label="Tên đăng nhập / email *" value={login} error={errors.accountLogin} onChange={(e) => setLogin(e.target.value)} />
                  <FormField id="st-role" label="Vai trò trên dịch vụ" value={role} error={errors.role} onChange={(e) => setRole(e.target.value)} />
                  <div className="flex items-end"><Button type="submit" disabled={!employeeId || !login.trim() || grant.isPending}><Plus /> Cấp ghế</Button></div>
                </form>
              )}
              <div className="rounded-lg border">
                <Table>
                  <TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Tài khoản</TableHead><TableHead className="hidden sm:table-cell">Cấp</TableHead><TableHead /></TableRow></TableHeader>
                  <TableBody>
                    {seats.isLoading && <TableRow><TableCell colSpan={4}><Spinner /></TableCell></TableRow>}
                    {!seats.isLoading && rows.length === 0 && <TableRow><TableCell colSpan={4} className="py-4 text-center text-muted-foreground">Chưa cấp ghế nào.</TableCell></TableRow>}
                    {rows.map((s) => (
                      <TableRow key={s.id} className={s.revokedAt ? 'opacity-60' : undefined} data-testid="seat-row">
                        <TableCell>{s.employeeName} <span className="text-xs text-muted-foreground">({s.employeeCode})</span></TableCell>
                        <TableCell>{s.accountLogin}{s.role ? <div className="text-xs text-muted-foreground">{s.role}</div> : null}</TableCell>
                        <TableCell className="hidden text-xs sm:table-cell">
                          {formatDate(s.grantedAt)}{s.revokedAt ? <div className="text-destructive">Thu hồi {formatDate(s.revokedAt)}</div> : null}
                        </TableCell>
                        <TableCell className="text-right">
                          {!s.revokedAt && (
                            <Button size="sm" variant="outline" disabled={revoke.isPending}
                              onClick={() => revoke.mutate(s.id, { onSuccess: () => toast.success('Đã thu hồi ghế'), onError: (x) => toast.error(errorMessage(x)) })}>Thu hồi</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            <ServiceFormDialog open={editing} onOpenChange={setEditing} service={service} />
            <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Huỷ dịch vụ {service.name}?</AlertDialogTitle>
                  <AlertDialogDescription>Mọi ghế đang dùng sẽ bị thu hồi và người giữ nhận thông báo. Không hoàn tác được.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Không</AlertDialogCancel>
                  <AlertDialogAction onClick={() => cancel.mutate(undefined, { onSuccess: () => toast.success('Đã huỷ dịch vụ'), onError: (x) => toast.error(errorMessage(x)) })}>Huỷ dịch vụ</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
