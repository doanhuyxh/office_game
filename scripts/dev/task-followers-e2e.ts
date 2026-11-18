// E2E TEST-160 người theo dõi việc (followers): REST (thêm / bỏ, thêm lại là no-op, người ngoài dự án 400, người không xem được dự án 404,
// lịch sử Follow / Unfollow, followerCount, luồng /activity), token AI (nhãn BOT trong lịch sử), xoá việc → dòng followers bị xoá (khi có PG_CONTAINER),
// MCP (khi có MCP_URL: create_task followers, get_task followers, update_task thay danh sách / "none", người ngoài → lỗi),
// giao diện (khi có BASE_URL: mục "Người theo dõi" trong hộp thoại việc — nhãn BOT, chọn thành viên → thêm, ✕ → bỏ; ảnh vào SHOTS_DIR).
// CHỈ DB tạm. Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5281
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=55439;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Mcp (tuỳ chọn): Mcp__ApiBaseUrl=http://localhost:5281 ASPNETCORE_URLS=http://localhost:5282 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
// Vite (tuỳ chọn, frontend/): VITE_API_TARGET=http://localhost:5281 bunx vite --port 5176 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5281 MCP_URL=http://localhost:5282/mcp BASE_URL=http://localhost:5176 PG_CONTAINER=<tên container Postgres tạm>
//   ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-followers-e2e.ts
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5281';
const MCP = process.env.MCP_URL ?? '';
const UI = !!process.env.BASE_URL;
const PG = process.env.PG_CONTAINER ?? '';
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
const bearer = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const SHOTS = process.env.SHOTS_DIR;

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV FL ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Theo dõi ${stamp}`, code: `FL${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[]) => {
  const code = rawCode.toUpperCase(); // server lưu mã viết hoa
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, code, name, cookie, token, user };
};
const PM = await mkEmp(`FM${stamp}`, 'Quản Lý Theo Dõi', `e2e.fl.pm.${stamp}`, ['employee', 'manager']);
const Dev = await mkEmp(`FD${stamp}`, 'Dev Theo Dõi', `e2e.fl.dev.${stamp}`, ['employee']);
const Ops = await mkEmp(`FO${stamp}`, 'Bot DevOps', `e2e.fl.ops.${stamp}`, ['employee']);
const Out = await mkEmp(`FX${stamp}`, 'Người Ngoài', `e2e.fl.out.${stamp}`, ['employee']);
ok('4 tài khoản + token', [PM, Dev, Ops, Out].every((x) => x.cookie && x.token?.startsWith('ohk_')));
await json(admin, 'PUT', `/api/org/employees/${Ops.e.id}/account/bot`, { isBot: true });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `fl-${stamp}`, name: 'Theo dõi việc', kind: 'Internal', startOn: today,
  memberIds: [Dev.e.id, Ops.e.id] })).body as string;
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc cần deploy', assigneeEmployeeId: Dev.e.id })).body as string;
ok('dự án + việc', typeof P === 'string' && typeof T === 'string', { P, T });
const detail = async (cookie = PM.cookie) => (await json(cookie, 'GET', `/api/projects/tasks/${T}`)).body;
const fpath = (emp: string, task = T) => `/api/projects/tasks/${task}/followers/${emp}`;

// ── REST ──
let r = await json(Dev.cookie, 'POST', fpath(Ops.e.id));
let d = await detail();
ok('thành viên thêm bot làm người theo dõi → 204, followers có nhãn isBot', r.status === 204 && d.followers?.length === 1
  && d.followers[0].employeeId === Ops.e.id && d.followers[0].code === Ops.code && d.followers[0].fullName === Ops.name && d.followers[0].isBot === true, { r, f: d.followers });
