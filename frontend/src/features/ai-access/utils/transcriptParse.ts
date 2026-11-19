// Phân tích transcript phiên agent (.jsonl, TEST-197) thành từng lượt để xem nhanh trên web.
// Hỗ trợ đầy đủ định dạng adapter `claude` (Claude Code: `<HOME>/.claude/projects/<cwd>/<session>.jsonl`); dòng không nhận ra (adapter khác,
// loại sự kiện lạ, JSON hỏng) → lượt "raw" hiện JSON thô — KHÔNG ném lỗi. Nội dung do agent sinh ra → chỉ là dữ liệu, chỉ hiển thị dạng chữ.

export type TranscriptTurnKind = 'user' | 'assistant' | 'thinking' | 'tool_call' | 'tool_result' | 'meta' | 'raw';

export const TURN_KINDS: TranscriptTurnKind[] = ['user', 'assistant', 'thinking', 'tool_call', 'tool_result', 'meta', 'raw'];

/** Nhãn từng loại lượt (bộ lọc + đầu lượt). */
export const TURN_KIND_LABEL: Record<TranscriptTurnKind, string> = {
  user: 'Người dùng', assistant: 'Assistant', thinking: 'Suy nghĩ', tool_call: 'Gọi tool', tool_result: 'Kết quả tool', meta: 'Hệ thống', raw: 'Khác (JSON thô)',
};

/** Loại lượt ẩn sẵn trong bộ lọc: bản ghi nội bộ của CLI (api-request, attachment…) — nhiều và dài, ít khi cần đọc. */
export const TURN_KINDS_HIDDEN_BY_DEFAULT: TranscriptTurnKind[] = ['meta'];

export interface ITranscriptTurn {
  /** Số thứ tự lượt (0..n-1) — khoá ổn định khi lọc. */
  i: number;
  kind: TranscriptTurnKind;
  /** Dòng trong file .jsonl (bắt đầu từ 1). */
  line: number;
  /** Thời điểm ISO (UTC) nếu dòng có. */
  at: string | null;
  /** Nội dung chính: Markdown (assistant), chữ (user, kết quả tool, suy nghĩ), JSON tham số (gọi tool), dòng gốc (meta / raw). */
  text: string;
  /** Tên tool (gọi tool / kết quả tool) hoặc loại bản ghi (meta / raw). */
  title?: string;
  /** Tham số gọi tool (đã parse). */
  input?: Record<string, unknown>;
  /** Kết quả tool báo lỗi. */
  isError?: boolean;
  /** Lượt của agent con (Task / subagent). */
  sidechain?: boolean;
}

/** Bản ghi nội bộ của Claude Code (không phải hội thoại) → lượt "Hệ thống". */
const CLAUDE_META_TYPES = new Set([
  'summary', 'system', 'attachment', 'file-history-snapshot', 'queue-operation', 'session-owner', 'atis-latch', 'last-prompt', 'tools-used',
  'cost-state', 'api-request', 'api-request-shape', 'api-request-blob', 'progress', 'custom-title', 'tag', 'pr-link', 'agent-name',
]);

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => (typeof v === 'string' ? v : '');

/** Nội dung kết quả tool → chữ: chuỗi giữ nguyên; mảng khối → nối chữ, ảnh / tham chiếu tool thành nhãn ngắn. */
function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return content == null ? '' : JSON.stringify(content, null, 2);
  return content.map((b) => {
    if (!isObj(b)) return String(b);
    if (b.type === 'text') return str(b.text);
    if (b.type === 'image') return '[Ảnh]';
    if (b.type === 'tool_reference') return `→ ${str(b.tool_name)}`;
    return JSON.stringify(b);
  }).join('\n');
}

/**
 * Bộ phân tích theo luồng: gọi {@link push} cho từng dòng (theo thứ tự file), đọc {@link turns}.
 * Nhớ `tool_use.id → tên tool` để kết quả tool biết của tool nào.
 */
export class TranscriptParser {
  readonly turns: ITranscriptTurn[] = [];
  private lineNo = 0;
  private readonly toolNames = new Map<string, string>();

  private add(t: Omit<ITranscriptTurn, 'i'>) {
    this.turns.push({ ...t, i: this.turns.length });
  }

