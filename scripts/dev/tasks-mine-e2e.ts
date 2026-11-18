// E2E: GET /api/projects/tasks/mine trả awaitingHuman + projectActive (TEST-157) — chỉ cần Api, không Realtime / Mcp / FE.
// Bot thao tác bằng token AI qua REST (byBot), người thật bằng cookie. Kiểm: người thật giao việc cho bot → false; bot bình luận → true;
// người thật bình luận → false; bot chuyển sang "Chờ review" → true; người thật trả việc về → false; bot khác giao việc cho bot này → false;
// người làm là người thật (dùng token AI bình luận việc của mình) → false; đóng dự án → projectActive = false; trang danh sách việc dự án giữ mặc định.
// CHỈ DB tạm. ~30 giây.
//   docker run -d --name officehub-e2e-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55432:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5180 'ConnectionStrings__Default=Host=127.0.0.1;Port=55432;Database=e2e;Username=e2e;Password=e2e'
//        Seed__AdminEmail=… Seed__AdminPassword=… Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/tasks-mine-e2e.ts
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
/** Request bằng token AI (bot thao tác qua REST → lịch sử byBot). */
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Việc của tôi ${stamp}`, code: `TM${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string, roles = ['employee']) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, token };
};
const H = await mkEmp('Quản Lý Người Thật', `e2e.tm.h.${stamp}`, ['employee', 'manager']);
const W = await mkEmp('Bot Làm Việc', `e2e.tm.w.${stamp}`);
const B = await mkEmp('Bot Trưởng Nhóm', `e2e.tm.b.${stamp}`);
for (const x of [W, B]) await json(admin, 'PUT', `/api/org/employees/${x.e.id}/account/bot`, { isBot: true });
ok('3 tài khoản (người thật H, bot W, bot B) + token AI', [H, W, B].every((x) => x.token?.startsWith('ohk_')));

const mkProject = async (code: string) => {
  const id = (await json(H.cookie, 'POST', '/api/projects', { code, name: `Việc của tôi ${code}`, kind: 'Internal', startOn: today, memberIds: [W.e.id, B.e.id] })).body as string;
  const d = (await json(H.cookie, 'GET', `/api/projects/${id}`)).body;
  return { id, col: (n: string) => d.columns.find((c: any) => c.name === n)?.id as string };
};
const P = await mkProject(`tm-${stamp}`);
const mkTask = async (projectId: string, title: string, assignee: string) =>
  (await json(H.cookie, 'POST', `/api/projects/${projectId}/tasks`, { title, assigneeEmployeeId: assignee })).body as string;
const mine = async (who: { token: string }) => {
  const r = await tk(who.token, 'GET', '/api/projects/tasks/mine');
  return new Map<string, any>((r.body ?? []).map((t: any) => [t.id, t]));
};
const flag = async (who: { token: string }, id: string) => (await mine(who)).get(id);

// ---------- Bot W: luồng chờ người ----------
const T1 = await mkTask(P.id, 'Sửa form đăng nhập', W.e.id);
await json(H.cookie, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: P.col('Đang làm') });
let t = await flag(W, T1);
ok('người thật giao việc + chuyển Đang làm → awaitingHuman = false, projectActive = true', t?.awaitingHuman === false && t?.projectActive === true, t);
await tk(W.token, 'POST', `/api/projects/tasks/${T1}/comments`, { content: 'Em hỏi lại: form cần captcha không?' });
t = await flag(W, T1);
ok('bot bình luận → awaitingHuman = true', t?.awaitingHuman === true, t);
await json(H.cookie, 'POST', `/api/projects/tasks/${T1}/comments`, { content: 'Không cần captcha.' });
t = await flag(W, T1);
ok('người thật bình luận → awaitingHuman = false', t?.awaitingHuman === false, t);
const mv = await tk(W.token, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: P.col('Chờ review') });
t = await flag(W, T1);
ok('bot chuyển sang Chờ review → awaitingHuman = true', mv.status < 300 && t?.awaitingHuman === true, { mv, t });
const back = await json(H.cookie, 'POST', `/api/projects/tasks/${T1}/move`, { columnId: P.col('Đang làm'), note: 'Thiếu kiểm tra mật khẩu trống' });
t = await flag(W, T1);
ok('người thật trả việc về Đang làm → awaitingHuman = false', back.status < 300 && t?.awaitingHuman === false, { back, t });

// ---------- Bot khác giao việc cho W ----------
const T2 = await mkTask(P.id, 'Viết báo cáo tuần', B.e.id);
const re = await tk(B.token, 'PUT', `/api/projects/tasks/${T2}`, { title: 'Viết báo cáo tuần', assigneeEmployeeId: W.e.id });
t = await flag(W, T2);
ok('bot B giao việc cho bot W → awaitingHuman = false', re.status < 300 && t?.awaitingHuman === false, { re, t });

// ---------- Người làm là người thật ----------
const T3 = await mkTask(P.id, 'Việc của người thật', H.e.id);
await tk(H.token, 'POST', `/api/projects/tasks/${T3}/comments`, { content: 'Ghi chú qua trợ lý AI' });
t = await flag(H, T3);
ok('người làm là người thật (bình luận qua token AI, byBot) → awaitingHuman = false', t?.awaitingHuman === false && t?.projectActive === true, t);

// ---------- Dự án đã đóng ----------
const P2 = await mkProject(`tm2-${stamp}`);
const T4 = await mkTask(P2.id, 'Việc ở dự án sắp đóng', W.e.id);
await tk(W.token, 'POST', `/api/projects/tasks/${T4}/comments`, { content: 'Đã xong phần của em' });
const closed = await json(H.cookie, 'PUT', `/api/projects/${P2.id}`, { code: `tm2-${stamp}`, name: `Việc của tôi tm2-${stamp}`, kind: 'Internal', startOn: today, status: 'Closed' });
const all = await mine(W);
ok('đóng dự án → projectActive = false (việc vẫn trong danh sách)', closed.status < 300 && all.get(T4)?.projectActive === false && all.get(T1)?.projectActive === true,
  { closed, t4: all.get(T4) });

// ---------- Nơi khác giữ mặc định ----------
const list = (await json(H.cookie, 'GET', `/api/projects/${P.id}/tasks`)).body as any[];
const detail = (await json(H.cookie, 'GET', `/api/projects/tasks/${T1}`)).body;
ok('danh sách việc dự án + chi tiết việc giữ mặc định (awaitingHuman false, projectActive true)',
  list.every((x) => x.awaitingHuman === false && x.projectActive === true) && detail?.task?.projectActive === true, list.map((x) => [x.code, x.awaitingHuman, x.projectActive]));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
