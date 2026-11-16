// E2E TEST-128: chat đầy đủ trong văn phòng 3D, xuyên 3D ↔ /chat (khung chat HUD dùng chung ConversationList / MessagePane của features/chat).
//   - A, B vào /office; A bấm avatar B → "Nhắn tin riêng" → gửi chữ + ảnh; B thấy số chưa đọc + toast → "Trả lời" → A nhận trong 3D;
//     C mở /chat thấy kênh Toàn văn phòng đồng bộ hai chiều với 3D, KHÔNG thấy 1-1 của A–B (API 404).
//   - Sửa, cảm xúc, thu hồi, tìm trong khung 3D (B thấy realtime).
//   - Tải lại /office → còn lịch sử Toàn văn phòng + 1-1.
//   - A bước vào Phòng họp lớn → kênh phòng tự mở (không cướp focus), gửi được ngay; ra khỏi phòng → về hội thoại trước.
//   - Gõ trong khung chat / menu tin / hộp emoji không làm nhân vật đi.
//   - Chỉ 1 WebSocket /rt/hub/chat trên /office.
//   - Điện thoại 390 × 844 (cảm ứng): hai màn hình danh sách ↔ hội thoại, khung không che joystick / nút zoom.
// Dùng hook dev `window.__officeScene` (chỉ có khi chạy Vite dev). Ảnh chụp vào SHOTS_DIR. Ảnh đính kèm lên S3 thật trong `.env` (Vite PHẢI ở :5173 vì CORS bucket).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-ocf-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55499:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5283
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55499;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng>
//        Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1
//        Seed__AdminEmail=ocf-admin@officehub-e2e.vn Seed__AdminPassword=Ocf-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5293 Realtime__ApiBaseUrl=http://localhost:5283 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Vite (từ frontend/): VITE_API_TARGET=http://localhost:5283 VITE_RT_TARGET=http://localhost:5293 bunx vite --port 5173 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 BASE_URL=http://localhost:5173 ADMIN_LOGIN=ocf-admin@officehub-e2e.vn \
//     ADMIN_PASSWORD=Ocf-Admin-2026 SHOTS_DIR=/tmp/office-chat-full bun scripts/dev/office-chat-full-e2e.ts
// Đăng nhập giới hạn 30 lần / phút / IP: script này đăng nhập ~12 lần; chạy nối script e2e khác thì đợi ≥ 60 giây.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/office-chat-full`;
mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- REST: tài khoản (như office-help-e2e.ts) ----------
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 429) throw new Error('Đăng nhập bị giới hạn (429) — đợi 60 giây rồi chạy lại');
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Chat 3D ${stamp}`, code: `C3${stamp}`.slice(0, 10) })).body;
const mk = async (n: number, fullName: string) => {
  const user = `e2e.ocf${n}.${stamp}`, code = `NV6${stamp}${n}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c0 = await login(user, acc.tempPassword);
  await json(c0, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  return { user, name: fullName, code, cookie, userId };
};
const A = await mk(1, 'Phạm An Khang');
const B = await mk(2, 'Đỗ Bích Ngọc');
const C = await mk(3, 'Hồ Chí Công');
ok('tạo 3 tài khoản thử (A, B, C)', [A, B, C].every((x) => !!x.userId && !!x.cookie));

// ---------- Trình duyệt ----------
const NO_FREEZE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=PageFreeze,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'];
/** Ghi mọi WebSocket trang mở (đếm kết nối /rt/hub/chat) + đếm âm báo (headless không nghe được). */
const SPY = `(() => { const W = window.WebSocket; window.__ws = [];
  window.WebSocket = class extends W { constructor(...a) { super(...a); window.__ws.push(this); } };
  window.__plays = 0; HTMLAudioElement.prototype.play = function () { window.__plays++; return Promise.resolve(); }; })()`;