const follows = (x: any) => (x.activities as any[]).filter((a) => a.kind === 'Follow' || a.kind === 'Unfollow');
ok('lịch sử Follow (to = họ tên, người thật)', follows(d).length === 1 && follows(d)[0].kind === 'Follow' && follows(d)[0].to === Ops.name && !follows(d)[0].byBot, follows(d));
r = await json(Dev.cookie, 'POST', fpath(Ops.e.id));
d = await detail();
ok('thêm lại → 204, không trùng, không thêm lịch sử', r.status === 204 && d.followers.length === 1 && follows(d).length === 1, { r, n: follows(d).length });
r = await json(Dev.cookie, 'POST', fpath(Out.e.id));
ok('thêm người ngoài dự án → 400 "phải là thành viên dự án"', r.status === 400 && JSON.stringify(r.body).includes('thành viên dự án'), r);
r = await json(Out.cookie, 'POST', fpath(Dev.e.id));
ok('người không xem được dự án → 404', r.status === 404, r);
r = await json(Dev.cookie, 'POST', fpath('00000000-0000-0000-0000-000000000001'));
ok('id nhân viên lạ → 400', r.status === 400, r);
r = await bearer(Ops.token, 'POST', fpath(PM.e.id));
d = await detail();
ok('token AI (bot) thêm quản lý dự án → 204, lịch sử byBot', r.status === 204 && d.followers.length === 2 && follows(d).some((a: any) => a.kind === 'Follow' && a.to === PM.name && a.byBot), { r, h: follows(d) });
const list = (await json(PM.cookie, 'GET', `/api/projects/${P}/tasks`)).body as any[];
ok('danh sách việc: followerCount = 2', list.find((t) => t.id === T)?.followerCount === 2, list.map((t) => t.followerCount));
r = await bearer(Ops.token, 'DELETE', fpath(PM.e.id));
d = await detail();
ok('token AI bỏ người theo dõi → 204, lịch sử Unfollow (from = họ tên)', r.status === 204 && d.followers.length === 1
  && follows(d).some((a: any) => a.kind === 'Unfollow' && a.from === PM.name && a.byBot), { r, h: follows(d) });
r = await json(Dev.cookie, 'DELETE', fpath(PM.e.id));
d = await detail();
ok('bỏ người không theo dõi → 204, không thêm lịch sử', r.status === 204 && follows(d).length === 3, { r, n: follows(d).length });
r = await json(Out.cookie, 'DELETE', fpath(Ops.e.id));
ok('người ngoài bỏ → 404', r.status === 404, r);
const feed = (await json(Dev.cookie, 'GET', `/api/projects/activity?after=${encodeURIComponent(new Date(Date.now() - 600_000).toISOString())}`)).body;
ok('luồng thay đổi (/activity) có Follow / Unfollow', (feed?.items ?? feed ?? []).some?.((a: any) => a.kind === 'Follow') ?? false, feed);

// Xoá việc → dòng followers bị xoá theo (cascade)
const T2 = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc sẽ xoá' })).body as string;
await json(PM.cookie, 'POST', fpath(Dev.e.id, T2));
await json(PM.cookie, 'POST', fpath(Ops.e.id, T2));
const psql = (sql: string) => {
  const p = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-tAc', sql]);
  return p.stdout.toString().trim();
};
if (PG) ok('trước khi xoá việc: 2 dòng task_followers', psql(`select count(*) from projects.task_followers where "TaskId" = '${T2}'`) === '2');
r = await json(PM.cookie, 'DELETE', `/api/projects/tasks/${T2}`);
ok('xoá việc → 204', r.status === 204, r);
if (PG) ok('xoá việc → dòng task_followers bị xoá theo', psql(`select count(*) from projects.task_followers where "TaskId" = '${T2}'`) === '0');
else console.log('… bỏ qua kiểm tra DB (chưa đặt PG_CONTAINER)');

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
  ok('tools/list: create_task + update_task có tham số followers', !!schema('create_task').followers && !!schema('update_task').followers);
  const c1 = await call(Dev.token, 'create_task', { project: `fl-${stamp}`, title: 'Việc MCP có người theo dõi', followers: Ops.code });
  const g1 = c1.j?.code ? await call(Dev.token, 'get_task', { task: c1.j.code }) : { err: true, j: null, text: '' };
  ok('MCP create_task followers (mã bot) → get_task followers có bot', !c1.err && !g1.err && g1.j.followers?.length === 1 && g1.j.followers[0].code === Ops.code
    && g1.j.followers[0].isBot === true && g1.j.task.followerCount === 1, { c: c1.text.slice(0, 300), g: g1.text.slice(0, 400) });
  const u1 = await call(Dev.token, 'update_task', { task: c1.j.code, followers: `${PM.name}, ${Dev.code}` });
  ok('MCP update_task followers thay toàn bộ danh sách (họ tên + mã)', !u1.err
    && JSON.stringify((u1.j.followers ?? []).map((f: any) => f.code).sort()) === JSON.stringify([Dev.code, PM.code].sort()), u1.text.slice(0, 400));
  const u2 = await call(Dev.token, 'update_task', { task: c1.j.code, followers: 'none' });
  ok('MCP update_task followers "none" → bỏ hết', !u2.err && (u2.j.followers ?? []).length === 0, u2.text.slice(0, 300));
  const u3 = await call(Dev.token, 'update_task', { task: c1.j.code, followers: Out.code });
  ok('MCP followers người ngoài dự án → lỗi', u3.err && /thành viên/.test(u3.text), u3.text.slice(0, 300));
  const h = await call(Dev.token, 'get_task', { task: c1.j.code, history: 50 });
  ok('MCP get_task lịch sử Follow / Unfollow byBot', (h.j?.activities ?? []).filter((a: any) => a.kind === 'Follow' && a.byBot).length === 3
    && (h.j?.activities ?? []).filter((a: any) => a.kind === 'Unfollow' && a.byBot).length === 3, h.text.slice(0, 500));
} else console.log('… bỏ qua phần MCP (chưa đặt MCP_URL)');

