import type { IPaged } from '@/types/api';

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

/** Trang tiền tăng ca: chỉ người có tăng ca trong tháng; `totalMinutes` / `totalAmount` là tổng cả tháng (không chỉ trang). */
export interface IOvertimePayPage extends IPaged<IOvertimePayRow> {
  month: string;
  totalMinutes: number;
  totalAmount: number;
}

/** Trang phép năm → tiền; `due` = người đã nghỉ việc trong năm còn phép phải trả (toàn bộ, không theo trang). */
export interface ILeavePayoutPage extends IPaged<ILeavePayoutRow> {
  due: ILeavePayoutRow[];
}

// ---------- Sử dụng trợ lý AI (module Audit: /api/audit/ai-usage) ----------

export type AiUsageKind = 'tool' | 'api';
export type AiUsageSort = 'total' | 'writes' | 'errors' | 'blocked' | 'ips' | 'last' | 'name';

/** Bộ lọc chung: from / to = yyyy-MM-dd (lịch VN). */
export interface IAiUsageFilter {
  from: string;
  to: string;
  departmentId?: string | null;
  client?: string | null;
  kind?: AiUsageKind | null;
}

/** Khớp AiUsageSummary. errors = status ≥ 400 trừ bị chặn; blocked = 403 + 429. */
export interface IAiUsageSummary {
  total: number;
  users: number;
  writes: number;
  errors: number;
  blocked: number;
  avgDurationMs: number;
  lastAt: string | null;
}

export interface IAiUsageDay { date: string; total: number; errors: number; blocked: number }
/** tool null = gọi API trực tiếp bằng token. errors = mọi status ≥ 400. */
export interface IAiUsageTool { tool: string | null; total: number; errors: number; users: number }
export interface IAiUsageClient { clientName: string; total: number; users: number }
export interface IAiUsageIp { ip: string; total: number; lastAt: string }

export interface IAiUsageReport {
  from: string;
  to: string;
  summary: IAiUsageSummary;
  daily: IAiUsageDay[];
  byTool: IAiUsageTool[];
  byClient: IAiUsageClient[];
  /** Chỉ khi lọc một người. */
  ips: IAiUsageIp[] | null;
}

export interface IAiUsageUserRow {
  userId: string;
  fullName: string | null;
  userName: string | null;
  employeeCode: string | null;
  departmentName: string | null;
  isBot: boolean;
  total: number;
  writes: number;
  errors: number;
  blocked: number;
  ips: number;
  topClient: string | null;
  lastAt: string;
}

export type IAiUsageUsersPage = IPaged<IAiUsageUserRow>;

/** Luật cảnh báo AI (AiAlertRules ở module Audit). */
export type AiAlertRule = 'blocked' | 'errors' | 'burst_writes' | 'bot_approval' | 'chat_spam';

/** Cảnh báo trợ lý AI bất thường (AiAlertDto, `GET /api/audit/ai-alerts`). */
export interface IAiAlert {
  id: string;
  createdAt: string;
  userId: string;
  fullName: string | null;
  userName: string | null;
  departmentName: string | null;
  isBot: boolean;
  rule: AiAlertRule | string;
  title: string;
  body: string;
  /** Số lệnh khớp luật / tổng lệnh trong cửa sổ 15 phút. */
  count: number;
  total: number;
  windowStart: string;
  windowEnd: string;
}

export type IAiAlertPage = IPaged<IAiAlert>;
