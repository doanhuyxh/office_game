import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import type { INotification, INotificationList } from '../types/notification.types';

/** Quá số này trong một lần hỏi lại → gộp thành một toast "N thông báo mới" thay vì hiện từng cái. */
const MAX_SINGLE = 3;

/**
 * Toast cho thông báo MỚI xuất hiện trong danh sách chuông (chỉ văn phòng ảo, TEST-109 — cổng nhân sự chỉ phát âm).
 * Lần tải đầu chỉ ghi nhận, không toast (tránh dội thông báo cũ khi vào văn phòng). Âm chuông do `useNotifications` phát.
 */
export function useNewNotificationToasts(data: INotificationList | undefined, enabled: boolean, onOpen: (n: INotification) => void, onOpenAll: () => void) {
  const seen = useRef<Set<string> | null>(null);
  const handlers = useRef({ onOpen, onOpenAll });
  handlers.current = { onOpen, onOpenAll };

  useEffect(() => {
    if (!enabled || !data) return;
    if (seen.current === null) {
      seen.current = new Set(data.items.map((n) => n.id));
      return;
    }
    const known = seen.current;
    const fresh = data.items.filter((n) => !n.read && !known.has(n.id));
    data.items.forEach((n) => known.add(n.id));
    if (fresh.length > MAX_SINGLE) {
      toast.info(`Bạn có ${fresh.length} thông báo mới`, { action: { label: 'Xem', onClick: () => handlers.current.onOpenAll() } });
      return;
    }
    // Danh sách mới nhất trước → hiện cũ trước để toast mới nhất nằm trên cùng
    [...fresh].reverse().forEach((n) =>
      toast.info(n.title, {
        description: n.body,
        action: { label: 'Xem', onClick: () => handlers.current.onOpen(n) },
      }),
    );
  }, [data, enabled]);
}
