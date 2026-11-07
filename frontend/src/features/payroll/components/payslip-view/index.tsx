import { AlertTriangle } from 'lucide-react';
import { formatMoney } from '@/utils/money';
import { cn } from '@/utils/cn';
import type { IPayslipData } from '../../types/payroll.types';

const days = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

function Row({ label, value, strong, sub, negative }: { label: string; value: string; strong?: boolean; sub?: string; negative?: boolean }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-1 text-sm', strong && 'font-semibold')}>
      <span>{label}{sub && <span className="ml-1 text-xs font-normal text-muted-foreground">{sub}</span>}</span>
      <span className={cn('tabular-nums', negative && 'text-destructive')}>{value}</span>
    </div>
  );
}

/** Phiếu lương chi tiết (HR xem trong kỳ lương; nhân viên xem phiếu đã chốt). */
export function PayslipView({ d }: { d: IPayslipData }) {
  const taxableAdj = d.adjustments.filter((a) => a.taxable);
  const otherAdj = d.adjustments.filter((a) => !a.taxable);
  return (
    <div className="grid gap-4">
      <div className="text-sm text-muted-foreground">
        {d.employeeCode} · {d.fullName}{d.departmentName ? ` · ${d.departmentName}` : ''}{d.contractNumber ? ` · HĐ ${d.contractNumber}` : ''}
      </div>
      {d.warnings.length > 0 && (
        <div className="grid gap-1 rounded-md bg-warning/15 p-3 text-sm text-warning">
          {d.warnings.map((w) => <div key={w} className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</div>)}
        </div>
      )}
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Thu nhập</div>
          <Row label="Lương hợp đồng" value={formatMoney(d.salary)} />
          <Row label="Công hưởng lương" value={`${days(d.paidDays)} / ${d.standardDays}`} />
          <Row label="Lương theo công" value={formatMoney(d.basePay)} />
          {d.allowance > 0 && <Row label="Phụ cấp theo công" value={formatMoney(d.allowancePay)} />}
          {d.overtimeMinutes > 0 && <Row label="Tăng ca" sub={`${days(d.overtimeMinutes / 60)} giờ · lương giờ ${formatMoney(d.hourlyWage)}`} value={formatMoney(d.overtimePay)} />}
          {taxableAdj.map((a, i) => <Row key={i} label={a.label} value={formatMoney(a.amount)} negative={a.amount < 0} />)}
          <Row label="Tổng thu nhập" value={formatMoney(d.gross)} strong />
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Khấu trừ</div>
          {d.insured ? <>
            <Row label="BHXH" value={formatMoney(-d.employeeSocial)} negative />
            <Row label="BHYT" value={formatMoney(-d.employeeHealth)} negative />
            <Row label="BHTN" value={formatMoney(-d.employeeUnemployment)} negative />
          </> : <Row label="Bảo hiểm" value="Không đóng" />}
          <Row label="Thuế TNCN"
            sub={d.taxMethod === 'flat' ? 'khấu trừ cố định (thử việc)' : `${d.dependents} người phụ thuộc · tính thuế ${formatMoney(d.assessableIncome)}`}
            value={formatMoney(-d.tax)} negative={d.tax > 0} />
          {otherAdj.map((a, i) => <Row key={i} label={a.label} sub="không chịu thuế" value={formatMoney(a.amount)} negative={a.amount < 0} />)}
          <div className="mt-2 rounded-md bg-primary/10 px-3 py-2">
            <Row label="Thực lĩnh" value={formatMoney(d.net)} strong />
          </div>
        </div>
      </div>
      {d.overtimeTaxExempt > 0 && <p className="text-xs text-muted-foreground">Phần tăng ca cao hơn lương giờ bình thường ({formatMoney(d.overtimeTaxExempt)}) được miễn thuế TNCN.</p>}
    </div>
  );
}

/** Phần doanh nghiệp đóng (chỉ HR). */
export function EmployerCost({ d }: { d: IPayslipData }) {
  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Doanh nghiệp đóng</div>
      <Row label="BHXH / BHYT / BHTN" value={`${formatMoney(d.employerSocial)} · ${formatMoney(d.employerHealth)} · ${formatMoney(d.employerUnemployment)}`} />
      <Row label="Tổng chi phí cho nhân viên" value={formatMoney(d.employerCost)} strong />
    </div>
  );
}
