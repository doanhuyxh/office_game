import { http, httpPost, pageQs } from '@/services/api-client';
import type { IPageQuery } from '@/types/api';
import type { INotificationList, INotificationPage, INotificationPreferences } from '../types/notification.types';

export const notificationKeys = {
  all: ['notifications'] as const,
  list: ['notifications', 'list'] as const,
  page: (unread: boolean, q: IPageQuery) => ['notifications', 'page', unread, q] as const,
  preferences: ['notifications', 'preferences'] as const,
};

export const notificationApi = {
  list: (take = 20) => http<INotificationList>(`/api/notifications?take=${take}`),
  /** Trang /notifications: unread = chỉ lấy thông báo chưa đọc. */
  page: (unread: boolean, q: IPageQuery) => http<INotificationPage>(`/api/notifications?${unread ? 'unread=true&' : ''}${pageQs(q)}`),
  read: (id: string) => httpPost<void>(`/api/notifications/${id}/read`),
  readAll: () => httpPost<void>('/api/notifications/read-all'),
  registerPushToken: (token: string) => http<void>('/api/notifications/push-tokens', { method: 'PUT', body: JSON.stringify({ token }) }),
  preferences: () => http<INotificationPreferences>('/api/notifications/preferences'),
  savePreferences: (body: INotificationPreferences) =>
    http<INotificationPreferences>('/api/notifications/preferences', { method: 'PUT', body: JSON.stringify(body) }),
  unregisterPushToken: (token: string) => http<void>('/api/notifications/push-tokens', { method: 'DELETE', body: JSON.stringify({ token }) }),
};
