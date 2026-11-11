// E2E: đội agent tự phối hợp qua bảng việc — (1) rào chắn + @nhắc, (2) webhook đánh thức agent, (3) việc phụ thuộc.
// (1) token không bao giờ duyệt (kể cả quản lý dự án), 20 việc / ngày / tài khoản, chuỗi 10 thao tác bot liên tiếp → chặn tới khi người thật xem,
//     @mã-nhân-viên → chuông "nhắc bạn". (2) đặt / sửa / đổi khoá / gửi thử / xoá webhook (token 403), ký HMAC đúng, thông báo + tin 1-1 → webhook,
//     URL chết → lỗi + thử lại. (3) chờ việc, chặn vòng / khác dự án, bot không bắt đầu việc còn chờ, việc trước xong → "Sẵn sàng" (+ webhook), MCP dependsOn.
// CHỈ DB tạm. Api :5180 chạy ASPNETCORE_ENVIRONMENT=Development (cho phép webhook về localhost). MCP tuỳ chọn (MCP_URL).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/agent-team-e2e.ts
import { createHmac } from 'node:crypto';
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

const MCP = process.env.MCP_URL ?? '';
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 5299);
const addDays = (n: number) => new Date(Date.parse(today) + n * 86400000).toISOString().slice(0, 10);
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Máy nhận webhook giả ----------
type Hit = { event: string; ts: string; sig: string; body: string; json: any };
const hits: Hit[] = [];
let failNext = 0;
const server = Bun.serve({
  port: HOOK_PORT,
  async fetch(req) {
    const body = await req.text();
    if (failNext > 0) { failNext--; return new Response('boom', { status: 500 }); }
    hits.push({ event: req.headers.get('x-officehub-event') ?? '', ts: req.headers.get('x-officehub-timestamp') ?? '', sig: req.headers.get('x-officehub-signature') ?? '',
      body, json: JSON.parse(body) });
    return new Response('ok');
  },
});
const waitHit = async (pred: (h: Hit) => boolean, ms = 15000) => {
  for (let i = 0; i < ms / 250; i++) { const h = hits.find(pred); if (h) return h; await Bun.sleep(250); }
  return undefined;
};
const signed = (h: Hit | undefined, secret: string) => !!h && h.sig === 'sha256=' + createHmac('sha256', secret).update(`${h.ts}.${h.body}`).digest('hex');

// ---------- Chuẩn bị ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV AT ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Đội agent ${stamp}`, code: `AT${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  return { e, code, cookie, token, userId, name };
};
const PM = await mkEmp(`AM${stamp}`, 'Quản Lý Đội', `e2e.at.pm.${stamp}`, ['employee', 'manager']);
const L = await mkEmp(`AL${stamp}`, 'Bot Trưởng Nhóm', `e2e.at.lead.${stamp}`, ['employee']);
const W = await mkEmp(`AW${stamp}`, 'Bot Thợ', `e2e.at.work.${stamp}`, ['employee']);
const H = await mkEmp(`AH${stamp}`, 'Dev Người', `e2e.at.dev.${stamp}`, ['employee']);
ok('4 tài khoản + token', [PM, L, W, H].every((x) => x.cookie && x.token?.startsWith('ohk_')));
for (const b of [L, W]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `at-${stamp}`, name: 'Đội agent', kind: 'Internal', startOn: today, memberIds: [L.e.id, W.e.id, H.e.id] })).body;
const CODE = `AT-${stamp}`.toUpperCase();
const pd = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
const col = (n: string) => pd.columns.find((c: any) => c.name === n)!.id as string;
const [TODO, DOING, REVIEW, DONE] = ['Cần làm', 'Đang làm', 'Chờ review', 'Xong'].map(col);
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const notifs = async (c: string) => ((await json(c, 'GET', '/api/notifications?take=50')).body?.items ?? []) as any[];
const newTask = (token: string, title: string, assignee: string | null = W.e.id) => tk(token, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: assignee });

// ================= (2) Webhook — đặt trước để bắt sự kiện các phần sau =================
ok('token AI không xem / đặt webhook → 403', (await tk(W.token, 'GET', '/api/notifications/webhook')).status === 403
  && (await tk(W.token, 'PUT', '/api/notifications/webhook', { url: 'https://x.example.com' })).status === 403
  && (await tk(W.token, 'POST', '/api/notifications/webhook/test')).status === 403);
