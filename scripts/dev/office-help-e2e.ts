// E2E TEST-129: bảng hướng dẫn "Điều khiển" trong văn phòng 3D — mặc định đóng, mở bằng nút "Hướng dẫn" cạnh thẻ tài khoản (bảng hiện
// ngay dưới nút), đóng bằng bấm lại nút / "Đã hiểu" / Esc / bấm ra ngoài; phím H / ? bật tắt khi không gõ, gõ H trong ô nhập không mở;
// điện thoại 390×844: nút ≥ 44 px, không chồng thẻ tên / thẻ trạng thái / bản đồ nhỏ. Ảnh chụp vào SHOTS_DIR.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm (cùng cách dựng Api / Realtime / Vite như đầu `office-chat-float-e2e.ts`):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5282 BASE_URL=http://localhost:5178 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/office-help-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5282';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/office-help`;
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

// ---------- Dữ liệu: 1 nhân viên (tên dài để thử thẻ tên trên điện thoại) ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Hướng dẫn ${stamp}`, code: `HD${stamp}`.slice(0, 10) })).body;
const user = `e2e.help.${stamp}`;
{
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV7${stamp}`.slice(0, 20), fullName: 'Nguyễn Thị Hướng Dẫn Thử', email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const RECT = (sel: string) => `(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`;
const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const HELP = '[data-testid=office-help]', BTN = '[data-testid=office-help-open]';

type Page = Awaited<ReturnType<typeof launch>>;
const open = async (label: string, port: number, width: number, height: number, touch: boolean): Promise<Page> => {
  const p = await launch(port, `${tmpdir()}/office-help-${label}-${stamp}`, width, height);
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  const st = await p.login(user, PW);
  ok(`${label}: đăng nhập trình duyệt`, st === 200, st);
  await p.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`);
  await p.go(`${BASE}/office`, 5000);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me && !!document.querySelector('.office-root .status .dot.online')`)); i++) await p.sleep(500);
  await p.sleep(800);
  return p;
};
const shown = (p: Page) => p.evalJs(`!!document.querySelector('${HELP}')`);
const expanded = (p: Page) => p.evalJs(`document.querySelector('${BTN}')?.getAttribute('aria-expanded')`);
const click = async (p: Page, x: number, y: number) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
  await p.sleep(250);
};
const clickSel = async (p: Page, sel: string) => {
  const r: Rect = await p.evalJs(RECT(sel));
  await click(p, (r.left + r.right) / 2, (r.top + r.bottom) / 2);
};
const press = async (p: Page, key: string, code: string, text?: string) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text, windowsVirtualKeyCode: key === 'Escape' ? 27 : undefined });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: key === 'Escape' ? 27 : undefined });
  await p.sleep(250);
};
const pos3 = (p: Page) => p.evalJs(`(() => { const m = window.__officeScene.snapshot().me; return { x: m.x, z: m.z }; })()`);

// ---------- Máy tính 1440×900 ----------
{
  const p = await open('desktop', 9571, 1440, 900, false);
  ok('desktop: vào /office không thấy bảng hướng dẫn', !(await shown(p)));
  const btn: Rect = await p.evalJs(RECT(BTN));
  const me: Rect = await p.evalJs(RECT('.office-root .me'));
  ok('desktop: nút "Hướng dẫn" có, bên phải thẻ tên, cùng hàng', !!btn && !!me && btn.left >= me.right && btn.top < me.bottom && btn.bottom > me.top, { btn, me });
  ok('desktop: nút tròn 32 px', !!btn && Math.round(btn.width) === 32 && Math.round(btn.height) === 32, btn);
  ok('desktop: aria-label + aria-expanded=false', await p.evalJs(`document.querySelector('${BTN}').getAttribute('aria-label')`) === 'Hướng dẫn điều khiển' && await expanded(p) === 'false');
  ok('desktop: bỏ nút "?" trong cụm camera', !(await p.evalJs(`[...document.querySelectorAll('.office-root .camera button')].some((b) => b.textContent === '?')`)));

  await clickSel(p, BTN);
  ok('desktop: bấm nút → bảng hiện', await shown(p) && await expanded(p) === 'true');
  const help: Rect = await p.evalJs(RECT(HELP));
  ok('desktop: bảng ngay dưới nút', !!help && help.top >= btn.bottom && help.top - btn.bottom <= 12 && Math.abs(help.left - btn.left) <= 1, { help, btn });
  ok('desktop: bảng nổi trên khung chat (điểm dưới cùng của bảng thuộc bảng)', await p.evalJs(`(() => { const r = document.querySelector('${HELP}').getBoundingClientRect();
    return !!document.elementFromPoint(r.left + 20, r.bottom - 10)?.closest('${HELP}'); })()`));
  ok('desktop: bảng ghi phím H', await p.evalJs(`document.querySelector('${HELP}').textContent.includes('bật / tắt bảng hướng dẫn')`));
  await p.shot(`${SHOTS}/desktop-open.png`);
  const before = await pos3(p);
  await p.key('w', 400);
  const after = await pos3(p);
  ok('desktop: bảng mở vẫn đi được bằng W (không chặn phím di chuyển)', Math.hypot(after.x - before.x, after.z - before.z) > 0.1, { before, after });
  ok('desktop: W không đóng bảng', await shown(p));

  await clickSel(p, BTN);
  ok('desktop: bấm lại nút → đóng', !(await shown(p)) && await expanded(p) === 'false');

  await clickSel(p, BTN);
  await p.evalJs(`[...document.querySelectorAll('${HELP} button')].find((b) => b.textContent === 'Đã hiểu').click()`);
  await p.sleep(200);
  ok('desktop: "Đã hiểu" → đóng', !(await shown(p)));

  await clickSel(p, BTN);
  await press(p, 'Escape', 'Escape');
  ok('desktop: Esc → đóng', !(await shown(p)));

  await clickSel(p, BTN);
  await clickSel(p, `${HELP} b`);
  ok('desktop: bấm trong bảng không đóng', await shown(p));
  await click(p, 720, 600);
  ok('desktop: bấm ra ngoài (cảnh 3D) → đóng', !(await shown(p)));

  await press(p, 'h', 'KeyH', 'h');
  ok('desktop: phím H → mở', await shown(p));
  await press(p, 'h', 'KeyH', 'h');
  ok('desktop: phím H lần nữa → đóng', !(await shown(p)));
  await press(p, '?', 'Slash', '?');
  ok('desktop: phím ? → mở', await shown(p));
  await press(p, '?', 'Slash', '?');
  ok('desktop: phím ? lần nữa → đóng', !(await shown(p)));

  // Gõ H trong ô nhập (ô tạm trong HUD — cùng nhánh kiểm tra INPUT / TEXTAREA với ô chat) → không mở
  const focused = await p.evalJs(`(() => { const el = document.createElement('input'); el.id = 'tmp-help-input';
    el.style.cssText = 'position:fixed;top:400px;left:400px;z-index:99'; document.querySelector('.office-root .hud').appendChild(el);
    el.focus(); return document.activeElement === el; })()`);
  await press(p, 'h', 'KeyH', 'h');
  ok('desktop: gõ H trong ô nhập không mở bảng (chữ vẫn vào ô)', focused && !(await shown(p)) && await p.evalJs(`document.getElementById('tmp-help-input').value`) === 'h');
  await p.evalJs(`document.getElementById('tmp-help-input')?.remove()`);

  await p.go(`${BASE}/office`, 5000);
  for (let i = 0; i < 20 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me`)); i++) await p.sleep(500);
  ok('desktop: tải lại → vẫn đóng (không lưu trạng thái)', !(await shown(p)));
  ok('desktop: không lỗi console', p.errors.filter((e) => !/livekit|voice|7880|favicon/i.test(e)).length === 0, p.errors);
  p.close();
}

