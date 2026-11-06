export interface ITaxBracket { upTo: number | null; rate: number }

/** Khớp PayrollRules (back-end) — thông số luật HR sửa được. */
export interface IPayrollRules {
  baseSalary: number;
  regionMinWage: number;
  capMultiplier: number;
  employeeSocial: number;
  employeeHealth: number;
  employeeUnemployment: number;
  employerSocial: number;
  employerHealth: number;
  employerUnemployment: number;
  insuranceIncludesAllowance: boolean;
  personalDeduction: number;
  dependentDeduction: number;
  brackets: ITaxBracket[];
  flatTaxRate: number;
  flatTaxThreshold: number;
  overtimePremiumTaxExempt: boolean;
  unpaidDaysNoInsurance: number;
}

export interface ISettings { id: string; effectiveFrom: string; rules: IPayrollRules; createdAt: string; createdByName: string | null }

export interface IPayProfile {
  employeeId: string; code: string; fullName: string; departmentName: string | null;
  dependents: number; insured: boolean | null; taxCode: string | null; note: string | null;
}

export interface IPayLine { label: string; amount: number; taxable: boolean }

/** Khớp PayslipData — mọi số tiền đã làm tròn tới đồng. */
export interface IPayslipData {
  employeeCode: string; fullName: string; departmentName: string | null; contractNumber: string | null; contractType: string | null;
  salary: number; allowance: number; standardDays: number; paidDays: number; hourlyWage: number;
  basePay: number; allowancePay: number; overtimeMinutes: number; overtimePay: number; overtimeTaxExempt: number;
  adjustments: IPayLine[]; gross: number;
  insured: boolean; insuranceBase: number;
  employeeSocial: number; employeeHealth: number; employeeUnemployment: number; employeeInsurance: number;
  employerSocial: number; employerHealth: number; employerUnemployment: number; employerInsurance: number;
  taxableIncome: number; dependents: number; deductions: number; assessableIncome: number;
  taxMethod: 'progressive' | 'flat' | 'none'; tax: number;
  nonTaxableAdjustments: number; net: number; employerCost: number; warnings: string[];
}

export type PeriodStatus = 'Draft' | 'Locked';

export interface IPeriod {
  id: string; month: string; status: PeriodStatus; createdAt: string; computedAt: string | null; lockedAt: string | null; lockedByName: string | null;
  employees: number; totalGross: number; totalNet: number; totalTax: number; totalEmployeeInsurance: number; totalEmployerCost: number;
}

export interface IAdjustment { id: string; employeeId: string; label: string; amount: number; taxable: boolean; createdByName: string | null }
export interface IPayslip { id: string; employeeId: string; data: IPayslipData; adjustments: IAdjustment[] }
export interface IPeriodDetail { period: IPeriod; payslips: IPayslip[] }
export interface IMyPayslip { periodId: string; month: string; data: IPayslipData }
