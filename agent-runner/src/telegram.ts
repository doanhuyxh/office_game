/** Telegram Bot API tối thiểu (fetch): getMe, getUpdates (long polling), sendMessage. URL có token → không bao giờ log URL. */
export interface TgMessage {
  message_id: number;
  chat: { id: number; type: string };
  from?: { id: number; is_bot: boolean; username?: string };
  text?: string;
  date: number;
}
export interface TgUpdate { update_id: number; message?: TgMessage }

export class TelegramClient {
  constructor(private readonly apiUrl: string, private readonly token: string) {}

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    const res = await fetch(`${this.apiUrl}/bot${this.token}/${method}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({})) as any;
    if (!res.ok || !data.ok) {
      const err = new Error(`Telegram ${method} lỗi ${res.status}${data?.description ? `: ${data.description}` : ''}`) as Error & { retryAfter?: number };
      err.retryAfter = data?.parameters?.retry_after;
      throw err;
    }
    return data.result as T;
  }

  getMe() { return this.call<{ id: number; username: string; is_bot: boolean }>('getMe', {}); }

  /** Long polling 50 giây; chỉ nhận message. */
  getUpdates(offset: number) {
    return this.call<TgUpdate[]>('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, 65_000);
  }

  sendMessage(chatId: string, text: string) {
    return this.call('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  }
}