type Page = Awaited<ReturnType<typeof launch>>;
const browser = async (label: string, port: number, w = 1440, h = 900, touch = false): Promise<Page> => {
  const p = await launch(port, `${tmpdir()}/ocf-${label}-${stamp}`, w, h, NO_FREEZE);
  if (touch) {
    await p.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  }
  await p.send('Page.addScriptToEvaluateOnNewDocument', { source: SPY });
  return p;
};
const waitFor = async (p: Page, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await p.evalJs(expr)) return true; await sleep(250); } return false; };
const enterOffice = async (p: Page) => {
  await p.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`);
  await p.go(`${BASE}/office`, 3000);
  return waitFor(p, `!!window.__officeScene?.myPosition() && !!document.querySelector('.office-root .status .dot.online')`, 25000);
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const me = (p: Page) => p.evalJs('window.__officeScene.myPosition()') as Promise<{ x: number; z: number }>;
/** Đi tới ô trống gần (x, z) (A* của engine) rồi chờ tới nơi + 500 ms cho vị trí kịp tới server. */
const walk = async (p: Page, x: number, z: number, timeoutMs = 25_000) => {
  const target = await p.evalJs(`(() => { const s = window.__officeScene, c = s.nav.nearestFree(${x}, ${z}); if (!c) return null; const [tx, tz] = s.nav.center(c[0], c[1]); s.walkTo(tx, tz); return { x: tx, z: tz }; })()`) as { x: number; z: number } | null;
  if (!target) return null;
  for (let t = 0; t < timeoutMs; t += 250) {
    const m = await me(p);
    if (dist(m, target) < 0.3) { await sleep(500); return m; }
    await sleep(250);
  }
  return null;
};
const click = async (p: Page, x: number, y: number) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
/** Điểm màn hình trúng avatar `id`, không bị HUD che (như bot-watch-e2e.ts). */
const avatarPixel = (p: Page, id: string) => p.evalJs(`(() => { const s = window.__officeScene, W = innerWidth, H = innerHeight, id = ${JSON.stringify(id)};
  const hit = (x, y) => s.avatarAt(x, y, false)?.id === id && document.elementFromPoint(x, y)?.tagName === 'CANVAS';
  let sx = 0, sy = 0, n = 0, first = null;
  for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) if (hit(x, y)) { sx += x; sy += y; n++; first ??= [x, y]; }
  if (!n) return null;
  const c = [Math.round(sx / n), Math.round(sy / n)];
  return hit(c[0], c[1]) ? c : first; })()`) as Promise<[number, number] | null>;
/** Giữ phím `key` trong `ms` (CDP — đi qua đúng đường bàn phím thật). */
const hold = async (p: Page, key: string, code: string, vk: number, ms = 600) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, text: key, windowsVirtualKeyCode: vk });
  await sleep(ms);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
};
const esc = async (p: Page) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(250);
};

// Khung chat 3D: mọi truy vấn trong `[data-testid=office-chat]` (P) — `scope` = '' để dùng cho trang /chat
const P3 = `document.querySelector('[data-testid=office-chat]')`;
const conv = (p: Page) => p.evalJs(`${P3}?.dataset.conversation ?? null`) as Promise<string | null>;
const msgs = (p: Page, scope = P3) => p.evalJs(`[...(${scope} ?? document).querySelectorAll('[data-testid=chat-message]')].map((e) => e.textContent)`) as Promise<string[]>;
const hasMsg = (p: Page, text: string, ms = 8000, scope = P3) =>
  waitFor(p, `[...(${scope} ?? document).querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes(${JSON.stringify(text)}) && !e.textContent.includes('Đang gửi'))`, ms);
const setInput = (p: Page, sel: string, text: string, scope = P3) => p.evalJs(`(() => { const i = (${scope} ?? document).querySelector('${sel}'); if (!i) return false;
  const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const sendGap = () => sleep(1250); // giới hạn 1 tin / giây / tài khoản
const say = async (p: Page, text: string, scope = P3) => {
  await setInput(p, '[data-testid=chat-input]', text, scope);
  await sleep(150);
  await p.evalJs(`(${scope} ?? document).querySelector('[data-testid=chat-send]').click()`);
  await sendGap();
};
/** Chọn hội thoại theo tên trong khung 3D (khung hẹp hai màn hình → bấm "quay lại" trước nếu đang ở hội thoại). */
const pickConv = async (p: Page, title: string) => {
  const find = `[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].find((e) => e.textContent.includes(${JSON.stringify(title)}))`;
  if (!(await p.evalJs(`!!${find}`))) await p.evalJs(`${P3}.querySelector('[data-testid=chat-back]')?.click()`);
  await waitFor(p, `!!${find}`, 3000);
  const r = await p.evalJs(`(() => { const e = ${find}; e?.click(); return !!e; })()`);
  await sleep(400);
  return r;
};
/** Mở menu "Tuỳ chọn tin nhắn" của tin chứa `text` (Radix mở bằng pointerdown). */
const openMsgMenu = (p: Page, text: string) => p.evalJs(`(() => { const m = [...${P3}.querySelectorAll('[data-testid=chat-message]')].find((e) => e.textContent.includes(${JSON.stringify(text)}));
  const b = m?.querySelector('[data-testid=chat-message-menu]'); if (!b) return false;
  b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return true; })()`);
const chatSockets = (p: Page) => p.evalJs(`(window.__ws ?? []).filter((w) => w.url.includes('/rt/hub/chat') && w.readyState <= 1).length`) as Promise<number>;
/** Gọi Api bằng phiên của trình duyệt (cookie REST cũ có thể đã hết hiệu lực khi trình duyệt đăng nhập lại). */
const api = (p: Page, path: string) => p.evalJs(`fetch(${JSON.stringify(path)}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))`) as Promise<{ status: number; body: any }>;
const toastText = (p: Page) => p.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.textContent).join(' | ')`) as Promise<string>;

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const pngPath = `${tmpdir()}/ocf-e2e-${stamp}.png`;
await Bun.write(pngPath, PNG);

const pa = await browser('a', 9611), pb = await browser('b', 9612), pc = await browser('c', 9613);
const all: Page[] = [pa, pb, pc];
try {
  ok('đăng nhập 3 trình duyệt', (await pa.login(A.user, PW)) === 200 && (await pb.login(B.user, PW)) === 200 && (await pc.login(C.user, PW)) === 200);
  ok('A vào /office', await enterOffice(pa));
  ok('B vào /office', await enterOffice(pb));
  await pc.go(`${BASE}/chat`, 3500);

  // ---------- Một kết nối hub chat trên /office ----------
  await sleep(1500);
  ok('A: đúng 1 WebSocket /rt/hub/chat đang mở trên /office', (await chatSockets(pa)) === 1, await pa.evalJs(`(window.__ws ?? []).map((w) => w.url.split('?')[0] + ' ' + w.readyState)`));
  ok('B: đúng 1 WebSocket /rt/hub/chat', (await chatSockets(pb)) === 1, await chatSockets(pb));
  ok('máy tính: khung chat mở sẵn ở kênh Toàn văn phòng', await waitFor(pa, `${P3}?.querySelector('[data-testid=chat-title]')?.textContent === 'Toàn văn phòng'`));

  // ---------- Toàn văn phòng: 3D ↔ /chat hai chiều ----------
  await say(pa, `A chào cả văn phòng từ 3D ${stamp}`);
  ok('A thấy tin Toàn văn phòng vừa gửi trong 3D', await hasMsg(pa, `A chào cả văn phòng từ 3D ${stamp}`));
  ok('B (3D) nhận tin Toàn văn phòng', await hasMsg(pb, `A chào cả văn phòng từ 3D ${stamp}`));
  await pc.evalJs(`[...document.querySelectorAll('[data-testid=chat-conversation]')].find((e) => e.textContent.includes('Toàn văn phòng'))?.click()`);
  ok('C (/chat) thấy tin A gửi từ 3D', await hasMsg(pc, `A chào cả văn phòng từ 3D ${stamp}`, 8000, 'document'));
  await say(pc, `C trả lời từ web ${stamp}`, 'document');
  ok('A (3D) nhận tin C gửi từ /chat', await hasMsg(pa, `C trả lời từ web ${stamp}`));

  // ---------- A bấm avatar B → Nhắn tin riêng ----------
  const aPos = await me(pa);
  const bNear = await walk(pb, aPos.x + 2, aPos.z + 1.5);
  ok('B đứng cạnh A (~2,5 m)', !!bNear && dist(bNear, aPos) < 4, bNear);
  await sleep(800);
  let px = await avatarPixel(pa, B.userId);
  ok('A thấy avatar B trên màn hình (không bị HUD che)', !!px, px);
  if (px) await click(pa, px[0], px[1]);
  ok('bấm avatar B → menu có "Nhắn tin riêng"', await waitFor(pa, `!!document.querySelector('[data-testid=avatar-menu-chat]')`, 3000));
  await pa.evalJs(`document.querySelector('[data-testid=avatar-menu-chat]')?.click()`);
  ok('A: khung chat mở 1-1 với B', await waitFor(pa, `${P3}?.querySelector('[data-testid=chat-title]')?.textContent === ${JSON.stringify(B.name)}`));
  const dmId = await conv(pa);
  ok('…đầu khung: phòng ban + "đang trong văn phòng · cách bạn N m" + nút Đi tới',
    await waitFor(pa, `(${P3}.querySelector('[data-testid=chat-subtitle]')?.textContent ?? '').includes('cách bạn') && !!${P3}.querySelector('[data-testid=office-chat-walk]')`),
    await pa.evalJs(`${P3}.querySelector('[data-testid=chat-subtitle]')?.textContent`));
  await pb.evalJs(`localStorage.getItem('x')`); // giữ trang B hoạt động
  const bPlays0 = await pb.evalJs('window.__plays') as number;
  await say(pa, `Chào Ngọc, A nhắn riêng ${stamp}`);
  ok('A thấy tin 1-1 của mình', await hasMsg(pa, `Chào Ngọc, A nhắn riêng ${stamp}`));
  // Ảnh
  const doc = await pa.send('DOM.getDocument', { depth: 1 });
  const node = await pa.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[data-testid=office-chat] [data-testid=chat-file-input]' });
  await pa.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [pngPath] });
  ok('A chọn ảnh trong khung 3D → hiện tệp chờ gửi', await waitFor(pa, `!!${P3}.querySelector('[data-testid=chat-files]')`));
  await sleep(1500); // tải lên S3
  await pa.evalJs(`${P3}.querySelector('[data-testid=chat-send]').click()`);
  ok('A: ảnh hiển thị trong khung 3D (tải được từ S3)', await waitFor(pa, `(() => { const im = ${P3}.querySelector('[data-testid=chat-messages] img'); return !!im && im.complete && im.naturalWidth > 0; })()`, 15000));

  // ---------- B: số chưa đọc + toast → Trả lời ----------
  ok('B: nút chat trên thẻ trạng thái có số chưa đọc', await waitFor(pb, `+(document.querySelector('[data-testid=office-chat-button-unread]')?.textContent ?? 0) >= 1`),
    await pb.evalJs(`document.querySelector('[data-testid=office-chat-button-unread]')?.textContent`));
  ok('B: toast "Phạm An Khang nhắn bạn" + xem trước + Trả lời / Để sau', await waitFor(pb, `[...document.querySelectorAll('[data-sonner-toast]')].some((t) => t.textContent.includes(${JSON.stringify(`${A.name} nhắn bạn`)}) && t.textContent.includes('Trả lời') && t.textContent.includes('Để sau'))`),
    await toastText(pb));
  ok('B: phát âm báo tin mới', (await pb.evalJs('window.__plays') as number) > bPlays0);
  await pb.shot(`${SHOTS}/b-toast.png`);
  await pb.evalJs(`[...document.querySelectorAll('[data-sonner-toast] button')].find((b) => b.textContent === 'Trả lời')?.click()`);
  ok('B bấm Trả lời → khung chat mở đúng 1-1 với A', await waitFor(pb, `${P3}?.dataset.conversation === ${JSON.stringify(dmId)}`), await conv(pb));
  ok('B thấy chữ + ảnh của A', await hasMsg(pb, `Chào Ngọc, A nhắn riêng ${stamp}`) && await waitFor(pb, `(() => { const im = ${P3}.querySelector('[data-testid=chat-messages] img'); return !!im && im.complete && im.naturalWidth > 0; })()`, 15000));
  ok('B mở hội thoại → hết số chưa đọc', await waitFor(pb, `!document.querySelector('[data-testid=office-chat-button-unread]')`));
  await say(pb, `B trả lời trong 3D ${stamp}`);
  ok('A nhận trả lời của B trong 3D (realtime)', await hasMsg(pa, `B trả lời trong 3D ${stamp}`));
  ok('A đang xem 1-1 → không toast', !(await toastText(pa)).includes(`${B.name} nhắn bạn`), await toastText(pa));

  // ---------- C (/chat) không thấy 1-1 của A–B ----------
  const cConvs = (await api(pc, '/api/chat/conversations')).body as any[];
  ok('C: danh sách hội thoại không có 1-1 A–B', !cConvs.some((c) => c.id === dmId), cConvs.map((c) => c.title));
  ok('C: đọc tin 1-1 A–B → 404', (await api(pc, `/api/chat/conversations/${encodeURIComponent(dmId!)}/messages`)).status === 404);
  ok('C: trang /chat không có hội thoại tên A / B', !(await pc.evalJs(`[...document.querySelectorAll('[data-testid=chat-conversation]')].some((e) => e.textContent.includes(${JSON.stringify(A.name)}) || e.textContent.includes(${JSON.stringify(B.name)}))`)));

  // ---------- Sửa, cảm xúc, thu hồi, tìm trong khung 3D ----------
  const EDIT = `Chào Ngọc, A nhắn riêng ${stamp}`;
  await openMsgMenu(pa, EDIT);
  ok('menu tin: có Sửa', await waitFor(pa, `!!document.querySelector('[data-testid=chat-edit]')`, 3000));
  await pa.evalJs(`document.querySelector('[data-testid=chat-edit]').click()`);
  ok('sửa: hiện ô sửa', await waitFor(pa, `!!${P3}.querySelector('[data-testid=chat-edit-input]')`, 3000));
  await setInput(pa, '[data-testid=chat-edit-input]', `Chào Ngọc (đã chỉnh) ${stamp}`);
  await sleep(150);
  await pa.evalJs(`${P3}.querySelector('[data-testid=chat-edit-save]').click()`);
  ok('A: tin đã sửa + nhãn "(đã sửa)"', await waitFor(pa, `[...${P3}.querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes('Chào Ngọc (đã chỉnh) ${stamp}') && !!e.querySelector('[data-testid=chat-edited]'))`));
  ok('B thấy bản sửa realtime', await waitFor(pb, `[...${P3}.querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes('Chào Ngọc (đã chỉnh) ${stamp}') && !!e.querySelector('[data-testid=chat-edited]'))`));

  await openMsgMenu(pb, `Chào Ngọc (đã chỉnh) ${stamp}`);
  ok('B: menu tin của người khác có cảm xúc nhanh', await waitFor(pb, `!!document.querySelector('[data-testid=chat-quick-emoji]')`, 3000));
  const emo = await pb.evalJs(`(() => { const e = document.querySelector('[data-testid=chat-quick-emoji]'); const t = e.textContent; e.click(); return t; })()`) as string;
  const hasReact = (p: Page) => waitFor(p, `[...${P3}.querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes('Chào Ngọc (đã chỉnh)') && [...e.querySelectorAll('[data-testid=chat-reaction]')].some((r) => r.textContent.includes(${JSON.stringify(emo)})))`);
  ok(`B thả ${emo} → hiện dưới tin`, await hasReact(pb));
  ok(`A thấy cảm xúc ${emo} realtime`, await hasReact(pa));

  await say(pa, `tin sắp thu hồi ${stamp}`);
  ok('A gửi tin để thu hồi', await hasMsg(pa, `tin sắp thu hồi ${stamp}`));
  await sleep(500);
  await openMsgMenu(pa, `tin sắp thu hồi ${stamp}`);
  await waitFor(pa, `!!document.querySelector('[data-testid=chat-recall]')`, 3000);
  await pa.evalJs(`document.querySelector('[data-testid=chat-recall]').click()`);
  await waitFor(pa, `!!document.querySelector('[data-testid=chat-recall-confirm]')`, 3000);
  await pa.evalJs(`document.querySelector('[data-testid=chat-recall-confirm]').click()`);
  const recalled = `[...${P3}.querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes('Tin nhắn đã thu hồi')) && ![...${P3}.querySelectorAll('[data-testid=chat-message]')].some((e) => e.textContent.includes('tin sắp thu hồi ${stamp}'))`;
  ok('A: "Tin nhắn đã thu hồi"', await waitFor(pa, recalled));
  ok('B thấy thu hồi realtime, nội dung cũ biến mất', await waitFor(pb, recalled));

  await pa.evalJs(`${P3}.querySelector('[data-testid=chat-search-toggle]').click()`);
  ok('tìm: hiện ô tìm trong khung 3D', await waitFor(pa, `!!${P3}.querySelector('[data-testid=chat-search-input]')`, 3000));
  await setInput(pa, '[data-testid=chat-search-input]', 'trả lời trong 3D');
  ok('tìm "trả lời trong 3D" → ra tin của B', await waitFor(pa, `[...${P3}.querySelectorAll('[data-testid=chat-search-result]')].some((e) => e.textContent.includes('B trả lời trong 3D ${stamp}'))`));
  await pa.shot(`${SHOTS}/a-search.png`);
  await pa.evalJs(`${P3}.querySelector('[data-testid=chat-search-toggle]').click()`);
  await sleep(300);

  // ---------- Phím: gõ trong khung chat / menu tin / hộp emoji không làm nhân vật đi ----------
  await pa.evalJs(`${P3}.querySelector('[data-testid=chat-input]').focus()`);
  let p0 = await me(pa);
  await hold(pa, 'w', 'KeyW', 87);
  ok('gõ "w" trong ô soạn → nhân vật đứng yên, chữ vào ô', dist(p0, await me(pa)) < 0.05 && (await pa.evalJs(`${P3}.querySelector('[data-testid=chat-input]').value`) as string).includes('w'));
  await setInput(pa, '[data-testid=chat-input]', '');
  await pa.evalJs('document.activeElement?.blur()');
  await openMsgMenu(pa, `B trả lời trong 3D ${stamp}`);
  await waitFor(pa, `!!document.querySelector('[role=menu]')`, 3000);
  p0 = await me(pa);
  await hold(pa, 'w', 'KeyW', 87);
  ok('menu tin đang mở: giữ W → nhân vật đứng yên', dist(p0, await me(pa)) < 0.05);
  await pa.evalJs(`[...document.querySelectorAll('[role=menuitem]')].find((e) => e.textContent.includes('Emoji khác'))?.click()`);
  ok('menu "Emoji khác…" → hộp nhập emoji', await waitFor(pa, `!!document.querySelector('[data-testid=chat-emoji-input]')`, 3000));
  p0 = await me(pa);
  await hold(pa, 'w', 'KeyW', 87);
  ok('hộp emoji: giữ W → nhân vật đứng yên', dist(p0, await me(pa)) < 0.05);
  await esc(pa);
  ok('Esc đóng hộp emoji', await waitFor(pa, `!document.querySelector('[data-testid=chat-emoji-input]')`, 2000));
  await pa.evalJs('document.activeElement?.blur()');
  p0 = await me(pa);
  await hold(pa, 'w', 'KeyW', 87);
  ok('ra khỏi khung chat → W lại đi được', dist(p0, await me(pa)) > 0.1);

  // ---------- Tải lại /office → còn lịch sử ----------
  await pa.go(`${BASE}/office`, 3000);
  await waitFor(pa, `!!window.__officeScene?.myPosition() && !!document.querySelector('.office-root .status .dot.online')`, 25000);
  ok('tải lại: khung chat vẫn mở (nhớ trạng thái)', await waitFor(pa, `!!${P3}`, 5000));
  ok('tải lại: đúng 1 WebSocket /rt/hub/chat', await waitFor(pa, `(window.__ws ?? []).filter((w) => w.url.includes('/rt/hub/chat') && w.readyState <= 1).length === 1`, 5000), await chatSockets(pa));
  ok('tải lại: còn lịch sử Toàn văn phòng (tin 3D + tin web)', await pickConv(pa, 'Toàn văn phòng') && await hasMsg(pa, `A chào cả văn phòng từ 3D ${stamp}`) && await hasMsg(pa, `C trả lời từ web ${stamp}`), await msgs(pa));
  ok('tải lại: còn lịch sử 1-1 (sửa, cảm xúc, ảnh, trả lời)', await pickConv(pa, B.name) && await hasMsg(pa, `Chào Ngọc (đã chỉnh) ${stamp}`) && await hasMsg(pa, `B trả lời trong 3D ${stamp}`)
    && await waitFor(pa, `!!${P3}.querySelector('[data-testid=chat-messages] img')`), await msgs(pa));

  // ---------- Phòng họp: kênh phòng tự mở, ra → quay lại hội thoại trước ----------
  ok('trước khi vào phòng: A đang xem 1-1 với B', (await conv(pa)) === dmId, await conv(pa));
  const outside = await me(pa);
  await pa.evalJs('window.__officeScene.walkTo(25, 6.5)');
  ok('A bước vào Phòng họp lớn → dòng báo "Bạn vừa vào … — đã mở kênh của phòng"', await waitFor(pa, `!!${P3}.querySelector('[data-testid=office-chat-room-notice]')`, 20000),
    await pa.evalJs(`${P3}.innerText.slice(0, 300)`));
  const roomConvId = await conv(pa);
  ok('…kênh phòng tự chọn (tiêu đề Phòng họp lớn)', roomConvId !== dmId && (await pa.evalJs(`${P3}.querySelector('[data-testid=chat-title]')?.textContent`)) === 'Phòng họp lớn',
    await pa.evalJs(`${P3}.querySelector('[data-testid=chat-title]')?.textContent`));
  ok('…dòng báo có "Quay lại Đỗ Bích Ngọc"', (await pa.evalJs(`${P3}.querySelector('[data-testid=office-chat-room-back]')?.textContent ?? ''`) as string).includes(B.name));
  ok('…ô soạn ghi "Chỉ người trong Phòng họp lớn thấy…", không cướp focus', await pa.evalJs(`${P3}.querySelector('[data-testid=chat-input]')?.placeholder`) === 'Chỉ người trong Phòng họp lớn thấy…'
    && !(await pa.evalJs(`document.activeElement?.dataset?.testid === 'chat-input'`)));
  await pa.shot(`${SHOTS}/a-room.png`);
  await say(pa, `tin phòng họp ngay khi vào ${stamp}`);
  ok('gửi được ngay trong kênh phòng', await hasMsg(pa, `tin phòng họp ngay khi vào ${stamp}`));
  const roomRest = ((await api(pa, '/api/chat/conversations')).body as any[]).find((c) => c.type === 'Room');
  ok('…tin phòng được lưu (Api: kênh meeting-large, xem trước đúng)', roomRest?.roomId === 'meeting-large' && roomRest.lastPreview === `tin phòng họp ngay khi vào ${stamp}`, roomRest);
  ok('B (ngoài phòng) không thấy tin phòng; C không đọc được kênh phòng (404)', !(await msgs(pb)).some((t) => t.includes('tin phòng họp'))
    && (await api(pc, `/api/chat/conversations/${encodeURIComponent(roomRest?.id ?? 'room:meeting-large')}/messages`)).status === 404);
  await walk(pa, outside.x, outside.z);
  ok('ra khỏi phòng → quay lại 1-1 với B, dòng báo biến mất', await waitFor(pa, `${P3}?.dataset.conversation === ${JSON.stringify(dmId)} && !${P3}.querySelector('[data-testid=office-chat-room-notice]')`, 8000), await conv(pa));

  for (const [n, p] of [['A', pa], ['B', pb], ['C', pc]] as const)
    ok(`không lỗi console ${n}`, p.errors.filter((e) => !/livekit|voice|ICE|WebSocket|getUserMedia|NotAllowed|favicon/i.test(e)).length === 0, p.errors.slice(0, 3));
} finally { for (const p of all) p.close(); }

// ---------- Điện thoại 390 × 844 (cảm ứng): hai màn hình, không che joystick ----------
const pm = await browser('m', 9614, 390, 844, true);
try {
  ok('điện thoại: đăng nhập C', (await pm.login(C.user, PW)) === 200);
  ok('điện thoại: vào /office', await enterOffice(pm));
  ok('điện thoại: khung chat đóng mặc định, có nút "Tin nhắn" + joystick', !(await pm.evalJs(`!!${P3}`)) && await pm.evalJs(`!!document.querySelector('[data-testid=office-chat-open]') && !!document.querySelector('[data-testid=office-joystick]')`));
  ok('điện thoại: 1 WebSocket /rt/hub/chat', (await chatSockets(pm)) === 1, await chatSockets(pm));
  await pm.evalJs(`document.querySelector('[data-testid=office-chat-open]').click()`);
  ok('mở chat → màn hình danh sách (chưa có khung tin)', await waitFor(pm, `!!${P3}?.querySelector('[data-testid=chat-conversations]') && !${P3}.querySelector('[data-testid=chat-messages]')`, 4000));
  const geo = await pm.evalJs(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; };
    const zoom = [...document.querySelectorAll('.office-root .camera button')].map((e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom }; });
    return { panel: r('[data-testid=office-chat]'), joy: r('[data-testid=office-joystick]'), zoom }; })()`) as any;
  const overlaps = (a: any, b: any) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  ok('khung chat ~92% rộng, nằm trong màn hình', !!geo.panel && geo.panel.r - geo.panel.l >= 390 * 0.9 - 1 && geo.panel.l >= 0 && geo.panel.r <= 390 && geo.panel.b <= 844, geo.panel);
  ok('khung chat không che joystick / nút zoom', !!geo.joy && !overlaps(geo.panel, geo.joy) && geo.zoom.every((z: any) => !overlaps(geo.panel, z)), geo);
  ok('dòng hội thoại cao ≥ 44 px', await pm.evalJs(`[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].every((e) => e.getBoundingClientRect().height >= 44)`));
  await pm.shot(`${SHOTS}/mobile-list.png`);
  await pm.evalJs(`[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].find((e) => e.textContent.includes('Toàn văn phòng'))?.click()`);
  ok('chạm Toàn văn phòng → màn hình hội thoại (ẩn danh sách, có nút quay lại)', await waitFor(pm, `!!${P3}.querySelector('[data-testid=chat-messages]') && !${P3}.querySelector('[data-testid=chat-conversations]') && !!${P3}.querySelector('[data-testid=chat-back]')`, 4000));
  ok('…thấy lịch sử (tin A gửi từ 3D)', await hasMsg(pm, `A chào cả văn phòng từ 3D ${stamp}`));
  ok('…ô soạn cao ≥ 40 px', await pm.evalJs(`${P3}.querySelector('[data-testid=chat-input]').getBoundingClientRect().height >= 40`),
    await pm.evalJs(`${P3}.querySelector('[data-testid=chat-input]').getBoundingClientRect().height`));
  await pm.shot(`${SHOTS}/mobile-thread.png`);
  await pm.evalJs(`${P3}.querySelector('[data-testid=chat-back]').click()`);
  ok('nút quay lại → về danh sách', await waitFor(pm, `!!${P3}.querySelector('[data-testid=chat-conversations]') && !${P3}.querySelector('[data-testid=chat-messages]')`, 3000));
  ok('không lỗi console điện thoại', pm.errors.filter((e) => !/livekit|voice|ICE|WebSocket|getUserMedia|NotAllowed|favicon/i.test(e)).length === 0, pm.errors.slice(0, 3));
} finally { pm.close(); }

console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
