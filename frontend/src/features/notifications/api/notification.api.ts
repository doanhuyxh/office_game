import { http, httpPost } from '@/services/api-client';
import type { INotificationList } from '../types/notification.types';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
};

export const notificationApi = {
  list: (take = 20) => http<INotificationList>(`/api/notifications?take=${take}`),
  read: (id: string) => httpPost<void>(`/api/notifications/${id}/read`),
  readAll: () => httpPost<void>('/api/notifications/read-all'),
};
