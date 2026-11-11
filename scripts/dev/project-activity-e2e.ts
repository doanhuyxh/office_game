// E2E: luồng thay đổi dự án GET /api/projects/activity (bảng việc tự cập nhật + toast khi ở trang khác).
// Con trỏ (không after → chỉ con trỏ), thấy thay đổi của người / bot khác, không thấy của mình, người ngoài dự án không thấy, HR thấy (member=false),
// lý do chuyển lùi không thành 2 sự kiện, bình luận, cửa sổ chồng lấn (bỏ trùng theo id), after sai → 400, token AI → 403.
// CHỈ DB tạm: E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-activity-e2e.ts
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
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV PA ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Luồng DA ${stamp}`, code: `PA${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, token, name };
};
const PM = await mkEmp(`PM${stamp}`, 'Quản Lý Luồng', `e2e.pa.pm.${stamp}`, ['employee', 'manager']);
const Bot = await mkEmp(`PB${stamp}`, 'Bot Luồng', `e2e.pa.bot.${stamp}`, ['employee']);
const Out = await mkEmp(`PO${stamp}`, 'Người Ngoài Luồng', `e2e.pa.out.${stamp}`, ['employee']);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `pa-${stamp}`, name: 'Dự án luồng', kind: 'Internal', startOn: today, memberIds: [Bot.e.id] })).body;
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.columns as any[];
const [TODO, DOING] = [cols[0].id, cols[1].id];
const tk = async (method: string, path: string, body?: unknown) =>
  (await fetch(API + path, { method, headers: { authorization: `Bearer ${Bot.token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })).status;
const feed = async (c: string, after: string | null) => json(c, 'GET', `/api/projects/activity${after ? `?after=${encodeURIComponent(after)}` : ''}`);

const start = await feed(PM.cookie, null);
ok('không after → chỉ con trỏ, không có mục', start.status === 200 && !!start.body.cursor && start.body.items.length === 0, start.body);
const c0 = start.body.cursor as string, o0 = (await feed(Out.cookie, null)).body.cursor, h0 = (await feed(admin, null)).body.cursor;
await Bun.sleep(50);
// Bot tạo việc, bắt đầu làm, bình luận; quản lý tự tạo 1 việc (không được thấy của chính mình)
const created = await fetch(`${API}/api/projects/${P}/tasks`, { method: 'POST', headers: { authorization: `Bearer ${Bot.token}`, 'content-type': 'application/json' },
  body: JSON.stringify({ title: 'Việc của bot', assigneeEmployeeId: Bot.e.id }) });
const T = await created.json() as string;
ok('bot chuyển Đang làm + bình luận', await tk('POST', `/api/projects/tasks/${T}/move`, { columnId: DOING }) === 204
  && await tk('POST', `/api/projects/tasks/${T}/comments`, { content: 'Bắt đầu làm nhé' }) === 201);
await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc quản lý tự tạo' });
const f1 = await feed(PM.cookie, c0);
const kinds = (f1.body?.items ?? []).map((i: any) => i.kind);
ok('quản lý thấy 3 thay đổi của bot (Created, Moved, Commented), theo thứ tự thời gian', JSON.stringify(kinds) === '["Created","Moved","Commented"]', f1.body);
const mv = f1.body.items.find((i: any) => i.kind === 'Moved');
ok('mục có mã việc, tên dự án, BOT, member=true, to = tên cột', mv?.taskCode === `PA-${stamp}`.toUpperCase() + '-1' && mv.projectName === 'Dự án luồng' && mv.byBot && mv.member && mv.to === 'Đang làm', mv);
ok('không thấy thao tác của chính mình', !f1.body.items.some((i: any) => i.taskTitle === 'Việc quản lý tự tạo'));
ok('người ngoài dự án không thấy gì', (await feed(Out.cookie, o0)).body.items.length === 0);
const hr = (await feed(admin, h0)).body.items as any[];
ok('admin (HR) thấy mọi dự án nhưng member=false (không bị toast)', hr.length >= 4 && hr.every((i) => i.member === false), hr.length);
const again = await feed(PM.cookie, f1.body.cursor);
ok('hỏi lại bằng con trỏ: cửa sổ chồng lấn có thể trả lại mục cũ (FE bỏ trùng theo id), không có mục mới lạ', again.body.items.every((i: any) => f1.body.items.some((x: any) => x.id === i.id)), again.body);

// Chuyển lùi kèm lý do = 1 sự kiện Moved (không thêm Commented trùng)
const c1 = (await feed(PM.cookie, null)).body.cursor;
await Bun.sleep(50);
await tk('POST', `/api/projects/tasks/${T}/move`, { columnId: TODO, note: 'Chưa đủ thông tin' });
const f2 = (await feed(PM.cookie, c1)).body.items as any[];
ok('lùi kèm lý do → 1 mục Moved có text = lý do', f2.length === 1 && f2[0].kind === 'Moved' && f2[0].text === 'Chưa đủ thông tin', f2);
ok('after sai định dạng → 400', (await json(PM.cookie, 'GET', '/api/projects/activity?after=hom-qua')).status === 400);
ok('token AI → 403', await tk('GET', '/api/projects/activity') === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
