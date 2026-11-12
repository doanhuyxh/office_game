// TEST-66 E2E: link chuông việc dự án → mở trang dự án + hộp thoại đúng việc (Chrome headless).
// Kiểm tra: link BE (?task= / &comment=), bấm chuông → modal đúng việc, bình luận được cuộn + tô sáng, đóng → bỏ ?task (F5 không mở lại),
// việc đã xong mở được theo id, id sai → toast + vẫn ở tab Công việc, chuông cũ (không có task) như trước, bấm thẻ kanban ghi ?task=.
// CHỈ DB tạm. Api trỏ DB tạm, Vite: cd frontend && VITE_API_TARGET=http://localhost:5181 bun run dev --port 5175
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 BASE_URL=http://localhost:5175 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-link-e2e.ts
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
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV Link ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Task link ${stamp}`, code: `TL${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW), user };
};
const PM = await mkEmp(`TM${stamp}`, 'Quản Lý Link', `e2e.tl.pm.${stamp}`, ['employee', 'manager']);
const A = await mkEmp(`TA${stamp}`, 'Nhân Viên Link', `e2e.tl.a.${stamp}`, ['employee']);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `tl-${stamp}`, name: 'Dự án link', kind: 'Internal', startOn: today, memberIds: [A.e.id] })).body;
const P2 = (await json(PM.cookie, 'POST', '/api/projects', { code: `tx-${stamp}`, name: 'Dự án riêng', kind: 'Internal', startOn: today, memberIds: [] })).body;
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.columns as any[];

// BE: link chuông
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc giao qua chuông', assigneeEmployeeId: A.e.id })).body as string;
const notes = async (cookie: string) => (await json(cookie, 'GET', '/api/notifications?take=50')).body.items as any[];
const assigned = (await notes(A.cookie)).find((n) => n.title.includes('Bạn được giao việc'));
ok('chuông giao việc → /projects/{pid}?task={tid}', assigned?.link === `/projects/${P}?task=${T}`, assigned);
const C = (await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/comments`, { content: `Nhờ @${A.e.code} xem giúp` })).body as string;
const commented = (await notes(A.cookie)).find((n) => n.title.includes('bình luận việc'));
ok('chuông bình luận (người làm) → &comment={cid}', commented?.link === `/projects/${P}?task=${T}&comment=${C}`, commented);
// bình luận dài để bình luận cần tìm nằm dưới, phải cuộn
for (let i = 0; i < 12; i++) await json(A.cookie, 'POST', `/api/projects/tasks/${T}/comments`, { content: `Ghi chú ${i}\n\n${'Nội dung dài. '.repeat(30)}` });
const C2 = (await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/comments`, { content: `Bình luận cuối cho @${A.e.code}` })).body as string;
await json(A.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: cols[1].id });
const moved = (await notes(PM.cookie)).find((n) => n.title.includes('chuyển'));
ok('chuông chung đổi cột → ?task=', moved?.link === `/projects/${P}?task=${T}`, moved);
const memberAdded = (await notes(A.cookie)).find((n) => n.category !== 'project_task');
ok('chuông không gắn việc (thêm thành viên) giữ link cũ', !memberAdded || !String(memberAdded.link).includes('task='), memberAdded);
// việc đã xong (không hiện khi lọc "việc của tôi"): PM tự giao cho mình rồi đi lần lượt tới cột hoàn thành
const D = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc đã xong từ trước', assigneeEmployeeId: PM.e.id })).body as string;
for (const c of cols.slice(1)) { await json(PM.cookie, 'POST', `/api/projects/tasks/${D}/move`, { columnId: c.id }); if (c.isDone) break; }
const Tprivate = (await json(PM.cookie, 'POST', `/api/projects/${P2}/tasks`, { title: 'Việc dự án riêng' })).body as string;

