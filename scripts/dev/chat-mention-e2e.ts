// E2E TEST-70: @nhắc trong tin nhắn chat — gợi ý thành viên (kênh phòng / Toàn văn phòng / nhóm; 1-1 rỗng), tin lưu `mentions` (chỉ thành viên, bỏ người gửi),
// đếm "chưa đọc có nhắc tôi" (mentionedUnread), Telegram đánh thức bot (event chat_mention), webhook chat.mention, bot nhắc bot → không đánh thức, sửa tin → chỉ người mới.
// MÁY CHỦ TELEGRAM GIẢ + MÁY NHẬN WEBHOOK GIẢ trong cùng tiến trình. TẠO DỮ LIỆU THẬT → CHỈ DB tạm (container như security-e2e.ts):
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5187
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55461;Database=e2e;Username=e2e;Password=e2e' Telegram__ApiUrl=http://localhost:5197
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng giá trị> Smtp__Host=127.0.0.1 Smtp__Port=11061 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=sec-admin@officehub-e2e.vn Seed__AdminPassword=Sec-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile > api.log
//   MCP (tuỳ chọn): Mcp__ApiBaseUrl=http://localhost:5187 ASPNETCORE_URLS=http://localhost:5201 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   Giao diện (tuỳ chọn, BASE_URL): Realtime (Realtime__ApiBaseUrl=http://localhost:5187 ASPNETCORE_URLS=http://localhost:5191 + cùng khoá Chat__*)
//        + Vite (frontend/: VITE_API_TARGET=http://localhost:5187 VITE_RT_TARGET=http://localhost:5191 bunx vite --port 5175 --strictPort)
//        → 2 Chrome: gõ @ trong kênh phòng → gợi ý (BOT) → chọn bằng Enter → gửi → tên tô nổi; người được nhắc thấy "@" ở danh sách + tin được nhấn; HUD 3D.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5187 CHAT_KEY=<khoá trên> MCP_URL=http://localhost:5201/mcp BASE_URL=http://localhost:5175 PG_CONTAINER=e2e-sec-pg \
//        bun scripts/dev/chat-mention-e2e.ts
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5187';
const MCP = process.env.MCP_URL ?? '';
const CHAT_KEY = process.env.CHAT_KEY ?? '';
if (CHAT_KEY.length < 32) throw new Error('Đặt CHAT_KEY = Chat__InternalKey của Api tạm (≥ 32 ký tự)');
const PG = process.env.PG_CONTAINER ?? 'e2e-sec-pg';
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5197), HOOK_PORT = Number(process.env.HOOK_PORT ?? 5298);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'sec-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Sec-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();
const until = async (cond: () => boolean, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

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
const chatWakes = () => sent.filter((s) => s.text.includes('"chat_mention"')).map((s) => JSON.parse(s.text));
const mentionHooks = () => hits.filter((h) => h.event === 'chat.mention');
// Lọc theo tin: webhook thử lại của các lần chạy trước (cùng cổng giả) có thể tới chen vào
const hookFor = (messageId: string) => mentionHooks().filter((h) => h.json.data?.messageId === messageId);

// ---- đăng nhập / dữ liệu ----
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    if (!(await post('/api/auth/2fa/enable', { code }, cookie)).ok) throw new Error(`Không bật được 2FA cho ${user}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000);
    return login(user, password);
  }
  return cookie;
};
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, text };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const convs0 = async (w: { cookie: string }) => ((await json(w.cookie, 'GET', '/api/chat/conversations')).body ?? []) as any[];
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV CM ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Chat mention ${stamp}`, code: `CM${stamp}` })).body;
type Who = { e: any; code: string; name: string; cookie: string; userId: string; token: string };
const mkEmp = async (code: string, name: string, user: string): Promise<Who> => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `cm ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, code, name, cookie, userId, token };
};
const A = await mkEmp(`MA${stamp}`.toUpperCase(), 'Ánh Người Gửi', `e2e.cm.a.${stamp}`);
const H = await mkEmp(`MH${stamp}`.toUpperCase(), `Hùng Người Thật ${stamp}`, `e2e.cm.h.${stamp}`);
const B = await mkEmp(`MB${stamp}`.toUpperCase(), `Devloki Bot ${stamp}`, `e2e.cm.bot.${stamp}`);
const B2 = await mkEmp(`MC${stamp}`.toUpperCase(), 'Bot Phụ', `e2e.cm.bot2.${stamp}`);
const O = await mkEmp(`MO${stamp}`.toUpperCase(), 'Ông Ngoài Phòng', `e2e.cm.out.${stamp}`);
ok('5 tài khoản + token', [A, H, B, B2, O].every((x) => x.cookie && x.userId && x.token?.startsWith('ohk_')));
for (const b of [B, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
await convs0(O); // khởi tạo "đã đọc" Office của O trước (lần xem đầu đặt ở tin mới nhất)
ok('Bật Telegram (giả)', (await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } })).status === 200);
ok('Bot đặt webhook (localhost giả)', (await json(B.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200);

const ROOM = 'meeting-small';
for (const u of [A, H, B, B2]) await call({ 'x-chat-key': CHAT_KEY }, 'POST', `/api/chat/internal/rooms/${ROOM}/members`, { userId: u.userId });
const convs = async (w: Who) => ((await json(w.cookie, 'GET', '/api/chat/conversations')).body ?? []) as any[];
const roomConv = (await convs(A)).find((c) => c.type === 'Room' && c.roomId === ROOM);
ok('A là thành viên kênh Phòng họp nhỏ', !!roomConv, await convs(A));
const RC = roomConv?.id as string;
const send = (w: Who, conv: string, text: string, viaToken = false) =>
  viaToken ? call({ authorization: `Bearer ${w.token}` }, 'POST', `/api/chat/conversations/${conv}/messages`, { text })
    : json(w.cookie, 'POST', `/api/chat/conversations/${conv}/messages`, { text });
const cand = (w: Who, conv: string, search = '') => json(w.cookie, 'GET', `/api/chat/conversations/${conv}/mention-candidates?search=${encodeURIComponent(search)}`);

// ---- Gợi ý @ ----
let r = await cand(A, RC, stamp); // mã nhân viên của lần chạy này đều chứa stamp (phòng còn thành viên của các lần chạy trước; tối đa 8 gợi ý)
const ids = (r.body ?? []).map((x: any) => x.userId);
ok('Gợi ý kênh phòng: thành viên trừ mình, không có người ngoài phòng', r.status === 200 && r.body.length === 3 && [H, B, B2].every((x) => ids.includes(x.userId)) && !ids.includes(A.userId) && !ids.includes(O.userId), r.body);
ok('… bot có isBot, mã + tên đúng', r.body?.find((x: any) => x.userId === B.userId)?.isBot === true && r.body?.find((x: any) => x.userId === H.userId)?.isBot === false
  && r.body?.find((x: any) => x.userId === B.userId)?.code === B.code);
r = await cand(A, RC, `devloki bot ${stamp}`);
ok('Tìm không phân biệt hoa thường theo tên ("devloki bot …")', r.body?.length === 1 && r.body[0].userId === B.userId, r.body);
r = await cand(A, RC, `hung nguoi that ${stamp}`);
ok('Tìm bỏ dấu ("hung nguoi that …" → Hùng Người Thật)', r.body?.length === 1 && r.body[0].userId === H.userId, r.body);
r = await cand(A, 'office', O.code.toLowerCase());
ok('Toàn văn phòng: gợi ý cả người ngoài phòng (theo mã)', r.body?.some((x: any) => x.userId === O.userId), r.body);
ok('Người ngoài kênh xin gợi ý kênh phòng → 404', (await cand(O, RC)).status === 404);
const DM = (await json(A.cookie, 'POST', '/api/chat/conversations/direct', { userId: H.userId })).body?.id as string;
r = await cand(A, DM);
ok('1-1: không gợi ý (rỗng)', r.status === 200 && Array.isArray(r.body) && r.body.length === 0, r.body);
ok('Token AI gọi gợi ý → 403', (await call({ authorization: `Bearer ${B.token}` }, 'GET', `/api/chat/conversations/${RC}/mention-candidates`)).status === 403);

// ---- Gửi tin có @ trong kênh phòng ----
let wb = chatWakes().length;
r = await send(A, RC, `@${B.code} đâu? cc @${O.code} @${H.code.toLowerCase()} và @${A.code}`);
const M1 = r.body?.message;
ok('Gửi tin phòng → mentions = [bot, người thật] (bỏ người ngoài phòng, bỏ chính mình, mã không phân biệt hoa thường)', r.status === 200
  && JSON.stringify(M1?.mentions?.map((x: any) => x.userId)) === JSON.stringify([B.userId, H.userId]), r.body);
ok('… mention có mã + tên hiện tại', M1?.mentions?.[0]?.code === B.code && M1?.mentions?.[0]?.name === B.name, M1?.mentions);
ok('Telegram: đúng 1 tin chat_mention cho bot', await until(() => chatWakes().length === wb + 1) && (await sleep(3500), chatWakes().length === wb + 1), chatWakes().length - wb);
const w1 = chatWakes().at(-1);
ok('… JSON: employee_code, event, conversation_id, message_id (không nội dung)', JSON.stringify(Object.keys(w1 ?? {})) === JSON.stringify(['employee_code', 'event', 'conversation_id', 'message_id'])
  && w1.employee_code === B.code && w1.conversation_id === RC && w1.message_id === M1?.id && !sent.at(-1)!.text.includes('đâu'), w1);
ok('Webhook chat.mention tới bot (messageId, conversationId, text)', await until(() => hookFor(M1?.id).length === 1)
  && hookFor(M1?.id)[0].json.data?.conversationId === RC && String(hookFor(M1?.id)[0].json.data?.text).includes('đâu?'), mentionHooks().at(-1)?.json);
const hRoom = (await convs(H)).find((c) => c.id === RC);
ok('Người được nhắc: mentionedUnread = 1', hRoom?.unread >= 1 && hRoom?.mentionedUnread === 1, hRoom);
ok('Người không được nhắc (bot phụ): mentionedUnread = 0', (await convs(B2)).find((c) => c.id === RC)?.mentionedUnread === 0);
const hist = await json(H.cookie, 'GET', `/api/chat/conversations/${RC}/messages`);
ok('Lịch sử trả mentions', hist.body?.items?.find((m: any) => m.id === M1?.id)?.mentions?.length === 2, hist.body?.items?.at(-1));
ok('Đánh dấu đã đọc → mentionedUnread = 0', (await json(H.cookie, 'POST', `/api/chat/conversations/${RC}/read`)).status === 204
  && (await convs(H)).find((c) => c.id === RC)?.mentionedUnread === 0);
const botList = await call({ authorization: `Bearer ${B.token}` }, 'GET', '/api/chat/conversations');
ok('Bot (token) thấy mentionedUnread của kênh phòng', botList.body?.find((c: any) => c.id === RC)?.mentionedUnread === 1, botList.body);

// ---- Bot nhắc bot: lưu mentions nhưng không đánh thức ----
await sleep(1100);
wb = chatWakes().length;
r = await send(B2, RC, `@${B.code} trả lời giúp`, true);
const BB1 = r.body?.message?.id as string;
ok('Bot phụ (token) nhắc bot → 200, mentions có bot', r.status === 200 && r.body?.message?.mentions?.[0]?.userId === B.userId && r.body?.message?.byBot === true, r.body);
await sleep(4000);
ok('… không Telegram, không webhook (chống vòng lặp bot ↔ bot)', chatWakes().length === wb && hookFor(BB1).length === 0, { tg: chatWakes().length - wb, hook: hookFor(BB1).length });
await sleep(1100);
r = await send(B2, RC, `@${B.code} gửi từ web của tài khoản bot`);
await sleep(4000);
ok('Tài khoản bot nhắn trên web (cookie) nhắc bot → cũng không đánh thức', r.status === 200 && chatWakes().length === wb && hookFor(r.body?.message?.id).length === 0);

// ---- Sửa tin: chỉ người mới được nhắc ----
wb = chatWakes().length;
r = await json(A.cookie, 'PATCH', `/api/chat/messages/${M1.id}`, { text: `@${B.code} đâu? thêm @${B2.code}` });
ok('Sửa tin thêm @bot phụ → mentions = [bot, bot phụ] (bỏ H)', r.status === 200
  && JSON.stringify(r.body?.message?.mentions?.map((x: any) => x.userId)) === JSON.stringify([B.userId, B2.userId]), r.body);
ok('… chỉ bot phụ (mới) được đánh thức', await until(() => chatWakes().length === wb + 1) && (await sleep(3500), chatWakes().length === wb + 1)
  && chatWakes().at(-1).employee_code === B2.code, chatWakes().slice(wb));

// ---- Toàn văn phòng / 1-1 / nhóm ----
await sleep(1100);
wb = chatWakes().length;
r = await send(A, 'office', `@${O.code} và @${B.code} ơi`);
ok('Toàn văn phòng: nhắc được mọi nhân viên (người ngoài phòng + bot)', r.status === 200
  && JSON.stringify(r.body?.message?.mentions?.map((x: any) => x.userId)) === JSON.stringify([O.userId, B.userId]), r.body);
ok('… Telegram cho bot (event chat_mention, conversation = Office)', await until(() => chatWakes().length === wb + 1) && chatWakes().at(-1).employee_code === B.code
  && chatWakes().at(-1).conversation_id === r.body?.message?.conversationId);
ok('… người ngoài phòng có mentionedUnread ở Office', (await convs(O)).find((c) => c.type === 'Office')?.mentionedUnread === 1);
await sleep(1100);
r = await send(A, DM, `@${H.code} xem nhé`);
ok('1-1: không lưu mentions (hành vi cũ)', r.status === 200 && (r.body?.message?.mentions ?? []).length === 0, r.body);
const G = (await json(A.cookie, 'POST', '/api/chat/conversations/group', { title: `Nhóm ${stamp}`, userIds: [H.userId] })).body?.id as string;
await sleep(1100);
r = await send(A, G, `@${H.code} @${O.code}`);
ok('Nhóm: chỉ thành viên nhóm được nhắc', r.status === 200 && JSON.stringify(r.body?.message?.mentions?.map((x: any) => x.userId)) === JSON.stringify([H.userId]), r.body);
ok('Gợi ý nhóm = thành viên nhóm', JSON.stringify((await cand(A, G)).body?.map((x: any) => x.userId)) === JSON.stringify([H.userId]));
await sleep(1100);
const many = `${Array.from({ length: 12 }, () => `@${H.code}`).join(' ')} @${B.code}`;
r = await send(A, RC, many);
ok('Nhắc trùng một người nhiều lần → lưu 1 lần', r.status === 200 && r.body?.message?.mentions?.length === 2, r.body?.message?.mentions);

const dbq = (await sql(`select count(*) from notifications.telegram_messages where "Kind"='chat_mention' and "TaskId" is null and "Text" like '%${B.code}%'`)).trim();
ok('DB: hàng đợi Kind = chat_mention, TaskId trống', Number(dbq) >= 3, dbq);
const col = (await sql(`select array_length("MentionedUserIds",1) from chat.messages where "Id"='${M1.id}'`)).trim();
ok('DB: chat.messages.MentionedUserIds (uuid[]) đã lưu', col === '2', col);

// ---- MCP thật (tuỳ chọn) ----
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${B.token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const d = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(d); } catch { return text; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const lc = JSON.parse((await rpc('tools/call', { name: 'list_chats', arguments: {} }))?.result?.content?.[0]?.text ?? '[]');
  ok('MCP list_chats: mentionedUnread của kênh phòng ≥ 1', (lc.find((c: any) => c.conversation === RC)?.mentionedUnread ?? 0) >= 1, lc);
  const rc = JSON.parse((await rpc('tools/call', { name: 'read_chat', arguments: { conversation: RC, take: 10 } }))?.result?.content?.[0]?.text ?? '{}');
  ok('MCP read_chat: tin có mentions [{code, name}]', rc.messages?.some((m: any) => m.mentions?.some((x: any) => x.code === B.code && x.name === B.name)), rc);
}

// ---- Giao diện (tuỳ chọn) ----
if (process.env.BASE_URL) {
  const BASE = process.env.BASE_URL;
  const a = await launch(9341, `${tmpdir()}/cm-a-${stamp}`);
  const h = await launch(9342, `${tmpdir()}/cm-h-${stamp}`);
  const waitJs = async (p: typeof a, expr: string, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (await p.evalJs(expr)) return true; await p.sleep(250); } return false; };
  const typeText = (p: typeof a, t: string) => p.send('Input.insertText', { text: t });
  const press = async (p: typeof a, k: string) => {
    await p.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 });
    await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code: k, windowsVirtualKeyCode: k === 'Enter' ? 13 : 0 });
  };
  const input = `document.querySelector('[data-testid="chat-input"]')`;
  ok('UI: A đăng nhập', (await a.login(`e2e.cm.a.${stamp}`, PW)) === 200);
  ok('UI: H đăng nhập', (await h.login(`e2e.cm.h.${stamp}`, PW)) === 200);
  await a.go(`${BASE}/chat?c=${RC}`, 3500);
  await a.evalJs(`${input}.focus()`);
  await typeText(a, `@${B.code.toLowerCase()}`);
  ok('UI: gõ "@<mã bot>" → gợi ý có bot + chip BOT', await waitJs(a, `(() => { const l = document.querySelector('[data-testid="mention-list"]'); return !!l && l.textContent.includes(${JSON.stringify(B.name)}) && l.textContent.includes('BOT'); })()`),
    await a.evalJs(`document.querySelector('[data-testid="mention-list"]')?.textContent ?? null`));
  await press(a, 'Enter');
  ok('UI: Enter chọn → ô nhập thành "@<mã bot> " (không gửi)', await waitJs(a, `${input}.value === ${JSON.stringify(`@${B.code} `)}`), await a.evalJs(`${input}.value`));
  await typeText(a, `@${H.code.toLowerCase()}`);
  ok('UI: gợi ý người thật theo mã', await waitJs(a, `document.querySelector('[data-testid="mention-list"]')?.textContent.includes(${JSON.stringify(H.name)}) === true`));
  await press(a, 'Enter');
  await typeText(a, 'xem giúp');
  await press(a, 'Enter');
  ok('UI: gửi → tin hiện "@<tên bot>" + "@<tên người>" tô nổi', await waitJs(a, `(() => { const ms = [...document.querySelectorAll('[data-testid="chat-message"]')].at(-1);
      const ns = [...(ms?.querySelectorAll('[data-testid="chat-mention"]') ?? [])].map((x) => x.textContent); return ns.includes(${JSON.stringify('@' + B.name)}) && ns.includes(${JSON.stringify('@' + H.name)}); })()`),
    await a.evalJs(`[...document.querySelectorAll('[data-testid="chat-message"]')].at(-1)?.innerText`));
  ok('UI: ô nhập trống sau khi gửi', await a.evalJs(`${input}.value === ''`));
  await h.go(`${BASE}/chat`, 3500);
  ok('UI (H): danh sách hội thoại có "@" ở kênh phòng', await waitJs(h, `[...document.querySelectorAll('[data-testid="chat-conversation"]')].some((c) => c.textContent.includes('Phòng họp nhỏ') && c.querySelector('[data-testid="chat-conversation-mention"]'))`));
  await h.go(`${BASE}/chat?c=${RC}`, 3500);
  ok('UI (H): tin nhắc mình được nhấn (data-mentions-me)', await waitJs(h, `[...document.querySelectorAll('[data-testid="chat-message"]')].at(-1)?.dataset.mentionsMe === 'true'`));
  ok('UI (A): tin của mình không bị nhấn', await a.evalJs(`[...document.querySelectorAll('[data-testid="chat-message"]')].at(-1)?.dataset.mentionsMe === undefined`));
  await h.go(`${BASE}/chat?c=${DM}`, 3000);
  await h.evalJs(`${input}.focus()`);
  await typeText(h, '@an');
  await h.sleep(1500);
  ok('UI: 1-1 gõ @ không hiện gợi ý', await h.evalJs(`!document.querySelector('[data-testid="mention-list"]')`));
  // HUD 3D: H trong văn phòng, A nhắc H ở Toàn văn phòng (gửi từ web qua hub → Realtime phát vào HUD; REST thẳng thì không phát)
  await h.go(`${BASE}/office`, 6000);
  await a.go(`${BASE}/chat?c=office`, 3500);
  await a.evalJs(`${input}.focus()`);
  await typeText(a, `Chào @${H.code} trong 3D`);
  await press(a, 'Escape');
  await press(a, 'Enter');
  ok('UI HUD 3D: dòng chat thay "@mã" bằng tên (tô) + nhấn dòng nhắc mình', await waitJs(h, `(() => { const d = [...document.querySelectorAll('[data-testid="office-chat"] .log > div')].at(-1);
      return !!d && d.dataset.mentionsMe === 'true' && d.querySelector('.mention')?.textContent === ${JSON.stringify('@' + H.name)}; })()`, 15000),
    await h.evalJs(`[...document.querySelectorAll('[data-testid="office-chat"] .log > div')].at(-1)?.outerHTML ?? null`));
  const errs = [...a.errors, ...h.errors].filter((e) => !/livekit|7880|voice|favicon|WebGL|GPU/i.test(e));
  ok('UI: không lỗi console', errs.length === 0, errs);
  a.close(); h.close();
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
