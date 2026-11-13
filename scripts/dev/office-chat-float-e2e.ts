// E2E TEST-90: ô chat văn phòng 3D — chế độ ghim góc / nổi, kéo di chuyển (hàng tab) + kéo đổi kích thước (tay nắm góc dưới phải),
// luôn trong màn hình (kéo ra 4 góc, thu nhỏ cửa sổ, xoay điện thoại, giả lập bàn phím ảo qua visualViewport), nhớ chế độ / vị trí /
// kích thước sau khi tải lại, không làm nhân vật đi / camera xoay, joystick + nút zoom vẫn dùng được khi bảng nổi, thanh "Họp với AI"
// trong bảng nổi ở phòng họp, tin dài đọc được. Chrome headless máy tính 1440×900 (chuột) + điện thoại 390×844 (cảm ứng giả lập).
// Dùng hook dev `window.__officeScene` (chỉ có khi chạy Vite dev). Ảnh chụp vào SHOTS_DIR.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-chatfloat-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55498:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5282
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55498;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng>
//        Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1
//        Seed__AdminEmail=cf-admin@officehub-e2e.vn Seed__AdminPassword=Cf-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5292 Realtime__ApiBaseUrl=http://localhost:5282 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Vite (từ frontend/): VITE_API_TARGET=http://localhost:5282 VITE_RT_TARGET=http://localhost:5292 bunx vite --port 5178 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5282 BASE_URL=http://localhost:5178 ADMIN_LOGIN=cf-admin@officehub-e2e.vn \
//     ADMIN_PASSWORD=Cf-Admin-2026 SHOTS_DIR=/tmp/chat-float bun scripts/dev/office-chat-float-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5282';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/chat-float`;
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
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Chat nổi ${stamp}`, code: `CF${stamp}`.slice(0, 10) })).body;
const user = `e2e.cf.${stamp}`;
{
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV8${stamp}`.slice(0, 20), fullName: 'Người Thử Chat', email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
const RECT = (sel: string) => `(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; })()`;
const CHAT = '[data-testid=office-chat]';
const inside = (r: Rect, W: number, H: number, top = 0) => r.left >= -0.5 && r.top >= top - 0.5 && r.right <= W + 0.5 && r.bottom <= H + 0.5;
const overlap = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const near = (a: number, b: number, d = 2) => Math.abs(a - b) <= d;

type Page = Awaited<ReturnType<typeof launch>>;
const open = async (label: string, port: number, width: number, height: number, touch: boolean): Promise<Page> => {
  const p = await launch(port, `${tmpdir()}/chat-float-${label}-${stamp}`, width, height);
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  const st = await p.login(user, PW);
  ok(`${label}: đăng nhập trình duyệt`, st === 200, st);
  await p.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`);
  await p.go(`${BASE}/office`, 5000);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me`)); i++) await p.sleep(500);
  await p.evalJs(`[...document.querySelectorAll('button')].find((b) => b.textContent === 'Đã hiểu')?.click()`);
  return p;
};
const mouseDrag = async (p: Page, x0: number, y0: number, x1: number, y1: number) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 8; i++) await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8, button: 'left', buttons: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x1, y: y1, button: 'left', buttons: 0, clickCount: 1 });
  await p.sleep(150);
};
const touchDrag = async (p: Page, x0: number, y0: number, x1: number, y1: number, holdMs = 0) => {
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let i = 1; i <= 8; i++) await p.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + (x1 - x0) * i / 8, y: y0 + (y1 - y0) * i / 8 }] });
  if (holdMs) await p.sleep(holdMs);
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.sleep(150);
};
const tap = async (p: Page, sel: string) => {
  const r: Rect = await p.evalJs(RECT(sel));
  const x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await p.sleep(300);
};
/** Điểm trống trên hàng tab (giữa tab cuối và nút ⤡) — chỗ bắt đầu kéo. */
const GRIP = `(() => { const t = document.querySelector('${CHAT} .tabs'), r = t.getBoundingClientRect(), e = t.querySelector('.tabs-end').getBoundingClientRect();
  const last = [...t.children].filter((c) => c.tagName === 'BUTTON').at(-1).getBoundingClientRect(); return { x: (last.right + e.left) / 2, y: (r.top + r.bottom) / 2 }; })()`;
