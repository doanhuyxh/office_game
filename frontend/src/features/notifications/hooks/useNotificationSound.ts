import { useSyncExternalStore } from 'react';
import { getSoundSnapshot, setSoundEnabled, subscribeSound } from '../utils/sound';

/** Trạng thái bật/tắt âm thanh chuông, dùng chung giữa chuông và trang hồ sơ. */
export function useNotificationSound(): [boolean, (on: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeSound, getSoundSnapshot, getSoundSnapshot);
  return [enabled, setSoundEnabled];
}
