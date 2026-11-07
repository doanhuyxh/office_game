import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Badge } from '@/components/common/badge';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Label } from '@/components/common/label';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/date';
import {
  useDepartments, useEmployeesPage, useReactivateEmployee, useResendInvite, useResetAccountPassword, useResetTwoFactor, useResignEmployee,
} from '../../hooks/useOrg';
import { hasRole, useMe } from '@/features/auth';
import type { IEmployee } from '../../types/employee.types';
import { ROLE_LABEL, STATUS_LABEL, STATUS_VARIANT } from '../../utils/labels';
import { CreateAccountDialog, ResignDialog, RolesDialog, TempPasswordDialog } from '../account-dialogs';
import { EmployeeFormDialog } from '../employee-form-dialog';
import { departmentOptions } from '../../utils/orgTree';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { EmployeePrivateDialog } from '@/features/profile';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';

type DialogState =
  | { kind: 'form'; employee: IEmployee | null }
  | { kind: 'account' | 'roles' | 'resign' | 'private' | 'reset2fa'; employee: IEmployee }
  | { kind: 'temp'; userName: string; password: string }
  | null;

function AccountBadge({ e }: { e: IEmployee }) {
  if (!e.userId) return <Badge variant="outline" className="text-muted-foreground">Chưa có</Badge>;
  const a = e.account;
  if (!a) return <Badge variant="secondary">Có</Badge>;
  if (!a.isActive) return <Badge variant="outline">Đã khoá</Badge>;
  if (a.invitePending) return <Badge variant="secondary">Chờ nhận lời mời</Badge>;
  if (a.mustChangePassword) return <Badge variant="secondary">Mật khẩu tạm</Badge>;
  return <Badge>Hoạt động</Badge>;
}

/** Nút "Đặt lại 2FA": chỉ khi người đó đã bật; không cho chính mình; HR không thấy với tài khoản admin (BE vẫn chặn). */
function canResetTwoFactor(e: IEmployee, meId: string | undefined, isAdmin: boolean) {
  const a = e.account;
  return !!a?.twoFactorEnabled && e.userId !== meId && (isAdmin || !a.roles.includes('admin'));
}

