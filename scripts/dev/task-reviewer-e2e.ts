// E2E TEST-161 người review việc + cột review: REST (reviewerId thành viên / khác người làm → 400, lịch sử Reviewer, reviewer trong chi tiết,
// cột isReview — mặc định "Chờ review", sửa bằng chức vụ "Quản lý trạng thái công việc"), chuyển vào cột review → chuông "Cần review" cho người review,
// người review là bot → đúng 1 tin Telegram `review_requested` (+ assignee_code) + webhook `task.review_requested`; lùi rồi chuyển lại → bắn lại;
// người review tự chuyển / chuyển sang cột không review → không bắn. MCP (khi có MCP_URL): create_task / update_task `reviewer`, get_task `reviewer`.
// Giao diện (khi có BASE_URL): ô "Người review" trong hộp thoại việc + checkbox "Cột review" (ảnh vào SHOTS_DIR).
// MÁY CHỦ TELEGRAM GIẢ + MÁY NHẬN WEBHOOK GIẢ trong cùng tiến trình. CHỈ DB tạm. Api (backend/):
//   env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5291
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=15461;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://localhost:5297 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Mcp (tuỳ chọn): Mcp__ApiBaseUrl=http://localhost:5291 ASPNETCORE_URLS=http://localhost:5292 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
// Vite (tuỳ chọn, frontend/): VITE_API_TARGET=http://localhost:5291 bunx vite --port 5177 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5291 TG_PORT=5297 MCP_URL=http://localhost:5292/mcp BASE_URL=http://localhost:5177 PG_CONTAINER=<container>
//   ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-reviewer-e2e.ts
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5291';
const MCP = process.env.MCP_URL ?? '';
const UI = !!process.env.BASE_URL;
const PG = process.env.PG_CONTAINER ?? '';
const TG_PORT = Number(process.env.TG_PORT ?? 5297);
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 5298);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

