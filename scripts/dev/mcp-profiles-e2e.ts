// E2E TEST-143: hồ sơ tool MCP theo loại phiên agent + cắt gọn kết quả, Api + Mcp THẬT trên DB tạm.
// Kiểm tra: tools/list không profile = đủ 104 tool; ?profile=chat|meeting|task chỉ trả tool hợp loại phiên (đo kích thước schema từng hồ sơ),
// profile lạ = đủ; tool ngoài hồ sơ vẫn gọi được (không phải lớp bảo mật); get_task mặc định 20 bình luận mới nhất + commentsTotal, comments=0,
// không có trường null; read_chat since = chỉ tin mới, không có olderBefore null.
// CHỈ DB tạm (lệnh dựng: .agent/e2e.md "mcp-profiles-e2e.ts"):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 MCP_BASE=http://localhost:5201 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/mcp-profiles-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5181';
const MCP_BASE = process.env.MCP_BASE ?? 'http://localhost:5201';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    if (!keys[login]) throw new Error(`${login} đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`);
    const r2 = await fetch(`${API}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieOf(r, 'officehub.2fa') },
      body: JSON.stringify({ code: totp(keys[login]), isRecoveryCode: false, rememberMe: true }) });
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const post = async (path: string, b: unknown) => {
      const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) });
      cookie = cookieOf(x, 'officehub.auth') || cookie;
      return { status: x.status, body: await x.json().catch(() => null) as any };
    };
    const s = await post('/api/auth/2fa/setup', {});
    const e = await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ---------- Chuẩn bị: admin, một bot có token, dự án + việc 25 bình luận ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `MCP hồ sơ ${stamp}`, code: `MP${stamp}`.slice(0, 10) })).body;
const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV9${stamp}`.slice(0, 20), fullName: 'Bot Hồ Sơ Tool', email: `e2e.mp.${stamp}@e2e.test`, phone: null,
  dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const user = `e2e.mp.${stamp}`;
const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const botCookie = await login(user, PW);
const token = (await json(botCookie, 'POST', '/api/auth/access-tokens', { name: 'Agent hồ sơ', expiresInDays: 30 })).body?.token as string;
await json(admin, 'PUT', `/api/org/employees/${e.id}/account/bot`, { isBot: true });
ok('bot + token AI', token?.startsWith('ohk_'));
const P = (await json(admin, 'POST', '/api/projects', { code: `mp-${stamp}`, name: 'Hồ sơ tool', kind: 'Internal', startOn: today, memberIds: [e.id], sequential: false })).body;
const T = (await json(admin, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc nhiều bình luận', assigneeEmployeeId: e.id })).body;
const taskId = typeof T === 'string' ? T : T?.id;
for (let i = 1; i <= 25; i++) await json(admin, 'POST', `/api/projects/tasks/${taskId}/comments`, { content: `Bình luận số ${i}` });
ok('dự án + việc + 25 bình luận', !!P && !!taskId);

// ---------- MCP ----------
let rid = 0;
const rpc = async (profile: string | null, method: string, params: unknown = {}) => {
  const url = `${MCP_BASE}/mcp${profile === null ? '' : `?profile=${profile}`}`;
  const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const list = async (profile: string | null) => {
  const tools: any[] = (await rpc(profile, 'tools/list'))?.result?.tools ?? [];
  return { names: tools.map((t) => t.name as string), bytes: JSON.stringify(tools).length };
};
const call = async (profile: string | null, name: string, args: Record<string, unknown> = {}) => {
  const x = await rpc(profile, 'tools/call', { name, arguments: args });
  const text: string = x?.result?.content?.[0]?.text ?? '';
  try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
};
await rpc(null, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });

const all = await list(null), chat = await list('chat'), meeting = await list('meeting'), task = await list('task'), odd = await list('abc');
console.log(`  schema tools/list: đủ ${all.names.length} tool ${all.bytes} B · chat ${chat.names.length} / ${chat.bytes} B · meeting ${meeting.names.length} / ${meeting.bytes} B`
  + ` · task ${task.names.length} / ${task.bytes} B`);
ok('không profile → đủ 104 tool', all.names.length === 104, all.names.length);
ok('profile lạ → đủ tool', odd.names.length === 104, odd.names.length);
ok('chat: có read_chat / send_chat_message / create_task / go_to, không approve / check_in_out / speak_in_meeting',
  ['read_chat', 'send_chat_message', 'create_task', 'go_to'].every((n) => chat.names.includes(n))
  && !['approve_request', 'check_in_out', 'speak_in_meeting'].some((n) => chat.names.includes(n)), chat.names.length);
ok('meeting: có get_my_meeting / speak_in_meeting / pass_turn / tool đọc nghiệp vụ, không send_chat_message / update_task_status',
  ['get_my_meeting', 'speak_in_meeting', 'pass_turn', 'get_finance_overview'].every((n) => meeting.names.includes(n))
  && !['send_chat_message', 'update_task_status', 'approve_request'].some((n) => meeting.names.includes(n)), meeting.names.length);
ok('task: 89 tool (có create_upload / view_attachment — TEST-153), không tool họp / chat / duyệt / chấm công',
  task.names.length === 89 && ['create_upload', 'view_attachment'].every((n) => task.names.includes(n))
  && !['speak_in_meeting', 'read_chat', 'approve_request', 'check_in_out'].some((n) => task.names.includes(n)), task.names.length);
ok('schema mỗi hồ sơ nhỏ hơn đủ tool', [chat, meeting, task].every((p) => p.bytes < all.bytes));
// Không phải lớp bảo mật: tool ngoài hồ sơ vẫn gọi được, quyền do Api
const outside = await call('meeting', 'list_my_tasks');
ok('tool đọc gọi được ở mọi hồ sơ', !outside.err, outside.text.slice(0, 200));
const outsideWrite = await call('meeting', 'comment_task', { task: taskId, content: 'gọi ngoài hồ sơ' });
ok('tool ghi ngoài hồ sơ vẫn chạy (hồ sơ chỉ ẩn khỏi tools/list)', !outsideWrite.err, outsideWrite.text.slice(0, 200));

// ---------- get_task cắt gọn ----------
const g = await call('task', 'get_task', { task: taskId });
ok('get_task mặc định: 20 bình luận MỚI NHẤT + commentsTotal 26', !g.err && g.j.comments.length === 20 && g.j.commentsTotal === 26
  && g.j.comments.at(-1).content === 'gọi ngoài hồ sơ' && g.j.comments[0].content === 'Bình luận số 7', { n: g.j?.comments?.length, total: g.j?.commentsTotal, first: g.j?.comments?.[0]?.content });
ok('get_task không có trường null', !g.text.includes(':null'), g.text.match(/"[a-zA-Z]+":null/g));
ok('get_task vẫn đủ task / columns / canApprove', !!g.j.task?.code && Array.isArray(g.j.columns) && typeof g.j.canApprove === 'boolean');
const g0 = await call('task', 'get_task', { task: taskId, comments: 0, history: 1 });
ok('get_task comments=0, history=1', !g0.err && g0.j.comments.length === 0 && g0.j.commentsTotal === 26 && g0.j.activities.length <= 1, { c: g0.j?.comments?.length, a: g0.j?.activities?.length });
const gAll = await call('task', 'get_task', { task: taskId, comments: 100 });
ok('get_task comments=100 → đủ 26, không commentsTotal', !gAll.err && gAll.j.comments.length === 26 && gAll.j.commentsTotal === undefined);

// ---------- read_chat since ----------
// Chat giới hạn tốc độ gửi (429 "Gửi chậm lại một chút") → giãn các lần gửi
const sent: boolean[] = [];
for (const i of [1, 2, 3]) {
  if (i > 1) await Bun.sleep(2500);
  sent.push(!(await call('chat', 'send_chat_message', { conversation: 'office', text: `Tin thử hồ sơ ${stamp} #${i}` })).err);
}
ok('bot gửi 3 tin vào Toàn văn phòng', sent.every(Boolean), sent);
const r = await call('chat', 'read_chat', { conversation: 'office', take: 10 });
const mine = (r.j?.messages ?? []).filter((m: any) => String(m.text).includes(`hồ sơ ${stamp}`));
ok('read_chat: 3 tin vừa gửi, không trường null', !r.err && mine.length === 3 && !r.text.includes(':null'), r.text.slice(0, 300));
const since = mine[0]?.seq;
const r2 = await call('chat', 'read_chat', { conversation: 'office', since });
ok('read_chat since = seq tin đầu → chỉ 2 tin mới hơn, không olderBefore', !r2.err && r2.j.messages.length === 2 && r2.j.messages.every((m: any) => m.seq > since)
  && r2.j.olderBefore === undefined, r2.j);
const r3 = await call('chat', 'read_chat', { conversation: 'office', since: mine[2]?.seq });
ok('read_chat since = tin cuối → rỗng', !r3.err && r3.j.messages.length === 0, r3.j);

console.log(`\n${pass} pass / ${fail} fail`);
process.exit(fail ? 1 : 0);
