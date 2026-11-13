import { http, httpPost } from '@/services/api-client';
import type {
  IAgentBotOption, IAgentMeeting, IAgentMeetingSettings, IBooking, ICreateBooking, IMeetingRoom, IOpenAgentMeeting, IRoomNow,
} from '../types/meeting.types';

export const meetingKeys = {
  all: ['meetings'] as const,
  rooms: ['meetings', 'rooms'] as const,
  day: (date: string) => ['meetings', 'day', date] as const,
  mine: ['meetings', 'mine'] as const,
  now: ['meetings', 'now'] as const,
  sessions: ['meetings', 'sessions'] as const,
  roomSession: (roomId: string) => ['meetings', 'sessions', 'room', roomId] as const,
  agentBots: ['meetings', 'agent-bots'] as const,
  agentSettings: ['meetings', 'agent-settings'] as const,
};

const base = '/api/meetings';
export const meetingApi = {
  rooms: () => http<IMeetingRoom[]>(`${base}/rooms`),
  /** from / to: thời điểm kèm múi giờ. */
  list: (from: string, to: string, mine = false) =>
    http<IBooking[]>(`${base}/bookings?${new URLSearchParams({ from, to, ...(mine ? { mine: 'true' } : {}) })}`),
  now: () => http<IRoomNow[]>(`${base}/bookings/now`),
  create: (body: ICreateBooking) => httpPost<{ booking: IBooking; warnings: string[] }>(`${base}/bookings`, body),
  cancel: (id: string) => http<void>(`${base}/bookings/${id}`, { method: 'DELETE' }),

  /** Phiên họp agent của phòng, mới nhất trước (≤ 50); active = chỉ phiên đang họp. */
  sessions: (roomId?: string, active = false) =>
    http<IAgentMeeting[]>(`${base}/sessions?${new URLSearchParams({ ...(roomId ? { roomId } : {}), ...(active ? { active: 'true' } : {}) })}`),
  openSession: (body: IOpenAgentMeeting) => httpPost<IAgentMeeting>(`${base}/sessions`, body),
  stopSession: (id: string) => httpPost<IAgentMeeting>(`${base}/sessions/${id}/stop`),
  agentBots: () => http<IAgentBotOption[]>(`${base}/agent-bots`),
  agentSettings: () => http<IAgentMeetingSettings>(`${base}/agent-settings`),
  saveAgentSettings: (body: { maxTurns: number; maxMinutes: number }) =>
    http<IAgentMeetingSettings>(`${base}/agent-settings`, { method: 'PUT', body: JSON.stringify(body) }),
};
