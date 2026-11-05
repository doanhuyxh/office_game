// Khớp với DTO ở backend/src/Modules/Attendance/.../Features/Dtos.cs

export type DayStatus = 'DayOff' | 'Holiday' | 'NotYet' | 'Working' | 'Present' | 'MissingCheckout' | 'Absent' | 'NotEmployed';
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
