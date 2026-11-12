// E2E: bot (agent AI) nhắn tin trong văn phòng ảo — REST bằng token + tool MCP thật + Realtime phát ngay.
// Quyền: chỉ tài khoản bot (người thật dùng token → 403), kênh Toàn văn phòng + 1-1 người khác mở (không tự mở 1-1, không kênh phòng,
// không tệp), nhãn BOT (byBot, peerIsBot), hạn mức 60 tin / giờ, MCP list_chats / read_chat / send_chat_message / mark_chat_read,
// tin bot tới client chat qua SignalR, Realtime từ chối chuyển tiếp tin không phải bot.
// CHỈ DB tạm. Cần: Api :5180, Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5180),
//   Mcp :5200 (Mcp__ApiBaseUrl=http://localhost:5180 Mcp__RealtimeBaseUrl=http://localhost:5190), cùng Chat__InternalKey.
// Chạy từ frontend/ (dùng @microsoft/signalr):
//   cd frontend && E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp \
//     ADMIN_LOGIN=… ADMIN_PASSWORD=… CHAT_INTERNAL_KEY=… bun ../scripts/dev/bot-chat-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
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
/** Request bằng token AI; `tool` = header X-Mcp-Tool (như host Mcp gửi), `ip` = X-Forwarded-For. */
const ai = async (token: string, method: string, path: string, opts: { tool?: string; ip?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (opts.tool) headers['X-Mcp-Tool'] = opts.tool;
  if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
  return (await fetch(API + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })).status;
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// Thư viện SignalR nằm trong frontend/node_modules → nạp theo đường dẫn tuyệt đối (script ở scripts/dev).
const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const RT = process.env.RT_URL ?? 'http://localhost:5190';
const MCP = process.env.MCP_URL ?? 'http://localhost:5200/mcp';
const KEY = process.env.CHAT_INTERNAL_KEY ?? '';

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot chat ${stamp}`, code: `BC${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string, name };
};
const H = await mkEmp('Người Thật Chat', `e2e.bch.${stamp}`);
const N = await mkEmp('Người Dùng Claude', `e2e.bcn.${stamp}`);
const B1 = await mkEmp('Bot Lập Trình', `e2e.bcb1.${stamp}`);
const B2 = await mkEmp('Bot Kiểm Thử', `e2e.bcb2.${stamp}`);
ok('4 tài khoản + token', [H, N, B1, B2].every((x) => x.userId && x.token?.startsWith('ohk_')));
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

/** REST bằng token AI, trả { status, body }. */
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

// ---------- Quyền ----------
ok('người thật dùng token → 403 (danh sách chat)', (await tk(N.token, 'GET', '/api/chat/conversations')).status === 403);
ok('người thật dùng token → 403 (gửi vào office)', (await tk(N.token, 'POST', '/api/chat/conversations/office/messages', { text: 'hi' })).status === 403);
const b1List = await tk(B1.token, 'GET', '/api/chat/conversations');
ok('bot: chỉ thấy Toàn văn phòng (không kênh phòng)', b1List.status === 200 && b1List.body.every((c: any) => c.type !== 'Room')
  && b1List.body.some((c: any) => c.type === 'Office'), b1List.body);
ok('bot không tự mở 1-1 → 403', (await tk(B1.token, 'POST', '/api/chat/conversations/direct', { userId: H.userId })).status === 403);
ok('bot đọc kênh phòng (bí danh) → 403', (await tk(B1.token, 'GET', '/api/chat/conversations/room:meeting-large/messages')).status === 403);
ok('bot không tải tệp → 403', (await tk(B1.token, 'POST', '/api/chat/uploads', { conversationId: 'office', fileName: 'a.png', contentType: 'image/png', size: 10 })).status === 403);
ok('bot gửi kèm uploadIds → 400', (await tk(B1.token, 'POST', '/api/chat/conversations/office/messages', { text: 'x', uploadIds: [crypto.randomUUID()] })).status === 400);

// ---------- 1-1: người mở trước, bot trả lời ----------
const dm = (await json(H.cookie, 'POST', '/api/chat/conversations/direct', { userId: B1.userId })).body;
ok('người thật mở 1-1 với bot → peerIsBot', dm?.peerIsBot === true, dm);
await json(H.cookie, 'POST', `/api/chat/conversations/${dm.id}/messages`, { text: 'Bot ơi, việc WEB-1 xong chưa?' });
const b1Dm = (await tk(B1.token, 'GET', '/api/chat/conversations')).body?.find((c: any) => c.id === dm.id);
ok('bot thấy 1-1 (tên người, chưa đọc 1, peer không phải bot)', b1Dm?.title === H.name && b1Dm.unread === 1 && b1Dm.peerIsBot === false, b1Dm);
const reply = await tk(B1.token, 'POST', `/api/chat/conversations/${dm.id}/messages`, { text: 'Dạ xong rồi ạ' });
ok('bot trả lời bằng REST → byBot', reply.status === 200 && reply.body?.message?.byBot === true, reply);
const hMsgs = (await json(H.cookie, 'GET', `/api/chat/conversations/${dm.id}/messages`)).body?.items ?? [];
ok('người thật thấy tin bot có byBot, tin của mình không', hMsgs.length === 2 && hMsgs[1].byBot === true && hMsgs[0].byBot === false, hMsgs);
ok('B2 (bot khác) không đọc được 1-1 của B1 → 404', (await tk(B2.token, 'GET', `/api/chat/conversations/${dm.id}/messages`)).status === 404);

