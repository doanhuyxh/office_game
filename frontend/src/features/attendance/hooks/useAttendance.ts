import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import { attendanceApi, attendanceKeys } from '../api/attendance.api';
import type { CheckSource, ICreateCorrection, ICreateOvertime, IUpsertShift, IWeekDay } from '../types/attendance.types';

/** Trạng thái chấm công hôm nay. `noProfile` = tài khoản chưa gắn hồ sơ nhân viên (ví dụ admin hệ thống). */
export function useToday() {
  const q = useQuery({
    queryKey: attendanceKeys.today,
    queryFn: attendanceApi.today,
    refetchInterval: 60_000, // cập nhật giờ làm đang chạy
    retry: (n, err) => !(err instanceof ApiError && err.status === 409) && n < 1,
  });
  const noProfile = q.error instanceof ApiError && q.error.problem.title === 'no_employee_profile';
  return { ...q, noProfile };
}

/** Bấm chấm công (vào ↔ ra). */
export function useCheck() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (source: CheckSource) => attendanceApi.check(source),
    onSuccess: (today) => {
      qc.setQueryData(attendanceKeys.today, today);
      qc.invalidateQueries({ queryKey: attendanceKeys.all, predicate: (q) => q.queryKey[1] !== 'today' });
    },
  });
}

export const useMyMonth = (month: string) => useQuery({ queryKey: attendanceKeys.my(month), queryFn: () => attendanceApi.my(month) });
export const useEmployeeMonth = (id: string | null, month: string) =>
  useQuery({ queryKey: attendanceKeys.employee(id ?? '', month), queryFn: () => attendanceApi.employeeMonth(id!, month), enabled: !!id });
export const useBoardPage = (q: IPageQuery) =>
  useQuery({ queryKey: attendanceKeys.boardPage(q), queryFn: () => attendanceApi.boardPage(q), refetchInterval: 60_000, placeholderData: (prev) => prev });
export const useReportPage = (month: string, q: IPageQuery) =>
  useQuery({ queryKey: attendanceKeys.reportPage(month, q), queryFn: () => attendanceApi.reportPage(month, q), placeholderData: (prev) => prev });
export const useShifts = () => useQuery({ queryKey: attendanceKeys.shifts, queryFn: attendanceApi.shifts });
export const useSchedulesPage = (q: IPageQuery) =>
  useQuery({ queryKey: attendanceKeys.schedulesPage(q), queryFn: () => attendanceApi.schedulesPage(q), placeholderData: (prev) => prev });
export const useHolidays = (year: number) => useQuery({ queryKey: attendanceKeys.holidays(year), queryFn: () => attendanceApi.holidays(year) });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: attendanceKeys.all });
}

export function useSaveShift() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: IUpsertShift }) => (id ? attendanceApi.updateShift(id, body) : attendanceApi.createShift(body)),
    onSuccess: invalidate,
  });
}
export function useDeleteShift() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => attendanceApi.deleteShift(id), onSuccess: invalidate });
}
export function useSaveSchedule() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: (v: { employeeId: string | null; effectiveFrom: string; days: IWeekDay[] }) => attendanceApi.saveSchedule(v.employeeId, v.effectiveFrom, v.days),
    onSuccess: invalidate,
  });
}
export function useDeleteSchedule() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { employeeId: string | null; effectiveFrom: string }) => attendanceApi.deleteSchedule(v.employeeId, v.effectiveFrom), onSuccess: invalidate });
}
export function useCreateHoliday() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (v: { date: string; name: string }) => attendanceApi.createHoliday(v.date, v.name), onSuccess: invalidate });
}
export function useDeleteHoliday() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: (id: string) => attendanceApi.deleteHoliday(id), onSuccess: invalidate });
}

export const useMyCorrections = (month: string) =>
  useQuery({ queryKey: attendanceKeys.corrections(month), queryFn: () => attendanceApi.myCorrections(month), retry: false });

export function useCreateCorrection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ICreateCorrection) => attendanceApi.createCorrection(body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: attendanceKeys.all }), qc.invalidateQueries({ queryKey: ['approval'] })]),
  });
}

export const useMyOvertimePage = (month: string, q: IPageQuery) =>
  useQuery({ queryKey: attendanceKeys.overtimePage(month, q), queryFn: () => attendanceApi.myOvertimePage(month, q), retry: false, placeholderData: (prev) => prev });

/** Xem trước đơn tăng ca (số giờ, loại ngày, cảnh báo vượt giới hạn). Chỉ gọi khi đủ ngày + giờ. Lỗi 400 trả theo field. */
export const useOvertimePreview = (v: Omit<ICreateOvertime, 'reason'>, enabled: boolean) =>
  useQuery({
    queryKey: attendanceKeys.overtimePreview(v),
    queryFn: () => attendanceApi.previewOvertime(v),
    enabled: enabled && !!v.workDate && /^\d{2}:\d{2}$/.test(v.startTime) && /^\d{2}:\d{2}$/.test(v.endTime),
    retry: false,
    staleTime: 10_000,
  });

export function useCreateOvertime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ICreateOvertime) => attendanceApi.createOvertime(body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: attendanceKeys.all }), qc.invalidateQueries({ queryKey: ['approval'] })]),
  });
}