const br = await launch(9376, `/tmp/officehub-tasklink-${Date.now()}`, 1440, 900);
try {
  ok('A đăng nhập web', (await br.login(A.user, PW)) === 200);
  const until = async (cond: () => Promise<boolean>, ms = 10000) => { for (let i = 0; i < ms / 300; i++) { try { if (await cond()) return true; } catch { /* trang đang chuyển */ } await br.sleep(300); } return false; };
  const dialogTitle = () => br.evalJs(`document.querySelector('[role="dialog"] h2')?.textContent ?? ''`) as Promise<string>;
  const search = () => br.evalJs(`location.search`) as Promise<string>;
  const toasts = () => br.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map(t => t.textContent).join(' | ')`) as Promise<string>;
  const activeTab = () => br.evalJs(`document.querySelector('[role="tab"][data-state="active"]')?.textContent ?? ''`) as Promise<string>;
  const closeDialog = () => br.evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Đóng')?.click()`);

  // 1) bấm chuông → mục "Bạn được giao việc"
  await br.go(`${BASE}/projects`, 3000);
  await br.evalJs(`(() => { const b = document.querySelector('[data-testid="notification-bell"]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); })()`);
  await until(async () => !!(await br.evalJs(`document.querySelector('[data-testid="notification-item"]') !== null`)));
  await br.evalJs(`[...document.querySelectorAll('[data-testid="notification-item"]')].find(x => x.textContent.includes('Bạn được giao việc'))?.click()`);
  ok('bấm chuông giao việc → trang dự án + hộp thoại đúng việc', await until(async () => (await dialogTitle()).includes('Việc giao qua chuông')), await dialogTitle());
  ok('… URL có ?task=', (await search()).includes(`task=${T}`), await search());
  ok('… tab Công việc', (await activeTab()).startsWith('Công việc'), await activeTab());
  await closeDialog();
  ok('đóng hộp thoại → URL bỏ task', await until(async () => !(await search()).includes('task=')), await search());
  await br.go(`${BASE}/projects/${P}`, 3000);
  ok('F5 sau khi đóng → không mở lại hộp thoại', (await dialogTitle()) === '');

  // 2) link bình luận → cuộn + tô sáng
  await br.go(`${BASE}/projects/${P}?task=${T}&comment=${C2}`, 3500);
  ok('link bình luận → hộp thoại đúng việc', (await dialogTitle()).includes('Việc giao qua chuông'), await dialogTitle());
  ok('… bình luận được tô sáng', !!(await br.evalJs(`document.getElementById('task-comment-${C2}')?.className.includes('ring-2')`)));
  ok('… và cuộn vào tầm nhìn', await until(() => br.evalJs(`(() => { const r = document.getElementById('task-comment-${C2}').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()`)));
  ok('… bình luận khác không tô sáng', !(await br.evalJs(`document.getElementById('task-comment-${C}')?.className.includes('ring-2')`)));
  await closeDialog();
  ok('đóng → bỏ cả task và comment', await until(async () => { const s = await search(); return !s.includes('task=') && !s.includes('comment='); }), await search());

  // 3) ?tab khác + task → về tab Công việc; việc đã xong, đang lọc "việc của tôi"
  await br.go(`${BASE}/projects/${P}?tab=members&task=${D}`, 3500);
  ok('?tab=members&task= → tab Công việc + mở việc đã xong', (await activeTab()).startsWith('Công việc') && (await dialogTitle()).includes('Việc đã xong từ trước'),
    [await activeTab(), await dialogTitle()]);
  await closeDialog();
  await br.sleep(800);

  // 4) id sai / không có quyền → toast, vẫn tab Công việc, không vỡ trang
  await br.go(`${BASE}/projects/${P}?task=00000000-0000-0000-0000-000000000001`, 3500);
  ok('id sai → toast "Không tìm thấy việc"', await until(async () => (await toasts()).includes('Không tìm thấy việc')), await toasts());
  ok('… không mở hộp thoại, URL bỏ task, vẫn tab Công việc', (await dialogTitle()) === '' && !(await search()).includes('task=') && (await activeTab()).startsWith('Công việc'),
    [await dialogTitle(), await search(), await activeTab()]);
  await br.go(`${BASE}/projects/${P}?task=${Tprivate}`, 3500);
  ok('việc của dự án khác (không có quyền xem) → toast, không mở', await until(async () => (await toasts()).includes('Không tìm thấy việc')) && (await dialogTitle()) === '');
  await br.go(`${BASE}/projects/${P}?task=khong-phai-guid`, 3500);
  ok('task không phải GUID → toast, không vỡ trang', await until(async () => (await toasts()).includes('Không tìm thấy việc')) && (await activeTab()).startsWith('Công việc'));

  // 5) link cũ (không task) → trang dự án như trước
  await br.go(`${BASE}/projects/${P}`, 3000);
  ok('link cũ /projects/{id} → trang dự án, không hộp thoại', (await activeTab()).startsWith('Công việc') && (await dialogTitle()) === '');

  // 6) bấm thẻ kanban → ghi ?task= (copy link được)
  await br.evalJs(`[...document.querySelectorAll('[data-testid="task-card"]')].find(x => x.textContent.includes('Việc giao qua chuông'))?.click()`);
  ok('bấm thẻ trên kanban → mở hộp thoại + URL ?task=', await until(async () => (await search()).includes(`task=${T}`)) && (await dialogTitle()).includes('Việc giao qua chuông'));
  await closeDialog();
  await br.sleep(600);
  // thêm việc mới (không gắn URL) vẫn mở / đóng được
  await br.evalJs(`document.querySelector('[aria-label^="Thêm việc vào"]')?.click()`);
  ok('nút "+" thêm việc vẫn mở hộp thoại "Thêm việc"', await until(async () => (await dialogTitle()) === 'Thêm việc'));
  await closeDialog();
  ok('… đóng được', await until(async () => (await dialogTitle()) === ''));

  if (process.env.SHOTS) await br.shot(`${process.env.SHOTS}/task-link.png`);
  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection|404|Not Found|status of 4/.test(e));
  ok('không lỗi JS trên trang (ngoài Realtime không bật / 404 cố ý)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
