import { errText } from './log';

/**
 * Gọi tool MCP của OfficeHub bằng token AI của agent (JSON-RPC qua HTTP, phản hồi JSON hoặc SSE).
 * Runner chỉ dùng vài tool đọc (get_my_profile, get_task) + comment_task để báo PR / chi phí.
 */
export class OfficeHubClient {
  private id = 0;
  private initialized = false;

  constructor(private readonly url: string, private readonly token: string) {}

  private async rpc(method: string, params: unknown): Promise<any> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 401) throw new Error('OfficeHub từ chối token AI (401) — token sai / đã thu hồi / hết hạn');
    if (!res.ok) throw new Error(`OfficeHub MCP trả ${res.status}`);
    const text = await res.text();
    const payload = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    const msg = JSON.parse(payload);
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result;
  }

  async callTool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.initialized) {
      await this.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'officehub-agent-runner', version: '1' } });
      this.initialized = true;
    }
    const r = await this.rpc('tools/call', { name, arguments: args });
    const text: string = r?.content?.[0]?.text ?? '';
    if (r?.isError) throw new Error(`${name}: ${text.slice(0, 300)}`);
    try { return JSON.parse(text) as T; } catch { return text as T; }
  }

  /** Nhân viên của token: { id, code, fullName }. */
  async me(): Promise<{ id: string; code: string; fullName: string }> {
    const p = await this.callTool<any>('get_my_profile', {});
    const e = p?.employee;
    if (!e?.id || !e?.code) throw new Error('get_my_profile không trả hồ sơ nhân viên (tài khoản chưa gắn nhân viên?)');
    return { id: e.id, code: String(e.code).toUpperCase(), fullName: e.fullName ?? '' };
  }

  getTask(task: string) { return this.callTool<any>('get_task', { task }); }

  async comment(task: string, content: string) {
    try { await this.callTool('comment_task', { task, content }); return true; }
    catch (e) { return errText(e); }
  }
}