// ---------- Điện thoại 390×844 (cảm ứng) ----------
{
  const W = 390, H = 844;
  const p = await open('phone', 9572, W, H, true);
  ok('phone: vào /office không thấy bảng', !(await shown(p)));
  const btn: Rect = await p.evalJs(RECT(BTN));
  const me: Rect = await p.evalJs(RECT('.office-root .me'));
  const status: Rect = await p.evalJs(RECT('.office-root .status'));
  const mini: Rect = await p.evalJs(RECT('.office-root .minimap'));
  ok('phone: vùng bấm ≥ 44 px', !!btn && btn.width >= 44 && btn.height >= 44, btn);
  ok('phone: nút không che thẻ tên (nằm ngay dưới thẻ)', !overlap(btn, me) && btn.top >= me.bottom && Math.abs(btn.left - me.left) <= 1, { btn, me });
  ok('phone: nút không che thẻ trạng thái', !overlap(btn, status), { btn, status });
  ok('phone: nút không che bản đồ nhỏ', !mini || !overlap(btn, mini), { btn, mini });
  ok('phone: chỉ biểu tượng (không chữ)', (await p.evalJs(`document.querySelector('${BTN}').textContent.trim()`)) === '');
  const r = btn;
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.sleep(400);
  ok('phone: chạm nút → bảng hiện', await shown(p));
  const help: Rect = await p.evalJs(RECT(HELP));
  ok('phone: bảng dưới nút, nằm trong màn hình', !!help && help.top >= btn.bottom && help.left >= 0 && help.right <= W && help.bottom <= H, help);
  await p.shot(`${SHOTS}/phone-open.png`);
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700 }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.sleep(400);
  ok('phone: chạm ra ngoài → đóng', !(await shown(p)));
  await p.shot(`${SHOTS}/phone-closed.png`);
  p.close();
}

console.log(`\n${pass}/${pass + fail} đạt · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
