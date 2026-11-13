// TEST-72 E2E: kéo thả việc trên kanban — thẻ sang cột mới ngay (optimistic) + spinner / khoá thẻ khi đang lưu, lỗi → quay về cột cũ + toast,
// cột không thả được (đi lần lượt nhảy cột, "Xong" cần người duyệt) mờ + lý do và không gửi request, kéo lùi hỏi lý do (huỷ → đứng yên),
// kéo nhanh 2 thẻ không nhảy ngược, "Chỉ việc của tôi" + giảm dần vẫn đúng. Mạng chậm / lỗi giả lập bằng cách bọc window.fetch cho POST …/move.
// CHỈ DB tạm (container riêng):
//   docker run -d --name officehub-e2e-t72-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55472:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5192
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55472;Database=e2e;Username=e2e;Password=e2e'
//        Seed__AdminEmail=t72-admin@officehub-e2e.vn Seed__AdminPassword=T72-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Giao diện: frontend/: VITE_API_TARGET=http://localhost:5192 bunx vite --port 5177 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5192 BASE_URL=http://localhost:5177 bun scripts/dev/task-drag-e2e.ts
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5192';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 't72-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'T72-Admin-2026';
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
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV Kéo ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Task drag ${stamp}`, code: `TD${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW), user };
};
const PM = await mkEmp(`DM${stamp}`, 'Quản Lý Kéo', `e2e.td.pm.${stamp}`, ['employee', 'manager']);
const A = await mkEmp(`DA${stamp}`, 'Nhân Viên Kéo', `e2e.td.a.${stamp}`, ['employee']);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `td-${stamp}`, name: 'Dự án kéo thả', kind: 'Internal', startOn: today, memberIds: [A.e.id] })).body;
const proj = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
const cols = proj.columns as { id: string; name: string; approverOnly: boolean }[];
ok('dự án mới đi lần lượt, 4 cột, cột cuối cần người duyệt', proj.project.sequential && cols.length === 4 && cols[3].approverOnly, cols);
const mk = async (title: string, assignee: string) => (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: assignee })).body as string;
const T1 = await mk('Việc kéo một', A.e.id), T2 = await mk('Việc kéo hai', A.e.id), T3 = await mk('Việc kéo ba', A.e.id);
await mk('Việc của quản lý', PM.e.id);
const serverCol = async (id: string) => (await json(PM.cookie, 'GET', `/api/projects/tasks/${id}`)).body.task.columnId as string;

