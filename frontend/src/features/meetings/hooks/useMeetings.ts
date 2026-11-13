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

// ── Phiên họp agent (TEST-83) ──

/**
 * Phiên họp agent mới nhất của phòng (đang họp hoặc vừa kết thúc). Lượt nói đổi theo tin bot gửi → đang họp thì hỏi lại mỗi 3 giây,
 * không thì 15 giây (để thấy phiên người khác vừa mở). roomId null = không hỏi.
 */
export const useRoomAgentSession = (roomId: string | null | undefined) =>
  useQuery({
    queryKey: meetingKeys.roomSession(roomId ?? ''),
    queryFn: async () => (await meetingApi.sessions(roomId!))[0] ?? null,
    enabled: !!roomId,
    refetchInterval: (q) => (q.state.data?.status === 'Active' ? 3_000 : 15_000),
  });

export const useAgentBots = (enabled = true) =>
  useQuery({ queryKey: meetingKeys.agentBots, queryFn: meetingApi.agentBots, enabled, staleTime: 60_000 });

export const useAgentMeetingSettings = () => useQuery({ queryKey: meetingKeys.agentSettings, queryFn: meetingApi.agentSettings });

export function useOpenAgentMeeting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: meetingApi.openSession, onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.sessions }) });
}

export function useStopAgentMeeting() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: meetingApi.stopSession, onSuccess: () => qc.invalidateQueries({ queryKey: meetingKeys.sessions }) });
}

export function useSaveAgentMeetingSettings() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: meetingApi.saveAgentSettings, onSuccess: (d) => qc.setQueryData(meetingKeys.agentSettings, d) });
}
