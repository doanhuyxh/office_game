// E2E TEST-166 đánh thức task_done cho bot theo dõi: người thật chuyển việc sang Xong (POST /move và PUT /tasks) → đúng 1 tin Telegram `task_done`
// (+ project_code, assignee_code) + webhook `task.done` cho MỖI bot theo dõi đang hoạt động; người theo dõi là người thật / bot đã khoá → không;
// đã Xong chuyển sang cột hoàn thành khác → không bắn lại; token AI chuyển sang cột hoàn thành → không bắn.
// MÁY CHỦ TELEGRAM GIẢ + MÁY NHẬN WEBHOOK GIẢ trong cùng tiến trình. CHỈ DB tạm. Api (backend/):
//   env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5291
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=15461;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://localhost:5297 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5291 TG_PORT=5297 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-done-e2e.ts
//   ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-reviewer-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5291';
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
const bearer = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV TD ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead TD ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Done ${stamp}`, code: `TD${stamp}` })).body;
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
const PM = await mkEmp(`DM${stamp}`, 'Quản Lý Done', `e2e.td.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Dev = await mkEmp(`DD${stamp}`, 'Dev Làm', `e2e.td.dev.${stamp}`, ['employee']);
const Ops = await mkEmp(`DO${stamp}`, 'Bot DevOps', `e2e.td.ops.${stamp}`, ['employee']);
const Qa = await mkEmp(`DQ${stamp}`, 'Bot QA', `e2e.td.qa.${stamp}`, ['employee']);
const Hum = await mkEmp(`DH${stamp}`, 'Người Theo Dõi', `e2e.td.hum.${stamp}`, ['employee']);
ok('5 tài khoản + token', [PM, Dev, Ops, Qa, Hum].every((x) => x.cookie && x.token?.startsWith('ohk_')));
for (const b of [Ops, Qa]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('Bật Telegram (giả)', (await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } })).status === 200);
let hooksOk = true;
for (const x of [Ops, Qa, Hum]) hooksOk &&= (await json(x.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200;
ok('2 bot + người thật đặt webhook (localhost giả)', hooksOk);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `td-${stamp}`, name: 'Việc xong', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Dev.e.id, Ops.e.id, Qa.e.id, Hum.e.id] })).body as string;
let r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Đã deploy', isDone: true, approverOnly: false });
ok('quản lý thêm cột hoàn thành thứ hai (không cần duyệt)', r.status === 201 || r.status === 200, r);
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const [DOING, DONE, DEPLOYED] = [col('Đang làm'), col('Xong'), col('Đã deploy')];
const mkTask = async (title: string, followers: { e: { id: string } }[]) => {
  const t = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: Dev.e.id, columnId: DOING })).body as string;
  for (const f of followers) await json(PM.cookie, 'POST', `/api/projects/tasks/${t}/followers/${f.e.id}`);
  return t;
};

// Lọc theo việc của lần chạy này (tin thử lại của lần chạy trước có thể tới chen vào)
const wakes = (task: string) => sent.filter((s) => s.includes('"task_done"')).map((s) => JSON.parse(s)).filter((x) => x.task_id === task);
const hooksFor = (task: string) => hits.filter((h) => h.event === 'task.done' && h.json.data?.taskId === task);
const codes = (task: string) => wakes(task).map((w) => w.employee_code).sort().join();

// ── Người thật chuyển sang Xong (POST /move) ──
const T = await mkTask('Tính năng deploy được', [Ops, Qa, Hum]);
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DONE });
ok('quản lý chuyển Đang làm → Xong (move) → 204', r.status === 204, r);
ok('Telegram: đúng 1 tin task_done cho mỗi bot theo dõi (DevOps, QA), không cho người thật',
  await until(() => wakes(T).length >= 2) && (await sleep(3500), codes(T) === [Ops.code, Qa.code].sort().join()), wakes(T));
const w = wakes(T).find((x) => x.employee_code === Ops.code);
ok('tin task_done: project_id, project_code, task_code, assignee_code, không có tên việc',
  w?.project_id === P && w?.project_code?.toUpperCase() === `TD-${stamp}`.toUpperCase() && w?.task_code?.toUpperCase().startsWith(`TD-${stamp}-`.toUpperCase())
  && w?.assignee_code === Dev.code && !JSON.stringify(w).includes('deploy được'), w);
ok('Webhook task.done: 2 lần (2 bot), có taskCode / title / projectCode / assigneeCode / movedBy',
  await until(() => hooksFor(T).length >= 2) && (await sleep(1500), hooksFor(T).length === 2)
  && hooksFor(T).every((h) => h.json.data.title === 'Tính năng deploy được' && h.json.data.assigneeCode === Dev.code && h.json.data.movedBy === PM.name
    && !!h.json.data.projectCode && !!h.json.data.taskCode), hooksFor(T).map((h) => h.json.data));

// ── Đã Xong chuyển sang cột hoàn thành khác → không bắn lại ──
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DEPLOYED });
ok('Xong → Đã deploy (cùng hoàn thành) → 204, không có tin / webhook mới', r.status === 204 && (await sleep(4000), wakes(T).length === 2 && hooksFor(T).length === 2),
  { r, n: wakes(T).length, h: hooksFor(T).length });

// ── PUT /tasks (UpdateAsync) cũng bắn ──
const T2 = await mkTask('Sửa việc sang Xong', [Ops]);
r = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T2}`, { title: 'Sửa việc sang Xong', assigneeEmployeeId: Dev.e.id, columnId: DONE });
ok('PUT đổi cột sang Xong → 204, 1 tin task_done + 1 webhook cho bot DevOps',
  r.status === 204 && await until(() => wakes(T2).length >= 1) && await until(() => hooksFor(T2).length >= 1)
  && (await sleep(3500), codes(T2) === Ops.code && hooksFor(T2).length === 1), { r, w: wakes(T2), h: hooksFor(T2).length });

// ── Token AI chuyển sang cột hoàn thành → không bắn ──
const T3 = await mkTask('Bot tự chuyển xong', [Ops, Qa]);
r = await bearer(Dev.token, 'POST', `/api/projects/tasks/${T3}/move`, { columnId: DEPLOYED });
ok('token AI chuyển sang "Đã deploy" (hoàn thành, không cần duyệt) → 204, không có tin / webhook',
  r.status === 204 && (await sleep(4500), wakes(T3).length === 0 && hooksFor(T3).length === 0), { r, w: wakes(T3), h: hooksFor(T3).length });

// ── Việc chỉ có người thật theo dõi → không bắn ──
const T4 = await mkTask('Chỉ người theo dõi', [Hum]);
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T4}/move`, { columnId: DONE });
ok('việc chỉ có người thật theo dõi → không có tin / webhook task.done', r.status === 204 && (await sleep(4000), wakes(T4).length === 0 && hooksFor(T4).length === 0), r);

console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);

