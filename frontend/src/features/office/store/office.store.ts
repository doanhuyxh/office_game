import { create } from 'zustand';
import type { IMe } from '@/features/auth';

export type ConnState = 'connecting' | 'online' | 'reconnecting' | 'offline' | 'kicked';
export interface ChatLine { id: string; name: string; text: string; at: string }

/** Store dùng chung giữa React (HUD) và engine Three.js (đọc/ghi ngoài React bằng useOffice.getState()). */
interface OfficeState {
  me: IMe | null;
  conn: ConnState;
  online: number;
  zone: string | null;
  chat: ChatLine[];
  setMe: (me: IMe) => void;
  setConn: (c: ConnState) => void;
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
  setMe: (me) => set({ me }),
  setConn: (conn) => set({ conn }),
  setOnline: (online) => set({ online }),
  setZone: (zone) => set({ zone }),
  pushChat: (l) => set((s) => ({ chat: [...s.chat.slice(-49), l] })),
}));
