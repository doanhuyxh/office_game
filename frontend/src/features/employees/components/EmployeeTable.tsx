import { useState } from 'react';
import { MoreHorizontal, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
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
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { formatDate } from '@/utils/date';
import {
  useDepartments, useEmployees, useReactivateEmployee, useResendInvite, useResetAccountPassword, useResignEmployee,
} from '../hooks/useOrg';
import type { IEmployee } from '../types/employee.types';
import { ROLE_LABEL, STATUS_LABEL, STATUS_VARIANT } from '../utils/labels';
import { CreateAccountDialog, ResignDialog, RolesDialog, TempPasswordDialog } from './AccountDialogs';
import { EmployeeFormDialog } from './EmployeeFormDialog';
import { departmentOptions } from '../utils/orgTree';

type DialogState =
  | { kind: 'form'; employee: IEmployee | null }
  | { kind: 'account' | 'roles' | 'resign'; employee: IEmployee }
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

export function EmployeeTable({ canEdit }: { canEdit: boolean }) {
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  const [includeResigned, setIncludeResigned] = useState(false);
  const debounced = useDebounce(search, 300);
  const { data: employees = [], isLoading } = useEmployees({ search: debounced, departmentId: departmentId ?? undefined, includeResigned });
  const { data: departments = [] } = useDepartments();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);

  const resign = useResignEmployee();
  const reactivate = useReactivateEmployee();
  const resend = useResendInvite();
  const resetPw = useResetAccountPassword();

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
        <Label className="h-9 font-normal">
          <Checkbox checked={includeResigned} onCheckedChange={(c) => setIncludeResigned(c === true)} />
          Hiện người đã nghỉ
        </Label>
        {canEdit && (
          <Button onClick={() => setDialog({ kind: 'form', employee: null })}>
            <Plus /> Thêm nhân viên
          </Button>
        )}
      </div>

      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mã</TableHead>
              <TableHead>Họ tên</TableHead>
              <TableHead>Phòng ban</TableHead>
              <TableHead>Chức vụ · chức danh</TableHead>
              <TableHead>Quản lý</TableHead>
              <TableHead>Trạng thái</TableHead>
              {canEdit && <TableHead>Tài khoản</TableHead>}
              {canEdit && <TableHead className="w-10" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>
            )}
            {!isLoading && employees.length === 0 && (
              <TableRow><TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                {search || departmentId ? 'Không tìm thấy nhân viên phù hợp' : 'Chưa có nhân viên nào'}
              </TableCell></TableRow>
            )}
            {employees.map((e) => (
              <TableRow key={e.id} className={e.status === 'Resigned' ? 'opacity-60' : undefined}>
                <TableCell className="font-mono text-xs">{e.code}</TableCell>
                <TableCell>
                  <div className="font-medium">{e.fullName}</div>
                  <div className="text-xs text-muted-foreground">{e.email ?? e.phone ?? ''}</div>
                </TableCell>
                <TableCell>{e.departmentName ?? '—'}</TableCell>
                <TableCell>
                  <div>{e.positionName ?? '—'}</div>
                  {e.jobTitle && <div className="text-xs text-muted-foreground">{e.jobTitle}</div>}
                </TableCell>
                <TableCell>{e.managerName ?? '—'}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {e.status === 'Resigned' && e.leftAt ? `Nghỉ ${formatDate(e.leftAt)}` : `Vào ${formatDate(e.joinedAt)}`}
                  </div>
                </TableCell>
                {canEdit && (
                  <TableCell>
                    <AccountBadge e={e} />
                    {e.account && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        {e.account.userName} · {e.account.roles.filter((r) => r !== 'employee').map((r) => ROLE_LABEL[r] ?? r).join(', ') || 'Nhân viên'}
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
      </div>
      <p className="text-xs text-muted-foreground">{employees.length} nhân viên</p>

      <EmployeeFormDialog open={dialog?.kind === 'form'} onOpenChange={close} employee={dialog?.kind === 'form' ? dialog.employee : null} />
      <CreateAccountDialog open={dialog?.kind === 'account'} onOpenChange={close} employee={dialog?.kind === 'account' ? dialog.employee : null}
        onTempPassword={(userName, password) => setDialog({ kind: 'temp', userName, password })} />
      <RolesDialog open={dialog?.kind === 'roles'} onOpenChange={close} employee={dialog?.kind === 'roles' ? dialog.employee : null} />
      <ResignDialog open={dialog?.kind === 'resign'} onOpenChange={close} employee={dialog?.kind === 'resign' ? dialog.employee : null}
        pending={resign.isPending}
        onConfirm={(leftAt) => dialog?.kind === 'resign' && resign.mutate({ id: dialog.employee.id, leftAt }, {
          onSuccess: () => { toast.success('Đã cho nghỉ việc và khoá tài khoản'); close(); }, onError,
        })} />
      {dialog?.kind === 'temp' && <TempPasswordDialog open onOpenChange={close} userName={dialog.userName} password={dialog.password} />}
    </div>
  );
}