const state = (p: Page) => p.evalJs(`(() => { const s = window.__officeScene, m = s.snapshot().me; return { x: m.x, z: m.z, az: s.azimuth, dist: s.distance, cam: s.camera.position.toArray() }; })()`);
const sameState = (a: any, b: any) => near(a.x, b.x, 0.01) && near(a.z, b.z, 0.01) && near(a.az, b.az, 0.001) && near(a.dist, b.dist, 0.001);

// ---------- Máy tính 1440×900 (chuột) ----------
{
  const W = 1440, H = 900;
  const p = await open('desktop', 9561, W, H, false);
  ok('desktop: mặc định ghim góc dưới trái', await p.evalJs(`document.querySelector('${CHAT}')?.dataset.mode`) === 'docked');
  const docked: Rect = await p.evalJs(RECT(CHAT));
  ok('desktop: ghim góc như cũ (left 12, bottom 12, rộng 340)', near(docked.left, 12) && near(docked.bottom, H - 12) && near(docked.width, 340), docked);
  ok('desktop: có nút mở rộng', !!(await p.evalJs(`!!document.querySelector('[data-testid=office-chat-float]')`)));
  await p.evalJs(`document.querySelector('[data-testid=office-chat-float]').click()`);
  await p.sleep(200);
  let r: Rect = await p.evalJs(RECT(CHAT));
  ok('desktop: nổi → giữa màn hình, 480 × 440', await p.evalJs(`document.querySelector('${CHAT}').dataset.mode`) === 'floating'
    && near((r.left + r.right) / 2, W / 2) && near((r.top + r.bottom) / 2, H / 2) && near(r.width, 480) && near(r.height, 440), r);
  await p.shot(`${SHOTS}/desktop-1-floating-center.png`);

  const s0 = await state(p);
  for (const [dx, dy, name] of [[-3000, -3000, 'trên trái'], [3000, -3000, 'trên phải'], [3000, 3000, 'dưới phải'], [-3000, 3000, 'dưới trái']] as const) {
    const g = await p.evalJs(GRIP);
    await mouseDrag(p, g.x, g.y, g.x + dx, g.y + dy);
    r = await p.evalJs(RECT(CHAT));
    ok(`desktop: kéo ra góc ${name} → không lọt ra ngoài`, inside(r, W, H) && near(r.width, 480) && near(r.height, 440), r);
  }
  await p.shot(`${SHOTS}/desktop-2-corner.png`);
  ok('desktop: kéo bảng không làm nhân vật đi / camera xoay / zoom', sameState(s0, await state(p)), [s0, await state(p)]);

  // Bấm nút tab không tính là kéo
  r = await p.evalJs(RECT(CHAT));
  const tabBtn: Rect = await p.evalJs(RECT(`${CHAT} .tabs button`));
  await mouseDrag(p, tabBtn.left + 10, tabBtn.top + 5, tabBtn.left + 200, tabBtn.top - 200);
  const r2: Rect = await p.evalJs(RECT(CHAT));
  ok('desktop: nhấn-kéo trên nút tab không di chuyển bảng', near(r.left, r2.left) && near(r.top, r2.top), [r, r2]);

  // Đổi kích thước
  const handle = async () => { const h: Rect = await p.evalJs(RECT('[data-testid=office-chat-resize]')); return { x: h.right - 4, y: h.bottom - 4 }; };
  let h0 = await handle();
  await mouseDrag(p, h0.x, h0.y, h0.x - 3000, h0.y - 3000);
  r = await p.evalJs(RECT(CHAT));
  ok('desktop: kéo tay nắm nhỏ hết cỡ → 280 × 220', near(r.width, 280) && near(r.height, 220), r);
  // Đưa bảng về trên trái rồi kéo to hết cỡ
  let g = await p.evalJs(GRIP);
  await mouseDrag(p, g.x, g.y, g.x - 3000, g.y - 3000);
  h0 = await handle();
  await mouseDrag(p, h0.x, h0.y, h0.x + 5000, h0.y + 5000);
  r = await p.evalJs(RECT(CHAT));
  ok('desktop: kéo tay nắm to hết cỡ → vừa màn hình (lề 8px), không vượt', near(r.width, W - 16) && near(r.height, H - 16) && inside(r, W, H), r);
  const logH = await p.evalJs(`document.querySelector('${CHAT} .log').getBoundingClientRect().height`);
  ok('desktop: phần tin nhắn giãn theo bảng (không còn 160px)', logH > 600, logH);
  await p.shot(`${SHOTS}/desktop-3-max.png`);

  // Đặt kích thước / vị trí giữa chừng rồi tải lại
  h0 = await handle();
  await mouseDrag(p, h0.x, h0.y, h0.x - 900, h0.y - 400);
  g = await p.evalJs(GRIP);
  await mouseDrag(p, g.x, g.y, g.x + 300, g.y + 150);
  const before: Rect = await p.evalJs(RECT(CHAT));
  await p.go(`${BASE}/office`, 5000);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!window.__officeScene?.snapshot().me`)); i++) await p.sleep(500);
  const after: Rect = await p.evalJs(RECT(CHAT));
  ok('desktop: tải lại trang còn nhớ chế độ nổi + vị trí + kích thước', await p.evalJs(`document.querySelector('${CHAT}').dataset.mode`) === 'floating'
    && near(before.left, after.left) && near(before.top, after.top) && near(before.width, after.width) && near(before.height, after.height), [before, after]);

  // Gõ trong ô nhập: phím W không làm nhân vật đi
  const s1 = await state(p);
  await p.evalJs(`document.querySelector('${CHAT} input').focus()`);
  await p.key('w', 600);
  ok('desktop: gõ trong ô nhập (W) không làm nhân vật đi', sameState(s1, await state(p)), [s1, await state(p)]);
  ok('desktop: ký tự gõ vào ô nhập', (await p.evalJs(`document.querySelector('${CHAT} input').value`)).includes('w'));
  await p.evalJs(`document.querySelector('${CHAT} input').blur()`);

  // Thu nhỏ cửa sổ → bảng vẫn trong màn hình
  await p.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 500, deviceScaleFactor: 1, mobile: false });
  await p.sleep(400);
  r = await p.evalJs(RECT(CHAT));
  ok('desktop: thu nhỏ cửa sổ 700×500 → bảng vẫn trong màn hình', inside(r, 700, 500), r);
  await p.shot(`${SHOTS}/desktop-4-small-window.png`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await p.sleep(400);

  // Phòng họp: tab phòng + thanh "Họp với AI" trong bảng nổi; tin dài đọc được
  await p.evalJs(`window.__officeScene.walkTo(26, 4)`);
  for (let i = 0; i < 40 && !(await p.evalJs(`!!document.querySelector('[data-testid=office-chat-room-tab]')`)); i++) await p.sleep(500);
  ok('desktop: vào Phòng họp lớn → tab phòng trong bảng nổi', !!(await p.evalJs(`!!document.querySelector('${CHAT}[data-mode=floating] [data-testid=office-chat-room-tab]')`)));
  ok('desktop: thanh "Họp với AI" trong bảng nổi', !!(await p.evalJs(`!!document.querySelector('${CHAT}[data-mode=floating] [data-testid=agent-meeting-bar]')`)));
  const long = 'Báo cáo tiến độ: doanh thu tháng 11 đạt 1.250.000.000đ, tăng 12% so với tháng trước; chi phí vận hành 430.000.000đ; 18/20 việc đúng hạn, 2 việc trễ. ';
  for (let i = 0; i < 4; i++) {
    await p.evalJs(`(() => { const i = document.querySelector('${CHAT} input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      set.call(i, ${JSON.stringify(`${i + 1}. ${long}`.slice(0, 200))}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await p.sleep(150); // để React nhận giá trị trước khi gửi
    await p.evalJs(`document.querySelector('${CHAT}').requestSubmit()`);
    await p.sleep(1500);
  }
  for (let i = 0; i < 20 && (await p.evalJs(`document.querySelectorAll('${CHAT} .log > div').length`)) < 4; i++) await p.sleep(300);
  const log = await p.evalJs(`(() => { const l = document.querySelector('${CHAT} .log'); return { n: l.children.length, sh: l.scrollHeight, ch: l.clientHeight }; })()`);
  ok('desktop: 4 tin dài (200 ký tự) hiện trọn trong bảng nổi, không cần cuộn', log.n >= 4 && log.sh <= log.ch + 1, log);
  await p.shot(`${SHOTS}/desktop-5-meeting-room.png`);

  // Thu về góc
  await p.evalJs(`document.querySelector('[data-testid=office-chat-dock]').click()`);
  await p.sleep(200);
  r = await p.evalJs(RECT(CHAT));
  ok('desktop: thu về góc → ghim như cũ', await p.evalJs(`document.querySelector('${CHAT}').dataset.mode`) === 'docked'
    && near(r.left, 12) && near(r.bottom, H - 12) && near(r.width, 340), r);
  ok('desktop: không lỗi console', p.errors.filter((e) => !/livekit|voice|WebSocket|ERR_CONNECTION_REFUSED/i.test(e)).length === 0, p.errors);
  p.close();
}

// ---------- Điện thoại 390×844 (cảm ứng) ----------
{
  const W = 390, H = 844;
  const p = await open('mobile', 9562, W, H, true);
  ok('mobile: trình duyệt là màn hình cảm ứng (pointer: coarse)', !!(await p.evalJs(`matchMedia('(pointer: coarse)').matches`)));
  ok('mobile: chat thu gọn, có nút 💬', !!(await p.evalJs(`!!document.querySelector('.chat-toggle') && !document.querySelector('${CHAT}')`)));
  await tap(p, '.chat-toggle');
  ok('mobile: mở chat → ghim + có nút mở rộng', await p.evalJs(`document.querySelector('${CHAT}')?.dataset.mode`) === 'docked'
    && !!(await p.evalJs(`!!document.querySelector('[data-testid=office-chat-float]')`)));
  await tap(p, '[data-testid=office-chat-float]');
  let r: Rect = await p.evalJs(RECT(CHAT));
  const joy: Rect = await p.evalJs(RECT('[data-testid=office-joystick]'));
  const cam: Rect = await p.evalJs(RECT('.office-root .camera'));
  ok('mobile: nổi → ~92% × 55%, trong màn hình', await p.evalJs(`document.querySelector('${CHAT}').dataset.mode`) === 'floating'
    && near(r.width, W * 0.92, 3) && r.height > H * 0.4 && inside(r, W, H), r);
  ok('mobile: bảng nổi mặc định không che joystick / nút zoom', !overlap(r, joy) && !overlap(r, cam), { r, joy, cam });
  await p.shot(`${SHOTS}/mobile-1-floating.png`);

  const s0 = await state(p);
  let g = await p.evalJs(GRIP);
  await touchDrag(p, g.x, g.y, g.x - 10, g.y + 120);
  const r2: Rect = await p.evalJs(RECT(CHAT));
  ok('mobile: kéo bằng ngón tay di chuyển được', r2.top > r.top + 60 && inside(r2, W, H), [r, r2]);
  g = await p.evalJs(GRIP);
  await touchDrag(p, g.x, g.y, g.x + 2000, g.y + 2000);
  r = await p.evalJs(RECT(CHAT));
  ok('mobile: kéo ra ngoài → vẫn trong màn hình', inside(r, W, H), r);
  ok('mobile: kéo bảng không làm nhân vật đi / camera đổi', sameState(s0, await state(p)), [s0, await state(p)]);

  const hr: Rect = await p.evalJs(RECT('[data-testid=office-chat-resize]'));
  ok('mobile: tay nắm đổi cỡ ≥ 32px', hr.width >= 32 && hr.height >= 32, hr);
  g = await p.evalJs(GRIP);
  await touchDrag(p, g.x, g.y, g.x - 2000, g.y - 2000);
  const h1: Rect = await p.evalJs(RECT('[data-testid=office-chat-resize]'));
  const rb: Rect = await p.evalJs(RECT(CHAT));
  await touchDrag(p, h1.right - 6, h1.bottom - 6, h1.right - 60, h1.bottom - 150);
  r = await p.evalJs(RECT(CHAT));
  ok('mobile: kéo tay nắm bằng ngón tay đổi kích thước', near(r.width, rb.width - 54, 3) && near(r.height, rb.height - 144, 3), [rb, r]);
  await p.shot(`${SHOTS}/mobile-2-resized.png`);

  // Joystick + zoom vẫn dùng được khi bảng nổi (bảng đang ở trên)
  const s1 = await state(p);
  const jc = { x: (joy.left + joy.right) / 2, y: (joy.top + joy.bottom) / 2 };
  await touchDrag(p, jc.x, jc.y, jc.x, jc.y - 50, 1200);
  const s2 = await state(p);
  ok('mobile: joystick vẫn điều khiển nhân vật khi bảng nổi', Math.hypot(s2.x - s1.x, s2.z - s1.z) > 0.3, [s1, s2]);
  await tap(p, '.office-root .camera button[title="Phóng to"]');
  const s3 = await state(p);
  ok('mobile: nút zoom vẫn dùng được', s3.dist < s2.dist - 0.5, [s2.dist, s3.dist]);

  // Giả lập bàn phím ảo: visualViewport còn 844 − 336 px → bảng + ô nhập vẫn trong vùng nhìn
  await p.evalJs(`(() => { const real = window.visualViewport; const fake = { offsetLeft: 0, offsetTop: 0, width: real.width, height: ${H - 336},
    addEventListener: real.addEventListener.bind(real), removeEventListener: real.removeEventListener.bind(real) };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake }); dispatchEvent(new Event('resize')); })()`);
  g = await p.evalJs(GRIP);
  await touchDrag(p, g.x, g.y, g.x, g.y + 2000); // kéo xuống đáy rồi mới "mở bàn phím" kiểu thật: thả bảng xuống dưới
  await p.sleep(200);
  const inp: Rect = await p.evalJs(RECT(`${CHAT} input`));
  r = await p.evalJs(RECT(CHAT));
  ok('mobile: bàn phím ảo mở (giả lập) → bảng + ô nhập trong vùng nhìn', inside(r, W, H - 336) && inp.bottom <= H - 336, { r, inp });
  await p.evalJs(`(() => { delete window.visualViewport; dispatchEvent(new Event('resize')); })()`);

  // Xoay ngang
  await p.send('Emulation.setDeviceMetricsOverride', { width: H, height: W, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
  await p.sleep(500);
  r = await p.evalJs(RECT(CHAT));
  ok('mobile: xoay ngang 844×390 → bảng vẫn trong màn hình', inside(r, H, W), r);
  await p.shot(`${SHOTS}/mobile-3-landscape.png`);
  await p.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'portraitPrimary', angle: 0 } });
  await p.sleep(500);
  r = await p.evalJs(RECT(CHAT));
  ok('mobile: xoay dọc lại → bảng trong màn hình', inside(r, W, H), r);

  await tap(p, '[data-testid=office-chat-dock]');
  ok('mobile: thu về góc → ghim', await p.evalJs(`document.querySelector('${CHAT}')?.dataset.mode`) === 'docked');
  ok('mobile: không lỗi console', p.errors.filter((e) => !/livekit|voice|WebSocket|ERR_CONNECTION_REFUSED/i.test(e)).length === 0, p.errors);
  p.close();
}

console.log(`\n${pass}/${pass + fail} đạt · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
