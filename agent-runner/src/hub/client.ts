import { errText } from '../log';
import type { ChatSummary, MeetingState, MyTask, ProfileResult, ProjectDetail, TaskDetail } from './types';

/** Phong bì JSON-RPC và kết quả `tools/call` của MCP (chỉ phần runner đọc). */
interface RpcMessage {
  error?: { message?: string };
  result?: ToolResult;
}
interface ToolResult {
  content?: { text?: string }[];
  isError?: boolean;
}

/** Hạn một lần gọi MCP. */
const RPC_TIMEOUT_MS = 30_000;

/**
 * Gọi tool MCP của OfficeHub bằng token AI của agent (JSON-RPC qua HTTP, phản hồi JSON hoặc SSE).
 * Runner chỉ dùng vài tool đọc (get_my_profile, get_task, get_project, list_my_tasks, list_chats, get_my_meeting) + comment_task để báo PR / chi phí + pass_turn khi agent
 * không dùng được lượt nói trong cuộc họp.
 */
export class OfficeHubClient {
  private id = 0;
  private initialized = false;

  constructor(
    private readonly url: string,
    private readonly token: string,
  ) {}

  private async rpc(method: string, params: unknown): Promise<ToolResult | undefined> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++this.id, method, params }),
      signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
    });
    if (res.status === 401) throw new Error('OfficeHub từ chối token AI (401) — token sai / đã thu hồi / hết hạn');
    if (!res.ok) throw new Error(`OfficeHub MCP trả ${res.status}`);
    const text = await res.text();
    const payload =
      text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5))
        .pop() ?? text;
    const msg = JSON.parse(payload) as RpcMessage;
    if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
    return msg.result;
  }

  /** Gọi một tool; kết quả là JSON tool trả (không phải JSON → chuỗi thô). Kiểu `T` chỉ là kỳ vọng — nơi dùng phải kiểm tra. */
  async callTool<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    if (!this.initialized) {
      await this.rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'officehub-agent-runner', version: '1' },
      });
      this.initialized = true;
    }
    const r = await this.rpc('tools/call', { name, arguments: args });
    const text = r?.content?.[0]?.text ?? '';
    if (r?.isError) throw new Error(`${name}: ${text.slice(0, 300)}`);
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as T;
    }
  }

  /** Nhân viên của token: { id, code, fullName }. */
  async me(): Promise<{ id: string; code: string; fullName: string }> {
    const profile = await this.callTool<ProfileResult | undefined>('get_my_profile', {});
    const e = profile?.employee;
    if (!e?.id || !e?.code) throw new Error('get_my_profile không trả hồ sơ nhân viên (tài khoản chưa gắn nhân viên?)');
    return { id: e.id, code: String(e.code).toUpperCase(), fullName: e.fullName ?? '' };
  }

  getTask(task: string) {
    return this.callTool<TaskDetail | undefined>('get_task', { task });
  }

  /** Dự án theo mã (hoặc id) — đổi mã dự án trong `projects` thành id lúc khởi động / `doctor` (TEST-200). */
  getProject(project: string) {
    return this.callTool<ProjectDetail | undefined>('get_project', { project });
  }

  /** Việc chưa xong đang giao cho agent ở mọi dự án (tối đa 200, sắp theo hạn) — bắt bù lúc khởi động (TEST-158). */
  myTasks() {
    return this.callTool<MyTask[] | undefined>('list_my_tasks', {});
  }

  /** Hội thoại của agent (chỉ tài khoản bot): `[{ conversation, type, unread, mentionedUnread, … }]`. */
  listChats() {
    return this.callTool<ChatSummary[] | undefined>('list_chats', {});
  }

  /** Cuộc họp agent đang dự (chỉ tài khoản bot): `{ inMeeting, sessionId, isMyTurn, isChair, … }`. */
  myMeeting() {
    return this.callTool<MeetingState | undefined>('get_my_meeting', {});
  }

  /** Bỏ lượt nói đang giữ (runner gọi thay khi agent không dùng được lượt — cuộc họp không đứng chờ hết hạn). */
  passTurn() {
    return this.callTool('pass_turn', {});
  }

  async comment(task: string, content: string) {
    try {
      await this.callTool('comment_task', { task, content });
      return true;
    } catch (e) {
      return errText(e);
    }
  }
}
