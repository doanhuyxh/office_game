import { create } from 'zustand';
import type { IMe } from '@/features/auth';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'kicked';
export interface ChatLine { id: string; name: string; text: string; at: string; channel?: 'office' | 'room'; roomId?: string | null; roomName?: string | null }

/** Store dùng chung giữa React (HUD) và engine Three.js (đọc/ghi ngoài React bằng useOffice.getState()). */
interface OfficeState {
  me: IMe | null;
  conn: ConnState;
  online: number;
  zone: string | null;
  chat: ChatLine[];
  /** Lý do server đẩy ra (đăng nhập nơi khác, phiên hết hiệu lực…) */
  kickReason: string | null;
  setMe: (me: IMe) => void;
  setConn: (c: ConnState) => void;
  kick: (reason: string) => void;
  setOnline: (n: number) => void;
  setZone: (z: string | null) => void;
  pushChat: (l: ChatLine) => void;
}

export const useOffice = create<OfficeState>((set) => ({
  me: null,
  conn: 'connecting',
  online: 0,
  zone: null,
  chat: [],
  kickReason: null,
  setMe: (me) => set({ me }),
  setConn: (conn) => set({ conn }),
  kick: (kickReason) => set({ conn: 'kicked', kickReason }),
  setOnline: (online) => set({ online }),
  setZone: (zone) => set({ zone }),
  pushChat: (l) => set((s) => ({ chat: [...s.chat.slice(-49), l] })),
}));
