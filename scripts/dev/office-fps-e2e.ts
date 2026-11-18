// E2E TEST-176: ô FPS thật trong văn phòng 3D — hiện số, khớp xấp xỉ bộ đếm rAF độc lập trong trang, màu theo ngưỡng (≥ 50 / 30–49 / < 30),
// CPU chậm 8× → số giảm; tab ẩn (visibilitychange) → "–" rồi đo lại; bấm thu gọn còn "FPS" (thôi đo) + nhớ sau tải lại; không chồng
// thẻ trạng thái / bản đồ nhỏ / cụm camera / thẻ voice / nút chat / joystick trên máy tính 1440×900 + điện thoại 390×844. Ảnh vào SHOTS_DIR.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm (dựng Api / Realtime / Vite như đầu `office-chat-float-e2e.ts`):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5282 BASE_URL=http://localhost:5178 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/office-fps-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5282';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/office-fps`;
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

// ---------- Dữ liệu: 1 nhân viên ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `FPS ${stamp}`, code: `FP${stamp}`.slice(0, 10) })).body;
const user = `e2e.fps.${stamp}`;
{
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV8${stamp}`.slice(0, 20), fullName: 'Trần Văn Đo Khung', email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const RECT = (sel: string) => `(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`;
const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const FPS = '[data-testid=office-fps]';

type Page = Awaited<ReturnType<typeof launch>>;
const gotoOffice = async (p: Page) => {
  await p.go(`${BASE}/office`, 5000);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me && !!document.querySelector('.office-root .status .dot.online')`)); i++) await p.sleep(500);
  await p.sleep(1500);
};
const open = async (label: string, port: number, width: number, height: number, touch: boolean): Promise<Page> => {
  const p = await launch(port, `${tmpdir()}/office-fps-${label}-${stamp}`, width, height);
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  const st = await p.login(user, PW);
  ok(`${label}: đăng nhập trình duyệt`, st === 200, st);
  await p.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`);
  await gotoOffice(p);
  return p;
};
const info = (p: Page) => p.evalJs(`(() => { const el = document.querySelector('${FPS}'); if (!el) return null;
  return { text: el.textContent, cls: el.className, num: Number(el.querySelector('b')?.textContent), pressed: el.getAttribute('aria-pressed') }; })()`);
/** FPS đo độc lập trong trang bằng rAF riêng trong 2 giây — để đối chiếu với số trên HUD. */
const rafFps = (p: Page) => p.evalJs(`new Promise((res) => { let n = 0; const t0 = performance.now();
  const f = () => { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(f); else res(n * 1000 / (performance.now() - t0)); }; requestAnimationFrame(f); })`);
const toneOf = (n: number) => (n >= 50 ? 'good' : n >= 30 ? 'mid' : 'bad');
const click = async (p: Page, sel: string) => {
  const r: Rect = await p.evalJs(RECT(sel));
  const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await p.sleep(300);
};
const HUD = ['.office-root .status', '.office-root .minimap', '.office-root .camera', '.office-root .voice', '.office-root .me', '.office-root .help-btn',
  '.office-root .chat-toggle', '.office-root .chat-panel', '.office-root .joystick', '.office-root .checkin', '.office-root .zone'];
const noOverlap = async (p: Page, label: string) => {
  const fps: Rect = await p.evalJs(RECT(FPS));
  for (const s of HUD) {
    const r: Rect | null = await p.evalJs(RECT(s));
    if (!r || !r.width) continue;
    ok(`${label}: ô FPS không chồng ${s}`, !overlap(fps, r), { fps, r });
  }
  const [w, h] = await p.evalJs('[innerWidth, innerHeight]');
  ok(`${label}: ô FPS nằm trong màn hình`, fps.left >= 0 && fps.top >= 0 && fps.right <= w && fps.bottom <= h, fps);
};
const setHidden = (p: Page, hidden: boolean) =>
  p.evalJs(`Object.defineProperty(document, 'hidden', { configurable: true, get: () => ${hidden} }); document.dispatchEvent(new Event('visibilitychange'))`);

// ---------- Máy tính 1440×900 ----------
{
  const p = await open('desktop', 9581, 1440, 900, false);
  const a = await info(p);
  ok('desktop: ô FPS hiện mặc định, dạng "N FPS"', !!a && a.pressed === 'true' && Number.isFinite(a.num) && a.num > 0 && /FPS/.test(a.text), a);
  const ref = await rafFps(p);
  const b = await info(p);
  ok('desktop: số trên HUD khớp xấp xỉ rAF đo riêng (±25%)', Math.abs(b.num - ref) <= Math.max(4, ref * 0.25), { hud: b.num, ref });
  ok('desktop: màu đúng ngưỡng', b.cls.includes(toneOf(b.num)), b);
  ok('desktop: có ms / khung', /ms/.test(b.text), b.text);
  await noOverlap(p, 'desktop');
  await p.shot(`${SHOTS}/desktop.png`);

  // CPU chậm → số giảm, màu theo ngưỡng
  await p.send('Emulation.setCPUThrottlingRate', { rate: 8 });
  await p.sleep(3000);
  const slow = await info(p);
  ok('desktop: CPU chậm 8× → FPS giảm', slow.num < b.num, { before: b.num, slow: slow.num });
  ok('desktop: CPU chậm → màu đúng ngưỡng', slow.cls.includes(toneOf(slow.num)), slow);
  await p.shot(`${SHOTS}/desktop-slow.png`);
  await p.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  await p.sleep(2000);

  // Tab ẩn → không hiện số cũ; hiện lại → đo lại
  await setHidden(p, true);
  await p.sleep(100);
  const hid = await info(p);
  ok('desktop: tab ẩn → "–" (không hiện số sai)', hid.text.startsWith('–'), hid);
  await setHidden(p, false);
  await p.sleep(1500);
  const back = await info(p);
  ok('desktop: quay lại → đo lại có số', Number.isFinite(back.num) && back.num > 0, back);

  // Thu gọn + nhớ sau tải lại
  await click(p, FPS);
  const col = await info(p);
  ok('desktop: bấm → thu gọn còn "FPS", aria-pressed=false', col.text === 'FPS' && col.pressed === 'false' && col.cls.includes('collapsed'), col);
  ok('desktop: thu gọn → engine thôi đo (onFps rỗng)', await p.evalJs('window.__officeScene.onFps === undefined'));
  await p.shot(`${SHOTS}/desktop-collapsed.png`);
  await gotoOffice(p);
  const col2 = await info(p);
  ok('desktop: tải lại vẫn thu gọn', col2?.text === 'FPS', col2);
  await click(p, FPS);
  await p.sleep(1200);
  const re = await info(p);
  ok('desktop: bấm lại → hiện số', re.pressed === 'true' && Number.isFinite(re.num) && re.num > 0, re);
  await gotoOffice(p);
  ok('desktop: tải lại vẫn hiện', (await info(p))?.pressed === 'true');
  ok('desktop: không lỗi console', p.errors.length === 0, p.errors);
  p.close();
}

// ---------- Điện thoại 390×844 (cảm ứng) ----------
{
  const p = await open('mobile', 9582, 390, 844, true);
  await p.sleep(1000);
  const a = await info(p);
  ok('mobile: ô FPS hiện', !!a && Number.isFinite(a.num) && a.num > 0, a);
  ok('mobile: không hiện ms (gọn)', await p.evalJs(`(() => { const s = document.querySelector('${FPS} small'); return !s || getComputedStyle(s).display === 'none'; })()`));
  const r: Rect = await p.evalJs(RECT(FPS));
  ok('mobile: cỡ nhỏ (cao ≤ 24 px)', r.height <= 24, r);
  await noOverlap(p, 'mobile');
  await p.shot(`${SHOTS}/mobile.png`);
  ok('mobile: không lỗi console', p.errors.length === 0, p.errors);
  p.close();
}

console.log(`\n${pass} đạt, ${fail} lỗi — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
