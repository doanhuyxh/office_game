// E2E TEST-133 hộp thoại việc — ô "Thêm việc phải xong trước" kiểu tìm rồi chọn + TablePagination gọn trong khung hẹp.
// Dữ liệu: 1 dự án 4 cột mặc định, 41 việc (10 Xong, 12 Cần làm, 12 Đang làm, 6 Chờ review, việc đích). Kiểm tra: không thanh phân trang trong ô,
// mặc định ẩn việc đã Xong, Đang làm → Cần làm → Chờ review (mới nhất trước), 15 dòng + "Xem thêm", gõ mã ra đúng việc (khớp mã trước khớp tên),
// "Hiện cả việc đã xong" (gạch ngang, cuối danh sách), bấm một dòng → chỉ dòng đó xoay (mạng chậm giả lập) rồi lên "Phải chờ việc",
// ↑ ↓ Enter, Esc chỉ xoá ô tìm (hộp thoại không đóng), vùng bấm ≥ 40 px (44 px điện thoại 390), không tràn ngang, theme tối;
// TablePagination ở /notifications: máy tính bản đầy đủ, khung < 420 px (điện thoại / khung bị thu hẹp) một dòng không "Mỗi trang". Ảnh vào SHOTS_DIR.
// CHỈ DB tạm. Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5281
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=55439;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Vite (frontend/): VITE_API_TARGET=http://localhost:5281 bunx vite --port 5176 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5281 BASE_URL=http://localhost:5176 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-dependency-picker-e2e.ts
// Không bật Realtime → lỗi kết nối hub bị bỏ qua.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5281';
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
const SHOTS = process.env.SHOTS_DIR;

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV DP ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Phụ thuộc ${stamp}`, code: `DP${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW), user };
};
const PM = await mkEmp(`DM${stamp}`, 'Quản Lý DP', `e2e.dp.pm.${stamp}`, ['employee', 'manager']);
const Dev = await mkEmp(`DD${stamp}`, 'Dev DP', `e2e.dp.dev.${stamp}`, ['employee']);
const PCODE = `dp-${stamp}`;
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: PCODE, name: 'Phụ thuộc DP', kind: 'Internal', startOn: today,
  departmentIds: [dept], leadDepartmentId: dept, memberIds: [Dev.e.id] })).body as string;
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as { id: string; name: string; isDone: boolean }[];
const col = (n: string) => cols.find((c) => c.name === n)!.id;
// Thứ tự tạo = số việc: 1–10 Xong, 11–22 Cần làm (12 = "Sửa đăng nhập"), 23–34 Đang làm, 35–40 Chờ review, 41 = việc đích
const plan: [string, number][] = [['Xong', 10], ['Cần làm', 12], ['Đang làm', 12], ['Chờ review', 6]];
const ids: Record<number, string> = {};
let n = 0, created = 0;
for (const [c, count] of plan) for (let i = 0; i < count; i++) {
  n++;
  const title = n === 12 ? 'Sửa lỗi đăng nhập bằng mã một lần cho tài khoản quản trị có tên rất dài để thử cắt hai dòng'
    : n === 5 ? 'Việc cũ đã Xong số 5' : `${c} việc số ${n}`;
  // Cột Xong cần người duyệt → không tạo thẳng vào được: tạo ở Chờ review rồi quản lý dự án chuyển sang Xong
  const r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, columnId: col(c === 'Xong' ? 'Chờ review' : c), assigneeEmployeeId: Dev.e.id });
  if (r.status === 200 || r.status === 201) {
    ids[n] = r.body as string;
    if (c !== 'Xong' || (await json(PM.cookie, 'POST', `/api/projects/tasks/${ids[n]}/move`, { columnId: col('Xong') })).status === 204) created++;
  }
}
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc đích DP', assigneeEmployeeId: Dev.e.id })).body as string;
const all = (await json(PM.cookie, 'GET', `/api/projects/${P}/tasks`)).body as { id: string; code: string; columnName: string; done: boolean }[];
const CODE = all.find((t) => t.id === T)!.code.replace(/-\d+$/, '');
ok('dựng dữ liệu: 41 việc (10 Xong, 12 Cần làm, 12 Đang làm, 6 Chờ review)', created === 40 && all.length === 41 && all.filter((t) => t.done).length === 10,
  { created, len: all.length, cols: cols.map((c) => c.name) });

