import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IPageQuery } from '@/types/api';
import { notificationApi, notificationKeys } from '../api/notification.api';
import { getPushSnapshot, subscribePush } from '../utils/push';
import { playNotificationSound } from '../utils/sound';

/** Có push rồi thì chuông không còn là kênh báo nhanh chính → hỏi lại thưa hơn. */
const POLL_MS = { withPush: 120_000, fallback: 30_000 };

/**
 * Thông báo của tôi (20 mới nhất + số chưa đọc), hỏi lại mỗi 30 giây — hoặc 2 phút nếu đã bật thông báo đẩy.
 * Có thông báo mới → phát âm chuông (nếu bật) + làm mới dữ liệu đơn / nghỉ phép / chấm công.
 */
export function useNotifications() {
  const qc = useQueryClient();
  const pushEnabled = useSyncExternalStore(subscribePush, getPushSnapshot, getPushSnapshot);
  const q = useQuery({ queryKey: notificationKeys.list, queryFn: () => notificationApi.list(), refetchInterval: pushEnabled ? POLL_MS.withPush : POLL_MS.fallback });
  const last = useRef<number | null>(null);
  const unread = q.data?.unreadCount;
  useEffect(() => {
    if (unread === undefined) return;
    if (last.current !== null && unread > last.current) {
      playNotificationSound();
      ['approval', 'leave', 'attendance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    }
    last.current = unread;
  }, [unread, qc]);
  return q;
}

/** Trang /notifications (BE cắt trang); hỏi lại mỗi 30 giây như chuông. */
export const useNotificationsPage = (unread: boolean, q: IPageQuery) =>
  useQuery({ queryKey: notificationKeys.page(unread, q), queryFn: () => notificationApi.page(unread, q), refetchInterval: 30_000, placeholderData: (prev) => prev });

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: notificationApi.read, onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }) });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: notificationApi.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }) });
}
