import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationApi, notificationKeys } from '../api/notification.api';

/**
 * Thông báo của tôi (20 mới nhất + số chưa đọc), hỏi lại mỗi 30 giây.
 * Có thông báo mới → làm mới dữ liệu đơn / nghỉ phép / chấm công (người khác vừa duyệt hoặc gửi đơn).
 */
export function useNotifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: notificationKeys.list, queryFn: () => notificationApi.list(), refetchInterval: 30_000 });
  const last = useRef<number | null>(null);
  const unread = q.data?.unreadCount;
  useEffect(() => {
    if (unread === undefined) return;
    if (last.current !== null && unread > last.current)
      ['approval', 'leave', 'attendance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    last.current = unread;
  }, [unread, qc]);
  return q;
}

export function useMarkRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: notificationApi.read, onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }) });
}

export function useMarkAllRead() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: notificationApi.readAll, onSuccess: () => qc.invalidateQueries({ queryKey: notificationKeys.all }) });
}