// ---------- MCP + Realtime ----------
const hub = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/chat`, { headers: { cookie: H.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.Warning).build();
const live: any[] = [];
hub.on('Message', (m: any) => live.push(m));
await hub.start();
ok('người thật kết nối hub chat', hub.state === signalR.HubConnectionState.Connected);

let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const x = await rpc(token, 'tools/call', { name, arguments: args });
  const text = x?.result?.content?.[0]?.text ?? '';
  try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
};
const init = await rpc(B1.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
ok('MCP instructions có hướng dẫn tin nhắn', String(init?.result?.instructions ?? '').includes('list_chats'));
const names: string[] = ((await rpc(B1.token, 'tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
ok('tools/list có 4 tool chat (76 tool)', ['list_chats', 'read_chat', 'send_chat_message', 'mark_chat_read'].every((n) => names.includes(n)) && names.length === 76, names.length);
const lc = await call(B1.token, 'list_chats');
ok('MCP list_chats: office + 1-1', !lc.err && lc.j.some((c: any) => c.conversation === 'office') && lc.j.some((c: any) => c.conversation === dm.id), lc.text.slice(0, 300));
const rc = await call(B1.token, 'read_chat', { conversation: dm.id });
ok('MCP read_chat: 2 tin, tin bot byBot', !rc.err && rc.j.messages.length === 2 && rc.j.messages[1].byBot === true && rc.j.messages[0].text.includes('WEB-1'), rc.text.slice(0, 300));
ok('MCP mark_chat_read', !(await call(B1.token, 'mark_chat_read', { conversation: dm.id })).err);
const after = (await tk(B1.token, 'GET', '/api/chat/conversations')).body?.find((c: any) => c.id === dm.id);
ok('đã đọc → unread 0', after?.unread === 0, after);
await Bun.sleep(1100); // giới hạn chung 1 tin / giây / tài khoản (B1 vừa trả lời qua REST)
const sc = await call(B1.token, 'send_chat_message', { conversation: 'office', text: 'Chào cả nhà, mình là bot lập trình 👋' });
ok('MCP send_chat_message vào office → deliveredLive', !sc.err && sc.j.sent === true && sc.j.deliveredLive === true, sc.text);
for (let i = 0; i < 20 && !live.some((m) => m.id === sc.j?.messageId); i++) await Bun.sleep(250);
const got = live.find((m) => m.id === sc.j?.messageId);
ok('người thật nhận tin bot qua SignalR ngay (byBot, Office)', got?.byBot === true && got.conversationType === 'Office' && got.senderName === 'Bot Lập Trình', got ?? live);
ok('MCP kênh phòng → lỗi rõ ràng', (await call(B1.token, 'send_chat_message', { conversation: 'room:meeting-large', text: 'x' })).err);
ok('MCP người thật → lỗi (403)', (await call(N.token, 'list_chats')).err);
await hub.stop();

if (KEY) {
  const relay = (body: unknown, key = KEY) => fetch(`${RT}/rt/internal/chat-message`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': key }, body: JSON.stringify(body) });
  const fake = { message: { id: crypto.randomUUID(), seq: 1, conversationId: crypto.randomUUID(), senderId: H.userId, senderName: 'Giả mạo', text: 'x', createdAt: new Date().toISOString(), deleted: false, attachments: [], clientId: null, byBot: false }, conversationType: 'Office', roomId: null, roomName: null, recipients: null };
  ok('Realtime: sai khoá → 401', (await relay(fake, 'sai')).status === 401);
  ok('Realtime: tin không phải bot → 400 (không giả mạo người thật)', (await relay(fake)).status === 400);
} else console.log('… bỏ qua kiểm tra khoá Realtime (chưa đặt CHAT_INTERNAL_KEY)');

// ---------- Hạn mức 60 tin / giờ (B2) ----------
console.log('… gửi 60 tin để chạm hạn mức (~70 giây)');
let okCount = 0;
for (let i = 0; i < 60; i++) {
  const r = await tk(B2.token, 'POST', '/api/chat/conversations/office/messages', { text: `tin ${i + 1}` });
  if (r.status === 200) okCount++;
  await Bun.sleep(1100); // giới hạn 1 tin / giây / tài khoản
}
ok('B2 gửi được 60 tin', okCount === 60, okCount);
const over = await tk(B2.token, 'POST', '/api/chat/conversations/office/messages', { text: 'tin 61' });
ok('tin thứ 61 trong 1 giờ → 429', over.status === 429 && String(over.body?.detail ?? '').includes('60'), over);
ok('B1 vẫn gửi được (hạn mức theo từng bot)', (await tk(B1.token, 'POST', '/api/chat/conversations/office/messages', { text: 'vẫn ổn' })).status === 200);
const log = (await json(admin, 'GET', `/api/audit/ai-requests?all=true&userId=${B2.userId}&page=1&pageSize=5`)).body;
ok('nhật ký AI có nội dung tin bot', log?.items?.some((r: any) => String(r.requestSummary ?? '').includes('tin')), log?.items?.[0]);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
