import { create } from 'zustand';
import type { IMe } from '@/features/auth';
import type { BotAlertDto } from '../types/office.types';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'kicked';
/** Khung chat HUD đang mở? Nhớ theo trình duyệt; lần đầu: máy tính mở, cảm ứng đóng (chừa chỗ cho cảnh 3D). */
const CHAT_OPEN_KEY = 'officehub.office.chat-open';
const initialChatOpen = () => {
  try {
    const v = localStorage.getItem(CHAT_OPEN_KEY);
    if (v === '1' || v === '0') return v === '1';
  } catch { /* bỏ qua */ }
  return !(typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
};

/** Store dùng chung giữa React (HUD) và engine Three.js (đọc/ghi ngoài React bằng useOffice.getState()). */
interface OfficeState {
  me: IMe | null;
  conn: ConnState;
  online: number;
  /** Số bot đang làm việc (hiện trong văn phòng) */
  bots: number;
  zone: string | null;
  /** Khung chat HUD (TEST-126) đang mở. */
  chatOpen: boolean;
  /** Yêu cầu mở một hội thoại trong khung chat (toast "Trả lời", sau này "Nhắn tin riêng" khi bấm nhân vật); `seq` tăng mỗi lần để mở lại cùng id. */
  chatRequest: { conversationId: string; seq: number } | null;
  /** Bot cần chú ý (lỗi / việc chờ người, TEST-122) theo id tài khoản bot — thanh trạng thái + bảng danh sách. */
  alerts: Record<string, BotAttention>;
  /** Lý do server đẩy ra (đăng nhập nơi khác, phiên hết hiệu lực…) */
  kickReason: string | null;
  setMe: (me: IMe) => void;
  setConn: (c: ConnState) => void;
  kick: (reason: string) => void;
  setOnline: (n: number, bots: number) => void;
  setZone: (z: string | null) => void;
  setChatOpen: (open: boolean) => void;
  /** Mở khung chat, có `conversationId` → chọn đúng hội thoại đó. */
  openChat: (conversationId?: string) => void;
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
  chatOpen: initialChatOpen(),
  chatRequest: null,
  alerts: {},
  kickReason: null,
  setMe: (me) => set({ me }),
  setConn: (conn) => set({ conn }),
  kick: (kickReason) => set({ conn: 'kicked', kickReason }),
  setOnline: (online, bots) => set({ online, bots }),
  setZone: (zone) => set({ zone }),
  setChatOpen: (chatOpen) => {
    try { localStorage.setItem(CHAT_OPEN_KEY, chatOpen ? '1' : '0'); } catch { /* bỏ qua */ }
    set({ chatOpen });
  },
  openChat: (conversationId) => {
    try { localStorage.setItem(CHAT_OPEN_KEY, '1'); } catch { /* bỏ qua */ }
    set((s) => ({ chatOpen: true, chatRequest: conversationId ? { conversationId, seq: (s.chatRequest?.seq ?? 0) + 1 } : s.chatRequest }));
  },
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
