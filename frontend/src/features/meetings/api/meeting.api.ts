import { http, httpPost } from '@/services/api-client';
import type { IBooking, ICreateBooking, IMeetingRoom, IRoomNow } from '../types/meeting.types';

export const meetingKeys = {
  all: ['meetings'] as const,
  rooms: ['meetings', 'rooms'] as const,
  day: (date: string) => ['meetings', 'day', date] as const,
  mine: ['meetings', 'mine'] as const,
  now: ['meetings', 'now'] as const,
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
};
