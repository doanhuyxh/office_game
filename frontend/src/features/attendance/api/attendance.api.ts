import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPaged, IPageQuery } from '@/types/api';
import type {
  CheckSource, IBoardPage, ICorrection, ICreateCorrection, ICreateOvertime, IHoliday, IMonth, IOvertime, IOvertimeCreated, IOvertimePreview,
  IReportRow, ISchedule, IShift, IToday, IUpsertShift, IWeekDay,
} from '../types/attendance.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url: string) => http<void>(url, { method: 'DELETE' });

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  my: (month: string) => ['attendance', 'my', month] as const,
  employee: (id: string, month: string) => ['attendance', 'employee', id, month] as const,
  boardPage: (q: IPageQuery) => ['attendance', 'board', 'today', 'page', q] as const,
  reportPage: (month: string, q: IPageQuery) => ['attendance', 'report', month, q] as const,
  schedulesPage: (q: IPageQuery) => ['attendance', 'schedules', 'page', q] as const,
  overtimePage: (month: string, q: IPageQuery) => ['attendance', 'overtime', month, q] as const,
  shifts: ['attendance', 'shifts'] as const,
  holidays: (year: number) => ['attendance', 'holidays', year] as const,
  corrections: (month: string) => ['attendance', 'corrections', month] as const,
  overtimePreview: (v: Omit<ICreateOvertime, 'reason'>) => ['attendance', 'overtime-preview', v.workDate, v.startTime, v.endTime] as const,
};

export const attendanceApi = {
  today: () => http<IToday>('/api/attendance/today'),
  check: (source: CheckSource) => httpPost<IToday>('/api/attendance/check', { source }),
  my: (month: string) => http<IMonth>(`/api/attendance/my?month=${month}`),
  employeeMonth: (id: string, month: string) => http<IMonth>(`/api/attendance/employees/${id}?month=${month}`),
  /** Hôm nay, một trang: BE sắp theo trạng thái (đang làm → … → nghỉ) rồi mã NV, kèm đếm theo trạng thái. */
  boardPage: (q: IPageQuery) => http<IBoardPage>(`/api/attendance/board?${pageQs(q)}`),
  /** Tổng hợp tháng, một trang nhân viên (BE chỉ tính bảng công cho trang). */
  reportPage: (month: string, q: IPageQuery) => http<IPaged<IReportRow>>(`/api/attendance/report?month=${month}&${pageQs(q)}`),

  shifts: () => http<IShift[]>('/api/attendance/shifts'),
  createShift: (body: IUpsertShift) => httpPost<IShift>('/api/attendance/shifts', body),
  updateShift: (id: string, body: IUpsertShift) => put<IShift>(`/api/attendance/shifts/${id}`, body),
  deleteShift: (id: string) => del(`/api/attendance/shifts/${id}`),

  schedulesPage: (q: IPageQuery) => http<IPaged<ISchedule>>(`/api/attendance/schedules?${pageQs(q)}`),
  saveSchedule: (employeeId: string | null, effectiveFrom: string, days: IWeekDay[]) =>
    put<void>('/api/attendance/schedules', { employeeId, effectiveFrom, days }),
  deleteSchedule: (employeeId: string | null, effectiveFrom: string) =>
    del(`/api/attendance/schedules?effectiveFrom=${effectiveFrom}${employeeId ? `&employeeId=${employeeId}` : ''}`),

  holidays: (year: number) => http<IHoliday[]>(`/api/attendance/holidays?year=${year}`),
  createHoliday: (date: string, name: string) => httpPost<IHoliday>('/api/attendance/holidays', { date, name }),
  deleteHoliday: (id: string) => del(`/api/attendance/holidays/${id}`),

  myCorrections: (month: string) => http<ICorrection[]>(`/api/attendance/corrections/my?month=${month}`),
  createCorrection: (body: ICreateCorrection) => httpPost<ICorrection>('/api/attendance/corrections', body),

  myOvertimePage: (month: string, q: IPageQuery) => http<IPaged<IOvertime>>(`/api/attendance/overtime/my?month=${month}&${pageQs(q)}`),
  previewOvertime: (v: Omit<ICreateOvertime, 'reason'>) =>
    http<IOvertimePreview>(`/api/attendance/overtime/preview?${new URLSearchParams({ workDate: v.workDate, startTime: v.startTime, endTime: v.endTime })}`),
  createOvertime: (body: ICreateOvertime) => httpPost<IOvertimeCreated>('/api/attendance/overtime', body),
};
