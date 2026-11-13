// E2E TEST-75: chia lượt nói trong họp agent — mở họp → chỉ bot chủ trì nhận meeting_turn; bot giữ lượt @nhắc bot khác → bot đó nhận lượt;
// bot không giữ lượt / bot không dự họp nhắn vào kênh phòng → 409; người thật @nhắc bot → bot nhận lượt (không tính lượt, không chat_mention trùng);
// bỏ lượt / chỉ định (API), hết giờ chờ 3 phút → coi như bỏ lượt (job), chủ trì bỏ lượt → kết thúc AllPassed, hết trần lượt → TurnLimit,
// tin hệ thống báo kết thúc trong kênh phòng, ngoài phiên họp bot nhắn bot không đánh thức ai.
// MÁY CHỦ TELEGRAM GIẢ + MÁY NHẬN WEBHOOK GIẢ trong cùng tiến trình. TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-agt-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55475:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5188
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55475;Database=e2e;Username=e2e;Password=e2e' Telegram__ApiUrl=http://localhost:5196
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng giá trị> Smtp__Host=127.0.0.1 Smtp__Port=11062 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=agt-admin@officehub-e2e.vn Seed__AdminPassword=Agt-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5188 CHAT_KEY=<khoá trên> ADMIN_LOGIN=agt-admin@officehub-e2e.vn ADMIN_PASSWORD=Agt-Admin-2026 PG_CONTAINER=e2e-agt-pg \
//     bun scripts/dev/agent-meeting-turns-e2e.ts
// Phần "hết giờ chờ" sửa TurnStartedAt bằng psql trong container DB tạm rồi chờ job (mỗi phút) — ~2 phút.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5188';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const PG = process.env.PG_CONTAINER ?? 'e2e-agt-pg';
const CHAT_KEY = process.env.CHAT_KEY ?? '';
if (CHAT_KEY.length < 32) throw new Error('Đặt CHAT_KEY = Chat__InternalKey của Api tạm (≥ 32 ký tự)');
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5196), HOOK_PORT = Number(process.env.HOOK_PORT ?? 5296);
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();

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
const hits: { event: string; json: any }[] = [];
Bun.serve({
  port: HOOK_PORT,
  async fetch(req) {
    hits.push({ event: req.headers.get('x-officehub-event') ?? '', json: JSON.parse(await req.text()) });
    return new Response('ok');
  },
});
const wakes = (event: string) => sent.map((s) => { try { return JSON.parse(s.text); } catch { return null; } }).filter((j) => j?.event === event);
const turnWakes = (code: string) => wakes('meeting_turn').filter((j) => j.employee_code === code);
const until = async (cond: () => boolean, ms = 12000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

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
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Lượt họp ${stamp}`, code: `LT${stamp}`.slice(0, 10) })).body;
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
const H = await mkEmp('Người Họp', `e2e.lth.${stamp}`);
const B1 = await mkEmp('Bot Chủ Trì', `e2e.ltb1.${stamp}`);
const B2 = await mkEmp('Bot Kinh Doanh', `e2e.ltb2.${stamp}`);
const B3 = await mkEmp('Bot Tài Chính', `e2e.ltb3.${stamp}`);
const B4 = await mkEmp('Bot Ngoài Họp', `e2e.ltb4.${stamp}`);
ok('5 tài khoản + token', [H, B1, B2, B3, B4].every((x) => x.e?.id && x.token?.startsWith('ohk_') && x.userId), [H, B1].map((x) => x.userId));
for (const b of [B1, B2, B3, B4]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

const tg = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } });
ok('Bật Telegram (giả)', tg.status === 200, tg.body);
ok('B2 đặt webhook (localhost giả)', (await json(B2.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200);
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });

const rooms = (await json(H.cookie, 'GET', '/api/meetings/rooms')).body as any[];
const ROOM = rooms[0].id as string;
const CONV = `room:${ROOM}`;
// Lần chạy trước bị dừng giữa chừng → còn phiên đang họp trong phòng: admin dừng
for (const old of (await json(admin, 'GET', `/api/meetings/sessions?roomId=${ROOM}&active=true`)).body ?? [])
  await json(admin, 'POST', `/api/meetings/sessions/${old.id}/stop`);
// Người thật + bot ngoài họp vào kênh phòng như khi đi vào phòng (khoá nội bộ Realtime → Api)
for (const u of [H, B4]) await call({ 'x-chat-key': CHAT_KEY }, 'POST', `/api/chat/internal/rooms/${ROOM}/members`, { userId: u.userId });
// Token AI chỉ dùng id hội thoại (Guid) — lấy từ tin meeting_turn đầu tiên
let CONV_ID = '';
// Chat chặn mỗi người 1 tin / giây (429) → giãn các tin
const say = async (who: { token: string }, text: string) => { await sleep(1100); return tk(who.token, 'POST', `/api/chat/conversations/${CONV_ID}/messages`, { text }); };
const sayH = async (text: string) => { await sleep(1100); return json(H.cookie, 'POST', `/api/chat/conversations/${CONV}/messages`, { text }); };
const session = async (id: string) => (await json(H.cookie, 'GET', `/api/meetings/sessions/${id}`)).body;
const lastMessages = async () => (await json(H.cookie, 'GET', `/api/chat/conversations/${CONV}/messages?take=5`)).body?.items as any[];

// ---------- Mở họp ----------
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic: 'Doanh thu Q1', chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id, B3.e.id] });
const M = open.body;
ok('mở họp → lượt đầu thuộc bot chủ trì', open.status === 200 && M.currentSpeakerEmployeeId === B1.e.id && M.turnDeadline && M.turnsUsed === 0, open);
ok('Telegram: chỉ bot chủ trì nhận meeting_turn', await until(() => turnWakes(B1.code).length === 1) && turnWakes(B2.code).length === 0 && turnWakes(B3.code).length === 0,
  wakes('meeting_turn'));
const w1 = turnWakes(B1.code)[0];
ok('tin meeting_turn: đúng 4 trường (session_id, conversation_id), không nội dung', w1 && Object.keys(w1).join() === 'employee_code,event,session_id,conversation_id'
  && w1.session_id === M.id, w1);
CONV_ID = w1?.conversation_id as string;
ok('DB: hàng đợi Kind = meeting_turn', Number((await sql(`select count(*) from notifications.telegram_messages where "Kind"='meeting_turn'`)).trim()) >= 1);
const b1View = await tk(B1.token, 'GET', `/api/meetings/sessions/${M.id}`);
ok('bot chủ trì xem phiên: isMyTurn', b1View.body?.isMyTurn === true && b1View.body.bots[0].isSpeaking, b1View.body);
ok('bot dự họp được thêm vào kênh phòng (đọc được)', (await tk(B2.token, 'GET', `/api/chat/conversations/${CONV_ID}/messages`)).status === 200);

// ---------- Chặn ở back-end ----------
const notTurn = await say(B2, 'Tôi nói trước được không?');
ok('bot dự họp không giữ lượt nhắn → 409 kèm lý do', notTurn.status === 409 && String(notTurn.body?.detail ?? '').includes('Bot Chủ Trì'), notTurn);
const outsider = await say(B4, 'Xin chào phòng họp');
ok('bot không dự họp nhắn vào kênh phòng → 409', outsider.status === 409, outsider);
ok('bot dự họp không giữ lượt bỏ lượt → 409', (await tk(B2.token, 'POST', `/api/meetings/sessions/${M.id}/pass`)).status === 409);
ok('bot không phải chủ trì chỉ định → 409', (await tk(B2.token, 'POST', `/api/meetings/sessions/${M.id}/assign`, { employeeId: B3.e.id })).status === 409);
ok('bot không dự họp bỏ lượt → 404', (await tk(B4.token, 'POST', `/api/meetings/sessions/${M.id}/pass`)).status === 404);
ok('người thật (cookie) bỏ lượt → 403 (TEST-82: không phải tài khoản bot → 403 trước mọi kiểm tra)', (await json(H.cookie, 'POST', `/api/meetings/sessions/${M.id}/pass`)).status === 403);

// ---------- Chủ trì @nhắc → bot đó nói ----------
const s1 = await say(B1, `Mở đầu cuộc họp. @${B2.code} trình bày số liệu kinh doanh.`);
ok('bot chủ trì nói (giữ lượt) → 200', s1.status === 200, s1);
let S = await session(M.id);
ok('… @nhắc B2 → B2 giữ lượt, đã dùng 1 lượt', S.currentSpeakerEmployeeId === B2.e.id && S.turnsUsed === 1, S);
ok('… Telegram meeting_turn cho B2', await until(() => turnWakes(B2.code).length === 1), wakes('meeting_turn'));
ok('… webhook meeting.turn cho B2 (sessionId, conversationId)', await until(() => hits.some((h) => h.event === 'meeting.turn' && h.json.data?.sessionId === M.id
  && h.json.data?.conversationId === CONV_ID)), hits.map((h) => h.event));
ok('… bot nhắc bot: không chat_mention', wakes('chat_mention').length === 0);
ok('bot chủ trì nói tiếp khi đã hết lượt → 409', (await say(B1, 'Thêm một ý')).status === 409);
// Sửa tin chỉ có trên web (token AI không có route) → tài khoản bot đăng nhập web
const editBlocked = await json(B1.cookie, 'PATCH', `/api/chat/messages/${s1.body?.message?.id}`, { text: `Sửa @${B3.code}` });
ok('tài khoản bot sửa tin trong kênh phòng đang họp (web) → 409', editBlocked.status === 409, editBlocked);
ok('tài khoản bot không giữ lượt nhắn qua web → 409', (await json(B3.cookie, 'POST', `/api/chat/conversations/${CONV}/messages`, { text: 'web' })).status === 409);

// ---------- Mỗi lượt một tin; không nhắc → về chủ trì ----------
ok('B2 nói (không nhắc ai) → 200', (await say(B2, 'Doanh thu tháng 10 đạt 120%.')).status === 200);
ok('B2 nói tin thứ hai → 409 (mỗi lượt một tin)', (await say(B2, 'Thêm nữa')).status === 409);
S = await session(M.id);
ok('… lượt về bot chủ trì, 2 lượt', S.currentSpeakerEmployeeId === B1.e.id && S.turnsUsed === 2, S);
ok('… bot chủ trì được đánh thức lần 2', await until(() => turnWakes(B1.code).length === 2));

// ---------- Nhắc nhiều bot → lần lượt ----------
await say(B1, `@${B3.code} rồi @${B2.code} cho ý kiến.`);
S = await session(M.id);
ok('nhắc B3 rồi B2 → B3 giữ lượt, B2 chờ (vị trí 1)', S.currentSpeakerEmployeeId === B3.e.id && S.bots.find((b: any) => b.employeeId === B2.e.id)?.queuePosition === 1, S);
await say(B3, 'Chi phí trong kế hoạch.');
S = await session(M.id);
ok('… B3 nói xong → tới B2', S.currentSpeakerEmployeeId === B2.e.id && S.turnsUsed === 4, S);

// ---------- Người thật @nhắc bot ----------
await until(() => turnWakes(B3.code).length === 1); // tin đánh thức trước của B3 đã tới (hàng đợi gửi mỗi 3 giây)
const beforeB3 = turnWakes(B3.code).length;
const h1 = await sayH(`@${B3.code} cho tôi biết dòng tiền tháng này?`);
ok('người thật nhắn trong phòng đang họp → 200', h1.status === 200, h1);
S = await session(M.id);
ok('… B3 nhận lượt ngay, không tính lượt', S.currentSpeakerEmployeeId === B3.e.id && S.turnsUsed === 4, S);
ok('… Telegram meeting_turn cho B3', await until(() => turnWakes(B3.code).length === beforeB3 + 1));
await sleep(3500);
ok('… không gửi chat_mention trùng cho B3', wakes('chat_mention').filter((j) => j.employee_code === B3.code).length === 0, wakes('chat_mention'));
ok('người thật nhắn không nhắc ai → không đổi lượt', (await sayH('Mọi người cứ tiếp tục.')).status === 200 && (await session(M.id)).currentSpeakerEmployeeId === B3.e.id);

// ---------- Bỏ lượt / chỉ định ----------
const p1 = await tk(B3.token, 'POST', `/api/meetings/sessions/${M.id}/pass`);
ok('B3 bỏ lượt → B2 (còn chờ trong hàng), tính lượt', p1.status === 200 && p1.body.currentSpeakerEmployeeId === B2.e.id && p1.body.turnsUsed === 5, p1);
const p2 = await tk(B2.token, 'POST', `/api/meetings/sessions/${M.id}/pass`);
ok('B2 bỏ lượt → về chủ trì', p2.status === 200 && p2.body.currentSpeakerEmployeeId === B1.e.id, p2);
ok('chủ trì tự chỉ định mình → 409', (await tk(B1.token, 'POST', `/api/meetings/sessions/${M.id}/assign`, { employeeId: B1.e.id })).status === 409);
ok('chủ trì chỉ định bot ngoài họp → 409', (await tk(B1.token, 'POST', `/api/meetings/sessions/${M.id}/assign`, { employeeId: B4.e.id })).status === 409);
const a1 = await tk(B1.token, 'POST', `/api/meetings/sessions/${M.id}/assign`, { employeeId: B3.e.id });
ok('chủ trì chỉ định B3 qua API → B3 giữ lượt', a1.status === 200 && a1.body.currentSpeakerEmployeeId === B3.e.id && a1.body.turnsUsed === 7, a1);

// ---------- Hết giờ chờ 3 phút → coi như bỏ lượt ----------
await sql(`UPDATE meetings.agent_sessions SET "TurnStartedAt" = now() - interval '4 minutes' WHERE "Id" = '${M.id}'`);
let t: any = null;
for (let i = 0; i < 20 && t?.currentSpeakerEmployeeId !== B1.e.id; i++) { await sleep(6000); t = await session(M.id); }
ok('job: B3 quá 3 phút không nói → lượt về chủ trì, tính lượt', t?.currentSpeakerEmployeeId === B1.e.id && t.turnsUsed === 8 && t.status === 'Active', t);

// ---------- Chủ trì bỏ lượt, không ai chờ → kết thúc ----------
const end1 = await tk(B1.token, 'POST', `/api/meetings/sessions/${M.id}/pass`);
ok('chủ trì bỏ lượt không chỉ định ai → Ended / AllPassed', end1.status === 200 && end1.body.status === 'Ended' && end1.body.endReason === 'AllPassed'
  && !end1.body.currentSpeakerEmployeeId, end1);
let msgs = await lastMessages();
ok('tin hệ thống báo kết thúc trong kênh phòng', msgs?.some((x) => x.senderName === 'OfficeHub' && x.text?.includes('không còn ai phát biểu')), msgs?.map((x) => x.text));
ok('hết họp: bot nhắn kênh phòng như thường (200)', (await say(B4, 'Phòng trống rồi')).status === 200);
const chatBefore = wakes('chat_mention').length, turnBefore = wakes('meeting_turn').length;
ok('ngoài phiên họp: bot @nhắc bot → 200', (await say(B2, `@${B3.code} xong họp rồi`)).status === 200);
await sleep(3500);
ok('… không đánh thức ai (không meeting_turn, không chat_mention)', wakes('chat_mention').length === chatBefore && wakes('meeting_turn').length === turnBefore);

// ---------- Trần lượt ----------
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 3, maxMinutes: 30 });
const M2 = (await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic: 'Trần lượt', chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id] })).body;
ok('mở phiên 3 lượt', M2?.maxTurns === 3 && M2.currentSpeakerEmployeeId === B1.e.id, M2);
await say(B1, `@${B2.code} nói đi`);
await say(B2, 'Đã nói');
const last = await say(B1, 'Kết luận');
S = await session(M2.id);
ok('đủ 3 lượt → phiên tự kết thúc TurnLimit', last.status === 200 && S.status === 'Ended' && S.endReason === 'TurnLimit' && S.turnsUsed === 3, S);
msgs = await lastMessages();
ok('… tin hệ thống "hết 3 lượt"', msgs?.some((x) => x.senderName === 'OfficeHub' && x.text?.includes('dùng hết 3 lượt')), msgs?.map((x) => x.text));
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });

// ---------- Người dừng → tin hệ thống ----------
const M3 = (await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic: 'Dừng tay', chairEmployeeId: B2.e.id, botIds: [B1.e.id, B2.e.id] })).body;
const st = await json(H.cookie, 'POST', `/api/meetings/sessions/${M3.id}/stop`);
msgs = await lastMessages();
ok('người mở dừng → tin hệ thống "dừng cuộc họp"', st.status === 200 && msgs?.some((x) => x.senderName === 'OfficeHub' && x.text?.includes('Dừng tay')
  && x.text.includes('dừng cuộc họp')), msgs?.map((x) => x.text));
ok('bot đã dừng họp không bỏ lượt được → 409', (await tk(B2.token, 'POST', `/api/meetings/sessions/${M3.id}/pass`)).status === 409);

await json(admin, 'DELETE', '/api/system/settings/telegram');
console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
