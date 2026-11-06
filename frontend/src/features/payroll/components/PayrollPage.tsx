import { useEffect, useState } from 'react';
import { AlertTriangle, Calculator, FileSpreadsheet, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/common/tabs';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { currentMonthVn, formatDate, formatDateTime } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { downloadUrl, formatMoney } from '@/utils/money';
import { payrollApi } from '../api/payroll.api';
import {
  useAddAdjustment, useCreatePeriod, useDeleteAdjustment, usePeriod, usePeriodAction, usePeriods, useProfiles, useSaveProfile, useSaveSettings, useSettings,
} from '../hooks/usePayroll';
import type { IPayProfile, IPayrollRules, IPayslip } from '../types/payroll.types';
import { EmployerCost, PayslipView } from './PayslipView';
import { ColumnsMenu, useColumns, type ColumnDef } from '@/components/common/columns';

const monthLabel = (m: string) => `${m.slice(5)}/${m.slice(0, 4)}`;
const prevMonth = () => { const [y, m] = currentMonthVn().split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };

// ---------------- Kỳ lương ----------------

const PERIOD_COLUMNS: ColumnDef[] = [
  { id: 'employee', label: 'Nhân viên', required: true }, { id: 'days', label: 'Công' }, { id: 'gross', label: 'Tổng thu nhập' },
  { id: 'insurance', label: 'BH (NLĐ)' }, { id: 'tax', label: 'Thuế TNCN' }, { id: 'net', label: 'Thực lĩnh' }, { id: 'cost', label: 'Chi phí DN' },
];

function PayslipDialog({ slip, periodId, locked, onClose }: { slip: IPayslip | null; periodId: string; locked: boolean; onClose: () => void }) {
  const add = useAddAdjustment();
  const del = useDeleteAdjustment();
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [taxable, setTaxable] = useState(true);
  const errors = fieldErrors(add.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!slip) return;
    add.mutate({ periodId, employeeId: slip.employeeId, label: label.trim(), amount: Number(amount.replace(/[.,\s]/g, '')), taxable }, {
      onSuccess: () => { toast.success('Đã thêm và tính lại phiếu lương'); setLabel(''); setAmount(''); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={!!slip} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>Phiếu lương {slip?.data.fullName}</DialogTitle></DialogHeader>
        {slip && <>
          <PayslipView d={slip.data} />
          <EmployerCost d={slip.data} />
          <div className="grid gap-2">
            <Label>Khoản cộng / trừ trong kỳ</Label>
            {slip.adjustments.length === 0 && <p className="text-sm text-muted-foreground">Chưa có.</p>}
            {slip.adjustments.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm">
                <span>{a.label} <span className="text-xs text-muted-foreground">{a.taxable ? 'chịu thuế' : 'không chịu thuế'} · {a.createdByName}</span></span>
                <span className="flex items-center gap-2 tabular-nums">{formatMoney(a.amount)}
                  {!locked && <Button size="icon" variant="ghost" className="size-7 text-destructive" aria-label="Xoá"
                    onClick={() => del.mutate(a.id, { onSuccess: () => toast.success('Đã xoá'), onError: (e) => toast.error(errorMessage(e)) })}><Trash2 className="size-4" /></Button>}
                </span>
              </div>
            ))}
            {!locked && (
              <form onSubmit={submit} className="grid gap-3 rounded-md border p-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
                <FormField id="adj-label" label="Nội dung" required value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Vd: Thưởng dự án / Trừ tạm ứng" error={errors.label} />
                <FormField id="adj-amount" label="Số tiền (âm = trừ)" required inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="2000000" error={errors.amount} />
                <Button type="submit" disabled={add.isPending}><Plus className="size-4" /> Thêm</Button>
                <label className="flex items-center gap-2 text-sm sm:col-span-3">
                  <Checkbox checked={taxable} onCheckedChange={(c) => setTaxable(c === true)} /> Tính vào thu nhập chịu thuế (thưởng: có; tạm ứng / hoàn ứng: không)
                </label>
              </form>
            )}
          </div>
        </>}
      </DialogContent>
    </Dialog>
  );
}

function PeriodsTab() {
  const periods = usePeriods();
  const create = useCreatePeriod();
  const action = usePeriodAction();
  const [month, setMonth] = useState(prevMonth);
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => { if (!selected && periods.data?.length) setSelected(periods.data[0].id); }, [periods.data, selected]);
  const detail = usePeriod(selected);
  const cols = useColumns('payroll-period', PERIOD_COLUMNS);
  const v = cols.show;
  const p = detail.data?.period;
  const locked = p?.status === 'Locked';
  const run = (a: 'compute' | 'lock' | 'unlock', msg: string) => p && action.mutate({ id: p.id, action: a }, {
    onSuccess: () => toast.success(msg), onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <div className="grid gap-2"><Label htmlFor="pr-month">Tạo kỳ lương</Label>
          <Input id="pr-month" type="month" className="w-44" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></div>
        <Button disabled={create.isPending} onClick={() => create.mutate(month, {
          onSuccess: (r) => { toast.success(`Đã tạo kỳ ${monthLabel(r.month)} (${r.employees} phiếu)`); setSelected(r.id); },
          onError: (e) => toast.error(errorMessage(e)),
        })}><Plus className="size-4" /> {create.isPending ? 'Đang tính…' : 'Tạo & tính'}</Button>
        <div className="ms-auto flex flex-wrap gap-1">
          {periods.data?.map((x) => (
            <Button key={x.id} size="sm" variant={x.id === selected ? 'default' : 'outline'} onClick={() => setSelected(x.id)}>
              {monthLabel(x.month)} {x.status === 'Locked' && <Lock className="size-3" />}
            </Button>
          ))}
        </div>
      </div>

      {!periods.data?.length && !periods.isLoading && <p className="py-6 text-center text-sm text-muted-foreground">Chưa có kỳ lương nào.</p>}
      {detail.isLoading && <Spinner />}
      {p && detail.data && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">Kỳ lương {monthLabel(p.month)}
                <StatusBadge tone={locked ? 'success' : 'warning'}>{locked ? 'Đã chốt' : 'Bản nháp'}</StatusBadge></CardTitle>
              <CardDescription>
                {locked ? `Chốt ${p.lockedAt ? formatDateTime(p.lockedAt) : ''} bởi ${p.lockedByName ?? ''} — nhân viên đã xem được phiếu lương.`
                  : `Tính lần cuối ${p.computedAt ? formatDateTime(p.computedAt) : '—'}. Bấm một dòng để xem phiếu, thêm thưởng / khấu trừ.`}
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <ColumnsMenu state={cols} className="h-9" />
              {!locked && <Button variant="outline" disabled={action.isPending} onClick={() => run('compute', 'Đã tính lại')}><Calculator className="size-4" /> Tính lại</Button>}
              <Button variant="outline" onClick={() => downloadUrl(payrollApi.exportUrl(p.id))}><FileSpreadsheet className="size-4" /> Excel</Button>
              {locked
                ? <Button variant="outline" disabled={action.isPending} onClick={() => confirm('Mở lại kỳ lương để sửa? Nhân viên sẽ tạm không thấy phiếu kỳ này.') && run('unlock', 'Đã mở lại')}><Unlock className="size-4" /> Mở lại</Button>
                : <Button disabled={action.isPending} onClick={() => confirm(`Chốt kỳ lương ${monthLabel(p.month)}? Hệ thống tính lại lần cuối rồi gửi phiếu lương cho nhân viên.`) && run('lock', 'Đã chốt và gửi phiếu lương')}><Lock className="size-4" /> Chốt kỳ</Button>}
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nhân viên</TableHead>{v('days') && <TableHead className="text-right">Công</TableHead>}{v('gross') && <TableHead className="text-right">Tổng thu nhập</TableHead>}
                    {v('insurance') && <TableHead className="text-right">BH (NLĐ)</TableHead>}{v('tax') && <TableHead className="text-right">Thuế TNCN</TableHead>}{v('net') && <TableHead className="text-right">Thực lĩnh</TableHead>}
                    {v('cost') && <TableHead className="text-right">Chi phí DN</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.data.payslips.map((s) => (
                    <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpen(s.id)}>
                      <TableCell>
                        <span className="font-mono text-xs text-muted-foreground">{s.data.employeeCode}</span> {s.data.fullName}
                        {s.data.warnings.length > 0 && <AlertTriangle className="ml-1 inline size-3.5 text-warning" aria-label={s.data.warnings.join('; ')} />}
                        {s.adjustments.length > 0 && <span className="ml-1 text-xs text-muted-foreground">+{s.adjustments.length} khoản</span>}
                      </TableCell>
                      {v('days') && <TableCell className="text-right tabular-nums">{s.data.paidDays.toLocaleString('vi-VN')}/{s.data.standardDays}</TableCell>}
                      {v('gross') && <TableCell className="text-right tabular-nums">{formatMoney(s.data.gross)}</TableCell>}
                      {v('insurance') && <TableCell className="text-right tabular-nums">{formatMoney(s.data.employeeInsurance)}</TableCell>}
                      {v('tax') && <TableCell className="text-right tabular-nums">{formatMoney(s.data.tax)}</TableCell>}
                      {v('net') && <TableCell className="text-right font-medium tabular-nums">{formatMoney(s.data.net)}</TableCell>}
                      {v('cost') && <TableCell className="text-right tabular-nums text-muted-foreground">{formatMoney(s.data.employerCost)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell>Tổng ({p.employees} người)</TableCell>{v('days') && <TableCell />}
                    {v('gross') && <TableCell className="text-right">{formatMoney(p.totalGross)}</TableCell>}
                    {v('insurance') && <TableCell className="text-right">{formatMoney(p.totalEmployeeInsurance)}</TableCell>}
                    {v('tax') && <TableCell className="text-right">{formatMoney(p.totalTax)}</TableCell>}
                    {v('net') && <TableCell className="text-right">{formatMoney(p.totalNet)}</TableCell>}
                    {v('cost') && <TableCell className="text-right">{formatMoney(p.totalEmployerCost)}</TableCell>}
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
      {p && <PayslipDialog slip={detail.data?.payslips.find((s) => s.id === open) ?? null} periodId={p.id} locked={locked} onClose={() => setOpen(null)} />}
    </div>
  );
}

// ---------------- Hồ sơ thuế ----------------

function ProfileRow({ p }: { p: IPayProfile }) {
  const save = useSaveProfile();
  const [dep, setDep] = useState(String(p.dependents));
  const [ins, setIns] = useState<string | null>(p.insured === null ? null : String(p.insured));
  const [tax, setTax] = useState(p.taxCode ?? '');
  const dirty = dep !== String(p.dependents) || ins !== (p.insured === null ? null : String(p.insured)) || tax !== (p.taxCode ?? '');
  return (
    <TableRow>
      <TableCell><span className="font-mono text-xs text-muted-foreground">{p.code}</span> {p.fullName}
        <div className="text-xs text-muted-foreground">{p.departmentName}</div></TableCell>
      <TableCell><Input type="number" min={0} max={20} className="w-20" value={dep} onChange={(e) => setDep(e.target.value)} aria-label="Người phụ thuộc" /></TableCell>
      <TableCell className="w-48"><SelectField id={`ins-${p.employeeId}`} label="" value={ins} onChange={setIns} allowEmpty emptyLabel="Tự động theo HĐ"
        options={[{ value: 'true', label: 'Có đóng' }, { value: 'false', label: 'Không đóng' }]} /></TableCell>
      <TableCell><Input className="w-36" value={tax} maxLength={20} onChange={(e) => setTax(e.target.value)} placeholder="Mã số thuế" aria-label="Mã số thuế" /></TableCell>
      <TableCell>
        <Button size="sm" variant={dirty ? 'default' : 'ghost'} disabled={!dirty || save.isPending} onClick={() => save.mutate(
          { employeeId: p.employeeId, dependents: Number(dep) || 0, insured: ins === null ? null : ins === 'true', taxCode: tax || null, note: p.note },
          { onSuccess: () => toast.success(`Đã lưu ${p.fullName}`), onError: (e) => toast.error(errorMessage(e)) })}>Lưu</Button>
      </TableCell>
    </TableRow>
  );
}

function ProfilesTab() {
  const profiles = useProfiles();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Hồ sơ thuế & bảo hiểm</CardTitle>
        <CardDescription>Số người phụ thuộc đã đăng ký giảm trừ gia cảnh. "Tự động": hợp đồng thử việc không đóng bảo hiểm (thuế khấu trừ 10%), hợp đồng khác có đóng.</CardDescription>
      </CardHeader>
      <CardContent>
        {profiles.isLoading ? <Spinner /> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Nhân viên</TableHead><TableHead>Người phụ thuộc</TableHead><TableHead>Bảo hiểm</TableHead><TableHead>MST cá nhân</TableHead><TableHead /></TableRow></TableHeader>
              <TableBody>{profiles.data?.map((p) => <ProfileRow key={p.employeeId} p={p} />)}</TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------- Thông số ----------------

const NUM_FIELDS: { key: keyof IPayrollRules; label: string; unit: string }[] = [
  { key: 'baseSalary', label: 'Lương cơ sở', unit: 'đ' }, { key: 'regionMinWage', label: 'Lương tối thiểu vùng', unit: 'đ' },
  { key: 'capMultiplier', label: 'Hệ số trần đóng BH', unit: '×' },
  { key: 'employeeSocial', label: 'BHXH người lao động', unit: '%' }, { key: 'employeeHealth', label: 'BHYT người lao động', unit: '%' },
  { key: 'employeeUnemployment', label: 'BHTN người lao động', unit: '%' }, { key: 'employerSocial', label: 'BHXH doanh nghiệp', unit: '%' },
  { key: 'employerHealth', label: 'BHYT doanh nghiệp', unit: '%' }, { key: 'employerUnemployment', label: 'BHTN doanh nghiệp', unit: '%' },
  { key: 'personalDeduction', label: 'Giảm trừ bản thân / tháng', unit: 'đ' }, { key: 'dependentDeduction', label: 'Giảm trừ mỗi người phụ thuộc', unit: 'đ' },
  { key: 'flatTaxRate', label: 'Khấu trừ thử việc', unit: '%' }, { key: 'flatTaxThreshold', label: 'Ngưỡng khấu trừ thử việc', unit: 'đ' },
  { key: 'unpaidDaysNoInsurance', label: 'Nghỉ không lương từ … ngày → không đóng BH (0 = tắt)', unit: 'ngày' },
];

function SettingsTab() {
  const settings = useSettings();
  const save = useSaveSettings();
  const current = settings.data?.[0];
  const [rules, setRules] = useState<IPayrollRules | null>(null);
  const [from, setFrom] = useState(`${currentMonthVn()}-01`);
  useEffect(() => { if (current && !rules) setRules(current.rules); }, [current, rules]);
  if (!rules || !current) return <Spinner />;
  const set = <K extends keyof IPayrollRules>(k: K, v: IPayrollRules[K]) => setRules({ ...rules, [k]: v });
  const errors = fieldErrors(save.error);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex gap-2 rounded-md bg-warning/15 p-3 text-sm text-warning">
        <AlertTriangle className="mt-0.5 size-4 shrink-0" />
        <span>Thông số mặc định lấy theo quy định 2026 mà hệ thống biết (lương cơ sở, lương tối thiểu vùng I, giảm trừ 15,5 tr / 6,2 tr, biểu thuế 5 bậc).
          <b> Kế toán cần đối chiếu văn bản hiện hành trước khi chốt lương thật.</b> Lưu bản mới với ngày hiệu lực — kỳ đã chốt không bị ảnh hưởng.</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Thông số đang dùng (hiệu lực từ {formatDate(current.effectiveFrom)})</CardTitle>
          <CardDescription>Cập nhật bởi {current.createdByName ?? '—'} · {formatDateTime(current.createdAt)}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NUM_FIELDS.map((f) => (
              <FormField key={f.key} id={`r-${f.key}`} label={`${f.label} (${f.unit})`} type="number" step="any"
                value={String(rules[f.key] as number)} onChange={(e) => set(f.key, Number(e.target.value) as never)} />
            ))}
          </div>
          <div className="grid gap-2">
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={rules.insuranceIncludesAllowance} onCheckedChange={(c) => set('insuranceIncludesAllowance', c === true)} /> Lương đóng bảo hiểm gồm phụ cấp trên hợp đồng</label>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={rules.overtimePremiumTaxExempt} onCheckedChange={(c) => set('overtimePremiumTaxExempt', c === true)} /> Miễn thuế phần tiền tăng ca cao hơn lương giờ bình thường</label>
          </div>
          <div className="grid gap-2">
            <Label>Biểu thuế lũy tiến (thu nhập tính thuế / tháng)</Label>
            {rules.brackets.map((b, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-14 text-muted-foreground">Bậc {i + 1}</span>
                {b.upTo === null ? <span className="w-44">trên mức trước</span>
                  : <Input type="number" className="w-44" value={b.upTo} aria-label={`Đến (bậc ${i + 1})`}
                      onChange={(e) => set('brackets', rules.brackets.map((x, j) => (j === i ? { ...x, upTo: Number(e.target.value) } : x)))} />}
                <Input type="number" step="any" className="w-24" value={b.rate} aria-label={`Thuế suất (bậc ${i + 1})`}
                  onChange={(e) => set('brackets', rules.brackets.map((x, j) => (j === i ? { ...x, rate: Number(e.target.value) } : x)))} />%
              </div>
            ))}
          </div>
          {errors.rules && <p className="text-sm text-destructive">{errors.rules}</p>}
          <div className="flex flex-wrap items-end gap-3">
            <FormField id="r-from" label="Hiệu lực từ" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Button disabled={save.isPending} onClick={() => save.mutate({ effectiveFrom: from, rules }, {
              onSuccess: () => toast.success('Đã lưu thông số'), onError: (e) => !Object.keys(fieldErrors(e)).length && toast.error(errorMessage(e)),
            })}>Lưu thông số</Button>
          </div>
          {settings.data && settings.data.length > 1 && (
            <p className="text-xs text-muted-foreground">Các bản trước: {settings.data.slice(1).map((s) => formatDate(s.effectiveFrom)).join(', ')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/** Bảng lương (HR): kỳ lương, hồ sơ thuế, thông số luật. */
export function PayrollPage() {
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Bảng lương" />
      <Tabs defaultValue="periods">
        <TabsList>
          <TabsTrigger value="periods">Kỳ lương</TabsTrigger>
          <TabsTrigger value="profiles">Hồ sơ thuế</TabsTrigger>
          <TabsTrigger value="settings">Thông số</TabsTrigger>
        </TabsList>
        <TabsContent value="periods" className="pt-2"><PeriodsTab /></TabsContent>
        <TabsContent value="profiles" className="pt-2"><ProfilesTab /></TabsContent>
        <TabsContent value="settings" className="pt-2"><SettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
