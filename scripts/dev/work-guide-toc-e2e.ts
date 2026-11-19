// E2E TEST-183 tab "Hướng dẫn" của dự án: 2 cột từ desktop thường (1280 / 1440 / 1920 — không còn nửa màn hình trống), cột phải dính khi cuộn
// (tóm tắt quy trình = nhãn màu theo cột + mục lục từ tiêu đề `##`, bỏ qua `##` trong khối code), bấm mục lục cuộn tới đúng tiêu đề,
// điện thoại 390 px: 1 cột, quy trình ở trên, mục lục thu gọn; theme tối; dự án chưa có hướng dẫn. Ảnh vào SHOTS_DIR (tuỳ chọn).
// CHỈ DB tạm. Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5280
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=15439;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Vite (frontend/): VITE_API_TARGET=http://localhost:5280 bunx vite --port 5175 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5280 BASE_URL=http://localhost:5175 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/work-guide-toc-e2e.ts
// Không bật Realtime → lỗi kết nối hub (negotiation) bị bỏ qua.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5280';
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WG ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Dự án WG ${stamp}`, code: `WG${stamp}` })).body;
const emp = (await json(admin, 'POST', '/api/org/employees', { code: `WM${stamp}`, fullName: 'Quản Lý WG', email: `e2e.wg.${stamp}@e2e.test`, phone: null, dateOfBirth: null,
  departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const USER = `e2e.wg.pm.${stamp}`;
const acc = (await json(admin, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee', 'manager'], userName: USER })).body;
await json(await login(USER, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const PM = await login(USER, PW);

// Hướng dẫn dài kiểu dự án TEST: 8 mục `##`, có "## giả" trong khối code (không được vào mục lục)
const SECTIONS = ['Mục đích dự án', 'Quy trình trạng thái', 'Review', 'Deploy', 'Cách viết mô tả việc', 'Khi làm một việc', 'Kiểm thử', 'Commit & báo kết quả'];
const para = (n: number) => Array.from({ length: n }, (_, i) => `- Bước ${i + 1}: làm đúng quy trình, ghi **kết quả** vào bình luận, kèm \`lệnh\` đã chạy và link tài liệu liên quan nếu có.`).join('\n');
const GUIDE = SECTIONS.map((s, i) => `## ${s}\n${para(6 + (i % 3) * 3)}${i === 2 ? '\n\n```md\n## Không phải tiêu đề (trong code)\n```' : ''}`).join('\n\n');
const A = (await json(PM, 'POST', '/api/projects', { code: `wg-${stamp}`, name: 'Hướng dẫn WG', kind: 'Internal', startOn: today, departmentIds: [dept], leadDepartmentId: dept, memberIds: [] })).body as string;
const g = await json(PM, 'PUT', `/api/projects/${A}/guide`, { workGuide: GUIDE });
const B = (await json(PM, 'POST', '/api/projects', { code: `wh-${stamp}`, name: 'Chưa hướng dẫn WG', kind: 'Internal', startOn: today, departmentIds: [dept], leadDepartmentId: dept, memberIds: [] })).body as string;
const COLS = ((await json(PM, 'GET', `/api/projects/${A}`)).body?.columns ?? []).length;
ok('dựng dữ liệu (dự án có hướng dẫn 8 mục + dự án trống)', typeof A === 'string' && typeof B === 'string' && g.status === 200, { A, B, g });

type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js)) return true; await br.sleep(250); } return false; };
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\//.test(e));
const layout = `(() => { const w = document.querySelector('[data-testid="work-guide"]'); const a = w.querySelector('aside'); const m = w.querySelector('aside ~ div, aside ~ p');
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: Math.round(b.left), r: Math.round(b.right), t: Math.round(b.top), w: Math.round(b.width) }; };
  return { guide: r(w), aside: r(a), main: r(m), vw: innerWidth, deskToc: getComputedStyle(a.lastElementChild).display, details: getComputedStyle(a.querySelector('details') ?? a).display,
    badges: a.querySelectorAll('[data-testid="column-badge"]').length, toc: [...a.querySelectorAll('[data-testid="work-guide-toc"]')].map((n) => n.querySelectorAll('a').length) }; })()`;