const br = await launch(9377, `/tmp/officehub-taskdrag-${Date.now()}`, 1440, 900);
try {
  ok('A đăng nhập web', (await br.login(A.user, PW)) === 200);
  const until = async (cond: () => Promise<boolean>, ms = 8000) => { for (let i = 0; i < ms / 100; i++) { try { if (await cond()) return true; } catch { /* đang render */ } await br.sleep(100); } return false; };
  await br.go(`${BASE}/projects/${P}`, 3500);
  // Bọc fetch: POST …/move chờ __moveDelay ms, __moveFail → lỗi mạng; đếm số lệnh gửi.
  await br.evalJs(`(() => { const f = window.fetch; window.__moves = 0; window.__moveDelay = 0; window.__moveFail = false;
    window.fetch = async (u, o) => { if (String(u).includes('/move') && o?.method === 'POST') { window.__moves++;
      await new Promise((r) => setTimeout(r, window.__moveDelay)); if (window.__moveFail) throw new TypeError('Failed to fetch'); } return f(u, o); }; })()`);
  const moves = () => br.evalJs('window.__moves') as Promise<number>;
  const col = (i: number) => `document.querySelector('[data-testid="col-${cols[i].name}"]')`;
  const card = (title: string) => `[...document.querySelectorAll('[data-testid="task-card"]')].find((x) => x.textContent.includes(${JSON.stringify(title)}))`;
  const colOf = (title: string) => br.evalJs(`(() => { const c = ${card(title)}; return c ? c.closest('[data-testid^="col-"]').dataset.testid.slice(4) : null; })()`) as Promise<string | null>;
  const count = (i: number) => br.evalJs(`${col(i)}.querySelector('[data-testid="column-header"]').textContent.match(/\\((\\d+)\\)/)[1]`).then(Number);
  const toasts = () => br.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join(' | ')`) as Promise<string>;
  const dt = `(window.__dt ??= new DataTransfer())`;
  const startDrag = async (title: string) => {
    await br.evalJs(`(() => { window.__dt = new DataTransfer(); ${card(title)}.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: ${dt} })); })()`);
    await br.sleep(150);
  };
  /** dragover → trả về trình duyệt có cho thả không (defaultPrevented) rồi drop + dragend như trình duyệt thật. */
  const dropOn = async (title: string, i: number, force = false) => {
    const allowed = await br.evalJs(`(() => { const e = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: ${dt} }); ${col(i)}.dispatchEvent(e); return e.defaultPrevented; })()`) as boolean;
    if (allowed || force) await br.evalJs(`${col(i)}.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: ${dt} }))`);
    await br.evalJs(`${card(title)}?.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: ${dt} }))`);
    return allowed;
  };

  // 1) đang kéo: thẻ nguồn mờ, cột nhảy bước + "Xong" mờ kèm lý do
  await startDrag('Việc kéo một');
  ok('đang kéo: thẻ nguồn mờ', !!(await br.evalJs(`${card('Việc kéo một')}.className.includes('opacity-50')`)));
  ok('cột liền kề không bị chặn', !(await br.evalJs(`${col(1)}.hasAttribute('data-blocked')`)));
  const why2 = await br.evalJs(`${col(2)}.querySelector('[data-testid="drop-blocked"]')?.textContent ?? ''`) as string;
  ok('cột nhảy bước mờ + lý do "Phải đi lần lượt"', !!(await br.evalJs(`${col(2)}.className.includes('opacity-50')`)) && why2.includes('Phải đi lần lượt'), why2);
  const why3 = await br.evalJs(`${col(3)}.querySelector('[data-testid="drop-blocked"]')?.textContent ?? ''`) as string;
  ok('cột cần người duyệt mờ + lý do (nhân viên)', why3.includes('Chỉ quản lý dự án') || why3.includes('Phải đi lần lượt'), why3);
  const before = await moves();
  ok('dragover cột bị chặn → trình duyệt không cho thả', !(await dropOn('Việc kéo một', 2)));
  await startDrag('Việc kéo một');
  await dropOn('Việc kéo một', 3, true);
  await br.sleep(300);
  ok('thả cưỡng bức vào cột bị chặn → không gửi request, thẻ đứng yên', (await moves()) === before && (await colOf('Việc kéo một')) === cols[0].name, [await moves(), await colOf('Việc kéo một')]);
  ok('kéo xong: hết mờ cột / thẻ', !(await br.evalJs(`!!document.querySelector('[data-blocked]') || ${card('Việc kéo một')}.className.includes('opacity-50')`)));

  // 2) mạng chậm: thẻ sang cột mới ngay, spinner + khoá tới khi xong, đếm cột đổi ngay
  await br.evalJs('window.__moveDelay = 1500');
  const c0 = await count(0), c1 = await count(1);
  await startDrag('Việc kéo một');
  ok('dragover cột liền kề → cho thả', await dropOn('Việc kéo một', 1));
  await br.sleep(200);
  ok('thả → thẻ sang cột mới ngay (API chưa trả)', (await colOf('Việc kéo một')) === cols[1].name, await colOf('Việc kéo một'));
  ok('… số đếm cột đổi ngay', (await count(0)) === c0 - 1 && (await count(1)) === c1 + 1, [await count(0), await count(1)]);
  ok('… thẻ aria-busy + spinner + khoá (disabled, không kéo được)', !!(await br.evalJs(`(() => { const c = ${card('Việc kéo một')};
    return c.getAttribute('aria-busy') === 'true' && c.disabled && c.getAttribute('draggable') === 'false' && !!c.querySelector('.animate-spin'); })()`)));
  ok('lưu xong → hết spinner, nháy viền primary', await until(() => br.evalJs(`(() => { const c = ${card('Việc kéo một')}; return c.getAttribute('aria-busy') === 'false' && c.className.includes('ring-primary'); })()`), 4000));
  ok('… server: việc ở cột mới', (await serverCol(T1)) === cols[1].id);
  await br.sleep(1000);
  ok('… sau refetch vẫn ở cột mới, viền nháy đã tắt', (await colOf('Việc kéo một')) === cols[1].name && !(await br.evalJs(`${card('Việc kéo một')}.className.includes('ring-')`)));

  // 3) lỗi mạng → thẻ quay về cột cũ + toast + viền destructive
  await br.evalJs('window.__moveDelay = 600; window.__moveFail = true');
  await startDrag('Việc kéo hai');
  await dropOn('Việc kéo hai', 1);
  await br.sleep(150);
  ok('lỗi: trước khi API trả đã ở cột mới', (await colOf('Việc kéo hai')) === cols[1].name);
  ok('lỗi → thẻ quay về cột cũ', await until(async () => (await colOf('Việc kéo hai')) === cols[0].name, 3000), await colOf('Việc kéo hai'));
  ok('… viền destructive', !!(await br.evalJs(`${card('Việc kéo hai')}.className.includes('ring-destructive')`)));
  ok('… toast "Không chuyển được"', await until(async () => (await toasts()).includes('Không chuyển được') && (await toasts()).includes(cols[1].name), 2000), await toasts());
  ok('… việc khác (đã chuyển) không bị trả về', (await colOf('Việc kéo một')) === cols[1].name);
  ok('… server: việc vẫn ở cột cũ', (await serverCol(T2)) === cols[0].id);
  await br.evalJs('window.__moveFail = false; window.__moveDelay = 0');
  await br.sleep(1000);

  // 4) kéo lùi: hỏi lý do, huỷ → đứng yên không request; xác nhận → chuyển
  const m0 = await moves();
  await startDrag('Việc kéo một');
  await dropOn('Việc kéo một', 0);
  ok('kéo lùi → hộp thoại lý do, thẻ vẫn ở cột cũ', await until(async () => !!(await br.evalJs(`!!document.querySelector('[role="alertdialog"], [role="dialog"]')`)))
    && (await colOf('Việc kéo một')) === cols[1].name);
  await br.evalJs(`[...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find((b) => /Huỷ|Hủy/.test(b.textContent))?.click()`);
  await br.sleep(400);
  ok('huỷ → thẻ đứng yên, không gửi request', (await colOf('Việc kéo một')) === cols[1].name && (await moves()) === m0);
  await startDrag('Việc kéo một');
  await dropOn('Việc kéo một', 0);
  await until(async () => !!(await br.evalJs(`!!document.querySelector('[role="alertdialog"] textarea, [role="dialog"] textarea')`)));
  await br.evalJs(`(() => { const t = document.querySelector('[role="alertdialog"] textarea, [role="dialog"] textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Làm lại'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(100);
  await br.evalJs(`[...document.querySelectorAll('[role="alertdialog"] button, [role="dialog"] button')].find((b) => b.textContent.trim() === 'Chuyển')?.click()`);
  ok('xác nhận lý do → thẻ về cột trước', await until(async () => (await colOf('Việc kéo một')) === cols[0].name, 3000));
  ok('… server ghi lý do thành bình luận', await until(async () => (await json(PM.cookie, 'GET', `/api/projects/tasks/${T1}`)).body.comments.some((c: any) => c.content.includes('Làm lại')), 3000));
  await br.sleep(800);

  // 5) "Chỉ việc của tôi" + giảm dần cột đích, kéo nhanh 2 thẻ liên tiếp
  await br.evalJs(`[...document.querySelectorAll('label')].find((l) => l.textContent.includes('Chỉ việc của tôi')).querySelector('input').click()`);
  await br.sleep(200);
  ok('"Chỉ việc của tôi" ẩn việc của quản lý', !(await br.evalJs(`!!${card('Việc của quản lý')}`)));
  await br.evalJs(`${col(1)}.querySelector('[data-testid="sort-desc"]').click()`);
  await br.evalJs('window.__moveDelay = 1200');
  await startDrag('Việc kéo hai');
  await dropOn('Việc kéo hai', 1);
  await br.sleep(150);
  await startDrag('Việc kéo ba');
  await dropOn('Việc kéo ba', 1);
  const order = () => br.evalJs(`[...${col(1)}.querySelectorAll('[data-testid="task-card"]')].map((c) => c.textContent.includes('Việc kéo hai') ? 2 : c.textContent.includes('Việc kéo ba') ? 3 : 0).join()`) as Promise<string>;
  await br.sleep(200);
  ok('kéo nhanh 2 thẻ: cả hai sang cột mới ngay, giảm dần → thẻ thả sau đứng đầu', (await order()) === '3,2', await order());
  await br.sleep(1000); // lệnh 1 xong, lệnh 2 còn chạy
  ok('… lệnh đầu xong trong khi lệnh sau còn chạy → không thẻ nào nhảy ngược', (await order()) === '3,2', await order());
  ok('… cả hai lưu xong, thứ tự vẫn đúng sau refetch', await until(async () => !(await br.evalJs(`!!${col(1)}.querySelector('[aria-busy="true"]')`)), 4000)
    && (await br.sleep(800), (await order()) === '3,2'), await order());
  ok('… server: cả hai ở cột mới', (await serverCol(T2)) === cols[1].id && (await serverCol(T3)) === cols[1].id);
  await br.evalJs(`${col(1)}.querySelector('[data-testid="sort-desc"]').click()`); // trả lại localStorage

  if (process.env.SHOTS) await br.shot(`${process.env.SHOTS}/task-drag.png`);
  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection|Failed to fetch|404|Not Found|status of 4/.test(e));
  ok('không lỗi JS trên trang (ngoài Realtime không bật / lỗi mạng giả lập)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