ok('URL ftp:// → 400', (await json(W.cookie, 'PUT', '/api/notifications/webhook', { url: 'ftp://x' })).status === 400);
ok('chưa có webhook → configured=false', (await json(W.cookie, 'GET', '/api/notifications/webhook')).body?.configured === false);
const hookUrl = `http://localhost:${HOOK_PORT}/hook`;
const created = await json(W.cookie, 'PUT', '/api/notifications/webhook', { url: hookUrl, enabled: true });
let secret = created.body?.secret as string;
ok('tạo webhook → trả khoá ký một lần (whsec_)', created.status === 200 && secret?.startsWith('whsec_'), created);
ok('lưu lại (đổi URL) không trả khoá', (await json(W.cookie, 'PUT', '/api/notifications/webhook', { url: hookUrl, enabled: true })).body?.secret === null);
ok('gửi thử → 204', (await json(W.cookie, 'POST', '/api/notifications/webhook/test')).status === 204);
const ping = await waitHit((h) => h.event === 'ping');
ok('nhận ping, chữ ký HMAC đúng, body {id, event, createdAt, data}', signed(ping, secret) && ping?.json.event === 'ping' && !!ping?.json.id && !!ping?.json.data, ping);
await Bun.sleep(500);
const wh = (await json(W.cookie, 'GET', '/api/notifications/webhook')).body;
ok('GET webhook: lần gửi gần đây Sent, có lastSuccessAt', wh?.recent?.[0]?.status === 'Sent' && !!wh.lastSuccessAt, wh);

// ================= (1) Rào chắn + @nhắc =================
const t1 = await newTask(L.token, 'Viết API đăng nhập');
ok('bot trưởng nhóm tạo việc giao bot thợ (201)', t1.status === 201, t1);
const T1 = t1.body as string;
const assignedHook = await waitHit((h) => h.event === 'notification' && String(h.json.data?.title ?? '').includes('giao việc'));
ok('bot thợ nhận webhook "được giao việc" (category project_task, có url)', assignedHook?.json.data.category === 'project_task' && String(assignedHook.json.data.url ?? '').includes(`/projects/${P}`)
  && signed(assignedHook, secret), assignedHook?.json);
const cm = await tk(L.token, 'POST', `/api/projects/tasks/${T1}/comments`, { content: `@${H.code} nhờ anh review giúp phần token nhé.` });
ok('bot bình luận có @mã → 201', cm.status === 201, cm);
ok('người được nhắc nhận chuông "nhắc bạn"', (await notifs(H.cookie)).some((n) => n.title.includes('nhắc bạn') && n.title.includes(`${CODE}-1`)));
ok('người làm việc (bot thợ) nhận chuông bình luận', (await notifs(W.cookie)).some((n) => n.title.includes('bình luận việc')));
ok('@ người ngoài dự án / email không gửi chuông', (await tk(L.token, 'POST', `/api/projects/tasks/${T1}/comments`, { content: `@${PM.code}x và a@b.com` })).status === 201);

// Không duyệt qua token (kể cả quản lý dự án)
for (const c of [DOING, REVIEW]) await tk(W.token, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: c });
const pmToken = await tk(PM.token, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: DONE });
ok('quản lý dự án dùng token chuyển sang Xong → 409', pmToken.status === 409, pmToken);
ok('chi tiết việc qua token: canApprove = false; qua web: true', (await tk(PM.token, 'GET', `/api/projects/tasks/${T1}`)).body?.canApprove === false
  && (await json(PM.cookie, 'GET', `/api/projects/tasks/${T1}`)).body?.canApprove === true);
ok('quản lý duyệt trên web → 204', (await json(PM.cookie, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: DONE })).status === 204);

// Chuỗi 10 thao tác bot liên tiếp
const t2 = (await newTask(L.token, 'Việc chuyền qua lại')).body as string;
let lastOk = 0, streakHit: any = null;
for (let i = 0; i < 12; i++) {
  const r = await tk(i % 2 ? L.token : W.token, 'POST', `/api/projects/tasks/${t2}/comments`, { content: `vòng ${i + 1}` });
  if (r.status === 201) lastOk = i + 1; else { streakHit = r; break; }
}
ok('2 bot bình luận qua lại: 10 lần được, lần 11 → 409', lastOk === 10 && streakHit?.status === 409 && String(streakHit.body?.detail ?? '').includes('người thật'), { lastOk, streakHit });
ok('bị chặn cả chuyển trạng thái', (await tk(W.token, 'POST', `/api/projects/tasks/${t2}/move`, { columnId: DOING })).status === 409);
await json(H.cookie, 'POST', `/api/projects/tasks/${t2}/comments`, { content: 'Mình xem rồi, làm tiếp đi.' });
ok('người thật bình luận → bot làm tiếp được', (await tk(W.token, 'POST', `/api/projects/tasks/${t2}/move`, { columnId: DOING })).status === 204);

