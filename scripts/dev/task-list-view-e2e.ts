// E2E TEST-192 chế độ xem "Danh sách" của tab Công việc (Chrome headless, thiết kế TEST-191 bản 2):
// nút Cột / Danh sách, tải lại vẫn giữ (localStorage); nhóm theo trạng thái đúng thứ tự cột của dự án (kể cả cột tự thêm / đổi thứ tự), nhóm Xong
// thu gọn sẵn, bấm mở / thu; tìm (mã + tên, không dấu), lọc trạng thái / người làm / hạn, Xoá bộ lọc, sắp xếp theo hạn (không hạn ở cuối), nhóm theo người làm;
// đổi trạng thái trên dòng: menu chỉ có cột được phép (đi lần lượt, cột cần người duyệt không hiện với thành viên), tiến một bước lưu ngay,
// lùi hỏi lý do → bình luận; người theo dõi 👁 + số, rê chuột hiện tên; Tạo công việc mở hộp thoại; bấm dòng mở chi tiết (?task=);
// tài khoản chỉ xem (thấy dự án nhờ phòng ban) → không nút tạo, trạng thái là nhãn tĩnh; trống / đang tải / lỗi tải + Thử lại;
// điện thoại 390×844 thẻ nhiều dòng không cuộn ngang; theme tối. Ảnh vào SHOTS_DIR.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Api như đầu task-column-guide-e2e.ts, Vite trỏ Api (không cần Mcp / Realtime):
//   docker run -d --name e2e192-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15492:5432 postgres:17-alpine
//   (script dùng `docker exec <PG_CONTAINER, mặc định e2e192-pg> psql` để đặt một hạn đã qua — API không cho tạo)
//   VITE_API_TARGET=http://localhost:5392 bunx vite --port 5193   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5392 BASE_URL=http://localhost:5193 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-list-view-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5392';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/task-list-view`;
mkdirSync(SHOTS, { recursive: true });
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
const addDays = (n: number) => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

