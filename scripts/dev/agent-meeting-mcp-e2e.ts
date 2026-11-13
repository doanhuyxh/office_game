// E2E TEST-82: tool MCP cho cuộc họp agent — get_my_meeting, speak_in_meeting, pass_turn, assign_turn (MCP thật → Api).
// Người thật (token / cookie) → 403 ở /sessions/mine, /pass, /assign; tool báo rõ ai đang giữ lượt; speak_in_meeting next → @mã + lượt chuyển đúng;
// bot không phải chủ trì assign_turn → lỗi; không có tool mở / dừng họp; nhật ký AI có nội dung phát biểu (tool speak_in_meeting).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-mcm-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55482:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5188
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55482;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng giá trị> Smtp__Host=127.0.0.1 Smtp__Port=11062 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=mcm-admin@officehub-e2e.vn Seed__AdminPassword=Mcm-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5188, cùng Chat__InternalKey) — tuỳ chọn, có thì đặt RT_LIVE=1
//   Mcp :5200 (Mcp__ApiBaseUrl=http://localhost:5188 Mcp__RealtimeBaseUrl=http://localhost:5190, cùng Chat__InternalKey)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5188 MCP_URL=http://localhost:5200/mcp CHAT_KEY=<khoá trên> ADMIN_LOGIN=mcm-admin@officehub-e2e.vn \
//     ADMIN_PASSWORD=Mcm-Admin-2026 bun scripts/dev/agent-meeting-mcp-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5188';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const CHAT_KEY = process.env.CHAT_KEY ?? '';
if (CHAT_KEY.length < 32) throw new Error('Đặt CHAT_KEY = Chat__InternalKey của Api tạm (≥ 32 ký tự)');
const MCP = process.env.MCP_URL ?? 'http://localhost:5200/mcp';
const LIVE = process.env.RT_LIVE === '1'; // Realtime đang chạy → tin phát ngay (deliveredLive)
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Họp MCP ${stamp}`, code: `HM${stamp}`.slice(0, 10) })).body;
let seq = 800 + Math.floor(Math.random() * 90);
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
  return { e, code: e.code as string, cookie, token: t?.token as string, name, userId: (me?.userId ?? me?.id) as string };
};
const H = await mkEmp('Người Họp', `e2e.mch.${stamp}`);
const B1 = await mkEmp('Bot Chủ Trì', `e2e.mcb1.${stamp}`);
const B2 = await mkEmp('Bot Kinh Doanh', `e2e.mcb2.${stamp}`);
const B3 = await mkEmp('Bot Tài Chính', `e2e.mcb3.${stamp}`);
const B4 = await mkEmp('Bot Ngoài Họp', `e2e.mcb4.${stamp}`);
ok('5 tài khoản + token', [H, B1, B2, B3, B4].every((x) => x.e?.id && x.token?.startsWith('ohk_') && x.userId), [H, B1].map((x) => x.userId));
for (const b of [B1, B2, B3, B4]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });

const rooms = (await json(H.cookie, 'GET', '/api/meetings/rooms')).body as any[];
const ROOM = rooms[0].id as string;
// Lần chạy trước bị dừng giữa chừng → còn phiên đang họp trong phòng: admin dừng
for (const old of (await json(admin, 'GET', `/api/meetings/sessions?roomId=${ROOM}&active=true`)).body ?? [])
  await json(admin, 'POST', `/api/meetings/sessions/${old.id}/stop`);
// Người thật + bot ngoài họp vào kênh phòng như khi đi vào phòng (khoá nội bộ Realtime → Api)
for (const u of [H, B4]) await call({ 'x-chat-key': CHAT_KEY }, 'POST', `/api/chat/internal/rooms/${ROOM}/members`, { userId: u.userId });

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

const init = await rpc(B1.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
const instr = String(init?.result?.instructions ?? '');
ok('ServerInstructions có đoạn cuộc họp (meeting_turn → get_my_meeting, pass_turn)', instr.includes('meeting_turn') && instr.includes('get_my_meeting') && instr.includes('pass_turn'));
const names: string[] = ((await rpc(B1.token, 'tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
ok('tools/list có 4 tool họp, 101 tool', ['get_my_meeting', 'speak_in_meeting', 'pass_turn', 'assign_turn'].every((n) => names.includes(n)) && names.length === 101, names.length);
ok('không có tool mở / dừng họp', !names.some((n) => /(open|start|stop|end)_.*meeting|meeting_(open|stop)/.test(n)), names.filter((n) => n.includes('meeting')));

// ---- chưa họp ----
const none = await tool(B1, 'get_my_meeting');
ok('get_my_meeting khi chưa họp → inMeeting false', !none.err && none.j?.inMeeting === false, none.text);
const hTok = await tk(H.token, 'GET', '/api/meetings/sessions/mine');
ok('người thật dùng token GET /sessions/mine → 403', hTok.status === 403, hTok);
ok('người thật (cookie) GET /sessions/mine → 403', (await json(H.cookie, 'GET', '/api/meetings/sessions/mine')).status === 403);
const hTool = await tool(H, 'get_my_meeting');
ok('người thật gọi get_my_meeting → lỗi "Chỉ tài khoản bot"', hTool.err && hTool.text.includes('Chỉ tài khoản bot'), hTool.text);
const noSpeak = await tool(B1, 'speak_in_meeting', { text: 'xin chào' });
ok('speak_in_meeting khi không họp → lỗi', noSpeak.err && noSpeak.text.includes('không dự cuộc họp'), noSpeak.text);

// ---- mở họp (người thật) ----
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic: `Kế hoạch quý ${stamp}`, chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id, B3.e.id] });
ok('người thật mở họp', open.status === 200, open.body);
const SID = open.body?.id as string;

const g1 = await tool(B1, 'get_my_meeting');
ok('B1: inMeeting, chủ trì, lượt của tôi', !g1.err && g1.j.inMeeting && g1.j.sessionId === SID && g1.j.isChair === true && g1.j.isMyTurn === true, g1.text);
ok('B1: conversation là Guid kênh phòng, chủ đề + phòng', /^[0-9a-f-]{36}$/.test(g1.j?.conversation ?? '') && g1.j.topic.includes(stamp) && g1.j.roomId === ROOM && !!g1.j.roomName, g1.j);
ok('B1: currentSpeaker = B1, lượt 0/30, còn ~30 phút, hạn lượt', g1.j?.currentSpeaker?.code === B1.code && g1.j.turnsUsed === 0 && g1.j.maxTurns === 30
  && g1.j.minutesLeft >= 29 && g1.j.minutesLeft <= 30 && !!g1.j.turnDeadline, g1.j);
const bots = (g1.j?.bots ?? []) as any[];
ok('bots: 3 bot (mã, tên, phòng ban, chức vụ), chủ trì đầu', bots.length === 3 && bots[0].code === B1.code && bots[0].isChair
  && bots.every((b) => b.code && b.name && b.department === `Họp MCP ${stamp}` && b.position === pos.name), bots);
const CONV_ID = g1.j?.conversation as string;

const g2 = await tool(B2, 'get_my_meeting');
ok('B2: không phải chủ trì, chưa tới lượt, thấy B1 giữ lượt', !g2.err && g2.j.isChair === false && g2.j.isMyTurn === false && g2.j.currentSpeaker?.code === B1.code, g2.text);
const g4 = await tool(B4, 'get_my_meeting');
ok('B4 (bot ngoài họp): inMeeting false', !g4.err && g4.j?.inMeeting === false, g4.text);
const hList = await tk(H.token, 'GET', `/api/meetings/sessions/${SID}`);
ok('người thật dùng token không xem được phiên → 404', hList.status === 404, hList.status);

// ---- giữ lượt ----
const s2 = await tool(B2, 'speak_in_meeting', { text: 'Tôi chen ngang' });
ok('B2 nói khi chưa tới lượt → lỗi nêu B1 đang giữ', s2.err && s2.text.includes('Bot Chủ Trì') && s2.text.includes(B1.code), s2.text);
const a2 = await tool(B2, 'assign_turn', { to: B3.code });
ok('B2 (không phải chủ trì) assign_turn → lỗi', a2.err, a2.text);
const bad = await tool(B1, 'speak_in_meeting', { text: 'Mời', next: 'NV999XYZ' });
ok('next không dự họp → lỗi liệt kê bot dự, không gửi', bad.err && bad.text.includes(B2.code), bad.text);

const s1 = await tool(B1, 'speak_in_meeting', { text: `Mở đầu: kế hoạch quý ${stamp}. Mời kinh doanh báo số liệu.`, next: B2.code.toLowerCase() });
ok('B1 speak_in_meeting (next = B2) → sent', !s1.err && s1.j?.sent === true && !!s1.j.messageId, s1.text);
if (LIVE) ok('tin phát ngay qua Realtime (deliveredLive)', s1.j?.deliveredLive === true, s1.j);
const msgs = (await json(H.cookie, 'GET', `/api/chat/conversations/${CONV_ID}/messages?take=5`)).body?.items as any[];
const last = msgs?.at(-1);
ok('tin hiện trong kênh phòng: byBot, có @B2, mentions B2', last?.byBot === true && last.text.includes(`@${B2.code}`) && last.mentions?.some((m: any) => m.code === B2.code), last);
const g2b = await tool(B2, 'get_my_meeting');
ok('lượt chuyển sang B2, đã dùng 1 lượt', g2b.j?.isMyTurn === true && g2b.j.turnsUsed === 1 && g2b.j.currentSpeaker?.code === B2.code, g2b.j);
const s1b = await tool(B1, 'speak_in_meeting', { text: 'nói thêm' });
ok('B1 nói lần 2 (hết lượt) → lỗi nêu B2 đang giữ', s1b.err && s1b.text.includes(B2.code), s1b.text);

const p2 = await tool(B2, 'pass_turn');
ok('B2 pass_turn → lượt về chủ trì, 2 lượt', !p2.err && p2.j?.ok && p2.j.currentSpeaker === 'Bot Chủ Trì' && p2.j.turnsUsed === 2, p2.text);
const p2b = await tool(B2, 'pass_turn');
ok('B2 pass_turn khi không giữ lượt → lỗi', p2b.err && p2b.text.includes('Bot Chủ Trì'), p2b.text);

const a1 = await tool(B1, 'assign_turn', { to: 'bot tài chính' });
ok('B1 (chủ trì) assign_turn theo tên → B3 giữ lượt', !a1.err && a1.j?.currentSpeaker === 'Bot Tài Chính' && a1.j.turnsUsed === 3, a1.text);
const a3 = await tool(B3, 'assign_turn', { to: B2.code });
ok('B3 giữ lượt nhưng không phải chủ trì → assign_turn lỗi', a3.err, a3.text);
const s3 = await tool(B3, 'speak_in_meeting', { text: 'Tài chính: chi phí quý đạt 72% ngân sách.' });
ok('B3 speak_in_meeting (không next) → lượt về chủ trì', !s3.err && s3.j?.sent, s3.text);
const g1c = await tool(B1, 'get_my_meeting');
ok('B1 giữ lượt lại, 4 lượt', g1c.j?.isMyTurn === true && g1c.j.turnsUsed === 4, g1c.j);

// ---- người thật dùng token / cookie gọi pass / assign → 403 ----
ok('người thật dùng token POST /pass → 403', (await tk(H.token, 'POST', `/api/meetings/sessions/${SID}/pass`)).status === 403);
ok('người thật dùng token POST /assign → 403', (await tk(H.token, 'POST', `/api/meetings/sessions/${SID}/assign`, { employeeId: B2.e.id })).status === 403);
ok('người thật (cookie) POST /pass → 403', (await json(H.cookie, 'POST', `/api/meetings/sessions/${SID}/pass`)).status === 403);
const hAssign = await tool(H, 'assign_turn', { to: B2.code });
ok('người thật gọi assign_turn → lỗi', hAssign.err && hAssign.text.includes('Chỉ tài khoản bot'), hAssign.text);
ok('B4 (bot ngoài họp) POST /pass → 404', (await tk(B4.token, 'POST', `/api/meetings/sessions/${SID}/pass`)).status === 404);

// ---- nhật ký AI ----
const log = (await json(admin, 'GET', `/api/audit/ai-requests?all=true&userId=${B1.userId}&page=1&pageSize=50`)).body;
const spoke = (log?.items ?? []).find((r: any) => r.tool === 'speak_in_meeting' && r.method === 'POST');
ok('nhật ký AI: speak_in_meeting POST tin, có nội dung', !!spoke && spoke.path.includes('/api/chat/conversations/') && String(spoke.requestSummary ?? '').includes('Mở đầu'), spoke ?? log?.items?.slice(0, 3));
ok('nhật ký AI: pass / assign ghi tên tool', (log?.items ?? []).some((r: any) => r.tool === 'assign_turn' && r.path.endsWith('/assign')));

// ---- kết thúc: chủ trì bỏ lượt khi không ai chờ ----
const end = await tool(B1, 'pass_turn');
ok('B1 pass_turn không ai chờ → kết thúc AllPassed', !end.err && end.j?.status === 'Ended' && end.j.endReason === 'AllPassed', end.text);
const after = await tool(B1, 'get_my_meeting');
ok('sau khi kết thúc: inMeeting false', !after.err && after.j?.inMeeting === false, after.text);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