// ================= (3) Việc phụ thuộc =================
const A = (await newTask(L.token, 'Thiết kế CSDL')).body as string;
const B = (await newTask(L.token, 'Viết API dùng CSDL')).body as string;
const dep = await tk(L.token, 'PUT', `/api/projects/tasks/${B}/dependencies`, { dependsOn: [A] });
ok('bot đặt B chờ A → 204', dep.status === 204, dep);
const bDetail = (await json(H.cookie, 'GET', `/api/projects/tasks/${B}`)).body;
ok('chi tiết B: dependsOn = A (chưa xong), waitingOn = 1; chi tiết A: blocks = B', bDetail?.dependsOn?.[0]?.id === A && bDetail.dependsOn[0].done === false
  && bDetail.task.waitingOn === 1 && (await json(H.cookie, 'GET', `/api/projects/tasks/${A}`)).body?.blocks?.[0]?.id === B, bDetail);
ok('danh sách việc có waitingOn', ((await json(H.cookie, 'GET', `/api/projects/${P}/tasks`)).body as any[]).find((t) => t.id === B)?.waitingOn === 1);
ok('A chờ B → vòng → 400', (await tk(L.token, 'PUT', `/api/projects/tasks/${A}/dependencies`, { dependsOn: [B] })).status === 400);
ok('chờ chính nó → 400', (await tk(L.token, 'PUT', `/api/projects/tasks/${A}/dependencies`, { dependsOn: [A] })).status === 400);
const bStart = await tk(W.token, 'POST', `/api/projects/tasks/${B}/move`, { columnId: DOING });
ok('bot bắt đầu B khi A chưa xong → 409', bStart.status === 409 && String(bStart.body?.detail ?? '').includes('chờ'), bStart);
for (const c of [DOING, REVIEW]) await tk(W.token, 'POST', `/api/projects/tasks/${A}/move`, { columnId: c });
hits.length = 0;
ok('quản lý duyệt A (Xong)', (await json(PM.cookie, 'POST', `/api/projects/tasks/${A}/move`, { columnId: DONE })).status === 204);
ok('bot thợ nhận chuông "Sẵn sàng" cho B', (await notifs(W.cookie)).some((n) => n.title.startsWith('Sẵn sàng') && n.title.includes('Viết API dùng CSDL')));
const readyHook = await waitHit((h) => String(h.json.data?.title ?? '').startsWith('Sẵn sàng'));
ok('… và webhook "Sẵn sàng" (đánh thức agent)', signed(readyHook, secret), readyHook?.json);
ok('A xong → bot bắt đầu B được', (await tk(W.token, 'POST', `/api/projects/tasks/${B}/move`, { columnId: DOING })).status === 204);
ok('lịch sử B có "Depends"', ((await json(H.cookie, 'GET', `/api/projects/tasks/${B}`)).body?.activities as any[]).some((a) => a.kind === 'Depends' && a.byBot));

// ================= (2) Webhook: tin 1-1, đổi khoá, lỗi + thử lại, xoá =================
const dm = (await json(H.cookie, 'POST', '/api/chat/conversations/direct', { userId: W.userId })).body;
await json(H.cookie, 'POST', `/api/chat/conversations/${dm.id}/messages`, { text: 'Bot ơi xong B chưa?' });
const chatHook = await waitHit((h) => h.event === 'chat.message');
ok('tin 1-1 tới bot → webhook chat.message (người gửi, nội dung, link)', chatHook?.json.data.text === 'Bot ơi xong B chưa?' && chatHook.json.data.senderId === H.userId
  && chatHook.json.data.byBot === false && signed(chatHook, secret), chatHook?.json);
