// E2E TEST-85: cuộc họp agent XUYÊN HOST — Api + Realtime + Mcp thật, Telegram giả + máy nhận webhook giả (ký HMAC) trong cùng tiến trình,
// người thật quan sát qua hub văn phòng 3D. Bắt lỗi nối giữa các phần mà script từng phần (agent-meeting-e2e / -turns / -mcp / -3d) không thấy:
// (1) mở 200 (API trả 200, không 201) / token AI 403 / phòng đang họp 409; (2) chỉ bot chủ trì được đánh thức (Telegram + webhook đúng chữ ký);
// (3) speak_in_meeting next → bot kế giữ lượt, bot không giữ lượt nói / send_chat_message vào kênh phòng → lỗi (REST 409); (4) nói không @nhắc → về chủ trì,
// pass_turn, assign_turn bởi bot thường → lỗi; (5) người thật @nhắc → bot đó giữ lượt, không tính lượt; (6) trần 4 lượt (API admin) → TurnLimit, không
// meeting_turn nào sau đó; (7) người thật dừng, token AI dừng 403; (8) 3D: bot đi vào phòng khi mở, rời phòng khi kết thúc; (9) ngoài phiên: bot @nhắc bot
// trong kênh phòng không đánh thức ai.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm (từ backend/, cùng khoá K ≥ 32 ký tự cho Chat__*):
//   docker run -d --name e2e-agmf-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55495:5432 postgres:18-alpine
//   Api: env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5389 'ConnectionStrings__Default=Host=127.0.0.1;Port=55495;Database=e2e;Username=e2e;Password=e2e'
//        Telegram__ApiUrl=http://localhost:5397 Chat__InternalKey=K Chat__RealtimeToApiKey=K Chat__McpToRealtimeKey=K
//        Smtp__Host=127.0.0.1 Smtp__Port=11062 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=agmf-admin@officehub-e2e.vn Seed__AdminPassword=Agmf-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5399 Realtime__ApiBaseUrl=http://localhost:5389 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Mcp: env ASPNETCORE_URLS=http://localhost:5409 Mcp__ApiBaseUrl=http://localhost:5389 Mcp__RealtimeBaseUrl=http://localhost:5399 + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5389 RT_URL=http://localhost:5399 MCP_URL=http://localhost:5409/mcp CHAT_KEY=K \
//     ADMIN_LOGIN=agmf-admin@officehub-e2e.vn ADMIN_PASSWORD=Agmf-Admin-2026 bun scripts/dev/agent-meeting-full-e2e.ts
// ~2 phút (bot đi bộ trong 3D, hàng đợi Telegram gửi mỗi 3 giây).
import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5389';
const RT = process.env.RT_URL ?? 'http://localhost:5399';
const MCP = process.env.MCP_URL ?? 'http://localhost:5409/mcp';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const CHAT_KEY = process.env.CHAT_KEY ?? '';
if (CHAT_KEY.length < 32) throw new Error('Đặt CHAT_KEY = Chat__InternalKey của Api tạm (≥ 32 ký tự)');
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5397), HOOK_PORT = Number(process.env.HOOK_PORT ?? 5398);
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 12000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

// ---- Telegram giả + webhook giả ----
const GOOD = '123456789:AAH-e2e-good-token-abcdefghijklmnop';
const sent: { text: string }[] = [];
Bun.serve({
  port: FAKE_PORT,
  async fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/bot([^/]+)\/sendMessage$/);
    if (!m || decodeURIComponent(m[1]) !== GOOD) return new Response('not found', { status: 404 });
    sent.push({ text: ((await req.json()) as any).text });
    return Response.json({ ok: true, result: { message_id: sent.length } });
  },
});
type Hit = { path: string; event: string; ts: string; sig: string; body: string; json: any };
const hits: Hit[] = [];
Bun.serve({
  port: HOOK_PORT,
  async fetch(req) {
    const body = await req.text();
    hits.push({ path: new URL(req.url).pathname, event: req.headers.get('x-officehub-event') ?? '', ts: req.headers.get('x-officehub-timestamp') ?? '',
      sig: req.headers.get('x-officehub-signature') ?? '', body, json: JSON.parse(body) });
    return new Response('ok');
  },
});
const signed = (h: Hit, secret: string) => h.sig === 'sha256=' + createHmac('sha256', secret).update(`${h.ts}.${h.body}`).digest('hex');
const wakes = (event: string) => sent.map((s) => { try { return JSON.parse(s.text); } catch { return null; } }).filter((j) => j?.event === event);
const turnWakes = (code: string, sid?: string) => wakes('meeting_turn').filter((j) => j.employee_code === code && (!sid || j.session_id === sid));
const hookTurns = (code: string, sid?: string) => hits.filter((h) => h.path === `/hook/${code}` && h.event === 'meeting.turn' && (!sid || h.json.data?.sessionId === sid));