const br = await launch(9383, `${tmpdir()}/officehub-wg-${Date.now()}`, 1440, 900);
try {
  ok('quản lý đăng nhập web', (await br.login(USER, PW)) === 200);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]] as const) {
    await br.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await br.go(`${BASE}/projects/${A}?tab=guide`, 3000);
    ok(`${w}px: tab Hướng dẫn tải`, await until(br, `!!document.querySelector('[data-testid="work-guide-toc"] a')`));
    const L = await br.evalJs(layout) as any;
    ok(`${w}px: 2 cột — quy trình + mục lục bên phải nội dung`, L.aside.l > L.main.r && Math.abs(L.aside.t - L.main.t) < 4, L);
    ok(`${w}px: không còn nửa màn hình trống (khoảng trống phải ≤ 25%)`, (L.vw - L.guide.r) / L.vw <= 0.25 && L.main.w > L.vw * 0.45, L);
    ok(`${w}px: quy trình là nhãn màu (mỗi cột một nhãn) + mục lục 8 mục (bỏ ## trong code), bản thu gọn ẩn`, L.badges === COLS && COLS > 0 && L.toc.includes(8) && L.details === 'none' && L.deskToc !== 'none', L);
    if (w === 1440 && SHOTS) await br.shot(`${SHOTS}/after-1440.png`);
    if (w === 1920 && SHOTS) await br.shot(`${SHOTS}/after-1920.png`);
  }
  // 1440: bấm mục "Deploy" (giữa trang — mục cuối sát đáy trang không cuộn lên đỉnh được) → tiêu đề ở đầu khung nhìn (dưới header 64px), cột phải vẫn dính
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await br.go(`${BASE}/projects/${A}?tab=guide`, 3000);
  await until(br, `!!document.querySelector('[data-testid="work-guide-toc"] a')`);
  await br.evalJs(`[...document.querySelectorAll('aside [data-testid="work-guide-toc"] a')].filter((a) => a.offsetParent).find((a) => a.textContent === 'Deploy').click()`);
  await br.sleep(1500);
  const jump = await br.evalJs(`(() => { const h = [...document.querySelectorAll('[data-testid="work-guide"] h2')].find((e) => e.textContent === 'Deploy');
    return { id: h?.id, top: Math.round(h?.getBoundingClientRect().top ?? -1), y: Math.round(scrollY), hash: location.hash, aside: Math.round(document.querySelector('[data-testid="work-guide"] aside').getBoundingClientRect().top) }; })()`) as any;
  ok('bấm mục lục → cuộn tới đúng tiêu đề (không bị header che)', jump.y > 200 && jump.top >= 60 && jump.top <= 140 && jump.hash === `#${jump.id}`, jump);
  ok('cột phải dính khi cuộn (top ≈ 80px)', jump.aside >= 70 && jump.aside <= 90, jump);
  const h2 = await br.evalJs(`[...document.querySelectorAll('[data-testid="work-guide"] h2')].map((e) => e.textContent)`) as string[];
  ok('"## trong khối code" không thành tiêu đề', h2.length === 8 && !h2.some((t) => t.includes('trong code')), h2);
  if (SHOTS) await br.shot(`${SHOTS}/after-1440-scrolled.png`);
  // Theme tối
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(`${BASE}/projects/${A}?tab=guide`, 3000);
  ok('theme tối: có class dark, mục lục hiển thị', await until(br, `document.documentElement.classList.contains('dark') && !!document.querySelector('[data-testid="work-guide-toc"] a')`));
  if (SHOTS) await br.shot(`${SHOTS}/after-1440-dark.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  // Điện thoại 390 px
  await br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await br.go(`${BASE}/projects/${A}?tab=guide`, 3000);
  await until(br, `!!document.querySelector('[data-testid="work-guide"] details')`);
  const M = await br.evalJs(layout) as any;
  ok('390px: 1 cột — quy trình ở trên nội dung, mục lục thu gọn (details), bản desktop ẩn', M.aside.t < M.main.t && M.aside.l === M.main.l && M.details !== 'none' && M.deskToc === 'none', M);
  ok('390px: không tràn ngang', await br.evalJs(`document.documentElement.scrollWidth <= innerWidth + 1`));
  await br.evalJs(`document.querySelector('[data-testid="work-guide"] details').open = true`);
  await br.sleep(300);
  if (SHOTS) await br.shot(`${SHOTS}/after-390.png`);
  // Dự án chưa có hướng dẫn
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await br.go(`${BASE}/projects/${B}?tab=guide`, 3000);
  ok('dự án chưa có hướng dẫn: giữ "Chưa có hướng dẫn", không có mục lục', await until(br, `document.querySelector('[data-testid="work-guide"]')?.innerText.includes('Chưa có hướng dẫn')`)
    && !(await br.evalJs(`!!document.querySelector('[data-testid="work-guide-toc"]')`)));
  ok('không lỗi JS (bỏ qua hub chat)', jsErr(br.errors).length === 0, jsErr(br.errors));
} finally { br.close(); }
console.log(`\n${pass}/${pass + fail} pass`);
if (fail) process.exit(1);
