// E2E giao diện: bảng việc tự cập nhật + toast (Chrome headless). Bot thao tác bằng token, quản lý xem trên web:
// đang mở đúng dự án → thẻ việc tự hiện / đổi cột, KHÔNG toast; ở trang khác / dự án khác → có toast (nút "Mở" về dự án).
// CHỈ DB tạm. Api :5180, Vite: cd frontend && VITE_API_TARGET=http://localhost:5180 bun run dev --port 5174
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 BASE_URL=http://localhost:5174 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-live-ui-e2e.ts
import { BASE, launch } from './cdp';
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV UI ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Live UI ${stamp}`, code: `LU${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, token, user };
};
const PM = await mkEmp(`UM${stamp}`, 'Quản Lý UI', `e2e.lu.pm.${stamp}`, ['employee', 'manager']);
const Bot = await mkEmp(`UB${stamp}`, 'Bot UI', `e2e.lu.bot.${stamp}`, ['employee']);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `lu-${stamp}`, name: 'Dự án live', kind: 'Internal', startOn: today, memberIds: [Bot.e.id] })).body;
const P2 = (await json(PM.cookie, 'POST', '/api/projects', { code: `lx-${stamp}`, name: 'Dự án khác', kind: 'Internal', startOn: today, memberIds: [] })).body;
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.columns as any[];
const bot = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${Bot.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return r.json().catch(() => null);
};

const br = await launch(9371, `/tmp/officehub-live-${Date.now()}`, 1440, 900);
try {
  ok('quản lý đăng nhập web', (await br.login(PM.user, PW)) === 200);
  const toasts = () => br.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent).join(' | ')`) as Promise<string>;
  const until = async (cond: () => Promise<boolean>, ms = 12000) => { for (let i = 0; i < ms / 400; i++) { if (await cond()) return true; await br.sleep(400); } return false; };
  const bodyText = () => br.evalJs(`document.body.innerText`) as Promise<string>;

  // 1) Đang mở đúng dự án → thẻ tự hiện, không toast
  await br.go(`${BASE}/projects/${P}`, 4000);
  const T = await bot('POST', `/api/projects/${P}/tasks`, { title: 'Việc bot tạo khi đang xem', assigneeEmployeeId: Bot.e.id }) as string;
  ok('đang xem dự án: thẻ việc bot vừa tạo tự hiện (≤ 12 giây, không tải lại)', await until(async () => (await bodyText()).includes('Việc bot tạo khi đang xem')));
  await br.sleep(1500);
  ok('… và không có toast', !(await toasts()).includes('Việc bot tạo khi đang xem'), await toasts());
  await bot('POST', `/api/projects/tasks/${T}/move`, { columnId: cols[1].id });
  ok('bot chuyển cột → thẻ tự sang cột "Đang làm"', await until(() => br.evalJs(`(() => {
    const c = document.querySelector('[data-testid="col-Đang làm"]');
    const t = document.querySelector('[data-testid="col-Cần làm"]');
    return !!c && c.innerText.includes('Việc bot tạo khi đang xem') && !t.innerText.includes('Việc bot tạo khi đang xem');
  })()`)));

  // 2) Ở trang khác → toast
  await br.go(`${BASE}/projects`, 3000);
  await bot('POST', `/api/projects/tasks/${T}/comments`, { content: 'Đã xong phần đăng nhập' });
  ok('ở danh sách dự án: có toast bình luận của bot (tên dự án)', await until(async () => { const t = await toasts(); return t.includes('bình luận') && t.includes('Dự án live'); }), await toasts());

  // 3) Ở dự án khác → toast, bấm "Mở" về dự án
  await br.go(`${BASE}/projects/${P2}`, 3000);
  await bot('POST', `/api/projects/tasks/${T}/move`, { columnId: cols[2].id });
  ok('ở dự án khác: có toast chuyển trạng thái', await until(async () => (await toasts()).includes('Chờ review')), await toasts());
  await br.evalJs(`[...document.querySelectorAll('[data-sonner-toast] button')].find(b => b.textContent.trim() === 'Mở')?.click()`);
  await br.sleep(2000);
  ok('bấm "Mở" → về trang dự án có việc', (await br.evalJs(`location.pathname`)) === `/projects/${P}`);
  if (process.env.SHOTS) await br.shot(`${process.env.SHOTS}/project-live.png`);
  // Bài này không bật Realtime → kết nối hub chat (SignalR) báo 502 là bình thường; bỏ qua đúng loại lỗi đó.
  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection/.test(e));
  ok('không lỗi JS trên trang (ngoài kết nối Realtime không bật)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
