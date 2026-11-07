import { HubConnectionBuilder, HubConnectionState, LogLevel, type HubConnection } from '@microsoft/signalr';
import { MessagePackHubProtocol } from '@microsoft/signalr-protocol-msgpack';
import { REALTIME } from '@/config/env';
import type { ChatLinkState, IChatMessage } from '../types/chat.types';

export interface ChatHandlers {
  message(m: IChatMessage): void;
  deleted(conversationId: string, messageId: string): void;
  kicked(reason: string): void;
  state(s: ChatLinkState): void;
  /** Kết nối lại thành công sau khi mất → bù tin bị lỡ. */
  reconnected(): void;
}

// MessagePack của SignalR gửi object dạng map với key PascalCase → chuẩn hoá về camelCase (giống office/api/officeHub.ts).
const camel = <T,>(o: unknown): T => {
  if (Array.isArray(o)) return o.map(camel) as T;
  if (o && typeof o === 'object' && !(o instanceof Date)) {
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), camel(v)])) as T;
  }
  return o as T;
};

/** SignalR bọc lỗi hub thành "…HubException: <nội dung>" → lấy nội dung tiếng Việt do server ném; lỗi khác (đứt kết nối…) → câu chung. */
export function hubErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const i = raw.indexOf('HubException:');
  return (i >= 0 ? raw.slice(i + 'HubException:'.length).trim() : '') || 'Mất kết nối tới máy chủ chat, thử lại sau';
}

/** Chuẩn hoá tin từ MessagePack (seq có thể là bigint/null, mảng/chuỗi có thể null). */
function normalize(m: IChatMessage): IChatMessage {
  return { ...m, seq: Number(m.seq), text: m.text ?? null, deleted: !!m.deleted, attachments: m.attachments ?? [], clientId: m.clientId ?? null };
}

const RETRY_MS = [2000, 5000, 10000, 30000];

/** Kết nối hub chat (/rt/hub/chat). Nhiều kết nối/tài khoản được phép (nhiều tab, nhiều thiết bị). */
export class ChatConnection {
  private readonly conn: HubConnection;
  private stopped = false;
  private kickedOut = false;

  constructor(private readonly h: ChatHandlers) {
    this.conn = new HubConnectionBuilder()
      .withUrl(REALTIME.chatHub)
      .withHubProtocol(new MessagePackHubProtocol())
      .withAutomaticReconnect([0, 1000, 3000, 5000, 10000, 30000])
      .configureLogging(LogLevel.Warning)
      .build();

    this.conn.on('Message', (m) => h.message(normalize(camel(m))));
    this.conn.on('MessageDeleted', (conversationId: string, messageId: string) => h.deleted(conversationId, messageId));
    this.conn.on('Kicked', (reason: string) => {
      this.kickedOut = true;
      h.kicked(reason);
      void this.conn.stop();
    });
    this.conn.onreconnecting(() => !this.kickedOut && h.state('reconnecting'));
    this.conn.onreconnected(() => {
      h.state('online');
      h.reconnected();
    });
    this.conn.onclose(() => {
      if (!this.stopped && !this.kickedOut) {
        h.state('offline');
        void this.start(); // hết lượt tự kết nối lại → thử lại từ đầu
      }
    });
  }

  get connected() {
    return this.conn.state === HubConnectionState.Connected;
  }

  /** Kết nối; lần đầu thất bại (Realtime chưa lên…) → thử lại dần cho tới khi được hoặc bị stop(). */
  async start() {
    this.h.state('connecting');
    for (let attempt = 0; !this.stopped && !this.kickedOut; attempt++) {
      try {
        await this.conn.start();
        if (this.stopped) return void (await this.conn.stop());
        this.h.state('online');
        if (attempt > 0) this.h.reconnected();
        return;
      } catch {
        if (this.stopped) return;
        this.h.state('offline');
        await new Promise((r) => setTimeout(r, RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)]));
      }
    }
  }

  /** Trả tin đã lưu (đúng như người nhận thấy). Lỗi nghiệp vụ → Error có thông điệp tiếng Việt (xem hubErrorMessage). */
  async send(conversationId: string, text: string | null, uploadIds: string[], clientId: string): Promise<IChatMessage> {
    try {
      const m = await this.conn.invoke('Send', conversationId, text, uploadIds.length ? uploadIds : null, clientId);
      return normalize(camel<IChatMessage>(m));
    } catch (err) {
      throw new Error(hubErrorMessage(err));
    }
  }

  async remove(messageId: string) {
    try {
      await this.conn.invoke('Delete', messageId);
    } catch (err) {
      throw new Error(hubErrorMessage(err));
    }
  }

  stop() {
    this.stopped = true;
    return this.conn.stop();
  }
}