// ── Dữ liệu: quản lý dự án, thành viên, người xem nhờ phòng ban ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV TL ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead TL ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Task List ${stamp}`, code: `TL${stamp}` })).body;
const deptV = (await json(admin, 'POST', '/api/org/departments', { name: `Xem DA ${stamp}`, code: `TV${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos, department = dept) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: department, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`LM${stamp}`, 'Quản Lý Dự Án', `e2e.tl.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Mem = await mkEmp(`LN${stamp}`, 'Đoàn Thành Viên', `e2e.tl.mem.${stamp}`, ['employee']);
const Viewer = await mkEmp(`LV${stamp}`, 'Người Xem Phòng Ban', `e2e.tl.view.${stamp}`, ['employee'], pos, deptV);
const projBody = { code: `TL${stamp}`, name: 'Danh sách công việc (UI)', kind: 'Internal', startOn: today, memberIds: [Mem.e.id], departmentIds: [deptV] };
const P = (await json(PM.cookie, 'POST', '/api/projects', { ...projBody, sequential: false })).body as string;
const detail = async () => (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
let cols: any[] = (await detail()).columns;
const colReq = (c: any, patch: any = {}) => ({ name: c.name, color: c.color, isDone: c.isDone, approverOnly: c.approverOnly, wakeFollowers: false, wakeBotIds: [], ...patch });
// Thêm "Lưu trữ" (đưa lên đầu) + "Deploy" (trước Xong); Xong cần người duyệt
const archive = (await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Lưu trữ', color: '#64748b', isDone: false, approverOnly: false, wakeFollowers: false, wakeBotIds: [] })).body as string;
const deploy = (await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Deploy', color: '#ef4444', isDone: false, approverOnly: false, wakeFollowers: false, wakeBotIds: [] })).body as string;
const by = (n: string) => cols.find((c) => c.name === n)!;
const order = [archive, by('Cần làm').id, by('Đang làm').id, by('Chờ review').id, deploy, by('Xong').id];
await json(PM.cookie, 'PUT', `/api/projects/${P}/columns/order`, { ids: order });
await json(PM.cookie, 'PUT', `/api/projects/columns/${by('Xong').id}`, colReq(by('Xong'), { approverOnly: true }));
cols = (await detail()).columns;
const NAMES = cols.map((c) => c.name);
ok('dữ liệu: 6 cột theo thứ tự tự đặt, Xong cần người duyệt', NAMES.join('|') === 'Lưu trữ|Cần làm|Đang làm|Chờ review|Deploy|Xong' && by('Xong').approverOnly === true, NAMES);
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const mk = async (title: string, column: string, extra: any = {}) => {
  const x = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, columnId: col(column), assigneeEmployeeId: Mem.e.id, ...extra });
  if (x.status >= 300) throw new Error(`Tạo việc "${title}" lỗi ${x.status}: ${JSON.stringify(x.body)}`);
  return x.body as string;
};
const T = {
  archived: await mk('Ý tưởng để sau', 'Lưu trữ', { assigneeEmployeeId: null }),
  todo: await mk('Viết đặc tả bộ lọc', 'Cần làm', { dueOn: addDays(3), estimateDays: 2 }),
  overdue: await mk('Sửa lỗi đăng nhập trễ hạn', 'Cần làm', { dueOn: addDays(1), estimateDays: 1 }),
  doing: await mk('Thiết kế trang chi tiết', 'Đang làm', { dueOn: addDays(20), estimateDays: 3, assigneeEmployeeId: PM.e.id }),
  review: await mk('Tích hợp cổng thanh toán', 'Chờ review', { dueOn: addDays(10), estimateDays: 4 }),
  deploy: await mk('Kiểm thử giỏ hàng', 'Deploy', { estimateDays: 1 }),
};
const done: string[] = [];
for (let i = 1; i <= 20; i++) done.push(await mk(`Việc đã xong số ${i}`, 'Xong'));
await json(PM.cookie, 'POST', `/api/projects/tasks/${T.review}/followers/${PM.e.id}`);
await json(PM.cookie, 'POST', `/api/projects/tasks/${T.review}/followers/${Mem.e.id}`);
// API không cho đặt hạn trước hôm nay → đưa hạn về quá khứ thẳng trong DB tạm (docker exec)
const PG = process.env.PG_CONTAINER ?? 'e2e192-pg';
const sql = Bun.spawnSync(['docker', 'exec', PG, 'psql', '-U', 'e2e', '-d', 'e2e', '-c',
  `UPDATE projects.tasks SET "DueOn" = '${addDays(-2)}' WHERE "Id" = '${T.overdue}'`]);
ok('đặt hạn quá khứ cho một việc (DB tạm)', sql.exitCode === 0, sql.stderr.toString());
// Bật "đi lần lượt" sau khi đã đặt việc vào đủ cột
ok('dự án chuyển sang đi lần lượt', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...projBody, sequential: true })).status < 300);
const tasksApi = async () => (await json(PM.cookie, 'GET', `/api/projects/${P}/tasks`)).body as any[];
const codeOf = async (id: string) => (await tasksApi()).find((t) => t.id === id)?.code as string;
const C = Object.fromEntries(await Promise.all(Object.entries(T).map(async ([k, id]) => [k, await codeOf(id)]))) as Record<keyof typeof T, string>;

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const br = await launch(9352, `${tmpdir()}/task-list-view-${stamp}`);
/** Bấm thật (pointer) vào giữa phần tử — Radix Select / DropdownMenu mở theo pointerdown. */
const clickAt = async (expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(350);
};
const pick = async (trigger: string, label: string) => {
  await clickAt(q(trigger));
  await clickAt(`[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === ${JSON.stringify(label)})`);
};
const rows = () => br.evalJs(`[...document.querySelectorAll('[data-testid="task-table"] [data-testid="task-row"]')].map((r) => r.dataset.task)`) as Promise<string[]>;
const groups = () => br.evalJs(`[...document.querySelectorAll('[data-testid="task-table"] [data-testid="task-group"]')].map((g) => g.dataset.group)`) as Promise<string[]>;
const row = (code: string) => `document.querySelector('[data-testid="task-table"] [data-task="${code}"]')`;
const setSearch = (v: string) => br.evalJs(`(() => { const i = ${q('task-search')}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)});
  i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const menuOptions = () => br.evalJs(`[...document.querySelectorAll('[data-testid="task-status-option"]')].map((o) => o.innerText.trim())`) as Promise<string[]>;
const noHScroll = () => br.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const URL_TASKS = `${BASE}/projects/${P}?tab=tasks`;
try {
  ok('đăng nhập UI thành viên', (await br.login(Mem.user, PW)) === 200);
  await br.go(URL_TASKS, 3500);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.go(URL_TASKS, 3500);
  ok('mặc định chế độ Cột (kanban)', await br.evalJs(`!!${q('col-Cần làm')} && !${q('task-list')} && ${q('view-board')}.getAttribute('aria-pressed') === 'true'`));
  await clickAt(q('view-list'));
  ok('bấm Danh sách → bảng danh sách, không còn kanban', await br.evalJs(`!!${q('task-list')} && !${q('col-Cần làm')}`));
  await br.go(URL_TASKS, 3500);
  ok('tải lại trang vẫn ở Danh sách', await br.evalJs(`!!${q('task-list')} && ${q('view-list')}.getAttribute('aria-pressed') === 'true'`));
  // Hàng tab dạng thẻ (ảnh danh-sach-trong-v2): tab Công việc đang chọn có nền + viền, số việc là nhãn tròn đảo màu, nối liền khung công cụ cùng nền
  ok('tab dạng thẻ: Công việc đang chọn nền muted + viền, số việc nhãn đảo màu, nối liền khung công cụ', await br.evalJs(`(() => {
    const t = document.querySelector('[data-testid="project-tabs"] [role="tab"][data-state="active"]'); const n = ${q('tab-count-tasks')};
    const panel = ${q('task-panel')}; const tool = panel.firstElementChild; const ts = getComputedStyle(t), ns = getComputedStyle(n);
    const tb = t.getBoundingClientRect(), pb = panel.getBoundingClientRect();
    return t.innerText.startsWith('Công việc') && n.innerText.trim() === '6' && ts.backgroundColor === getComputedStyle(tool).backgroundColor
      && ts.borderTopWidth === '1px' && ns.backgroundColor !== ts.backgroundColor && Math.abs(tb.bottom - pb.top) <= 1; })()`));

  // ── Nhóm theo trạng thái ──
  ok('nhóm đúng thứ tự cột của dự án (cột tự thêm / đổi thứ tự)', (await groups()).join('|') === NAMES.join('|'), await groups());
  let r = await rows();
  ok('nhóm Xong thu gọn sẵn (không dòng việc xong), các nhóm khác mở', r.length === 6 && r.includes(C.todo), r);
  ok('tiêu đề nhóm Xong có số việc 20 + aria-expanded=false', await br.evalJs(`(() => { const g = document.querySelector('[data-testid="task-table"] [data-group="Xong"] [data-testid="group-header"]');
    return g.getAttribute('aria-expanded') === 'false' && g.innerText.includes('20'); })()`));
  ok('việc quá hạn: chữ "Quá hạn" + màu đỏ', await br.evalJs(`!!${row(C.overdue)}.querySelector('[data-testid="task-overdue"]') && !!${row(C.overdue)}.querySelector('[data-overdue]')`));
  ok('người theo dõi: 👁 2 ở việc có 2 người, việc 0 người để trống', await br.evalJs(`${row(C.review)}.querySelector('[data-testid="task-followers"]')?.innerText.trim() === '2'
    && !${row(C.todo)}.querySelector('[data-testid="task-followers"]')`));
  ok('không có ô tích chọn dòng, không phân trang', await br.evalJs(`!${q('task-list')}.querySelector('[role="checkbox"]:not([data-testid="only-mine"]), input[type="checkbox"]') && !document.querySelector('[data-slot="pagination"]')`));
  await br.shot(`${SHOTS}/1-may-tinh-sang.png`);
  await clickAt(`document.querySelector('[data-testid="task-table"] [data-group="Xong"] [data-testid="group-header"]')`);
  r = await rows();
  ok('bấm nhóm Xong → mở 20 việc đã xong, tên gạch ngang', r.length === 26 && await br.evalJs(`!!${row(await codeOf(done[0]))}.querySelector('.line-through')`), r.length);
  await clickAt(`document.querySelector('[data-testid="task-table"] [data-group="Xong"] [data-testid="group-header"]')`);
  ok('bấm lại → thu gọn', (await rows()).length === 6);

  // ── Rê chuột người theo dõi ──
  const fp = await br.evalJs(`(() => { const e = ${row(C.review)}.querySelector('[data-testid="task-followers"]'); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  for (const d of [-6, -2, 0]) await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fp.x + d, y: fp.y + d });
  await br.sleep(1500);
  ok('rê chuột 👁 → tên người theo dõi (lấy từ chi tiết việc)', await br.evalJs(`[...document.querySelectorAll('[data-testid="follower-names"]')].some((t) => t.innerText.includes('Quản Lý Dự Án') && t.innerText.includes('Đoàn Thành Viên'))`));
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });

  // ── Tìm / lọc / sắp xếp / nhóm ──
  await setSearch('thanh toan');
  await br.sleep(300);
  ok('tìm không dấu theo tên → 1 việc', (await rows()).join() === C.review, await rows());
  await setSearch(C.overdue.toLowerCase());
  await br.sleep(300);
  ok('tìm theo mã việc', (await rows()).join() === C.overdue, await rows());
  ok('đang lọc → nhóm trống bị ẩn', (await groups()).join() === 'Cần làm', await groups());
  await clickAt(q('clear-filters'));
  ok('Xoá bộ lọc → đủ lại', (await rows()).length === 6 && await br.evalJs(`${q('task-search')}.value === ''`));
  await pick('filter-status', 'Đang làm');
  ok('lọc trạng thái Đang làm', (await rows()).join() === C.doing, await rows());
  await pick('filter-status', 'Tất cả');
  await pick('filter-assignee', 'Quản Lý Dự Án');
  ok('lọc người làm', (await rows()).join() === C.doing, await rows());
  await pick('filter-assignee', 'Chưa giao');
  ok('lọc "Chưa giao"', (await rows()).join() === C.archived, await rows());
  await pick('filter-assignee', 'Tất cả');
  await pick('filter-due', 'Quá hạn');
  ok('lọc hạn: Quá hạn', (await rows()).join() === C.overdue, await rows());
  await pick('filter-due', '7 ngày tới');
  ok('lọc hạn: 7 ngày tới', (await rows()).join() === C.todo, await rows());
  await pick('filter-due', 'Tất cả');
  await clickAt(`document.querySelector('label:has([data-testid="only-mine"])')`);
  ok('"Chỉ việc của tôi" bỏ việc của người khác / chưa giao', !(await rows()).includes(C.doing) && !(await rows()).includes(C.archived) && (await rows()).includes(C.todo), await rows());
  await clickAt(q('clear-filters'));
  ok('Xoá bộ lọc bỏ cả "Chỉ việc của tôi"', (await rows()).length === 6 && await br.evalJs(`${q('only-mine')}.getAttribute('aria-checked') === 'false'`));
  await pick('group-by', 'Không nhóm');
  await pick('sort-by', 'Hạn gần nhất');
  r = await rows();
  ok('không nhóm → hiện cả 26 việc, không dòng nhóm', r.length === 26 && (await groups()).length === 0, r.length);
  const tl = await tasksApi();
  const dueOf = (code: string) => tl.find((t) => t.code === code)?.dueOn ?? null;
  const dues = r.map(dueOf);
  const firstNull = dues.indexOf(null);
  ok('sắp xếp hạn tăng dần, việc không hạn ở cuối', firstNull > 0 && dues.slice(firstNull).every((x) => x === null)
    && dues.slice(0, firstNull).every((x, i, a) => i === 0 || a[i - 1]! <= x!), dues);
  await pick('sort-by', 'Hạn xa nhất');
  r = await rows();
  ok('sắp xếp hạn giảm dần: xa nhất trước, không hạn vẫn ở cuối', r[0] === C.doing && dueOf(r.at(-1)!) === null, r.slice(0, 3));
  await pick('sort-by', 'Thứ tự bảng');
  await pick('group-by', 'Người làm');
  ok('nhóm theo người làm (thứ tự thành viên dự án, Chưa giao cuối)', (await groups()).join('|') === 'Quản Lý Dự Án|Đoàn Thành Viên|Chưa giao', await groups());
  await pick('group-by', 'Trạng thái');

  // ── Đổi trạng thái trên dòng ──
  await clickAt(`${row(C.todo)}.querySelector('[data-testid="task-status-menu"]')`);
  ok('menu Cần làm (đi lần lượt): chỉ bước kế "Đang làm" + lùi "Lưu trữ"', (await menuOptions()).join('|') === 'Lưu trữ|Đang làm', await menuOptions());
  ok('mở menu không mở hộp thoại chi tiết', await br.evalJs(`!location.search.includes('task=')`));
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.sleep(300);
  await clickAt(`${row(C.deploy)}.querySelector('[data-testid="task-status-menu"]')`);
  ok('thành viên: cột cần người duyệt "Xong" không có trong menu', !(await menuOptions()).includes('Xong') && (await menuOptions()).includes('Chờ review'), await menuOptions());
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.sleep(300);
  await clickAt(`${row(C.todo)}.querySelector('[data-testid="task-status-menu"]')`);
  await clickAt(`[...document.querySelectorAll('[data-testid="task-status-option"]')].find((o) => o.innerText.trim() === 'Đang làm')`);
  await br.sleep(1200);
  ok('tiến một bước → API: việc sang Đang làm', (await tasksApi()).find((t) => t.id === T.todo)?.columnName === 'Đang làm');
  ok('dòng chuyển sang nhóm Đang làm', await br.evalJs(`(() => { const rs = [...document.querySelectorAll('[data-testid="task-table"] tr')]; const g = rs.findIndex((x) => x.dataset.group === 'Đang làm');
    const t = rs.findIndex((x) => x.dataset.task === '${C.todo}'); const n = rs.findIndex((x) => x.dataset.group === 'Chờ review'); return g < t && t < n; })()`));
  await clickAt(`${row(C.review)}.querySelector('[data-testid="task-status-menu"]')`);
  await clickAt(`[...document.querySelectorAll('[data-testid="task-status-option"]')].find((o) => o.innerText.trim() === 'Đang làm')`);
  await br.sleep(500);
  ok('lùi → hộp thoại hỏi lý do', await br.evalJs(`!!${q('confirm-dialog')} && !!document.getElementById('confirm-dialog-input')`));
  await br.shot(`${SHOTS}/2-lui-hoi-ly-do.png`);
  await br.evalJs(`(() => { const t = document.getElementById('confirm-dialog-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'Thiếu kiểm thử');
    t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(200);
  await clickAt(q('confirm-dialog-ok'));
  await br.sleep(1500);
  const rv = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T.review}`)).body;
  ok('lùi có lý do → API: Đang làm + bình luận lý do', rv?.task?.columnName === 'Đang làm' && JSON.stringify(rv?.comments ?? []).includes('Thiếu kiểm thử'), rv?.task?.columnName);

  // ── Bấm dòng / Tạo công việc ──
  await clickAt(row(C.deploy));
  await br.sleep(800);
  ok('bấm dòng → hộp thoại chi tiết việc (?task=)', await br.evalJs(`location.search.includes('task=${T.deploy}') && !!document.querySelector('[role="dialog"]')`));
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.sleep(600);
  ok('đóng hộp thoại → bỏ ?task', await br.evalJs(`!location.search.includes('task=')`));
  await clickAt(q('list-create-task'));
  await br.sleep(800);
  ok('Tạo công việc → hộp thoại tạo việc', await br.evalJs(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').innerText.includes('Cần làm')`));
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.sleep(500);

  // ── Trống ──
  await setSearch('khong-co-viec-nao-xyz');
  await br.sleep(300);
  ok('trống: "Không tìm thấy công việc" + Xoá bộ lọc', await br.evalJs(`${q('task-list-empty')}?.innerText.includes('Không tìm thấy công việc') && !!${q('task-list-empty')}.querySelector('button')`));
  ok('trống (máy tính): vẫn có hàng tiêu đề bảng + chân "Hiển thị 0 / 26 công việc"', await br.evalJs(`[...${q('task-list')}.querySelectorAll('thead th')].some((th) => th.offsetParent && th.innerText.toLowerCase().includes('người làm'))
    && ${q('task-list-count')}?.innerText.trim() === 'Hiển thị 0 / 26 công việc'`), await br.evalJs(`${q('task-list-count')}?.innerText`));
  await br.shot(`${SHOTS}/5-danh-sach-trong.png`);
  await clickAt(`${q('task-list-empty')}.querySelector('button')`);
  ok('bấm Xoá bộ lọc trong khung trống → có lại dữ liệu', (await rows()).length > 0);

  // ── Theme tối ──
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(URL_TASKS, 3500);
  ok('theme tối: html.dark + danh sách', await br.evalJs(`document.documentElement.classList.contains('dark') && !!${q('task-table')}`));
  await br.shot(`${SHOTS}/3-may-tinh-toi.png`);

  // ── Điện thoại 390×844 ──
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await br.go(URL_TASKS, 3500);
  ok('điện thoại: thẻ nhiều dòng, bảng ẩn', await br.evalJs(`${q('task-cards')}.offsetParent !== null && ${q('task-table')}.closest('div.hidden') !== null
    && getComputedStyle(${q('task-table')}.closest('div.hidden')).display === 'none'`));
  ok('điện thoại: không cuộn ngang', await noHScroll(), await br.evalJs(`[document.documentElement.scrollWidth, window.innerWidth]`));
  ok('điện thoại: nhóm Xong thu gọn, thẻ việc có menu trạng thái', await br.evalJs(`!document.querySelector('[data-testid="task-cards"] [data-task="${await codeOf(done[0])}"]')
    && !!document.querySelector('[data-testid="task-cards"] [data-task="${C.overdue}"] [data-testid="task-status-menu"]')`));
  await br.shot(`${SHOTS}/4-dien-thoai-sang.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(URL_TASKS, 3500);
  ok('điện thoại tối: không cuộn ngang', await noHScroll());
  await br.shot(`${SHOTS}/4b-dien-thoai-toi.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // ── Đang tải / lỗi tải (chặn request danh sách việc bằng CDP Fetch) ──
  let mode: 'hold' | 'fail' = 'hold';
  const held: string[] = [];
  br.on('Fetch.requestPaused', (p: any) => {
    if (mode === 'hold') held.push(p.requestId);
    else void br.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
      body: Buffer.from(JSON.stringify({ title: 'Lỗi thử' })).toString('base64') });
  });
  await br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/${P}/tasks`, requestStage: 'Request' }] });
  await br.go(URL_TASKS, 2500);
  ok('đang tải: dòng skeleton theo cột', await br.evalJs(`document.querySelectorAll('[data-testid="task-row-skeleton"]').length > 0 && !!${q('task-list-filters')}`));
  await br.shot(`${SHOTS}/6-dang-tai.png`);
  mode = 'fail';
  for (const id of held.splice(0)) await br.send('Fetch.fulfillRequest', { requestId: id, responseCode: 500, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    body: Buffer.from('{}').toString('base64') });
  await br.sleep(3500);
  ok('lỗi tải: "Không tải được công việc" + chỉ nút Thử lại', await br.evalJs(`${q('task-list-error')}?.innerText.includes('Không tải được công việc')
    && ${q('task-list-error')}.querySelectorAll('button').length === 1 && ${q('task-list-error')}.querySelector('button').innerText.includes('Thử lại')`));
  await br.shot(`${SHOTS}/7-loi-tai.png`);
  await br.send('Fetch.disable');
  await clickAt(`${q('task-list-error')}.querySelector('button')`);
  await br.sleep(1500);
  ok('Thử lại → có dữ liệu', (await rows()).length > 0 && await br.evalJs(`!${q('task-list-error')}`));

  // ── Chỉ xem: người thấy dự án nhờ phòng ban ──
  ok('đăng nhập UI người xem phòng ban', (await br.login(Viewer.user, PW)) === 200);
  await br.go(URL_TASKS, 3500);
  ok('chỉ xem: nhớ chế độ Danh sách theo trình duyệt', await br.evalJs(`!!${q('task-list')}`));
  ok('chỉ xem: không nút Tạo công việc, trạng thái là nhãn tĩnh', await br.evalJs(`!${q('list-create-task')} && !${q('task-status-menu')}
    && document.querySelectorAll('[data-testid="task-table"] [data-testid="task-status-static"]').length === 6`));
  await br.shot(`${SHOTS}/8-may-tinh-chi-xem.png`);
  await clickAt(row(C.deploy));
  await br.sleep(800);
  ok('chỉ xem: bấm dòng vẫn mở chi tiết', await br.evalJs(`location.search.includes('task=${T.deploy}') && !!document.querySelector('[role="dialog"]')`));
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.sleep(400);
  await clickAt(q('view-board'));
  await br.go(URL_TASKS, 3000);
  ok('chuyển về Cột → kanban như cũ, tải lại vẫn Cột', await br.evalJs(`!!${q('col-Cần làm')} && !${q('task-list')}`));
  const errs = br.errors.filter((e) => !/negotiat|signalr|hub|502|WebSocket|500|Lỗi thử|Failed to load resource/i.test(e ?? ''));
  ok('không lỗi console (bỏ SignalR, lỗi 500 cố ý)', errs.length === 0, errs);
} finally {
  br.close();
}
console.log(`\nẢnh: ${SHOTS}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