// ── Giao diện ──
if (UI) {
  type Br = Awaited<ReturnType<typeof launch>>;
  const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js)) return true; await br.sleep(250); } return false; };
  const box = `document.querySelector('[data-testid="task-followers"]')`;
  const chips = `[...document.querySelectorAll('[data-testid="task-follower"]')].map(li => li.innerText.replace(/\\s+/g, ' ').trim())`;
  const br = await launch(9393, `${tmpdir()}/officehub-fl-${Date.now()}`, 1440, 900);
  try {
    ok('quản lý đăng nhập web', (await br.login(PM.user, PW)) === 200);
    await br.go(`${BASE}/projects/${P}?task=${T}`, 3500);
    ok('hộp thoại việc có mục "Người theo dõi (1)"', await until(br, `${box}?.innerText.includes('Người theo dõi (1)')`), await br.evalJs(`${box}?.innerText`));
    const c0 = await br.evalJs(chips) as string[];
    ok('chip bot có nhãn BOT', c0.length === 1 && c0[0].includes(Ops.name) && /BOT/.test(c0[0]), c0);
    await br.evalJs(`${box}.scrollIntoView({ block: 'center' })`);
    await br.evalJs(`document.getElementById('follow-${T}').click()`);
    ok('ô chọn chỉ gợi ý thành viên chưa theo dõi', await until(br, `[...document.querySelectorAll('[role="option"]')].some(o => o.innerText.includes(${JSON.stringify(Dev.name)}))`)
      && !(await br.evalJs(`[...document.querySelectorAll('[role="option"]')].some(o => o.innerText.includes(${JSON.stringify(Ops.name)}))`)));
    if (SHOTS) await br.shot(`${SHOTS}/1-followers-picker.png`);
    await br.evalJs(`[...document.querySelectorAll('[role="option"] button')].find(b => b.innerText.includes(${JSON.stringify(Dev.name)})).click()`);
    ok('chọn thành viên → thêm ngay, "Người theo dõi (2)"', await until(br, `${box}?.innerText.includes('Người theo dõi (2)')`), await br.evalJs(`${box}?.innerText`));
    ok('lịch sử API có Follow Dev', (await detail(Dev.cookie)).followers.some((f: any) => f.employeeId === Dev.e.id));
    await br.evalJs(`${box}.scrollIntoView({ block: 'center' })`);
    if (SHOTS) await br.shot(`${SHOTS}/2-followers-added.png`);
    await br.evalJs(`document.querySelector('[aria-label="Bỏ ${Ops.name} khỏi người theo dõi"]').click()`);
    ok('✕ → bỏ người theo dõi, "Người theo dõi (1)"', await until(br, `${box}?.innerText.includes('Người theo dõi (1)')`), await br.evalJs(`${box}?.innerText`));
    ok('API: chỉ còn Dev', JSON.stringify((await detail(Dev.cookie)).followers.map((f: any) => f.employeeId)) === JSON.stringify([Dev.e.id]));
    await br.evalJs(`document.querySelector('[data-testid="task-history"]') || [...document.querySelectorAll('button')].find(b => /^Lịch sử/.test(b.innerText))?.click()`);
    ok('lịch sử trên web: "thêm người theo dõi" / "bỏ người theo dõi"',
      await until(br, `(() => { const t = document.querySelector('[data-testid="task-history"]')?.innerText ?? ''; return t.includes('thêm người theo dõi') && t.includes('bỏ người theo dõi'); })()`));
    if (SHOTS) {
      await br.evalJs(`document.querySelector('[data-testid="task-history"]').scrollIntoView({ block: 'center' })`);
      await br.shot(`${SHOTS}/3-followers-history.png`);
    }
    ok('không lỗi JS', br.errors.filter((e: string) => !/negotiation|Failed to start the connection|WebSocket|\/rt\//.test(e)).length === 0, br.errors);
  } finally { br.close(); }
} else console.log('… bỏ qua phần giao diện (chưa đặt BASE_URL)');

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
