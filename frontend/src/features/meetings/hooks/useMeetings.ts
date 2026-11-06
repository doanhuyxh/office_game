import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addDays, vnInstant } from '@/utils/date';
import { meetingApi, meetingKeys } from '../api/meeting.api';

export const useMeetingRooms = () => useQuery({ queryKey: meetingKeys.rooms, queryFn: meetingApi.rooms, staleTime: Infinity });

/** Lịch cả ngày (giờ VN) của mọi phòng. */
export const useDayBookings = (date: string) =>
  useQuery({ queryKey: meetingKeys.day(date), queryFn: () => meetingApi.list(vnInstant(date, '00:00'), vnInstant(addDays(date, 1), '00:00')), refetchInterval: 60_000 });

/** Lịch tôi tổ chức / được mời trong 14 ngày tới. */
export const useMyBookings = (today: string) =>
  useQuery({ queryKey: meetingKeys.mine, queryFn: () => meetingApi.list(vnInstant(today, '00:00'), vnInstant(addDays(today, 14), '00:00'), true) });

/** Trạng thái phòng hiện tại (văn phòng 3D). */
export const useRoomsNow = (enabled = true) =>
  useQuery({ queryKey: meetingKeys.now, queryFn: meetingApi.now, refetchInterval: 60_000, enabled });

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: meetingKeys.all });
}

export function useCreateBooking() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: meetingApi.create, onSuccess: invalidate });
}

export function useCancelBooking() {
  const invalidate = useInvalidate();
  return useMutation({ mutationFn: meetingApi.cancel, onSuccess: invalidate });
}