// ---- đăng nhập / dữ liệu ----
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
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const tk = (token: string, method: string, path: string, body?: unknown) => call({ authorization: `Bearer ${token}` }, method, path, body);
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const ROOM = 'meeting-large';
// Lần chạy trước bị dừng giữa chừng → còn phiên đang họp: admin dừng
for (const s of (await json(admin, 'GET', '/api/meetings/sessions?active=true')).body ?? []) await json(admin, 'POST', `/api/meetings/sessions/${s.id}/stop`);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Họp xuyên host ${stamp}`, code: `HX${stamp}`.slice(0, 10) })).body;
let seq = 500 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20).toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, code: e.code as string, cookie, token: t?.token as string, name, userId: (me?.userId ?? me?.id) as string, secret: '' };
};
const H = await mkEmp('Người Mở Họp', `e2e.hx.h.${stamp}`);
const B1 = await mkEmp('Bot Chủ Trì', `e2e.hx.b1.${stamp}`);
const B2 = await mkEmp('Bot Kinh Doanh', `e2e.hx.b2.${stamp}`);
const B3 = await mkEmp('Bot Tài Chính', `e2e.hx.b3.${stamp}`);
const BOTS = [B1, B2, B3];
ok('4 tài khoản + token', [H, ...BOTS].every((x) => x.e?.id && x.token?.startsWith('ohk_') && x.userId), [H, B1].map((x) => x.userId));
for (const b of BOTS) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

const tg = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } });
ok('bật Telegram (giả)', tg.status === 200, tg.body);
for (const b of BOTS) {
  const w = await json(b.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook/${b.code}`, enabled: true });
  b.secret = w.body?.secret ?? '';
}
ok('3 bot cài webhook (khoá ký whsec_)', BOTS.every((b) => b.secret.startsWith('whsec_')), BOTS.map((b) => b.secret.slice(0, 6)));
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });

// ---- MCP ----
let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const tool = async (who: { token: string }, name: string, args: Record<string, unknown> = {}) => {
  await sleep(1100); // Chat chặn 1 tin / giây / người
  const x = await rpc(who.token, 'tools/call', { name, arguments: args });
  const text = String(x?.result?.content?.[0]?.text ?? x?.error?.message ?? '');
  try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError || !!x?.error, j: null as any, text }; }
};
for (const b of BOTS) await rpc(b.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });

