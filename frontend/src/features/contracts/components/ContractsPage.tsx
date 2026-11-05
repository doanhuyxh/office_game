import { useMemo, useState } from 'react';
import { AlertTriangle, MoreHorizontal, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Textarea } from '@/components/common/textarea';
import { PageHeader } from '@/components/layout/PageHeader';
import { hasRole, useMe } from '@/features/auth';
import { useEmployees } from '@/features/employees';
import { formatDate } from '@/utils/date';
import { cn } from '@/utils/cn';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useContracts, useDeleteContract, useMyContracts, useTerminateContract } from '../hooks/useContracts';
import type { IContract } from '../types/contract.types';
import { CONTRACT_TYPE, EXPIRING_DAYS, formatMoney } from '../utils/labels';
import { ContractDetails, ContractStatusBadge } from './ContractDetails';
import { ContractFormDialog } from './ContractFormDialog';

type Filter = 'all' | 'active' | 'expiring' | 'ended';
const FILTERS: { value: Filter; label: string; match: (c: IContract) => boolean }[] = [
  { value: 'all', label: 'Tất cả', match: () => true },
  { value: 'active', label: 'Đang hiệu lực', match: (c) => c.status === 'Active' || c.status === 'Upcoming' },
  { value: 'expiring', label: `Sắp hết hạn (≤ ${EXPIRING_DAYS} ngày)`, match: (c) => c.daysLeft != null && c.daysLeft <= EXPIRING_DAYS },
  { value: 'ended', label: 'Hết hạn / chấm dứt', match: (c) => c.status === 'Expired' || c.status === 'Terminated' },
];

function TerminateDialog({ contract, onClose }: { contract: IContract | null; onClose: () => void }) {
  const terminate = useTerminateContract();
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const errors = fieldErrors(terminate.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contract) return;
    terminate.mutate({ id: contract.id, terminatedOn: date, reason }, {
      onSuccess: () => { toast.success('Đã ghi nhận chấm dứt hợp đồng'); setDate(''); setReason(''); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={!!contract} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Chấm dứt hợp đồng {contract?.number}</DialogTitle>
          <DialogDescription>{contract?.employee.fullName}. Hợp đồng hết hạn tự nhiên thì không cần thao tác này.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="t-date" label="Ngày làm việc cuối *" type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={errors.terminatedOn} />
          <div className="grid gap-2">
            <Label htmlFor="t-reason">Lý do *</Label>
            <Textarea id="t-reason" rows={2} maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Vd: Nghỉ việc theo nguyện vọng" />
            {errors.reason && <p className="text-xs text-destructive">{errors.reason}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" variant="destructive" disabled={terminate.isPending}>Chấm dứt</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** HR: mọi hợp đồng, lọc theo trạng thái, tìm theo nhân viên; cảnh báo nhân viên chưa có hợp đồng hiệu lực. */
function AllContracts() {
  const { data: rows = [], isLoading } = useContracts();
  const { data: employees = [] } = useEmployees({});
  const remove = useDeleteContract();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [viewing, setViewing] = useState<string | null>(null);
  const [editing, setEditing] = useState<IContract | null | undefined>(undefined); // undefined = đóng, null = thêm mới
  const [terminating, setTerminating] = useState<IContract | null>(null);

  const q = search.trim().toLowerCase();
  const shown = rows.filter((c) => FILTERS.find((f) => f.value === filter)!.match(c)
    && (!q || c.employee.fullName.toLowerCase().includes(q) || c.employee.code.toLowerCase().includes(q) || c.number.toLowerCase().includes(q)));
  const withoutContract = useMemo(() => {
    const covered = new Set(rows.filter((c) => c.status === 'Active').map((c) => c.employee.id));
    return employees.filter((e) => e.status !== 'Resigned' && !covered.has(e.id));
  }, [rows, employees]);
  const current = rows.find((c) => c.id === viewing) ?? null;

  return (
    <div className="space-y-4">
      {withoutContract.length > 0 && (
        <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm" data-testid="no-contract-alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <span>
            <b>{withoutContract.length} nhân viên đang làm chưa có hợp đồng hiệu lực:</b>{' '}
            {withoutContract.map((e) => `${e.code} ${e.fullName}`).join(', ')}
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-8" placeholder="Tìm theo tên, mã nhân viên, số hợp đồng…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} onClick={() => setFilter(f.value)}>
              {f.label} <span className="opacity-70">{rows.filter(f.match).length}</span>
            </Button>
          ))}
        </div>
        <Button onClick={() => setEditing(null)} data-testid="contract-new"><Plus /> Thêm hợp đồng</Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Nhân viên</TableHead><TableHead>Số HĐ</TableHead><TableHead>Loại</TableHead><TableHead>Thời hạn</TableHead>
              <TableHead className="text-right">Lương hiện tại</TableHead><TableHead>Trạng thái</TableHead><TableHead className="w-12" /></TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground">Đang tải…</TableCell></TableRow>}
            {!isLoading && shown.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Không có hợp đồng nào</TableCell></TableRow>}
            {shown.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setViewing(c.id)}>
                <TableCell>
                  <span className="font-mono text-xs text-muted-foreground">{c.employee.code}</span> {c.employee.fullName}
                  {c.employee.departmentName && <div className="text-xs text-muted-foreground">{c.employee.departmentName}</div>}
                </TableCell>
                <TableCell className="font-mono text-xs">{c.number}{c.amendments.length > 0 && <span className="ml-1 text-muted-foreground">+{c.amendments.length} PL</span>}</TableCell>
                <TableCell className="text-sm">{CONTRACT_TYPE[c.type]}</TableCell>
                <TableCell className="text-sm tabular-nums">{formatDate(c.startDate)} → {c.endDate ? formatDate(c.endDate) : '∞'}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(c.currentSalary)}</TableCell>
                <TableCell><ContractStatusBadge c={c} /></TableCell>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button size="icon" variant="ghost" className="size-8" aria-label="Thao tác"><MoreHorizontal /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setViewing(c.id)}>Xem chi tiết</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setEditing(c)}>Sửa</DropdownMenuItem>
                      {!c.terminatedOn && c.status !== 'Expired' && <DropdownMenuItem onSelect={() => setTerminating(c)}>Chấm dứt…</DropdownMenuItem>}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => confirm(`Xoá hợp đồng ${c.number}? Chỉ dùng khi nhập nhầm.`) &&
                        remove.mutate(c.id, { onSuccess: () => toast.success('Đã xoá'), onError: (e) => toast.error(errorMessage(e)) })}>Xoá (nhập nhầm)</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Dialog open={!!current} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>Hợp đồng {current?.number}</DialogTitle></DialogHeader>
          {current && <ContractDetails contract={current} canEdit />}
          <DialogFooter>
            {current && <Button variant="outline" onClick={() => { setEditing(current); setViewing(null); }}>Sửa hợp đồng</Button>}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ContractFormDialog open={editing !== undefined} contract={editing} onClose={() => setEditing(undefined)} />
      <TerminateDialog contract={terminating} onClose={() => setTerminating(null)} />
    </div>
  );
}