  push(raw: string) {
    this.lineNo++;
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!line.trim()) return;
    let o: unknown;
    try {
      o = JSON.parse(line);
    } catch {
      this.add({ kind: 'raw', line: this.lineNo, at: null, text: line, title: 'Không phải JSON' });
      return;
    }
    try {
      if (!this.claude(o, line)) this.add({ kind: 'raw', line: this.lineNo, at: isObj(o) ? str(o.timestamp) || null : null, text: line, title: isObj(o) ? str(o.type) || undefined : undefined });
    } catch {
      // dòng có hình dạng lạ làm hỏng nhánh claude → vẫn hiện JSON thô, không vỡ trang
      this.add({ kind: 'raw', line: this.lineNo, at: null, text: line });
    }
  }

  /** Một dòng của adapter `claude`; không nhận ra → false. */
  private claude(o: unknown, line: string): boolean {
    if (!isObj(o) || typeof o.type !== 'string') return false;
    const at = str(o.timestamp) || null;
    const base = { line: this.lineNo, at, sidechain: o.isSidechain === true || undefined };
    if (CLAUDE_META_TYPES.has(o.type)) {
      this.add({ ...base, kind: 'meta', text: line, title: o.type });
      return true;
    }
    if ((o.type !== 'user' && o.type !== 'assistant') || !isObj(o.message)) return false;
    const content = o.message.content;
    const userKind = o.isMeta === true ? 'meta' : 'user';
    if (typeof content === 'string') {
      this.add({ ...base, kind: o.type === 'user' ? userKind : 'assistant', text: content, title: o.isMeta === true ? 'isMeta' : undefined });
      return true;
    }
    if (!Array.isArray(content)) return false;
    for (const b of content) {
      if (!isObj(b)) {
        this.add({ ...base, kind: 'raw', text: JSON.stringify(b) });
        continue;
      }
      switch (b.type) {
        case 'text':
          this.add({ ...base, kind: o.type === 'user' ? userKind : 'assistant', text: str(b.text), title: o.isMeta === true ? 'isMeta' : undefined });
          break;
        case 'image':
          this.add({ ...base, kind: o.type === 'user' ? userKind : 'assistant', text: '[Ảnh đính kèm]' });
          break;
        case 'thinking':
        case 'redacted_thinking':
          this.add({ ...base, kind: 'thinking', text: str(b.thinking) });
          break;
        case 'tool_use':
        case 'server_tool_use': {
          const name = str(b.name) || 'tool';
          if (typeof b.id === 'string') this.toolNames.set(b.id, name);
          const input = isObj(b.input) ? b.input : {};
          this.add({ ...base, kind: 'tool_call', title: name, input, text: JSON.stringify(input, null, 2) });
          break;
        }
        case 'tool_result':
          this.add({
            ...base, kind: 'tool_result', text: toolResultText(b.content), isError: b.is_error === true || undefined,
            title: this.toolNames.get(str(b.tool_use_id)) ?? undefined,
          });
          break;
        default:
          this.add({ ...base, kind: 'raw', text: JSON.stringify(b), title: str(b.type) || undefined });
      }
    }
    return true;
  }
}

/** Phân tích cả chuỗi .jsonl (dùng cho thử nghiệm / file nhỏ). */
export function parseTranscript(jsonl: string): ITranscriptTurn[] {
  const p = new TranscriptParser();
  for (const l of jsonl.split('\n')) p.push(l);
  return p.turns;
}

/** Tên tool MCP `mcp__officehub__get_task` → `officehub · get_task`. */
export const toolLabel = (name: string) => {
  const m = /^mcp__(.+?)__(.+)$/.exec(name);
  return m ? `${m[1]} · ${m[2]}` : name;
};

const firstLine = (s: string, max = 160) => {
  const l = s.trim().split('\n', 1)[0] ?? '';
  return l.length > max ? `${l.slice(0, max)}…` : l;
};

/** Một dòng tóm tắt cho lượt đang thu gọn. */
export function turnPreview(t: ITranscriptTurn): string {
  if (t.kind === 'tool_call') {
    const inp = t.input ?? {};
    const pick = inp.command ?? inp.file_path ?? inp.path ?? inp.pattern ?? inp.query ?? inp.url ?? inp.task ?? inp.description;
    if (typeof pick === 'string' && pick) return firstLine(pick);
    const compact = JSON.stringify(inp);
    return compact === '{}' ? '' : firstLine(compact);
  }
  if (t.kind === 'meta' || t.kind === 'raw') return firstLine(t.text, 200);
  return firstLine(t.text);
}

/** Kết quả tool / JSON dài hơn bấy nhiêu ký tự thì cắt bớt, có nút "Xem đủ". */
export const TURN_TEXT_CUT = 4000;

/** Dòng JSON gốc → JSON thụt lề để đọc (không parse được → giữ nguyên). */
export function prettyJson(line: string): string {
  try {
    return JSON.stringify(JSON.parse(line), null, 2);
  } catch {
    return line;
  }
}
