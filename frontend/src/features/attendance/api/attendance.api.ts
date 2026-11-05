import { http, httpPost } from '@/services/api-client';
import type {
  CheckSource, IBoardRow, IHoliday, IMonth, IReportRow, ISchedule, IShift, IToday, IUpsertShift, IWeekDay,
} from '../types/attendance.types';

const put = <T>(url: string, body: unknown) => http<T>(url, { method: 'PUT', body: JSON.stringify(body) });
const del = (url: string) => http<void>(url, { method: 'DELETE' });

export const attendanceKeys = {
  all: ['attendance'] as const,
  today: ['attendance', 'today'] as const,
  my: (month: string) => ['attendance', 'my', month] as const,
  employee: (id: string, month: string) => ['attendance', 'employee', id, month] as const,
  board: (date?: string) => ['attendance', 'board', date ?? 'today'] as const,
  report: (month: string) => ['attendance', 'report', month] as const,
  shifts: ['attendance', 'shifts'] as const,
  schedules: ['attendance', 'schedules'] as const,
  holidays: (year: number) => ['attendance', 'holidays', year] as const,
};

export const attendanceApi = {
  today: () => http<IToday>('/api/attendance/today'),
  check: (source: CheckSource) => httpPost<IToday>('/api/attendance/check', { source }),
  my: (month: string) => http<IMonth>(`/api/attendance/my?month=${month}`),
  employeeMonth: (id: string, month: string) => http<IMonth>(`/api/attendance/employees/${id}?month=${month}`),
  board: (date?: string) => http<IBoardRow[]>(`/api/attendance/board${date ? `?date=${date}` : ''}`),
  report: (month: string) => http<IReportRow[]>(`/api/attendance/report?month=${month}`),

  shifts: () => http<IShift[]>('/api/attendance/shifts'),
  createShift: (body: IUpsertShift) => httpPost<IShift>('/api/attendance/shifts', body),
  updateShift: (id: string, body: IUpsertShift) => put<IShift>(`/api/attendance/shifts/${id}`, body),
  deleteShift: (id: string) => del(`/api/attendance/shifts/${id}`),

  schedules: () => http<ISchedule[]>('/api/attendance/schedules'),
  saveSchedule: (employeeId: string | null, effectiveFrom: string, days: IWeekDay[]) =>
    put<void>('/api/attendance/schedules', { employeeId, effectiveFrom, days }),
  deleteSchedule: (employeeId: string | null, effectiveFrom: string) =>
    del(`/api/attendance/schedules?effectiveFrom=${effectiveFrom}${employeeId ? `&employeeId=${employeeId}` : ''}`),

  holidays: (year: number) => http<IHoliday[]>(`/api/attendance/holidays?year=${year}`),
  createHoliday: (date: string, name: string) => httpPost<IHoliday>('/api/attendance/holidays', { date, name }),
  deleteHoliday: (id: string) => del(`/api/attendance/holidays/${id}`),
};
