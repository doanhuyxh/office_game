export interface IReportEmployee {
  id: string;
  code: string;
  fullName: string;
  departmentName: string | null;
  isActive: boolean;
  joinedAt: string;
  leftAt: string | null;
}

/** Khớp OvertimePayRow (Reporting). Tiền null = thiếu hợp đồng / lương. */
export interface IOvertimePayRow {
  employee: IReportEmployee;
  contractNumber: string | null;
  salary: number | null;
  standardDays: number;
  hourlyWage: number | null;
  weekdayMinutes: number;
  restDayMinutes: number;
  holidayMinutes: number;
  totalMinutes: number;
  weekdayAmount: number | null;
  restDayAmount: number | null;
  holidayAmount: number | null;
  totalAmount: number | null;
  warning: string | null;
}

export interface IOvertimePayLine {
  employeeId: string;
  workDate: string;
  startTime: string;
  endTime: string;
  minutes: number;
  kind: 'Weekday' | 'RestDay' | 'Holiday';
  percent: number;
  hourlyWage: number | null;
  amount: number | null;
  reason: string;
}

export interface IOvertimePayReport {
  month: string;
  rows: IOvertimePayRow[];
  lines: IOvertimePayLine[];
  totalMinutes: number;
  totalAmount: number;
}

/** Khớp LeavePayoutRow. payoutDue = đã nghỉ việc (phải trả); false = ước tính. */
export interface ILeavePayoutRow {
  employee: IReportEmployee;
  year: number;
  entitlement: number;
  accrued: number;
  carried: number;
  adjusted: number;
  used: number;
  pending: number;
  available: number;
  asOf: string;
  salary: number | null;
  standardDays: number;
  dailyWage: number | null;
  payoutAmount: number | null;
  payoutDue: boolean;
  warning: string | null;
}