// ── Telegram giả + webhook giả ──
const GOOD = '123456789:AAH-e2e-good-token-abcdefghijklmnop';
const sent: string[] = [];
Bun.serve({
  port: TG_PORT,
  async fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/bot([^/]+)\/sendMessage$/);
    if (!m || decodeURIComponent(m[1]) !== GOOD) return new Response('not found', { status: 404 });
    sent.push(((await req.json()) as any).text);
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
const SHOTS = process.env.SHOTS_DIR;

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV RV ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead RV ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Review ${stamp}`, code: `RV${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, code, name, cookie, token, user };
};
const PM = await mkEmp(`RM${stamp}`, 'Quản Lý Review', `e2e.rv.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Dev = await mkEmp(`RD${stamp}`, 'Dev Code', `e2e.rv.dev.${stamp}`, ['employee']);
const Bot = await mkEmp(`RB${stamp}`, 'Bot Review', `e2e.rv.bot.${stamp}`, ['employee']);
const Hum = await mkEmp(`RH${stamp}`, 'Người Review', `e2e.rv.hum.${stamp}`, ['employee']);
const Out = await mkEmp(`RX${stamp}`, 'Người Ngoài', `e2e.rv.out.${stamp}`, ['employee']);
ok('5 tài khoản + token', [PM, Dev, Bot, Hum, Out].every((x) => x.cookie && x.token?.startsWith('ohk_')));
await json(admin, 'PUT', `/api/org/employees/${Bot.e.id}/account/bot`, { isBot: true });
ok('Bật Telegram (giả)', (await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } })).status === 200);
ok('Bot + người review đặt webhook (localhost giả)', (await json(Bot.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200
  && (await json(Hum.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `rv-${stamp}`, name: 'Review việc', kind: 'Internal', startOn: today,
  memberIds: [Dev.e.id, Bot.e.id, Hum.e.id] })).body as string;
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
const col = (n: string) => cols.find((c) => c.name === n)!;
ok('dự án mới: chỉ cột "Chờ review" có isReview', cols.filter((c) => c.isReview).map((c) => c.name).join() === 'Chờ review', cols);
const [TODO, DOING, REVIEW] = ['Cần làm', 'Đang làm', 'Chờ review'].map((n) => col(n).id as string);
const base = { title: 'Tính năng X', assigneeEmployeeId: Dev.e.id };

// ── REST: đặt người review ──
let r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, reviewerId: Dev.e.id });
ok('tạo việc reviewer = người làm → 400 reviewerId', r.status === 400 && JSON.stringify(r.body).includes('khác người làm'), r);
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, reviewerId: Out.e.id });
ok('reviewer ngoài dự án → 400', r.status === 400 && JSON.stringify(r.body).includes('thành viên dự án'), r);
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, reviewerId: Bot.e.id })).body as string;
const detail = async (cookie = PM.cookie, task = T) => (await json(cookie, 'GET', `/api/projects/tasks/${task}`)).body;
let d = await detail();
ok('tạo việc có reviewer bot → chi tiết reviewer {code, fullName, isBot}', typeof T === 'string' && d.reviewer?.employeeId === Bot.e.id && d.reviewer.code === Bot.code
  && d.reviewer.isBot === true && d.task.reviewerEmployeeId === Bot.e.id, d?.reviewer);
r = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T}`, { ...base, reviewerId: Bot.e.id, assigneeEmployeeId: Bot.e.id });
ok('PUT đổi người làm thành người review → 400', r.status === 400, r);
r = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T}`, { ...base, reviewerId: Hum.e.id });
d = await detail();
const revActs = (x: any) => (x.activities as any[]).filter((a) => a.kind === 'Reviewer');
ok('PUT đổi người review → 204, lịch sử Reviewer (from → to họ tên)', r.status === 204 && d.reviewer?.employeeId === Hum.e.id
  && revActs(d).at(-1)?.from === Bot.name && revActs(d).at(-1)?.to === Hum.name, { r, h: revActs(d) });
await json(PM.cookie, 'PUT', `/api/projects/tasks/${T}`, { ...base, reviewerId: Bot.e.id });

// ── Chuyển vào cột review → báo người review ──
// Lọc theo bot của lần chạy này: tin thử lại của lần chạy trước (cùng Api, cổng giả) có thể tới chen vào
const wakes = () => sent.filter((s) => s.includes('"review_requested"')).map((s) => JSON.parse(s)).filter((x) => x.employee_code === Bot.code);
const hooksFor = (task: string) => hits.filter((h) => h.event === 'task.review_requested' && h.json.data?.taskId === task);
const bells = async (who: { cookie: string }) => ((await json(who.cookie, 'GET', '/api/notifications?take=100')).body?.items ?? []) as any[];
const reviewBells = async (who: { cookie: string }) => (await bells(who)).filter((n) => n.title.startsWith('Cần review:'));
const move = (who: { cookie: string }, to: string, note?: string, task = T) => json(who.cookie, 'POST', `/api/projects/tasks/${task}/move`, { columnId: to, note });
await move(Dev, DOING);
ok('chuyển sang Đang làm (không phải cột review) → không có tin review_requested', (await sleep(3500), wakes().length === 0), wakes());
r = await move(Dev, REVIEW);
ok('Dev chuyển vào Chờ review → 204', r.status === 204, r);
ok('Telegram: đúng 1 tin review_requested cho bot', await until(() => wakes().length === 1) && (await sleep(3500), wakes().length === 1), wakes());
const w = wakes()[0] ?? {};
ok('… tin có employee_code bot, task_id, task_code, project_id, assignee_code = người làm', w.employee_code === Bot.code && w.task_id === T && w.project_id === P
  && w.task_code === d.task.code && w.assignee_code === Dev.code, w);
ok('Webhook task.review_requested cho bot (taskCode, assigneeCode)', await until(() => hooksFor(T).length === 1)
  && hooksFor(T)[0].json.data.assigneeCode === Dev.code && hooksFor(T)[0].json.data.column === 'Chờ review', hits.map((h) => h.event));
ok('Chuông "Cần review" cho bot', (await reviewBells(Bot)).length === 1, (await bells(Bot)).map((n) => n.title));
r = await move(PM, DOING, 'Review chưa đạt');
await sleep(3500);
ok('lùi về Đang làm → không bắn review_requested', r.status === 204 && wakes().length === 1, { r, n: wakes().length });
await move(Dev, REVIEW);
ok('chuyển lại vào Chờ review → bắn lại (2 tin)', await until(() => wakes().length === 2) && (await sleep(3500), wakes().length === 2), wakes().length);
ok('… chuông "Cần review" lần 2', (await reviewBells(Bot)).length === 2);
if (PG) {
  const p = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-tAc',
    `select count(*) from notifications.telegram_messages where "Kind"='task_review_requested' and "TaskId"='${T}'`]);
  ok('DB: 2 dòng telegram_messages Kind = task_review_requested', p.stdout.toString().trim() === '2', p.stdout.toString());
}

// Người review là người thật → chỉ chuông, không Telegram / webhook riêng; người review tự chuyển → không báo
const T2 = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, title: 'Việc người review', reviewerId: Hum.e.id })).body as string;
await move(Dev, DOING, undefined, T2);
await move(Dev, REVIEW, undefined, T2);
await sleep(3500);
ok('reviewer người thật: chuông "Cần review", không Telegram, không webhook riêng', (await reviewBells(Hum)).length === 1 && wakes().length === 2 && hooksFor(T2).length === 0,
  { b: (await reviewBells(Hum)).length, tg: wakes().length, h: hooksFor(T2).length });
await move(PM, DOING, 'Mở lại', T2);
await move(Hum, REVIEW, undefined, T2);
await sleep(1000);
ok('người review tự chuyển vào cột review → không tự báo mình', (await reviewBells(Hum)).length === 1);
const T3 = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, title: 'Việc không có người review' })).body as string;
await move(Dev, DOING, undefined, T3);
await move(Dev, REVIEW, undefined, T3);
await sleep(3500);
ok('việc không có người review → không có tin', wakes().length === 2 && !sent.some((s) => s.includes(T3) && s.includes('review_requested')));

// ── Cột review ──
r = await json(PM.cookie, 'PUT', `/api/projects/columns/${DOING}`, { name: 'Đang làm', isDone: false, approverOnly: false, isReview: true });
let c2 = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('quản lý trạng thái bật "Cột review" cho Đang làm → isReview', r.status === 204 && c2.find((c) => c.id === DOING)?.isReview === true, { r, c2 });
r = await json(PM.cookie, 'PUT', `/api/projects/columns/${DOING}`, { name: 'Đang làm', isDone: false, approverOnly: false });
c2 = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('client cũ không gửi isReview → giữ nguyên', r.status === 204 && c2.find((c) => c.id === DOING)?.isReview === true);
await json(PM.cookie, 'PUT', `/api/projects/columns/${DOING}`, { name: 'Đang làm', isDone: false, approverOnly: false, isReview: false });
r = await json(Dev.cookie, 'PUT', `/api/projects/columns/${DOING}`, { name: 'Đang làm', isDone: false, approverOnly: false, isReview: true });
ok('chức vụ thường sửa cột → 403', r.status === 403, r);
const T4 = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { ...base, title: 'Việc qua PUT', reviewerId: Bot.e.id })).body as string;
await json(Dev.cookie, 'PUT', `/api/projects/tasks/${T4}`, { ...base, title: 'Việc qua PUT', reviewerId: Bot.e.id, columnId: DOING });
await json(Dev.cookie, 'PUT', `/api/projects/tasks/${T4}`, { ...base, title: 'Việc qua PUT', reviewerId: Bot.e.id, columnId: REVIEW });
ok('PUT đổi columnId vào cột review cũng bắn review_requested', await until(() => wakes().some((x) => x.task_id === T4)), wakes().map((x) => x.task_id));

// ── MCP ──
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
  await rpc(Dev.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const tools = await rpc(Dev.token, 'tools/list');
  const schema = (n: string) => tools?.result?.tools?.find((t: any) => t.name === n)?.inputSchema?.properties ?? {};
  ok('tools/list: create_task + update_task có tham số reviewer', !!schema('create_task').reviewer && !!schema('update_task').reviewer);
  const c1 = await call(Dev.token, 'create_task', { project: `rv-${stamp}`, title: 'Việc MCP có người review', assignee: Dev.code, reviewer: Bot.code });
  const g1 = await call(Dev.token, 'get_task', { task: c1.j?.id ?? '' });
  ok('MCP create_task reviewer (mã bot) → get_task reviewer', !c1.err && !g1.err && g1.j.reviewer?.code === Bot.code && g1.j.reviewer.isBot === true, [c1.text.slice(0, 200), g1.text.slice(0, 300)]);
  const u0 = await call(Dev.token, 'update_task', { task: c1.j.id, title: 'Việc MCP đổi tên' });
  ok('MCP update_task không truyền reviewer → giữ nguyên người review', !u0.err && u0.j.reviewer?.employeeId === Bot.e.id, u0.text.slice(0, 300));
  const u1 = await call(Dev.token, 'update_task', { task: c1.j.id, reviewer: Hum.name });
  ok('MCP update_task reviewer theo họ tên', !u1.err && u1.j.reviewer?.employeeId === Hum.e.id, u1.text.slice(0, 300));
  const u2 = await call(Dev.token, 'update_task', { task: c1.j.id, reviewer: 'none' });
  ok('MCP update_task reviewer "none" → bỏ', !u2.err && !u2.j.reviewer, u2.text.slice(0, 300));
  const u3 = await call(Dev.token, 'update_task', { task: c1.j.id, reviewer: Dev.code });
  ok('MCP reviewer = người làm → lỗi', u3.err && /khác người làm/.test(u3.text), u3.text.slice(0, 300));
} else console.log('… bỏ qua phần MCP (chưa đặt MCP_URL)');

// ── Giao diện ──
if (UI) {
  type Br = Awaited<ReturnType<typeof launch>>;
  const untilJs = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js)) return true; await br.sleep(250); } return false; };
  const br = await launch(9394, `${tmpdir()}/officehub-rv-${Date.now()}`, 1440, 900);
  try {
    ok('quản lý đăng nhập web', (await br.login(PM.user, PW)) === 200);
    await br.go(`${BASE}/projects/${P}?task=${T}`, 3500);
    const sel = `document.getElementById('tk-reviewer')`;
    ok('hộp thoại việc có ô "Người review" = Bot Review', await untilJs(br, `${sel}?.innerText.includes(${JSON.stringify(Bot.name)})`), await br.evalJs(`${sel}?.innerText`));
    await br.evalJs(`${sel}.scrollIntoView({ block: 'center' }); ${sel}.click()`);
    await br.sleep(500);
    const opts = await br.evalJs(`[...document.querySelectorAll('[role="option"]')].map(o => o.innerText.trim())`) as string[];
    ok('danh sách người review: có bot (BOT), không có người làm', opts.some((o) => o.includes(Bot.name) && o.includes('(BOT)')) && !opts.some((o) => o.includes(Dev.name)), opts);
    if (SHOTS) await br.shot(`${SHOTS}/1-reviewer-picker.png`);
    await br.evalJs(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await br.go(`${BASE}/projects/${P}`, 3000);
    const editBtn = `document.querySelector('[aria-label="Sửa trạng thái Chờ review"]')`;
    if (await br.evalJs(`!!${editBtn}`)) {
      await br.evalJs(`${editBtn}.click()`);
      ok('hộp thoại trạng thái: checkbox "Cột review" đang bật', await untilJs(br, `document.querySelector('[data-testid="col-review"]')?.checked === true`));
      if (SHOTS) await br.shot(`${SHOTS}/2-column-review.png`);
    } else console.log('… không tìm thấy nút sửa cột "Chờ review" — bỏ qua kiểm tra checkbox');
  } finally { await br.close(); }
} else console.log('… bỏ qua phần giao diện (chưa đặt BASE_URL)');

console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