// ---- 3D: người thật kết nối hub văn phòng để quan sát ----
const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const room = map.rooms.find((r: any) => r.id === ROOM);
const inside = (p?: { x: number; z: number }) => !!p && p.x >= room.x0 && p.x <= room.x1 && p.z >= room.z0 && p.z <= room.z1;
type Pos = { id: string; x: number; z: number; r: number; anim: number };
const moves: Pos[] = [];
const hub = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: H.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.Warning).build();
let welcome: any = null;
hub.on('Welcome', (w: any) => { welcome = w; for (const p of w.players ?? []) moves.push({ id: p.id, x: p.x, z: p.z, r: p.r ?? 0, anim: p.anim ?? 0 }); });
hub.on('PlayerJoined', (p: any) => { moves.push({ id: p.id, x: p.x, z: p.z, r: p.r ?? 0, anim: p.anim ?? 0 }); });
hub.on('Positions', (list: Pos[]) => { moves.push(...list); });
for (const m of ['PlayerLeft', 'BotStatus', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick', 'NameChanged']) hub.on(m, () => {});
await hub.start();
await until(() => !!welcome, 4000);
ok('H vào văn phòng 3D (Welcome)', !!welcome);
const lastOf = (id: string) => moves.filter((m) => m.id === id).at(-1);
const allSeated = () => BOTS.every((b) => { const l = lastOf(b.userId); return inside(l) && l!.anim === 2; });
const allOut = () => BOTS.every((b) => { const l = lastOf(b.userId); return !!l && !inside(l) && l.anim !== 1; });

// Người thật vào kênh phòng như khi đi vào phòng (khoá nội bộ Realtime → Api) để @nhắc bot
await call({ 'x-chat-key': CHAT_KEY }, 'POST', `/api/chat/internal/rooms/${ROOM}/members`, { userId: H.userId });
const session = async (id: string) => (await json(H.cookie, 'GET', `/api/meetings/sessions/${id}`)).body;
const openBody = (topic: string) => ({ roomId: ROOM, topic, chairEmployeeId: B1.e.id, botIds: BOTS.map((b) => b.e.id) });

// ========== (1) Mở phiên ==========
ok('(1) token AI của bot mở họp → 403', (await tk(B1.token, 'POST', '/api/meetings/sessions', openBody('x'))).status === 403);
ok('(1) token AI của người thật mở họp → 403', (await tk(H.token, 'POST', '/api/meetings/sessions', openBody('x'))).status === 403);
const topicA = `Kế hoạch quý ${stamp}`;
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', openBody(topicA));
const SA = open.body?.id as string;
ok('(1) người thật mở với 3 bot, B1 chủ trì → 200 (API trả 200, không 201), lượt đầu của B1', open.status === 200 && open.body.status === 'Active'
  && open.body.currentSpeakerEmployeeId === B1.e.id && open.body.bots.length === 3, open);
const dup = await json(H.cookie, 'POST', '/api/meetings/sessions', openBody('lần hai'));
ok('(1) mở lần hai cùng phòng → 409', dup.status === 409, dup);

// ========== (2) Chỉ chủ trì được đánh thức ==========
ok('(2) Telegram meeting_turn cho B1', await until(() => turnWakes(B1.code, SA).length === 1), wakes('meeting_turn'));
ok('(2) webhook meeting.turn cho B1, chữ ký HMAC đúng', await until(() => hookTurns(B1.code, SA).length === 1) && signed(hookTurns(B1.code, SA)[0], B1.secret),
  hits.map((h) => [h.path, h.event]));
await sleep(3500);
ok('(2) B2, B3 không nhận meeting_turn (Telegram + webhook)', [B2, B3].every((b) => turnWakes(b.code, SA).length === 0 && hookTurns(b.code, SA).length === 0),
  { tg: wakes('meeting_turn'), hooks: hits.map((h) => [h.path, h.event]) });

// ========== (8a) 3D: bot đi vào phòng ==========
await until(allSeated, 40000);
ok('(8) 3D: cả 3 bot đi vào Phòng họp lớn và ngồi (anim 2)', allSeated(), BOTS.map((b) => lastOf(b.userId)));
ok('(8) 3D: bot đi từng bước (có gói anim 1) chứ không dịch chuyển', BOTS.every((b) => moves.filter((m) => m.id === b.userId && m.anim === 1).length >= 2));

// ========== (3) Chuyển lượt bằng speak_in_meeting next ==========
const g1 = await tool(B1, 'get_my_meeting');
const CONV = g1.j?.conversation as string;
ok('(3) B1 get_my_meeting: chủ trì, lượt của tôi, kênh phòng', !g1.err && g1.j?.sessionId === SA && g1.j.isChair && g1.j.isMyTurn && /^[0-9a-f-]{36}$/.test(CONV ?? ''), g1.text);
const early = await tool(B2, 'speak_in_meeting', { text: 'Tôi nói trước' });
ok('(3) B2 speak_in_meeting khi chưa tới lượt → lỗi nêu B1 đang giữ', early.err && early.text.includes(B1.code), early.text);
const direct = await tool(B2, 'send_chat_message', { conversation: CONV, text: 'Chen ngang qua send_chat_message' });
ok('(3) B2 send_chat_message thẳng vào kênh phòng khi không giữ lượt → lỗi nêu B1', direct.err && direct.text.includes('Bot Chủ Trì'), direct.text);
await sleep(1100);
const rest = await tk(B2.token, 'POST', `/api/chat/conversations/${CONV}/messages`, { text: 'REST chen ngang' });
ok('(3) … cùng tin qua REST token → 409', rest.status === 409, rest);
const s1 = await tool(B1, 'speak_in_meeting', { text: `Mở đầu: ${topicA}. Mời kinh doanh báo số liệu.`, next: B2.code });
ok('(3) B1 speak_in_meeting next = B2 → gửi, phát ngay qua Realtime', !s1.err && s1.j?.sent === true && s1.j.deliveredLive === true, s1.text);
let S = await session(SA);
ok('(3) B2 giữ lượt, 1 lượt', S.currentSpeakerEmployeeId === B2.e.id && S.turnsUsed === 1, S);
ok('(3) B2 được đánh thức: Telegram + webhook ký đúng', await until(() => turnWakes(B2.code, SA).length === 1 && hookTurns(B2.code, SA).length === 1)
  && signed(hookTurns(B2.code, SA)[0], B2.secret) && hookTurns(B2.code, SA)[0].json.data?.conversationId === CONV, hookTurns(B2.code, SA).map((h) => h.json));
const again = await tool(B1, 'speak_in_meeting', { text: 'Thêm một ý' });
ok('(3) B1 nói lại khi đã chuyển lượt → lỗi', again.err && again.text.includes(B2.code), again.text);

// ========== (4) Không @nhắc → về chủ trì; pass_turn; assign_turn bởi bot thường ==========
const s2 = await tool(B2, 'speak_in_meeting', { text: 'Doanh thu tháng 10 đạt 120% kế hoạch.' });
ok('(4) B2 nói không @nhắc ai → gửi', !s2.err && s2.j?.sent, s2.text);
S = await session(SA);
ok('(4) lượt về chủ trì B1, 2 lượt', S.currentSpeakerEmployeeId === B1.e.id && S.turnsUsed === 2, S);
ok('(4) B1 được đánh thức lần 2', await until(() => turnWakes(B1.code, SA).length === 2 && hookTurns(B1.code, SA).length === 2));
const a2 = await tool(B2, 'assign_turn', { to: B3.code });
ok('(4) B2 (bot thường) assign_turn → lỗi', a2.err, a2.text);
const p2 = await tool(B2, 'pass_turn');
ok('(4) B2 pass_turn khi không giữ lượt → lỗi', p2.err, p2.text);

// ========== (5) Người thật @nhắc giữa chừng ==========
await sleep(1100);
const h1 = await json(H.cookie, 'POST', `/api/chat/conversations/${CONV}/messages`, { text: `@${B3.code} dòng tiền tháng này thế nào?` });
ok('(5) người thật nhắn @B3 trong phòng đang họp → 200', h1.status === 200, h1);
S = await session(SA);
ok('(5) B3 giữ lượt ngay, tin người thật không tính lượt (vẫn 2)', S.currentSpeakerEmployeeId === B3.e.id && S.turnsUsed === 2, S);
ok('(5) B3 được đánh thức (meeting_turn), không chat_mention trùng', await until(() => turnWakes(B3.code, SA).length === 1)
  && wakes('chat_mention').filter((j) => j.employee_code === B3.code).length === 0, wakes('chat_mention'));
const p3 = await tool(B3, 'pass_turn');
ok('(4) B3 pass_turn → lượt về chủ trì, 3 lượt', !p3.err && p3.j?.ok && p3.j.currentSpeaker === 'Bot Chủ Trì' && p3.j.turnsUsed === 3, p3.text);
ok('(8) trong phiên bot không rời phòng', BOTS.every((b) => inside(lastOf(b.userId))));

// ========== (7) Dừng phiên ==========
ok('(7) token AI của bot dừng → 403', (await tk(B1.token, 'POST', `/api/meetings/sessions/${SA}/stop`)).status === 403);
ok('(7) token AI của người mở dừng → 403', (await tk(H.token, 'POST', `/api/meetings/sessions/${SA}/stop`)).status === 403);
const stop = await json(H.cookie, 'POST', `/api/meetings/sessions/${SA}/stop`);
ok('(7) người mở dừng (cookie) → Ended / Stopped', stop.status === 200 && stop.body.status === 'Ended' && stop.body.endReason === 'Stopped', stop);
const after = await tool(B1, 'get_my_meeting');
ok('(7) sau khi dừng: get_my_meeting inMeeting false', !after.err && after.j?.inMeeting === false, after.text);
await until(allOut, 40000);
ok('(8) 3D: dừng → cả 3 bot đứng dậy rời Phòng họp lớn (không biến mất)', allOut(), BOTS.map((b) => lastOf(b.userId)));

// ========== (6) Trần 4 lượt → tự kết thúc, không đánh thức thêm ==========
const cap = await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 4, maxMinutes: 30 });
ok('(6) admin đặt trần 4 lượt', cap.status === 200 && cap.body?.maxTurns === 4, cap);
ok('(6) token AI sửa trần → 403', (await tk(B1.token, 'PUT', '/api/meetings/agent-settings', { maxTurns: 50, maxMinutes: 30 })).status === 403);
const openB = await json(H.cookie, 'POST', '/api/meetings/sessions', openBody(`Trần lượt ${stamp}`));
const SB = openB.body?.id as string;
ok('(6) mở phiên mới cùng phòng sau khi dừng → 200, trần 4', openB.status === 200 && openB.body.maxTurns === 4, openB);
await until(() => turnWakes(B1.code, SB).length === 1);
await until(allSeated, 40000);
ok('(8) 3D: phiên mới → bot đi vào phòng lại', allSeated(), BOTS.map((b) => lastOf(b.userId)));
const t1 = await tool(B1, 'speak_in_meeting', { text: 'Phiên ngắn.', next: B2.code });             // lượt 1 → B2
const t2 = await tool(B2, 'speak_in_meeting', { text: 'Kinh doanh ổn.' });                        // lượt 2 → B1
const t3 = await tool(B1, 'assign_turn', { to: B3.code });                                         // lượt 3 → B3
const t4 = await tool(B3, 'speak_in_meeting', { text: 'Tài chính ổn.' });                          // lượt 4 → hết trần
ok('(6) 4 lượt đều thành công', [t1, t2, t3, t4].every((t) => !t.err), [t1, t2, t3, t4].map((t) => t.text));
S = await session(SB);
ok('(6) đủ 4 lượt → phiên tự kết thúc, lý do TurnLimit', S.status === 'Ended' && S.endReason === 'TurnLimit' && S.turnsUsed === 4 && !S.currentSpeakerEmployeeId, S);
const late = await tool(B1, 'speak_in_meeting', { text: 'Nói thêm sau khi hết trần' });
ok('(6) sau khi hết trần speak_in_meeting → lỗi (không dự họp)', late.err, late.text);
await sleep(7000); // > 2 nhịp hàng đợi Telegram
const tgB = { b1: turnWakes(B1.code, SB).length, b2: turnWakes(B2.code, SB).length, b3: turnWakes(B3.code, SB).length };
const hkB = { b1: hookTurns(B1.code, SB).length, b2: hookTurns(B2.code, SB).length, b3: hookTurns(B3.code, SB).length };
ok('(6) meeting_turn của phiên đúng 4 lần (B1×2, B2, B3) — không gửi sau khi hết trần', tgB.b1 === 2 && tgB.b2 === 1 && tgB.b3 === 1, tgB);
ok('(6) webhook meeting.turn cũng đúng 4 lần', hkB.b1 === 2 && hkB.b2 === 1 && hkB.b3 === 1, hkB);
ok('(6) tin hệ thống "dùng hết 4 lượt" trong kênh phòng', ((await json(H.cookie, 'GET', `/api/chat/conversations/${CONV}/messages?take=5`)).body?.items as any[] ?? [])
  .some((x) => x.senderName === 'OfficeHub' && x.text?.includes('dùng hết 4 lượt')));
await until(allOut, 40000);
ok('(8) 3D: hết trần → bot rời phòng', allOut(), BOTS.map((b) => lastOf(b.userId)));
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });

// ========== (9) Ngoài phiên họp: bot @nhắc bot không đánh thức ==========
const tgBefore = sent.length, hookBefore = hits.filter((h) => h.path === `/hook/${B3.code}`).length;
const out = await tool(B2, 'send_chat_message', { conversation: CONV, text: `@${B3.code} họp xong rồi, cảm ơn.` });
ok('(9) ngoài phiên: B2 send_chat_message @B3 trong kênh phòng → gửi', !out.err && out.j?.sent, out.text);
await sleep(4000);
ok('(9) … không Telegram nào, B3 không nhận webhook', sent.length === tgBefore && hits.filter((h) => h.path === `/hook/${B3.code}`).length === hookBefore,
  { tg: sent.slice(tgBefore), hooks: hits.filter((h) => h.path === `/hook/${B3.code}`).slice(hookBefore).map((h) => h.event) });

await hub.stop();
await json(admin, 'DELETE', '/api/system/settings/telegram');
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
