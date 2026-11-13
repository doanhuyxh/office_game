import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack';
import { REALTIME } from '@/config/env';

import type { ChatDto, PlayerDto, PositionDto, ScreenDto, WelcomeDto } from '../types/office.types';

export interface OfficeHandlers {
  welcome(w: WelcomeDto): void;
  playerJoined(p: PlayerDto): void;
  playerLeft(id: string): void;
  positions(list: PositionDto[]): void;
  chat(m: ChatDto): void;
  teleport(x: number, z: number): void;
  kicked(reason: string): void;
  lookChanged(id: string, look: string | null): void;
  /** HR đổi họ tên của người `id` → cập nhật nhãn tên. */
  nameChanged(id: string, name: string): void;
  /** Màn hình phòng đổi tài liệu đang chiếu (null = tắt) — chỉ nhận khi đang ở trong phòng đó. */
  screenChanged(roomId: string, screen: ScreenDto | null): void;
  /** Bot của tài khoản `id` đang làm gì (null = hết hoạt động). */
  botStatus(id: string, status: string | null): void;
  state(s: 'online' | 'reconnecting' | 'offline'): void;
}

// MessagePack của SignalR gửi object dạng map với key PascalCase → chuẩn hoá về camelCase.
const camel = <T,>(o: unknown): T => {
  if (Array.isArray(o)) return o.map(camel) as T;
  if (o && typeof o === 'object' && !(o instanceof Date)) {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), camel(v)])) as T;
  }
  return o as T;
};

export class OfficeConnection {
  readonly conn: HubConnection;
  /** Bị đẩy ra do tài khoản vào từ tab khác → KHÔNG tự kết nối lại (tránh 2 tab đẩy nhau mãi). */
  private kicked = false;

  constructor(h: OfficeHandlers) {
    this.conn = new HubConnectionBuilder()
      .withUrl(REALTIME.officeHub)
      .withHubProtocol(new MessagePackHubProtocol())
      .withAutomaticReconnect([0, 1000, 3000, 5000, 10000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.conn.on('Welcome', (w) => h.welcome(camel(w)));
    this.conn.on('PlayerJoined', (p) => h.playerJoined(camel(p)));
    this.conn.on('PlayerLeft', (id: string) => h.playerLeft(id));
    this.conn.on('Positions', (l) => h.positions(camel(l)));
    this.conn.on('Chat', (m) => h.chat(camel(m)));
    this.conn.on('Teleport', (x: number, z: number) => h.teleport(x, z));
    this.conn.on('LookChanged', (id: string, look: string | null) => h.lookChanged(id, look ?? null));
    this.conn.on('NameChanged', (id: string, name: string) => h.nameChanged(id, name));
    this.conn.on('ScreenChanged', (roomId: string, s: unknown) => h.screenChanged(roomId, s ? camel<ScreenDto>(s) : null));
    this.conn.on('BotStatus', (id: string, status: string | null) => h.botStatus(id, status ?? null));
    this.conn.on('Kicked', (reason: string) => {
      this.kicked = true;
      h.kicked(reason);
      void this.conn.stop();
    });
    this.conn.onreconnecting(() => {
      if (this.kicked) void this.conn.stop();
      else h.state('reconnecting');
    });
    this.conn.onreconnected(() => h.state('online'));
    this.conn.onclose(() => !this.kicked && h.state('offline'));
  }

  async start() {
    await this.conn.start();
  }

  move(x: number, z: number, r: number, anim: number) {
    if (this.conn.state === HubConnectionState.Connected) void this.conn.send('Move', x, z, r, anim);
  }

  chat(text: string) {
    return this.conn.invoke('SendChat', text);
  }

  /** Chat chỉ trong phòng có tường đang đứng (server tự xác định phòng theo vị trí). */
  roomChat(text: string) {
    return this.conn.invoke('SendRoomChat', text);
  }

  /** Vừa lưu nhân vật qua REST → server tự đọc lại từ Api rồi phát LookChanged cho cả văn phòng. */
  refreshLook() {
    return this.conn.state === HubConnectionState.Connected ? this.conn.invoke('RefreshLook') : Promise.resolve();
  }

  /** Tài liệu đang chiếu ở phòng có tường mình đang đứng (server xác định phòng); null = chưa chiếu / khu mở. */
  async getScreen(): Promise<ScreenDto | null> {
    if (this.conn.state !== HubConnectionState.Connected) return null;
    const s = await this.conn.invoke('GetScreen');
    return s ? camel<ScreenDto>(s) : null;
  }

  /** Chiếu tài liệu lên màn hình phòng đang đứng (server hỏi Api bằng quyền của mình). */
  pinScreen(assetId: string) {
    return this.conn.invoke('PinScreen', assetId);
  }

  clearScreen() {
    return this.conn.invoke('ClearScreen');
  }

  stop() {
    return this.conn.stop();
  }
}