await Bun.sleep(1100);
await json(H.cookie, 'POST', '/api/chat/conversations/office/messages', { text: 'tin toàn văn phòng' });
const rot = await json(W.cookie, 'POST', '/api/notifications/webhook/rotate');
const old = secret;
secret = rot.body?.secret;
hits.length = 0;
await json(W.cookie, 'POST', '/api/notifications/webhook/test');
const ping2 = await waitHit((h) => h.event === 'ping');
ok('đổi khoá → chữ ký theo khoá mới, khoá cũ không khớp', signed(ping2, secret) && !signed(ping2, old));
ok('tin toàn văn phòng không đi webhook', !hits.some((h) => h.event === 'chat.message'));
failNext = 1;
await json(W.cookie, 'POST', '/api/notifications/webhook/test');
await Bun.sleep(5000);
const afterFail = (await json(W.cookie, 'GET', '/api/notifications/webhook')).body;
const failed = afterFail?.recent?.find((d: any) => d.event === 'ping' && d.attempts >= 1 && d.status === 'Pending');
ok('máy nhận trả 500 → giữ Pending để thử lại, ghi lỗi', !!failed && failed.responseStatus === 500 && String(afterFail.lastError ?? '').includes('500'), afterFail);
ok('xoá webhook → 204, configured=false', (await json(W.cookie, 'DELETE', '/api/notifications/webhook')).status === 204
  && (await json(W.cookie, 'GET', '/api/notifications/webhook')).body?.configured === false);
hits.length = 0;
await newTask(L.token, 'Việc sau khi xoá webhook');
await Bun.sleep(5000);
ok('xoá rồi → không còn webhook', hits.length === 0, hits.map((h) => h.event));

// ================= Hạn mức 20 việc / ngày =================
// L đã tạo 5 việc qua token (T1, t2, A, B, việc sau khi xoá webhook) → còn 15 việc tới hạn mức 20
let made = 0, quota: any = null;
for (let i = 0; i < 25; i++) {
  const r = await newTask(L.token, `Việc hàng loạt ${i + 1}`, null);
  if (r.status === 201) made++; else { quota = r; break; }
}
ok('bot tạo tối đa 20 việc / ngày → việc thứ 21 → 429', quota?.status === 429 && made === 15, { made, quota });
ok('người thật vẫn tạo việc bình thường', (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc người tạo' })).status === 201);
ok('bot khác (W) không bị ảnh hưởng', (await newTask(W.token, 'Việc của bot thợ', null)).status === 201);

// ================= MCP (tuỳ chọn) =================
if (MCP) {
  let rid = 0;
  const rpc = async (token: string, method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text; }
  };
  const call = async (token: string, name: string, args: Record<string, unknown>) => {
    const x = await rpc(token, 'tools/call', { name, arguments: args });
    const text = x?.result?.content?.[0]?.text ?? '';
    try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
  };
  const init = await rpc(W.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  ok('MCP instructions: phối hợp qua bảng việc + dependsOn + webhook', ['QUA BẢNG VIỆC', 'dependsOn', 'webhook'].every((s) => String(init?.result?.instructions ?? '').includes(s)));
  const c1 = await call(W.token, 'create_task', { project: CODE, title: 'Việc MCP chờ B', dependsOn: `${CODE}-4` });
  ok('MCP create_task với dependsOn (mã việc) → waitingOn 1', !c1.err && c1.j.waitingOn === 1, c1.text.slice(0, 300));
  const u1 = await call(W.token, 'update_task', { task: c1.j.code, dependsOn: 'none' });
  ok('MCP update_task dependsOn "none" → bỏ hết, vẫn trả đối tượng việc', !u1.err && u1.j.code === c1.j.code && Array.isArray(u1.j.dependsOn) && u1.j.dependsOn.length === 0, u1.text.slice(0, 300));
  const m1 = await call(W.token, 'comment_task', { task: c1.j.code, content: 'Xong phần của mình', mention: H.code });
  ok('MCP comment_task mention → người được nhắc nhận chuông', !m1.err && (await notifs(H.cookie)).some((n) => n.title.includes('nhắc bạn') && n.title.includes(c1.j.code)), m1.text);
  const bad = await call(W.token, 'comment_task', { task: c1.j.code, content: 'x', mention: PM.code + 'zz' });
  ok('MCP mention người ngoài dự án → lỗi rõ ràng', bad.err && bad.text.includes('thành viên'), bad.text);
} else console.log('… bỏ qua phần MCP (chưa đặt MCP_URL)');

server.stop(true);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