/** Hợp đồng của chính mình (chỉ xem, tải file). */
function MyContracts() {
  const { data: rows = [], isLoading, noProfile } = useMyContracts();
  if (noProfile)
    return <Card><CardHeader><CardTitle className="text-base">Tài khoản chưa gắn hồ sơ nhân viên</CardTitle><CardDescription>Tài khoản quản trị hệ thống không có hợp đồng.</CardDescription></CardHeader></Card>;
  if (isLoading) return <p className="text-sm text-muted-foreground">Đang tải…</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Chưa có hợp đồng nào. Liên hệ HR nếu bạn nghĩ đây là sai sót.</p>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {rows.map((c) => (
        <Card key={c.id} className={cn('px-6', c.status === 'Active' && 'border-success/40')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{c.number}</CardTitle>
            <ContractStatusBadge c={c} />
          </div>
          <ContractDetails contract={c} canEdit={false} />
        </Card>
      ))}
    </div>
  );
}

export function ContractsPage() {
  const { data: me } = useMe();
  const isHr = hasRole(me, 'admin', 'hr');
  return (
    <div className="space-y-6">
      <PageHeader title="Hợp đồng lao động"
        description={isHr ? 'Hợp đồng, phụ lục và file scan của nhân viên. Hệ thống nhắc HR và quản lý 30 và 7 ngày trước khi hết hạn.' : 'Hợp đồng lao động và phụ lục của bạn.'} />
      {isHr ? (
        <Tabs defaultValue="all">
          <TabsList><TabsTrigger value="all">Tất cả hợp đồng</TabsTrigger><TabsTrigger value="my">Của tôi</TabsTrigger></TabsList>
          <TabsContent value="all" className="mt-4"><AllContracts /></TabsContent>
          <TabsContent value="my" className="mt-4"><MyContracts /></TabsContent>
        </Tabs>
      ) : <MyContracts />}
    </div>
  );
}
