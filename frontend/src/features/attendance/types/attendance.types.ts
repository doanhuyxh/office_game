// Khớp với DTO ở backend/src/Modules/Attendance/.../Features/Dtos.cs

export type DayStatus = 'DayOff' | 'Holiday' | 'NotYet' | 'Working' | 'Present' | 'MissingCheckout' | 'Absent' | 'NotEmployed' | 'Leave';
export type WorkModeValue = 'Onsite' | 'Remote' | 'Mixed';
export type ShiftType = 'Fixed' | 'Flexible';

export interface IShift {
  id: string;
  name: string;
  type: ShiftType;
  startTime: string | null; // HH:mm
  endTime: string | null;
  graceMinutes: number;
  requiredMinutes: number;
  earliestIn: string | null;
  latestIn: string | null;
  breakStart: string | null;
  breakEnd: string | null;
  /** Số phút phải làm (đã trừ nghỉ trưa) */
  plannedMinutes: number;
}

export type IUpsertShift = Omit<IShift, 'id' | 'plannedMinutes'>;

export interface ISession {
  in: string;
  out: string | null;
}

export interface IDay {
  date: string; // yyyy-MM-dd
  status: DayStatus;
  sessions: ISession[];
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  requiredMinutes: number;
  lateMinutes: number;
  shortMinutes: number;
  workMode: WorkModeValue | null;
  shiftName: string | null;
  holidayName: string | null;
  /** 0 | 0.5 | 1 — phần ngày nghỉ phép đã duyệt */
  leaveFraction: number;
  leaveName: string | null;
  /** Phút tăng ca đã duyệt (theo đơn) */
  overtimeMinutes: number;
  overtimeKind: OvertimeKind | null;
}

export interface ISummary {
  workDays: number;
  presentDays: number;
  absentDays: number;
  lateCount: number;
  lateMinutes: number;
  shortMinutes: number;
  workedMinutes: number;
  requiredMinutes: number;
  onsiteDays: number;
  remoteDays: number;
  mixedDays: number;
  missingCheckoutDays: number;
  leaveDays: number;
  overtimeMinutes: number;
  overtimeWeekdayMinutes: number;
  overtimeRestDayMinutes: number;
  overtimeHolidayMinutes: number;
}

export interface IEmployeeBrief {
  id: string;
  code: string;
  fullName: string;
  departmentName: string | null;
}

export interface IToday {
  employee: IEmployeeBrief;
  checkedIn: boolean;
  nextAction: 'in' | 'out';
  day: IDay;
  shift: IShift | null;
  serverTime: string;
  /** Hình thức nếu chấm công ngay bây giờ (theo IP hiện tại) */
  currentWorkMode: 'Onsite' | 'Remote';
}

export interface IMonth {
  employee: IEmployeeBrief;
  month: string; // yyyy-MM
  days: IDay[];
  summary: ISummary;
}

export interface IBoardRow {
  employee: IEmployeeBrief;
  day: IDay;
}

export interface IReportRow {
  employee: IEmployeeBrief;
  summary: ISummary;
}

export interface IWeekDay {
  dayOfWeek: number; // 0 = CN … 6 = T7
  shiftId: string | null;
}

export interface ISchedule {
  employeeId: string | null;
  employeeName: string | null;
  effectiveFrom: string;
  days: IWeekDay[];
}

export interface IHoliday {
  id: string;
  date: string;
  name: string;
}

export type CheckSource = 'web' | 'office3d';

export type CorrectionStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface ICorrection {
  id: string;
  workDate: string;
  type: 'In' | 'Out';
  time: string; // HH:mm
  workMode: 'Onsite' | 'Remote';
  reason: string;
  status: CorrectionStatus;
  rejectReason: string | null;
  approvalRequestId: string | null;
  createdAt: string;
}

export interface ICreateCorrection {
  workDate: string;
  type: 'In' | 'Out';
  time: string;
  workMode: 'Onsite' | 'Remote';
  reason: string;
}

/** Loại ngày tăng ca → hệ số 150 / 200 / 300% (OvertimeRules ở back-end). */
export type OvertimeKind = 'Weekday' | 'RestDay' | 'Holiday';
export type OvertimeStatus = 'Pending' | 'Approved' | 'Rejected' | 'Cancelled';

export interface IOvertime {
  id: string;
  workDate: string;
  startTime: string; // HH:mm
  endTime: string;
  minutes: number;
  kind: OvertimeKind;
  percent: number;
  reason: string;
  status: OvertimeStatus;
  rejectReason: string | null;
  approvalRequestId: string | null;
  createdAt: string;
}

export interface ICreateOvertime {
  workDate: string;
  startTime: string;
  endTime: string;
  reason: string;
}

export interface IOvertimePreview {
  minutes: number;
  kind: OvertimeKind;
  percent: number;
  /** Đã duyệt + đang chờ trong tháng / năm (chưa tính đơn này) */
  monthMinutes: number;
  yearMinutes: number;
  warnings: string[];
}

export interface IOvertimeCreated {
  overtime: IOvertime;
  warnings: string[];
}
