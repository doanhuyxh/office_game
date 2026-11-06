import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack';
import { REALTIME } from '@/config/env';

import type { ChatDto, PlayerDto, PositionDto, WelcomeDto } from '../types/office.types';

export interface OfficeHandlers {
  welcome(w: WelcomeDto): void;
  playerJoined(p: PlayerDto): void;
  playerLeft(id: string): void;
  positions(list: PositionDto[]): void;
  chat(m: ChatDto): void;
  teleport(x: number, z: number): void;
  kicked(reason: string): void;
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

  stop() {
    return this.conn.stop();
  }
}
