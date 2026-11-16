import { create } from 'zustand';
import type { IMe } from '@/features/auth';
import type { BotAlertDto, ChatMentionDto } from '../types/office.types';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'kicked';
export interface ChatLine {
  id: string; name: string; text: string; at: string; channel?: 'office' | 'room'; roomId?: string | null; roomName?: string | null;
  /** Người được @nhắc — HUD thay "@mã" bằng tên, nhấn dòng nhắc mình. */
  mentions?: ChatMentionDto[] | null;
}

/** Store dùng chung giữa React (HUD) và engine Three.js (đọc/ghi ngoài React bằng useOffice.getState()). */
interface OfficeState {
  me: IMe | null;
  conn: ConnState;
  online: number;
  /** Số bot đang làm việc (hiện trong văn phòng) */
  bots: number;
  zone: string | null;
  chat: ChatLine[];
  /** Bot cần chú ý (lỗi / việc chờ người, TEST-122) theo id tài khoản bot — thanh trạng thái + bảng danh sách. */
  alerts: Record<string, BotAttention>;
  /** Lý do server đẩy ra (đăng nhập nơi khác, phiên hết hiệu lực…) */
  kickReason: string | null;
  setMe: (me: IMe) => void;
  setConn: (c: ConnState) => void;
  kick: (reason: string) => void;
  setOnline: (n: number, bots: number) => void;
  setZone: (z: string | null) => void;
  pushChat: (l: ChatLine) => void;
  /** Gán / gỡ (null) cảnh báo của một bot; `name` = tên hiện trên avatar. */
  setAlert: (id: string, name: string, alert: BotAlertDto | null) => void;
  /** Đổi tên (NameChanged) — chỉ khi đang có cảnh báo. */
  renameAlert: (id: string, name: string) => void;
  /** Welcome (vào lại / kết nối lại) → bắt đầu lại từ danh sách người trong văn phòng. */
  clearAlerts: () => void;
}
export interface BotAttention { name: string; alert: BotAlertDto }

export const useOffice = create<OfficeState>((set) => ({
  me: null,
  conn: 'connecting',
  online: 0,
  bots: 0,
  zone: null,
  chat: [],
  alerts: {},
  kickReason: null,
  setMe: (me) => set({ me }),
  setConn: (conn) => set({ conn }),
  kick: (kickReason) => set({ conn: 'kicked', kickReason }),
  setOnline: (online, bots) => set({ online, bots }),
  setZone: (zone) => set({ zone }),
  pushChat: (l) => set((s) => ({ chat: [...s.chat.slice(-49), l] })),
  setAlert: (id, name, alert) => set((s) => {
    if (!alert && !(id in s.alerts)) return s;
    const alerts = { ...s.alerts };
    if (alert) alerts[id] = { name, alert };
    else delete alerts[id];
    return { alerts };
  }),
  renameAlert: (id, name) => set((s) => (s.alerts[id] ? { alerts: { ...s.alerts, [id]: { ...s.alerts[id], name } } } : s)),
  clearAlerts: () => set({ alerts: {} }),
}));