export function EmployeeTable({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [includeResigned, setIncludeResigned] = useState(false);
  const debounced = useDebounce(search, 300);
  const filter = { search: debounced, departmentId: departmentId ?? undefined, includeResigned: canEdit && includeResigned };
  const pg = usePageState('employees', `${debounced}|${departmentId ?? ''}|${filter.includeResigned}`);
  const { data, isLoading } = useEmployeesPage(filter, pg.query);
  const employees = data?.items ?? [];
  // Trạng thái / ngày vào làm: BE chỉ trả cho HR, chính chủ và quản lý của người đó → không có dòng nào thì bỏ cả cột
  const showStatus = canEdit || employees.some((e) => e.status);
  const columnDefs = useMemo<ColumnDef[]>(() => [
    { id: 'code', label: 'Mã' }, { id: 'name', label: 'Họ tên', required: true }, { id: 'department', label: 'Phòng ban' },
    { id: 'position', label: 'Chức vụ · chức danh' }, { id: 'manager', label: 'Quản lý' },
    ...(showStatus ? [{ id: 'status', label: 'Trạng thái' }] : []), ...(canEdit ? [{ id: 'account', label: 'Tài khoản' }] : []),
  ], [showStatus, canEdit]);
  const cols = useColumns('employees', columnDefs);
  const v = cols.show;
  const { data: departments = [] } = useDepartments();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);

  const resign = useResignEmployee();
  const reactivate = useReactivateEmployee();
  const resend = useResendInvite();
  const resetPw = useResetAccountPassword();
  const reset2fa = useResetTwoFactor();
  const { data: me } = useMe();
  const isAdmin = hasRole(me, 'admin');

  const onError = (err: unknown) => toast.error(errorMessage(err));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-60 flex-1">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Tìm theo tên, mã, email…" className="pl-8" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-56">
          <SelectField id="filter-dept" label="Phòng ban" allowEmpty emptyLabel="Tất cả phòng ban" value={departmentId} onChange={setDepartmentId}
            options={departmentOptions(departments)} />
        </div>
        {canEdit && (
          <Label className="h-9 font-normal">
            <Checkbox checked={includeResigned} onCheckedChange={(c) => setIncludeResigned(c === true)} />
            Hiện người đã nghỉ
          </Label>
        )}
        <div className="ms-auto flex items-center gap-2">
          <ColumnsMenu state={cols} />
          {canEdit && (
            <Button onClick={() => setDialog({ kind: 'form', employee: null })}>
              <Plus /> Thêm nhân viên
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {v('code') && <TableHead>Mã</TableHead>}
              <TableHead>Họ tên</TableHead>
              {v('department') && <TableHead>Phòng ban</TableHead>}
              {v('position') && <TableHead>Chức vụ · chức danh</TableHead>}
              {v('manager') && <TableHead>Quản lý</TableHead>}
              {showStatus && v('status') && <TableHead>Trạng thái</TableHead>}
              {canEdit && v('account') && <TableHead>Tài khoản</TableHead>}
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={cols.span(1)} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>
            )}
            {!isLoading && employees.length === 0 && (
              <TableRow><TableCell colSpan={cols.span(1)} className="py-8 text-center text-muted-foreground">
                {search || departmentId ? 'Không tìm thấy nhân viên phù hợp' : 'Chưa có nhân viên nào'}
              </TableCell></TableRow>
            )}
            {employees.map((e) => (
              <TableRow key={e.id} className={e.status === 'Resigned' ? 'opacity-60' : undefined}>
                {v('code') && <TableCell className="font-mono text-xs">{e.code}</TableCell>}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <PersonAvatar name={e.fullName} url={e.avatarUrl} className="size-8" fallbackClassName="text-xs" />
                    <div className="min-w-0">
                      <div className="font-medium">{e.fullName}</div>
                      <div className="text-xs text-muted-foreground">{[e.email, e.phone].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                </TableCell>
                {v('department') && <TableCell>{e.departmentName ?? '—'}</TableCell>}
                {v('position') && (
                  <TableCell>
                    <div>{e.positionName ?? '—'}</div>
                    {e.jobTitle && <div className="text-xs text-muted-foreground">{e.jobTitle}</div>}
                  </TableCell>
                )}
                {v('manager') && <TableCell>{e.managerName ?? '—'}</TableCell>}
                {showStatus && v('status') && (
                  <TableCell>
                    {e.status && <>
                      <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {e.status === 'Resigned' && e.leftAt ? `Nghỉ ${formatDate(e.leftAt)}` : e.joinedAt ? `Vào ${formatDate(e.joinedAt)}` : ''}
                      </div>
                    </>}
                  </TableCell>
                )}
                {canEdit && v('account') && (
                  <TableCell>
                    <AccountBadge e={e} />
                    {e.account && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {e.account.userName} · {e.account.roles.filter((r) => r !== 'employee').map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'Nhân viên'}
                        {e.account.twoFactorEnabled && ' · 2FA'}
                      </div>
                    )}
                  </TableCell>
                )}
                {canEdit && (
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Thao tác ${e.code}`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel>{e.code}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setDialog({ kind: 'form', employee: e })}>Sửa hồ sơ</DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDialog({ kind: 'private', employee: e })}>Thông tin cá nhân (CCCD, ngân hàng…)</DropdownMenuItem>
                        <DropdownMenuSeparator />
                        {!e.userId && e.status !== 'Resigned' && (
                          <DropdownMenuItem onClick={() => setDialog({ kind: 'account', employee: e })}>Cấp tài khoản</DropdownMenuItem>
                        )}
                        {e.account?.invitePending && (
                          <DropdownMenuItem onClick={() => resend.mutate(e.id, { onSuccess: () => toast.success(`Đã gửi lại lời mời tới ${e.email}`), onError })}>
                            Gửi lại lời mời
                          </DropdownMenuItem>
                        )}
                        {e.userId && e.status !== 'Resigned' && (
                          <>
                            <DropdownMenuItem onClick={() => setDialog({ kind: 'roles', employee: e })}>Đổi vai trò</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => resetPw.mutate(e.id, {
                              onSuccess: (r) => setDialog({ kind: 'temp', userName: e.account?.userName ?? e.code, password: r.tempPassword }), onError,
                            })}>
                              Cấp lại mật khẩu tạm
                            </DropdownMenuItem>
                            {canResetTwoFactor(e, me?.id, isAdmin) && (
                              <DropdownMenuItem onClick={() => setDialog({ kind: 'reset2fa', employee: e })}>Đặt lại 2FA</DropdownMenuItem>
                            )}
                          </>
                        )}
                        <DropdownMenuSeparator />
                        {e.status === 'Resigned' ? (
                          <DropdownMenuItem onClick={() => reactivate.mutate(e.id, { onSuccess: () => toast.success('Đã khôi phục'), onError })}>
                            Khôi phục (đi làm lại)
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem variant="destructive" onClick={() => setDialog({ kind: 'resign', employee: e })}>Nghỉ việc</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="nhân viên" />
      </div>

      <EmployeeFormDialog open={dialog?.kind === 'form'} onOpenChange={close} employee={dialog?.kind === 'form' ? dialog.employee : null} />
      <CreateAccountDialog open={dialog?.kind === 'account'} onOpenChange={close} employee={dialog?.kind === 'account' ? dialog.employee : null}
        onTempPassword={(userName, password) => setDialog({ kind: 'temp', userName, password })} />
      <EmployeePrivateDialog employeeId={dialog?.kind === 'private' ? dialog.employee.id : null} name={dialog?.kind === 'private' ? dialog.employee.fullName : ''} onClose={close} />
      <RolesDialog open={dialog?.kind === 'roles'} onOpenChange={close} employee={dialog?.kind === 'roles' ? dialog.employee : null} />
      <ResignDialog open={dialog?.kind === 'resign'} onOpenChange={close} employee={dialog?.kind === 'resign' ? dialog.employee : null}
        pending={resign.isPending}
        onConfirm={(leftAt) => dialog?.kind === 'resign' && resign.mutate({ id: dialog.employee.id, leftAt }, {
          onSuccess: () => { toast.success('Đã cho nghỉ việc và khoá tài khoản'); close(); }, onError,
        })} />
      <AlertDialog open={dialog?.kind === 'reset2fa'} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Đặt lại xác thực 2 lớp của {dialog?.kind === 'reset2fa' ? dialog.employee.fullName : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              Dùng khi nhân viên mất điện thoại. 2FA bị tắt, mọi phiên đăng nhập bị đăng xuất; nhân viên nhận email thông báo.
              Tài khoản admin / HR sẽ phải bật lại ở lần đăng nhập tới.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Huỷ</AlertDialogCancel>
            <AlertDialogAction disabled={reset2fa.isPending} onClick={() => dialog?.kind === 'reset2fa' && reset2fa.mutate(dialog.employee.id, {
              onSuccess: () => { toast.success('Đã đặt lại xác thực 2 lớp'); close(); }, onError,
            })}>Đặt lại</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {dialog?.kind === 'temp' && <TempPasswordDialog open onOpenChange={close} userName={dialog.userName} password={dialog.password} />}
    </div>
  );
}