type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js)) return true; await br.sleep(250); } return false; };
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\//.test(e));
const rows = `[...document.querySelectorAll('[data-testid="dependency-candidate"]')]`;
const rowInfo = `${rows}.map(b => ({ code: b.dataset.code, col: b.querySelector('span.truncate')?.textContent, done: !!b.querySelector('.line-through'), h: Math.round(b.getBoundingClientRect().height) }))`;
const typeQ = (v: string) => `(() => { const i = document.querySelector('[data-testid="dependency-picker"] input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); return true; })()`;
const key = async (br: Br, k: string, code = k) => {
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 }[k] });
  await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27 }[k] });
};
const depCount = `(() => { const m = document.querySelector('[data-testid="task-dependencies"]')?.innerText.match(/Phải chờ việc \\((\\d+)\\)/); return m ? Number(m[1]) : -1; })()`;

const br = await launch(9391, `${tmpdir()}/officehub-dp-${Date.now()}`, 1440, 900);
try {
  ok('quản lý đăng nhập web', (await br.login(PM.user, PW)) === 200);
  await br.go(`${BASE}/projects/${P}?task=${T}`, 3500);
  ok('hộp thoại việc mở, có ô "Thêm việc phải xong trước"', await until(br, `!!document.querySelector('[data-testid="dependency-picker"]') && ${rows}.length > 0`));
  await br.evalJs(`document.querySelector('[data-testid="dependency-picker"]').scrollIntoView({ block: 'center' })`);
  ok('không còn thanh phân trang bảng trong ô chọn', await br.evalJs(`!document.querySelector('[data-testid="task-dependencies"] [data-testid="pagination"]') && !document.querySelector('[data-testid="task-dependencies"] [aria-label="Số dòng mỗi trang"]')`));
  let info = await br.evalJs(rowInfo) as { code: string; col: string; done: boolean; h: number }[];
  ok('hiện 15 dòng đầu', info.length === 15, info.length);
  ok('mặc định ẩn việc đã Xong', info.every((r) => !r.done && r.col !== 'Xong'), info);
  ok('Đang làm đứng đầu (12 việc), rồi Cần làm', info.slice(0, 12).every((r) => r.col === 'Đang làm') && info.slice(12).every((r) => r.col === 'Cần làm'), info.map((r) => r.col));
  ok('trong cột: việc mới nhất trước (Đang làm 34 → 23)', info[0].code === `${CODE}-34` && info[11].code === `${CODE}-23`, info.map((r) => r.code));
  ok('mỗi dòng là một nút (role=option), vùng bấm ≥ 40 px, không còn nút "+ Thêm" riêng', info.every((r) => r.h >= 40)
    && await br.evalJs(`${rows}.every(b => b.tagName === 'BUTTON' && b.getAttribute('role') === 'option') && ![...document.querySelectorAll('[data-testid="task-dependencies"] button')].some(b => b.textContent.trim() === 'Thêm')`), info.map((r) => r.h));
  ok('danh sách role=listbox, cuộn trong khung max-h-72 (≤ 288 px)', await br.evalJs(`(() => { const l = document.querySelector('[data-testid="dependency-list"]'); return l.getAttribute('role') === 'listbox' && l.getBoundingClientRect().height <= 289 && l.scrollHeight > l.clientHeight; })()`));
  const more = await br.evalJs(`document.querySelector('[data-testid="dependency-more"]')?.textContent ?? ''`) as string;
  ok('nút "Xem thêm 15 việc (15 còn lại)"', more.includes('Xem thêm 15 việc') && more.includes('15 còn lại'), more);
  const doneToggle = await br.evalJs(`document.querySelector('[data-testid="dependency-show-done"]').closest('label').textContent`) as string;
  ok('công tắc "Hiện cả việc đã xong (10)" cuối danh sách', doneToggle.includes('Hiện cả việc đã xong (10)'), doneToggle);
  if (SHOTS) await br.shot(`${SHOTS}/1-picker-default.png`);

  await br.evalJs(`document.querySelector('[data-testid="dependency-more"]').click()`);
  ok('"Xem thêm" tải thêm 15 → 30 dòng (Chờ review cuối, không còn nút)', await until(br, `${rows}.length === 30`)
    && await br.evalJs(`!document.querySelector('[data-testid="dependency-more"]')`)
    && (await br.evalJs(rowInfo) as any[]).slice(24).every((r) => r.col === 'Chờ review'));

  // Tìm theo mã: khớp đúng mã trước, không dấu theo tên
  await br.evalJs(typeQ(`${CODE.toLowerCase()}-12`));
  await br.sleep(300);
  info = await br.evalJs(rowInfo) as any[];
  ok(`gõ "${CODE.toLowerCase()}-12" → ${CODE}-12 đứng đầu (không phân biệt hoa thường)`, info[0]?.code === `${CODE}-12`, info.map((r) => r.code));
  const clamp = await br.evalJs(`(() => { const t = ${rows}[0].querySelector('.line-clamp-2'); return { clamp: getComputedStyle(t).webkitLineClamp, title: ${rows}[0].title }; })()`) as any;
  ok('tên dài: line-clamp-2, title đủ tên', clamp.clamp === '2' && clamp.title.includes('rất dài để thử cắt hai dòng'), clamp);
  await br.evalJs(typeQ('dang nhap'));
  await br.sleep(300);
  info = await br.evalJs(rowInfo) as any[];
  ok('gõ không dấu "dang nhap" → ra việc "Sửa lỗi đăng nhập…"', info.length === 1 && info[0].code === `${CODE}-12`, info);
  await br.evalJs(typeQ('Việc cũ đã Xong'));
  await br.sleep(300);
  const empty = await br.evalJs(`document.querySelector('[data-testid="dependency-empty"]')?.textContent ?? ''`) as string;
  ok('chỉ khớp việc đã Xong (đang ẩn) → "Không có việc phù hợp" + gợi ý bật "Hiện cả việc đã xong"', empty.includes('Không có việc phù hợp') && empty.includes('Hiện cả việc đã xong'), empty);
  await br.evalJs(`document.querySelector('[data-testid="dependency-show-done"]').click()`);
  ok('bật "Hiện cả việc đã xong" → thấy việc đã Xong, gạch ngang', await until(br, `${rows}.length === 1 && !!${rows}[0].querySelector('.line-through')`));
  await br.evalJs(typeQ(''));
  await br.sleep(300);
  await br.evalJs(`document.querySelector('[data-testid="dependency-more"]').click()`);
  await br.evalJs(`document.querySelector('[data-testid="dependency-more"]').click()`);
  info = await br.evalJs(rowInfo) as any[];
  ok('bật xong: đủ 40 việc, việc Xong đứng cuối (10 dòng gạch ngang)', info.length === 40 && info.slice(30).every((r) => r.done) && info.slice(0, 30).every((r) => !r.done), info.map((r) => r.col));
  if (SHOTS) await br.shot(`${SHOTS}/2-picker-show-done.png`);
  await br.evalJs(`document.querySelector('[data-testid="dependency-show-done"]').click()`);

  // Bàn phím: ↓ ↓ Enter → thêm dòng thứ 3; ↑ vòng lên cuối
  await br.evalJs(typeQ(''));
  await br.sleep(300);
  const third = (await br.evalJs(rowInfo) as any[])[2].code as string;
  await key(br, 'ArrowDown'); await key(br, 'ArrowDown');
  const act = await br.evalJs(`(() => { const i = document.querySelector('[data-testid="dependency-picker"] input'); const id = i.getAttribute('aria-activedescendant'); const el = document.getElementById(id);
    return { code: el?.dataset.code, sel: el?.getAttribute('aria-selected'), role: i.getAttribute('role') }; })()`) as any;
  ok('↓ ↓ → dòng thứ 3 được chọn (aria-activedescendant, aria-selected)', act.code === third && act.sel === 'true' && act.role === 'combobox', { act, third });
  await key(br, 'Enter');
  ok('Enter thêm việc → "Phải chờ việc (1)", dòng biến khỏi gợi ý, hộp thoại vẫn mở', await until(br, `${depCount} === 1`)
    && await until(br, `!${rows}.some(b => b.dataset.code === ${JSON.stringify(third)})`) && await br.evalJs(`!!document.querySelector('[role=dialog]')`));
  ok('… focus về ô tìm để thêm tiếp', await until(br, `document.activeElement === document.querySelector('[data-testid="dependency-picker"] input')`, 3000));

  // Esc: chỉ xoá ô tìm, hộp thoại không đóng
  await br.evalJs(typeQ('dang lam'));
  await br.sleep(200);
  await key(br, 'Escape');
  await br.sleep(400);
  ok('Esc khi ô tìm có chữ → xoá ô tìm, hộp thoại vẫn mở', await br.evalJs(`document.querySelector('[data-testid="dependency-picker"] input').value === '' && !!document.querySelector('[role=dialog]')`));

  // Mạng chậm → bấm một dòng: chỉ dòng đó xoay, các dòng khác khoá
  await br.send('Network.enable');
  await br.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
  const target = (await br.evalJs(rowInfo) as any[])[0].code as string;
  await br.evalJs(`${rows}[0].click()`);
  await br.sleep(400);
  const spin = await br.evalJs(`(() => { const r = ${rows}; return { loading: r.filter(b => b.dataset.loading).map(b => b.dataset.code), spinner: !!r[0].querySelector('svg.animate-spin'),
    disabled: r.filter(b => b.disabled).length, total: r.length, removeBusy: !!document.querySelector('[data-testid="task-dependencies"] [aria-label^="Bỏ chờ"][data-loading]') }; })()`) as any;
  ok('bấm dòng (mạng chậm) → chỉ dòng đó xoay (data-loading + vòng xoay), các dòng khác khoá', spin.loading.length === 1 && spin.loading[0] === target && spin.spinner
    && spin.disabled === spin.total && !spin.removeBusy, spin);
  if (SHOTS) await br.shot(`${SHOTS}/3-row-loading.png`);
  await br.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok('xong → việc lên "Phải chờ việc (2)", hết xoay', await until(br, `${depCount} === 2`) && await until(br, `!${rows}.some(b => b.dataset.loading)`));
  // Hỏi qua phiên của trình duyệt (đăng nhập web cấp phiên mới)
  const det = await br.evalJs(`fetch('/api/projects/tasks/${T}').then(async r => ({ status: r.status, body: await r.json() }))`) as { status: number; body: any };
  ok('API: việc đích phải chờ đúng 2 việc đã chọn', (det.body?.dependsOn ?? []).map((d: any) => d.code).sort().join() === [third, target].sort().join(),
    { status: det.status, deps: det.body?.dependsOn, want: [third, target] });

  // Bỏ chờ: nút X xoay riêng
  await br.send('Network.emulateNetworkConditions', { offline: false, latency: 1500, downloadThroughput: -1, uploadThroughput: -1 });
  await br.evalJs(`document.querySelector('[data-testid="task-dependencies"] [aria-label="Bỏ chờ ${target}"]').click()`);
  await br.sleep(400);
  const rm = await br.evalJs(`[...document.querySelectorAll('[data-testid="task-dependencies"] [aria-label^="Bỏ chờ"]')].map(b => ({ l: b.getAttribute('aria-label'), loading: !!b.dataset.loading, dis: b.disabled }))`) as any[];
  ok('bỏ chờ (mạng chậm) → chỉ nút X của việc đó xoay', rm.length === 2 && rm.filter((x) => x.loading).length === 1 && rm.find((x) => x.loading)?.l === `Bỏ chờ ${target}`, rm);
  await br.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  ok('… bỏ xong → "Phải chờ việc (1)", việc trở lại gợi ý', await until(br, `${depCount} === 1`) && await until(br, `${rows}.some(b => b.dataset.code === ${JSON.stringify(target)})`));

  // Theme tối
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(`${BASE}/projects/${P}?task=${T}`, 3500);
  await until(br, `${rows}.length > 0`);
  await br.evalJs(`document.querySelector('[data-testid="dependency-picker"]').scrollIntoView({ block: 'center' })`);
  await br.evalJs(`${rows}[1].dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))`);
  const dark = await br.evalJs(`(() => { const r = ${rows}[0]; const cs = getComputedStyle(r); return { dark: document.documentElement.classList.contains('dark'), color: cs.color, bg: cs.backgroundColor }; })()`) as any;
  ok('theme tối: dòng chọn có nền accent, chữ sáng', dark.dark && dark.bg !== 'rgba(0, 0, 0, 0)' && /rgb|oklch|lab/.test(dark.color), dark);
  if (SHOTS) await br.shot(`${SHOTS}/4-picker-dark.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  ok('không lỗi JS trên máy tính', jsErr(br.errors).length === 0, jsErr(br.errors));
} finally { br.close(); }

// ── Điện thoại 390 ──
const ph = await launch(9392, `${tmpdir()}/officehub-dp-ph-${Date.now()}`, 390, 844);
try {
  await ph.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok('điện thoại: đăng nhập', (await ph.login(PM.user, PW)) === 200);
  await ph.go(`${BASE}/projects/${P}?task=${T}`, 3500);
  ok('điện thoại: hộp thoại việc có ô gợi ý', await until(ph, `${rows}.length > 0`));
  await ph.evalJs(`document.querySelector('[data-testid="dependency-picker"]').scrollIntoView({ block: 'center' })`);
  const m = await ph.evalJs(`(() => { const p = document.querySelector('[data-testid="dependency-picker"]').getBoundingClientRect(); const r = ${rows};
    return { pw: Math.round(p.width), minH: Math.min(...r.map(b => b.getBoundingClientRect().height)), over: r.some(b => b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > innerWidth),
      docOver: document.documentElement.scrollWidth > innerWidth }; })()`) as any;
  ok('điện thoại 390: dòng ≥ 44 px, không tràn ngang', m.minH >= 44 && !m.over && !m.docOver, m);
  if (SHOTS) await ph.shot(`${SHOTS}/5-picker-phone.png`);
  ok('không lỗi JS trên điện thoại', jsErr(ph.errors).length === 0, jsErr(ph.errors));

  // TablePagination tự gọn khi khung < 420 px — /notifications của Dev (41 thông báo giao việc)
  ok('điện thoại: Dev đăng nhập', (await ph.login(Dev.user, PW)) === 200);
  await ph.go(`${BASE}/notifications`, 3500);
  ok('trang thông báo có thanh phân trang', await until(ph, `!!document.querySelector('[data-testid="pagination"]')`));
  const pp = await ph.evalJs(`(() => { const p = document.querySelector('[data-testid="pagination"]'); const vis = (sel) => [...p.querySelectorAll(sel)].some(e => e.offsetParent !== null);
    return { h: Math.round(p.getBoundingClientRect().height), text: p.innerText.replace(/\\s+/g, ' ').trim(), select: vis('[aria-label="Số dòng mỗi trang"]'),
      first: vis('[aria-label="Trang đầu"]'), next: vis('[aria-label="Trang sau"]'), over: p.scrollWidth > p.clientWidth + 1 }; })()`) as any;
  ok('khung < 420 px: một dòng (< 50 px), "1–… / N" + "‹ 1 / M ›", không "Mỗi trang", không nút đầu / cuối', pp.h < 50 && /^1–\d+ \/ \d+ 1 \/ \d+$/.test(pp.text)
    && !pp.select && !pp.first && pp.next && !pp.over, pp);
  if (SHOTS) await ph.shot(`${SHOTS}/6-pagination-phone.png`);
} finally { ph.close(); }

const dk = await launch(9393, `${tmpdir()}/officehub-dp-dk-${Date.now()}`, 1440, 900);
try {
  ok('máy tính: Dev đăng nhập', (await dk.login(Dev.user, PW)) === 200);
  await dk.go(`${BASE}/notifications`, 3500);
  await until(dk, `!!document.querySelector('[data-testid="pagination"]')`);
  const full = await dk.evalJs(`(() => { const p = document.querySelector('[data-testid="pagination"]'); const vis = (sel) => [...p.querySelectorAll(sel)].some(e => e.offsetParent !== null);
    return { text: p.innerText.replace(/\\s+/g, ' ').trim(), select: vis('[aria-label="Số dòng mỗi trang"]'), first: vis('[aria-label="Trang đầu"]'), last: vis('[aria-label="Trang cuối"]') }; })()`) as any;
  ok('máy tính: bản đầy đủ giữ nguyên ("… thông báo", Mỗi trang, Trang x/y, nút đầu / cuối)', full.select && full.first && full.last && /thông báo/.test(full.text) && /Trang 1\/\d+/.test(full.text), full);
  // Thu hẹp khung chứa xuống 360 px → tự chuyển gọn
  const narrow = await dk.evalJs(`(async () => { const p = document.querySelector('[data-testid="pagination"]'); p.style.width = '360px'; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const vis = (sel) => [...p.querySelectorAll(sel)].some(e => e.offsetParent !== null);
    return { h: Math.round(p.getBoundingClientRect().height), select: vis('[aria-label="Số dòng mỗi trang"]'), first: vis('[aria-label="Trang đầu"]'), text: p.innerText.replace(/\\s+/g, ' ').trim() }; })()`) as any;
  ok('máy tính, khung bị thu còn 360 px → tự gọn một dòng', narrow.h < 50 && !narrow.select && !narrow.first && /1 \/ \d+$/.test(narrow.text), narrow);
  await dk.evalJs(`document.querySelector('[aria-label="Trang sau"]').click()`);
  ok('bản gọn: "›" sang trang 2 ("21–40 / …", "2 / M")', await until(dk, `/^\\d+–\\d+ \\/ \\d+ 2 \\/ \\d+$/.test(document.querySelector('[data-testid="pagination"]').innerText.replace(/\\s+/g, ' ').trim())`));
  if (SHOTS) await dk.shot(`${SHOTS}/7-pagination-narrow.png`);
} finally { dk.close(); }

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
