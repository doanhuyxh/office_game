// E2E TEST-97 + TEST-98 (mục [98]: bảng đầy đủ "Màn hình của bot" — 10 loại sự kiện, thu gọn, cuộn, Esc, theme, kéo / đổi cỡ, rỗng)
// + TEST-100 (mục [100]: tab "File đã sửa" — gộp theo file, + / -, nhãn Mới, nội dung ẩn, mở diff, nháy, phiên mới → trống, điện thoại):
// + TEST-102 (mục [102]: kéo đổi vị trí + đổi kích thước bảng — ra 4 mép không lọt, nhỏ nhất 320 × 220 / to nhất vừa màn hình, nội dung không tràn,
//   nhấn-kéo trên nút Đóng / tab / chọn chữ / lăn chuột không di chuyển bảng, nhân vật + camera đứng yên, nhớ vị trí khi đóng mở lại / bot khác / tải lại,
//   thu cửa sổ tự vào lại, điện thoại rộng hết màn hình + chạm kéo không đổi):
// TEST-97: bấm vào bot trong văn phòng 3D để xem bot đang làm gì (FE): chọn avatar bot bằng chuột + chạm (vùng bấm theo màn hình),
// kiểm phạm vi nghe ở client (xa → gợi ý "Lại gần hơn…", không gọi hub), WatchBot → bảng nhận đệm + sự kiện trực tiếp (gộp theo id,
// session_start bỏ cũ, model / lượt / chi phí), con trỏ bàn tay khi rê lên bot, bấm sàn vẫn đi bộ, nút Đóng → UnwatchBot, đi ra xa →
// server ngắt (BotWatchEnded range), người thật của tài khoản bot vào văn phòng → ngắt (offline). Chrome headless máy tính 1440×900 + điện thoại
// 390×844 (chạm). Dùng hook dev `window.__officeScene` (chỉ có khi chạy Vite dev). Không cần Mcp: bot online + sự kiện bơm thẳng vào Realtime
// bằng khoá nội bộ (như Mcp làm). Chưa phủ: mất kết nối hub rồi nối lại (WatchBot lại) — thử tay bằng cách tắt / bật Realtime.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-botwatch-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55499:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5283
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55499;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng>
//        Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1   (không gửi gì ra ngoài)
//        Seed__AdminEmail=watch-admin@officehub-e2e.vn Seed__AdminPassword=Watch-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5293 Realtime__ApiBaseUrl=http://localhost:5283 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Vite (từ frontend/): VITE_API_TARGET=http://localhost:5283 VITE_RT_TARGET=http://localhost:5293 bunx vite --port 5179 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 RT_URL=http://localhost:5293 BASE_URL=http://localhost:5179 CHAT_INTERNAL_KEY=<khoá> \
//     ADMIN_LOGIN=watch-admin@officehub-e2e.vn ADMIN_PASSWORD=Watch-Admin-2026 SHOTS_DIR=/tmp/bot-watch bun scripts/dev/bot-watch-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const RT = process.env.RT_URL ?? 'http://localhost:5293';
const KEY = process.env.CHAT_INTERNAL_KEY ?? '';
if (!KEY) throw new Error('Đặt CHAT_INTERNAL_KEY = Chat__InternalKey của Realtime tạm');
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/bot-watch`;
mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
/** Gọi đường nội bộ của Realtime bằng khoá chung (như OfficeHub.Mcp). */
const internal = async (path: string, body: unknown) => {
  const r = await fetch(RT + path, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': KEY }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);

// ---------- Dữ liệu: 2 người (máy tính + điện thoại) + 1 bot ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Xem bot ${stamp}`, code: `BW${stamp}`.slice(0, 10) })).body;
let seq = 800 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  return { e, user, cookie, userId, name };
};
const H1 = await mkEmp('Người Xem Máy Tính', `e2e.bw.h1.${stamp}`);
const H2 = await mkEmp('Người Xem Điện Thoại', `e2e.bw.h2.${stamp}`);
const B = await mkEmp('Bot Đang Code', `e2e.bw.b.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${B.e.id}/account/bot`, { isBot: true });
ok('3 tài khoản, B là bot', [H1, H2, B].every((x) => !!x.userId));

// Bot online (như Mcp báo presence sau mỗi tool / runner báo đang làm) — không zone → ngồi bàn khu làm việc chung
const presence = { userId: B.userId, name: B.name, look: null, zone: null, activity: 'Sửa code', busy: true, task: 'TEST-97 · Xem bot', fromRunner: true };
const online = await internal('/rt/internal/bot-activity', presence);
ok('bot online qua /rt/internal/bot-activity', online.status < 300, online);
// Bot thứ hai (TEST-102: mở bot khác vẫn dùng vị trí / kích thước bảng đã nhớ)
const B2 = await mkEmp('Bot Thứ Hai', `e2e.bw.b2.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${B2.e.id}/account/bot`, { isBot: true });
const online2 = await internal('/rt/internal/bot-activity', { ...presence, userId: B2.userId, name: B2.name, task: 'TEST-102 · Bot khác' });
ok('[102] bot thứ hai online', online2.status < 300, online2);
const feed = (events: any[]) => internal('/rt/internal/bot-activity-feed', { userId: B.userId, events });
const first = await feed([{ id: 's1', kind: 'session_start', title: 'Bắt đầu', task: 'TEST-97 · Xem bot', model: 'claude-fable-5-1' },
  { id: 'c1', kind: 'command', title: 'Chạy lệnh', text: 'bun run build' }]);
ok('bơm 2 sự kiện đầu (đệm phiên)', first.status === 200 && first.body?.accepted === 2, first);

// ---------- Chrome máy tính ----------
const sig = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const pc = await launch(9341, `${tmpdir()}/bw-chrome-h1-${stamp}`, 1440, 900);
/** Chờ cảnh 3D sẵn sàng (đã vào, hub online, thấy bot B) rồi tắt thẻ Hướng dẫn (che một mảng màn hình — nhất là trên điện thoại) để bấm tới được canvas. */
const ready = async (p: typeof pc) => {
  for (let i = 0; i < 60; i++) {
    const ok = await p.evalJs(`!!(window.__officeScene && window.__officeScene.myPosition() && document.querySelector('.office-root .status .dot.online') && window.__officeScene.botInfo(${JSON.stringify(B.userId)}))`);
    if (ok) {
      await p.evalJs(`document.querySelector('[data-testid=office-help] button')?.click()`);
      return true;
    }
    await p.sleep(500);
  }
  return false;
};
const enter = async (p: typeof pc, who: { user: string }) => {
  const st = await p.login(who.user, PW);
  if (st !== 200) throw new Error(`Đăng nhập ${who.user} → ${st}`);
  await p.go(`${BASE}/office`, 2500);
  return ready(p);
};
ok('H1 vào văn phòng 3D, thấy bot', await enter(pc, H1));
const bot = await pc.evalJs(`window.__officeScene.botInfo(${JSON.stringify(B.userId)})`) as { name: string; x: number; z: number };
ok('botInfo trả tên + vị trí bot', bot?.name === B.name && Number.isFinite(bot?.x), bot);
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

/** Đi tới ô trống gần (x, z) rồi chờ tới nơi (A* của engine, như bấm sàn) + 500 ms cho vị trí kịp tới server. */
const walk = async (p: typeof pc, x: number, z: number, timeoutMs = 25_000) => {
  const target = await p.evalJs(`(() => { const s = window.__officeScene, c = s.nav.nearestFree(${x}, ${z}); if (!c) return null; const [tx, tz] = s.nav.center(c[0], c[1]); s.walkTo(tx, tz); return { x: tx, z: tz }; })()`) as { x: number; z: number } | null;
  if (!target) return null;
  for (let t = 0; t < timeoutMs; t += 250) {
    const me = await p.evalJs('window.__officeScene.myPosition()') as { x: number; z: number };
    if (dist(me, target) < 0.3) { await p.sleep(500); return me; }
    await p.sleep(250);
  }
  return null;
};
/**
 * Điểm màn hình trúng bot: quét lưới 6 px bằng chính hàm botAt của engine, chỉ lấy điểm không bị thẻ HUD che (elementFromPoint = canvas),
 * trả TÂM các điểm trúng (điểm ở mép có thể trượt khi camera còn trôi vài px sau khi dừng); null = bot không trên màn hình.
 */
const botPixel = (p: typeof pc, touch = false, id = B.userId) => p.evalJs(`(() => { const s = window.__officeScene, W = innerWidth, H = innerHeight, id = ${JSON.stringify(id)};
  const hit = (x, y) => s.botAt(x, y, ${touch}) === id && document.elementFromPoint(x, y)?.tagName === 'CANVAS';
  let sx = 0, sy = 0, n = 0, first = null;
  for (let y = 0; y < H; y += 6) for (let x = 0; x < W; x += 6) if (hit(x, y)) { sx += x; sy += y; n++; first ??= [x, y]; }
  if (!n) return null;
  const c = [Math.round(sx / n), Math.round(sy / n)];
  return hit(c[0], c[1]) ? c : first; })()`) as Promise<[number, number] | null>;
const click = async (p: typeof pc, x: number, y: number) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
};
const panel = (p: typeof pc) => p.evalJs(`(() => { const el = document.querySelector('[data-testid=office-bot-watch]'); if (!el) return null;
  return { bot: el.dataset.bot, text: el.innerText, state: el.querySelector('[data-testid=office-bot-watch-state]')?.textContent ?? '',
    lines: [...el.querySelectorAll('.bot-watch-line')].map((l) => ({ id: l.dataset.id, kind: l.dataset.kind, err: l.classList.contains('err'), text: l.innerText })),
    meta: el.querySelector('.bot-watch-meta')?.textContent ?? '' }; })()`) as Promise<{ bot: string; text: string; state: string; lines: { id: string; kind: string; err: boolean; text: string }[]; meta: string } | null>;
/** Chờ bảng mở (và WatchBot đã trả về — hết "Đang kết nối…") hoặc đóng. */
const waitPanel = async (p: typeof pc, want: boolean, ms = 5000) => {
  for (let t = 0; t < ms; t += 200) {
    const v = await panel(p);
    if (want ? !!v && v.state !== 'Đang kết nối…' : !v) return v;
    await p.sleep(200);
  }
  return await panel(p);
};
const toastHas = async (p: typeof pc, text: string, ms = 4000) => {
  for (let t = 0; t < ms; t += 200) { if (await p.evalJs(`document.body.innerText.includes(${JSON.stringify(text)})`)) return true; await p.sleep(200); }
  return false;
};

// --- Đứng xa (~8,5 m, ngoài 6 m) bấm bot → chỉ gợi ý, không mở bảng, không gọi hub
const far = await walk(pc, bot.x + 8.5, bot.z + 1);
ok('H1 đi tới chỗ cách bot > 7 m', !!far && dist(far, bot) > 7, far && dist(far, bot));
let px = await botPixel(pc);
ok('bot hiện trên màn hình khi đứng xa (có điểm bấm)', !!px, px);
if (px) {
  await click(pc, px[0], px[1]);
  ok('bấm bot từ xa → gợi ý "Lại gần hơn để xem <tên bot> đang làm gì"', await toastHas(pc, `Lại gần hơn để xem ${B.name} đang làm gì`));
  ok('…và không mở bảng', (await waitPanel(pc, true, 1200)) === null);
  const snap = await pc.evalJs('window.__officeScene.snapshot().target');
  ok('…và không đi bộ tới chỗ bot (không có điểm đến)', snap === null, snap);
}

// --- Lại gần (~2 m) → bấm → WatchBot → bảng có đệm phiên
const near = await walk(pc, bot.x + 1.6, bot.z + 1.4);
ok('H1 đi tới cạnh bot (≤ 6 m)', !!near && dist(near, bot) <= 6, near && dist(near, bot));
px = await botPixel(pc);
ok('có điểm bấm trúng bot (chuột, bán kính ≥ 18 px)', !!px, px);
await pc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px![0], y: px![1] });
await pc.sleep(100);
ok('rê chuột lên bot → con trỏ bàn tay', (await pc.evalJs(`document.querySelector('.office-root .scene canvas').style.cursor`)) === 'pointer');
await pc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 40, y: innerFloor(900) });
await pc.sleep(100);
ok('rê ra sàn → con trỏ thường', (await pc.evalJs(`document.querySelector('.office-root .scene canvas').style.cursor`)) === '');
function innerFloor(h: number) { return h - 300; }
await click(pc, px![0], px![1]);
let v = await waitPanel(pc, true);
ok('bấm bot khi đứng gần → mở bảng xem bot đúng bot', v?.bot === B.userId, v);
ok('bảng: tên bot + "Đang làm · TEST-97 · Xem bot" (busy / task từ WatchBot)', !!v && v.text.includes(B.name) && v.state === 'Đang làm · TEST-97 · Xem bot', v?.state);
ok('bảng: 2 sự kiện của đệm phiên (session_start + command), xếp theo seq', v?.lines.map((l) => l.id).join(',') === 's1,c1', v?.lines);
ok('bảng: model từ session_start', v?.meta.includes('claude-fable-5-1'), v?.meta);
ok('không đi bộ tới chỗ bot khi bấm bot', (await pc.evalJs('window.__officeScene.snapshot().target')) === null);
await pc.shot(`${SHOTS}/desktop-panel.png`);

// --- Sự kiện trực tiếp: thêm, cập nhật cùng id, session_end (chi phí), session_start mới xoá cũ
await feed([{ id: 'f1', kind: 'file_edit', title: 'Sửa src/a.ts', path: 'frontend/src/a.ts', diff: '-a\n+b' }, { id: 't1', kind: 'thinking', text: 'Nghĩ về cách sửa…' }]);
await pc.sleep(700);
v = await panel(pc);
ok('lô mới → 4 dòng (f1, t1 thêm vào sau)', v?.lines.map((l) => l.id).join(',') === 's1,c1,f1,t1', v?.lines.map((l) => l.id));
ok('dòng file_edit có đường dẫn', v?.lines.find((l) => l.id === 'f1')?.text.includes('frontend/src/a.ts'));
await feed([{ id: 'c1', kind: 'command', ok: false, output: 'error TS2322' }]);
await pc.sleep(700);
v = await panel(pc);
ok('gửi lại cùng id c1 (ok=false) → cập nhật tại chỗ, vẫn 4 dòng, đánh dấu lỗi', v?.lines.length === 4 && v.lines[1]?.id === 'c1' && v.lines[1].err && v.lines[1].text.includes('lỗi'), v?.lines[1]);
ok('…giữ nội dung cũ (lệnh) khi trường mới null', v?.lines[1]?.text.includes('bun run build'), v?.lines[1]?.text);
await feed([{ id: 'e1', kind: 'session_end', title: 'Xong', turns: 12, costUsd: 0.37 }]);
await pc.sleep(700);
v = await panel(pc);
ok('session_end → 5 dòng, meta có lượt + chi phí', v?.lines.length === 5 && v.meta.includes('12 lượt') && v.meta.includes('$0.37'), v?.meta);
await feed([{ id: 's2', kind: 'session_start', title: 'Phiên mới', task: 'TEST-98 · Bảng', model: 'claude-opus-5-5' }, { id: 'c2', kind: 'command', text: 'git status' }]);
await pc.sleep(700);
v = await panel(pc);
ok('session_start mới → bỏ sự kiện phiên cũ, còn s2 + c2', v?.lines.map((l) => l.id).join(',') === 's2,c2', v?.lines.map((l) => l.id));
ok('…meta đổi theo phiên mới (model mới, không còn chi phí cũ)', !!v && v.meta.includes('claude-opus-5-5') && !v.meta.includes('$0.37'), v?.meta);

// --- Bấm sàn vẫn đi bộ như cũ (bảng vẫn mở)
const floor = await pc.evalJs(`(() => { const s = window.__officeScene; for (let y = innerHeight - 120; y > 200; y -= 16) for (let x = 200; x < innerWidth - 300; x += 16)
  if (!s.botAt(x, y) && document.elementFromPoint(x, y)?.tagName === 'CANVAS') return [x, y]; return null; })()`) as [number, number] | null;
await click(pc, floor![0], floor![1]);
await pc.sleep(150);
const walking = await pc.evalJs('window.__officeScene.snapshot().target !== null');
ok('bấm sàn (không trúng bot) → vẫn đặt điểm đến / đi bộ như cũ', walking);
await pc.sleep(2500);

// --- Nút Đóng → UnwatchBot (sự kiện mới không tới nữa), mở lại được
await pc.evalJs(`document.querySelector('[data-testid=office-bot-watch-close]')?.click()`);
ok('bấm Đóng → bảng biến mất', (await waitPanel(pc, false, 2000)) === null);
await feed([{ id: 'c3', kind: 'command', text: 'ls' }]);
await pc.sleep(600);
ok('…đã đóng thì không hiện lại khi có sự kiện mới (UnwatchBot)', (await panel(pc)) === null);
const back = await walk(pc, bot.x + 1.6, bot.z + 1.4);
px = back ? await botPixel(pc) : null;
if (px) await click(pc, px[0], px[1]);
v = await waitPanel(pc, true);
ok('mở lại → đệm hiện tại gồm c3 (s2, c2, c3)', v?.lines.map((l) => l.id).join(',') === 's2,c2,c3', v?.lines.map((l) => l.id));

// ---------- TEST-98: bảng đầy đủ "Màn hình của bot" (đủ 10 loại sự kiện, thu gọn, cuộn, Esc, theme, kéo / đổi cỡ, trạng thái rỗng) ----------
const q = (p: typeof pc, js: string) => p.evalJs(`(() => { const P = document.querySelector('[data-testid=office-bot-watch]'); if (!P) return null; const L = (id) => P.querySelector('.bot-watch-line[data-id="' + id + '"]'); ${js} })()`);
const XSS = '<script>window.__xss = 1</script><img src=x onerror="window.__xss = 2"> <b>đậm?</b>';
const long = (n: number, pre: string) => Array.from({ length: n }, (_, i) => `${pre} ${i + 1}`).join('\n');
await feed([
  { id: 's3', kind: 'session_start', title: 'Bắt đầu', task: 'TEST-98 · Bảng màn hình bot', model: 'claude-opus-5-5' },
  { id: 'k-cmd', kind: 'command', title: 'Build front-end', text: 'bun run build' },
  { id: 'k-edit', kind: 'file_edit', path: 'frontend/src/a.ts', diff: '@@ -1,2 +1,2 @@\n giữ nguyên\n-const a = 1;\n+const a = 2;' },
  { id: 'k-write', kind: 'file_write', path: 'docs/new.md', diff: long(30, '+dòng') },
  { id: 'k-read', kind: 'file_read', path: 'backend/src/Program.cs' },
  { id: 'k-search', kind: 'search', text: 'useBotWatch', path: 'frontend/src' },
  { id: 'k-tool', kind: 'tool', title: 'Bình luận việc', text: 'comment_task · TEST-98' },
  { id: 'k-think', kind: 'thinking', text: `Cần sửa hook trước.\n${XSS}` },
  { id: 'k-say', kind: 'say', text: `Đã **xong** bước 1.\n\n- mục một\n\n![theo dõi](https://tracker.invalid/p.png)\n\n${XSS}` },
]);
await pc.sleep(800);
v = await panel(pc);
ok('[98] đủ 9 dòng của phiên mới, đúng thứ tự', v?.lines.map((l) => l.id).join(',') === 's3,k-cmd,k-edit,k-write,k-read,k-search,k-tool,k-think,k-say', v?.lines.map((l) => l.id));
ok('[98] đầu bảng: nhãn ● Trực tiếp + model + thời gian đã chạy', await q(pc, `return !!P.querySelector('[data-testid=office-bot-live]') && P.querySelector('.bot-watch-meta').textContent.includes('claude-opus-5-5') && /giây|phút/.test(P.querySelector('[data-testid=office-bot-elapsed]')?.textContent ?? '')`));
ok('[98] vạch ngăn session_start kèm tên việc', await q(pc, `return L('s3').classList.contains('bot-act-sep') && L('s3').innerText.includes('TEST-98 · Bảng màn hình bot')`));
ok('[98] lệnh: khối terminal nền tối, chữ mono, "$ lệnh", đang chạy có dấu quay', await q(pc, `const t = L('k-cmd'), cs = getComputedStyle(t), pre = t.querySelector('.bot-act-cmd');
  const [r, g, b] = cs.backgroundColor.match(/\\d+/g).map(Number);
  return r + g + b < 120 && /mono/i.test(getComputedStyle(pre).fontFamily) && pre.textContent.startsWith('$ bun run build') && !!t.querySelector('[data-testid=office-bot-running]')`));
await feed([{ id: 'k-cmd', kind: 'command', ok: true, output: long(30, 'out') }]);
await pc.sleep(700);
ok('[98] kết quả lệnh về sau → cập nhật đúng khối lệnh (hết dấu quay, vẫn 9 dòng), > 12 dòng thì thu gọn còn 12 dòng cuối', await q(pc, `const t = L('k-cmd'), out = t.querySelector('.bot-act-out');
  return P.querySelectorAll('.bot-watch-line').length === 9 && !t.querySelector('[data-testid=office-bot-running]') && out.textContent.split('\\n').length === 12 && out.textContent.endsWith('out 30') && !out.textContent.includes('out 18\\n') && !!t.querySelector('[data-testid=office-bot-fold]')`));
ok('[98] bấm mở → hiện cả 30 dòng', await q(pc, `const t = L('k-cmd'); t.querySelector('[data-testid=office-bot-fold]').click(); return new Promise((r) => setTimeout(() => r(t.querySelector('.bot-act-out').textContent.split('\\n').length === 30), 150))`));
ok('[98] diff: dòng - đỏ / + xanh (màu khác nhau, có nền), đường dẫn file', await q(pc, `const t = L('k-edit'), add = t.querySelector('.bot-act-diff .add'), del = t.querySelector('.bot-act-diff .del');
  return t.innerText.includes('frontend/src/a.ts') && add.textContent.trim() === '+const a = 2;' && del.textContent.trim() === '-const a = 1;' && getComputedStyle(add).color !== getComputedStyle(del).color && getComputedStyle(add).backgroundColor !== getComputedStyle(del).backgroundColor`));
ok('[98] file_write dài 30 dòng → thu gọn 12 dòng đầu + nút mở', await q(pc, `const t = L('k-write'); return t.querySelectorAll('.bot-act-diff span').length === 12 && t.querySelector('.bot-act-diff').textContent.startsWith('+dòng 1\\n') && !!t.querySelector('[data-testid=office-bot-fold]')`));
ok('[98] file_read / search / tool: một dòng gọn có nội dung', await q(pc, `const h = (id) => L(id).getBoundingClientRect().height;
  return L('k-read').innerText.includes('backend/src/Program.cs') && L('k-search').innerText.includes('useBotWatch') && L('k-tool').innerText.includes('Bình luận việc') && L('k-tool').innerText.includes('comment_task · TEST-98') && h('k-read') < 40 && h('k-search') < 40 && h('k-tool') < 40`));
ok('[98] suy nghĩ: chữ nghiêng, có nhãn "Suy nghĩ"', await q(pc, `const t = L('k-think'); return t.innerText.includes('Suy nghĩ') && getComputedStyle(t.querySelector('.bot-act-think-text')).fontStyle === 'italic'`));
ok('[98] lời agent: Markdown (đậm, danh sách), không tải ảnh', await q(pc, `const t = L('k-say'); return !!t.querySelector('strong') && !!t.querySelector('li') && !t.querySelector('img')`));
ok('[98] chuỗi có thẻ HTML / script hiện nguyên văn, không chạy, không sinh thẻ', await q(pc, `return window.__xss === undefined && !P.querySelector('script, img, iframe') && L('k-think').innerText.includes('<script>window.__xss = 1</script>') && L('k-say').innerText.includes('<img src=x') && !L('k-say').querySelector('b')`));
ok('[98] không gọi tài nguyên ngoài (tracker.invalid)', await pc.evalJs(`performance.getEntriesByType('resource').every((r) => !r.name.includes('tracker.invalid'))`));
await pc.shot(`${SHOTS}/desktop-full-light-or-default.png`);

// Theme sáng / tối: màu nền bảng theo token → đổi theo class .dark của app; khối terminal luôn tối
const bg = async (dark: boolean) => { await pc.evalJs(`document.documentElement.classList.toggle('dark', ${dark}); document.documentElement.classList.toggle('light', ${!dark})`); await pc.sleep(200);
  return await q(pc, `return [getComputedStyle(P).backgroundColor, getComputedStyle(L('k-cmd')).backgroundColor]`) as [string, string]; };
const hadDark = await pc.evalJs(`document.documentElement.classList.contains('dark')`);
const bgDark = await bg(true);
await pc.shot(`${SHOTS}/desktop-full-dark.png`);
const bgLight = await bg(false);
await pc.shot(`${SHOTS}/desktop-full-light.png`);
ok('[98] theme sáng / tối: nền bảng đổi theo theme, terminal giữ nền tối', bgDark[0] !== bgLight[0] && bgDark[1] === bgLight[1], { bgDark, bgLight });
await bg(!!hadDark);

// Cuộn: đang ở cuối → tự cuộn; người xem cuộn lên → không bị kéo xuống + nút "Về mới nhất"
const scroll = () => q(pc, `const l = P.querySelector('[data-testid=office-bot-log]'); return { top: l.scrollTop, gap: l.scrollHeight - l.scrollTop - l.clientHeight, latest: !!P.querySelector('[data-testid=office-bot-latest]') }`) as Promise<{ top: number; gap: number; latest: boolean }>;
await feed([{ id: 'k-say2', kind: 'say', text: 'Tin mới 1' }]);
await pc.sleep(700);
let sc = await scroll();
ok('[98] đang ở cuối → sự kiện mới tự cuộn xuống cuối, không có nút "Về mới nhất"', sc.gap <= 2 && !sc.latest, sc);
await q(pc, `P.querySelector('[data-testid=office-bot-log]').scrollTop = 40; return 1`);
await pc.sleep(300);
await feed([{ id: 'k-say3', kind: 'say', text: 'Tin mới 2' }, { id: 'k-cmd2', kind: 'command', text: 'dotnet test' }]);
await pc.sleep(700);
sc = await scroll();
ok('[98] đã cuộn lên → sự kiện mới KHÔNG kéo xuống, hiện nút "Về mới nhất"', Math.abs(sc.top - 40) <= 1 && sc.gap > 50 && sc.latest, sc);
await q(pc, `P.querySelector('[data-testid=office-bot-latest]').click(); return 1`);
await pc.sleep(300);
sc = await scroll();
ok('[98] bấm "Về mới nhất" → xuống cuối, nút biến mất, lại tự cuộn', sc.gap <= 2 && !sc.latest, sc);

// Dồn dập: 150 sự kiện trong 3 lô liền nhau → danh sách ≤ 200, vẫn bám cuối
for (let b = 0; b < 3; b++) await feed(Array.from({ length: 50 }, (_, i) => ({ id: `burst-${b}-${i}`, kind: 'file_read', path: `src/f${b}-${i}.ts` })));
await feed(Array.from({ length: 50 }, (_, i) => ({ id: `burst-3-${i}`, kind: 'tool', title: `Tool ${i}` })));
await pc.sleep(1200);
sc = await scroll();
ok('[98] 200 sự kiện dồn dập → danh sách đúng 200 mục (bỏ cũ nhất), vẫn ở cuối', (await q(pc, `return P.querySelectorAll('.bot-watch-line').length`)) === 200 && sc.gap <= 2, sc);

// Kéo (đầu bảng) + đổi cỡ (tay nắm) như chat nổi; bảng không che tâm màn hình (nhân vật của mình)
const rectOf = () => q(pc, `const r = P.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }`) as Promise<{ x: number; y: number; w: number; h: number }>;
const drag = async (x0: number, y0: number, dx: number, dy: number) => {
  await pc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0, y: y0 });
  await pc.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x0, y: y0, button: 'left', clickCount: 1 });
  for (let i = 1; i <= 4; i++) await pc.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x0 + (dx * i) / 4, y: y0 + (dy * i) / 4, button: 'left', buttons: 1 });
  await pc.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x0 + dx, y: y0 + dy, button: 'left', clickCount: 1 });
  await pc.sleep(200);
};
const r0 = await rectOf();
ok('[98] vị trí mặc định: nổi bên phải, không che tâm màn hình (nhân vật của mình), không đè bản đồ nhỏ', r0.x > 720 + 30 && r0.x + r0.w <= 1440 - 228, r0);
await drag(r0.x + r0.w / 2, r0.y + 16, -60, 40);
const r1 = await rectOf();
ok('[98] kéo đầu bảng → bảng di chuyển, giữ kích thước', Math.abs(r1.x - (r0.x - 60)) <= 2 && Math.abs(r1.y - (r0.y + 40)) <= 2 && Math.abs(r1.w - r0.w) <= 1, { r0, r1 });
await drag(r1.x + r1.w - 6, r1.y + r1.h - 6, 50, -80);
const r2 = await rectOf();
ok('[98] kéo tay nắm góc → đổi kích thước', Math.abs(r2.w - (r1.w + 50)) <= 2 && Math.abs(r2.h - (r1.h - 80)) <= 2, { r1, r2 });
ok('[98] chỉ nhớ vị trí bảng, không lưu sự kiện vào localStorage', await pc.evalJs(`Object.entries(localStorage).every(([k, val]) => !/burst-|k-cmd|dotnet test|Tin mới/.test(k + val))`));

// ---------- TEST-102: kéo đổi vị trí + đổi kích thước — luôn trong màn hình, không lọt xuống canvas 3D (phần nhớ vị trí: sau mục [100]) ----------
let rM102 = { x: 0, y: 0, w: 0, h: 0 }; // vị trí + kích thước đã đặt, dùng lại ở phần nhớ vị trí (sau mục [100])
{
  const W = 1440, H = 900, M = 8; // lề của use-floating-panel
  type R = { x: number; y: number; w: number; h: number };
  const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
  const inside = (r: R, w = W, h = H) => r.x >= M - 0.5 && r.y >= M - 0.5 && r.x + r.w <= w - M + 0.5 && r.y + r.h <= h - M + 0.5;
  const sameRect = (a: R, b: R) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
  const dragTo = (x0: number, y0: number, x1: number, y1: number) => drag(x0, y0, x1 - x0, y1 - y0);
  const head = async () => { const r = await rectOf(); return { x: r.x + r.w / 2, y: r.y + 14 }; };
  const grip = async () => { const r = await rectOf(); return { x: r.x + r.w - 5, y: r.y + r.h - 5 }; };
  type Scene = { x: number; z: number; az: number; dist: number; target: unknown };
  const scene = () => pc.evalJs(`(() => { const s = window.__officeScene, m = s.snapshot().me; return { x: m.x, z: m.z, az: s.azimuth, dist: s.distance, target: s.snapshot().target }; })()`) as Promise<Scene>;
  const sameScene = (a: Scene, b: Scene) => near(a.x, b.x, 0.01) && near(a.z, b.z, 0.01) && near(a.az, b.az, 0.001) && near(a.dist, b.dist, 0.001) && b.target === null;
  const s0 = await scene();

  // Kéo ra 4 mép → không lọt khỏi màn hình (lề 8 px), giữ kích thước
  let r = await rectOf();
  const size = { w: r.w, h: r.h };
  for (const [tx, ty, name] of [[2, 2, 'trên trái'], [W - 2, 2, 'trên phải'], [W - 2, H - 2, 'dưới phải'], [2, H - 2, 'dưới trái']] as const) {
    const g = await head();
    await dragTo(g.x, g.y, tx, ty);
    r = await rectOf();
    ok(`[102] kéo bảng ra mép ${name} → không lọt khỏi màn hình, giữ kích thước`, inside(r) && near(r.w, size.w) && near(r.h, size.h), r);
  }
  ok('[102] ở mép dưới trái: sát lề 8 px (không bị đẩy về chỗ mặc định)', near(r.x, M) && near(r.y + r.h, H - M), r);

  // Đổi cỡ: nhỏ hết cỡ → 320 × 220, nội dung không tràn, vẫn bám cuối; to hết cỡ → vừa màn hình trừ lề
  let g = await grip();
  await dragTo(g.x, g.y, r.x + 10, r.y + 10);
  r = await rectOf();
  ok('[102] kéo tay nắm nhỏ hết cỡ → 320 × 220', near(r.w, 320) && near(r.h, 220), r);
  const fitIn = () => q(pc, `const P0 = P.getBoundingClientRect(), l = P.querySelector('[data-testid=office-bot-log]'), L0 = l.getBoundingClientRect();
    const blocks = [...l.querySelectorAll('.bot-act-term, .bot-act-file, .bot-act-diff, .bot-act-say')];
    return { log: L0.left >= P0.left && L0.right <= P0.right + 0.5 && L0.bottom <= P0.bottom + 0.5 && l.scrollWidth <= l.clientWidth + 1, blocks: blocks.every((b) => b.getBoundingClientRect().right <= P0.right + 0.5),
      logH: L0.height, tabs: P.querySelector('.bot-act-tabs').getBoundingClientRect().bottom <= P0.bottom, gap: l.scrollHeight - l.scrollTop - l.clientHeight }`) as Promise<{ log: boolean; blocks: boolean; logH: number; tabs: boolean; gap: number }>;
  let f = await fitIn();
  ok('[102] bảng nhỏ nhất: thân cuộn nằm trong bảng, không tràn ngang, hàng tab còn thấy', f.log && f.blocks && f.tabs && f.logH > 60, f);
  ok('[102] …đổi cỡ khi đang ở cuối → vẫn bám cuối', f.gap <= 2, f);
  await pc.shot(`${SHOTS}/desktop-102-min.png`);
  g = await head();
  await dragTo(g.x, g.y, 2, 2);
  g = await grip();
  await dragTo(g.x, g.y, W - 1, H - 1);
  r = await rectOf();
  ok('[102] kéo tay nắm to hết cỡ → vừa màn hình trừ lề 8 px', near(r.w, W - 2 * M) && near(r.h, H - 2 * M) && inside(r), r);
  f = await fitIn();
  ok('[102] bảng to nhất: thân giãn theo bảng (> 600 px), nội dung trong bảng', f.log && f.blocks && f.logH > 600, f);
  await pc.shot(`${SHOTS}/desktop-102-max.png`);

  // Cỡ / vị trí giữa chừng để thử nhớ; đã cuộn lên rồi đổi cỡ → chỗ đang đọc đứng yên
  g = await grip();
  await dragTo(g.x, g.y, r.x + 520 - 5, r.y + 420 - 5); // tay nắm cách mép 5 px
  g = await head();
  await dragTo(g.x, g.y, 600, 180);
  const rM = await rectOf();
  rM102 = rM;
  ok('[102] đặt bảng ~520 × 420 ở giữa màn hình', near(rM.w, 520) && near(rM.h, 420) && inside(rM), rM);
  await q(pc, `P.querySelector('[data-testid=office-bot-log]').scrollTop = 60; return 1`);
  await pc.sleep(250);
  g = await grip();
  await dragTo(g.x, g.y, g.x + 40, g.y + 40);
  const top = await q(pc, `return P.querySelector('[data-testid=office-bot-log]').scrollTop`) as number;
  ok('[102] đã cuộn lên rồi đổi cỡ → chỗ đang đọc đứng yên (scrollTop ≈ 60), có nút "Về mới nhất"', near(top, 60, 1) && !!(await q(pc, `return !!P.querySelector('[data-testid=office-bot-latest]')`)), top);
  await q(pc, `P.querySelector('[data-testid=office-bot-latest]').click(); return 1`);
  g = await grip();
  await dragTo(g.x, g.y, g.x - 40, g.y - 40);
  ok('[102] trả cỡ về ~520 × 420', sameRect(await rectOf(), rM), { r: await rectOf(), rM });

  // Nhấn-kéo trên nút Đóng / tab, chọn chữ và lăn chuột trong thân: không di chuyển bảng, không đóng nhầm, không lọt xuống canvas
  const center = (sel: string) => q(pc, `const b = P.querySelector('${sel}').getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }`) as Promise<{ x: number; y: number }>;
  let b = await center('[data-testid=office-bot-watch-close]');
  await dragTo(b.x, b.y, b.x - 150, b.y + 150);
  ok('[102] nhấn trên nút Đóng rồi kéo ra ngoài → bảng không di chuyển, không đóng', !!(await panel(pc)) && sameRect(await rectOf(), rM), await rectOf());
  b = await center('[data-testid=office-bot-tab-files]');
  await dragTo(b.x, b.y, b.x + 12, b.y + 2);
  ok('[102] nhấn-kéo nhẹ trên tab "File đã sửa" → đổi tab, bảng không di chuyển', (await q(pc, `return P.querySelector('[data-testid=office-bot-tab-files]').getAttribute('aria-selected')`)) === 'true' && sameRect(await rectOf(), rM), await rectOf());
  await q(pc, `P.querySelector('[data-testid=office-bot-tab-log]').click(); return 1`);
  await pc.sleep(200);
  const line = await q(pc, `const l = P.querySelector('[data-testid=office-bot-log]'), L0 = l.getBoundingClientRect();
    const el = [...l.querySelectorAll('.bot-watch-line')].find((n) => { const b = n.getBoundingClientRect(); return b.top >= L0.top && b.bottom <= L0.bottom && b.height > 14; }); if (!el) return null;
    const b = el.getBoundingClientRect(); return { x: b.left + 6, y: b.top + 6, x1: Math.min(b.right - 6, b.left + 160), y1: Math.min(L0.bottom - 4, b.bottom + 20) }`) as { x: number; y: number; x1: number; y1: number } | null;
  if (line) await dragTo(line.x, line.y, line.x1, line.y1);
  const sel = await pc.evalJs(`getSelection().toString().length`) as number;
  ok('[102] kéo trong thân (chọn chữ) → bảng không di chuyển', !!line && sameRect(await rectOf(), rM), { line, r: await rectOf() });
  ok('[102] …và chọn được chữ như thường', sel > 0, sel);
  await pc.evalJs(`getSelection().removeAllRanges()`);
  const d0 = (await scene()).dist;
  const lg = await center('[data-testid=office-bot-log]');
  await pc.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: lg.x, y: lg.y, deltaX: 0, deltaY: -120 });
  await pc.sleep(300);
  const gap = await q(pc, `const l = P.querySelector('[data-testid=office-bot-log]'); return l.scrollHeight - l.scrollTop - l.clientHeight`) as number;
  ok('[102] lăn chuột trong thân → thân cuộn, camera 3D không zoom', gap > 20 && near((await scene()).dist, d0, 0.001), { gap, d0, d1: (await scene()).dist });
  await q(pc, `P.querySelector('[data-testid=office-bot-latest]')?.click(); return 1`);
  ok('[102] sau mọi thao tác kéo / đổi cỡ: nhân vật đứng yên, camera không xoay / zoom, không có điểm đến', sameScene(s0, await scene()), [s0, await scene()]);

}

// session_end: vạch tổng kết lượt + chi phí, hết "Trực tiếp", thời gian dừng đếm
await feed([{ id: 'e3', kind: 'session_end', title: 'Xong việc', turns: 7, costUsd: 1.25 }]);
await pc.sleep(700);
ok('[98] session_end: vạch ngăn có lượt + chi phí, mất nhãn Trực tiếp', await q(pc, `const t = L('e3'); return t.classList.contains('bot-act-sep') && t.innerText.includes('7 lượt') && t.innerText.includes('$1.25') && !P.querySelector('[data-testid=office-bot-live]')`));
const el1 = await q(pc, `return P.querySelector('[data-testid=office-bot-elapsed]')?.textContent`);
await pc.sleep(2100);
ok('[98] phiên xong → thời gian đã chạy đứng yên', !!el1 && el1 === await q(pc, `return P.querySelector('[data-testid=office-bot-elapsed]')?.textContent`), el1);

// Esc đóng bảng; trạng thái rỗng: bot rảnh / đang làm nhưng chưa có sự kiện
await pc.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
await pc.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
ok('[98] Esc → đóng bảng', (await waitPanel(pc, false, 2000)) === null);
const idle = await internal('/rt/internal/bot-activity', { ...presence, busy: false, task: null, activity: 'Nghỉ' }); // rảnh < 60 s: bot chưa đi ra Khu nghỉ
ok('[98] báo bot rảnh', idle.status < 300, idle);
await pc.sleep(500);
px = await botPixel(pc);
if (px) await click(pc, px[0], px[1]);
v = await waitPanel(pc, true);
ok('[98] bot rảnh, không có sự kiện → "☕ <tên bot> đang nghỉ, chưa có việc nào đang chạy"', v?.lines.length === 0 && v.text.includes(`☕ ${B.name} đang nghỉ, chưa có việc nào đang chạy`), v?.text);
await internal('/rt/internal/bot-activity', presence);
let waiting = false;
for (let t = 0; t < 4000 && !waiting; t += 250) { await pc.sleep(250); waiting = (await panel(pc))?.text.includes('Đang chờ thao tác đầu tiên…') === true; }
ok('[98] bot chuyển sang đang làm, chưa có sự kiện → "Đang chờ thao tác đầu tiên…"', waiting, (await panel(pc))?.text);
await feed([{ id: 's4', kind: 'session_start', task: 'TEST-97 · Xem bot', model: 'claude-fable-5-1' }, { id: 'c5', kind: 'command', title: 'Kiểm tra', text: 'git status', ok: false, output: 'fatal: <b>not</b> a git repository' },
  { id: 'd5', kind: 'file_edit', path: 'frontend/src/b.tsx', diff: '-<div>cũ</div>\n+<div>mới</div>' }, { id: 't5', kind: 'thinking', text: 'Thư mục này chưa có git.' }, { id: 'y5', kind: 'say', text: 'Mình sẽ **khởi tạo** repo.' }]);
await pc.sleep(700);
ok('[98] lệnh lỗi (ok = false): viền đỏ + nhãn lỗi', await q(pc, `const t = L('c5'); return t.classList.contains('err') && t.innerText.includes('lỗi') && /239|ef4444/.test(getComputedStyle(t).borderColor)`));

// ---------- TEST-100: tab "File đã sửa" (gộp theo file trong phiên, + / -, nhãn Mới, nội dung ẩn, mở diff, nháy, phiên mới → trống) ----------
const files = (p: typeof pc) => p.evalJs(`(() => { const P = document.querySelector('[data-testid=office-bot-watch]'); if (!P) return null;
  return { tab: P.querySelector('[data-testid=office-bot-tab-files]')?.textContent ?? '', text: P.querySelector('[data-testid=office-bot-files]')?.innerText ?? null,
    rows: [...P.querySelectorAll('.bot-file')].map((f) => ({ path: f.dataset.path, text: f.querySelector('.bot-file-row').innerText.replace(/\\s+/g, ' '),
      flash: f.querySelector('.bot-file-row').classList.contains('flash'), diffs: [...f.querySelectorAll('.bot-file-diffs > div')].map((d) => d.dataset.id) })) }; })()`) as
  Promise<{ tab: string; text: string | null; rows: { path: string; text: string; flash: boolean; diffs: string[] }[] } | null>;
await feed([{ id: 'a1', kind: 'file_edit', path: 'src/x.ts', diff: '-a\n+b\n+c' }, { id: 'w1', kind: 'file_write', path: 'docs/n.md', diff: '+1\n+2\n+3' },
  { id: 'a2', kind: 'file_edit', path: 'src/x.ts', diff: '--- a/src/x.ts\n+++ b/src/x.ts\n@@ -1 +1 @@\n-d\n+e' },
  { id: 'h1', kind: 'file_edit', path: '.env', text: '(nội dung ẩn: file nhạy cảm)' }, { id: 'bad', kind: 'file_edit', path: 'src/fail.ts', diff: '-x\n+y', ok: false }]);
await pc.sleep(700);
let fl = await files(pc);
ok('[100] nhãn tab có số file "File đã sửa (4)" (b.tsx, x.ts, n.md, .env — lần sửa lỗi không tính), mặc định vẫn ở tab Hoạt động', fl?.tab === 'File đã sửa (4)' && fl.text === null && (await panel(pc))!.lines.length > 0, fl);
await q(pc, `P.querySelector('[data-testid=office-bot-tab-files]').click(); return 1`);
await pc.sleep(300);
fl = await files(pc);
ok('[100] mở tab → mỗi file một dòng, file sửa gần nhất đứng đầu', fl?.rows.map((r) => r.path).join(',') === '.env,src/x.ts,docs/n.md,frontend/src/b.tsx', fl?.rows.map((r) => r.path));
const row = (path: string) => fl?.rows.find((r) => r.path === path);
ok('[100] sửa một file 2 lần → một dòng, cộng dồn +3 -2 (bỏ tiêu đề +++ / ---), "2 lần" + giờ', /\+3 -2/.test(row('src/x.ts')?.text ?? '') && /2 lần · \d\d:\d\d/.test(row('src/x.ts')?.text ?? ''), row('src/x.ts'));
ok('[100] file_write → nhãn "Mới" +3 -0; file_edit thường không có nhãn', !!row('docs/n.md')?.text.includes('Mới') && /\+3 -0/.test(row('docs/n.md')!.text) && !row('src/x.ts')!.text.includes('Mới'), row('docs/n.md'));
ok('[100] file nhạy cảm (không có diff) vẫn hiện tên + "nội dung ẩn"', !!row('.env')?.text.includes('nội dung ẩn') && !/\+\d/.test(row('.env')!.text), row('.env'));
ok('[100] ghi chú cuối tab + mở tab không nháy dòng nào', !!fl?.text?.includes('Chỉ gồm thay đổi từ lúc bạn bắt đầu xem và 200 thao tác gần nhất') && fl.rows.every((r) => !r.flash), fl?.text);
await q(pc, `P.querySelector('.bot-file[data-path="src/x.ts"] .bot-file-row').click(); return 1`);
await pc.sleep(300);
fl = await files(pc);
ok('[100] bấm file → mở các diff của file đó theo thứ tự thời gian (a1, a2), tô màu', row('src/x.ts')?.diffs.join(',') === 'a1,a2' && await q(pc, `return P.querySelectorAll('.bot-file-diffs .bot-act-diff .add').length === 3 && P.querySelectorAll('.bot-file-diffs .bot-act-diff .del').length === 2`), row('src/x.ts'));
await pc.shot(`${SHOTS}/desktop-files.png`);
await feed([{ id: 'a3', kind: 'file_edit', path: 'frontend/src/b.tsx', diff: '+thêm' }]);
await pc.sleep(700);
fl = await files(pc);
ok('[100] file vừa đổi nhảy lên đầu + nháy, cộng dồn +2 -1, file đang mở vẫn mở', fl?.rows[0]?.path === 'frontend/src/b.tsx' && fl.rows[0].flash && /\+2 -1/.test(fl.rows[0].text) && fl.rows.filter((r) => r.flash).length === 1 && row('src/x.ts')?.diffs.length === 2, fl?.rows);
await feed([{ id: 's5', kind: 'session_start', task: 'TEST-100 · File đã sửa', model: 'claude-fable-5-1' }]);
await pc.sleep(700);
fl = await files(pc);
ok('[100] session_start mới → danh sách trống "Chưa sửa file nào trong phiên này", nhãn tab hết số', fl?.rows.length === 0 && fl.tab === 'File đã sửa' && !!fl.text?.includes('Chưa sửa file nào trong phiên này'), fl);
await feed([{ id: 'a4', kind: 'file_edit', path: 'src/y.ts', diff: '-1\n+2' }]);
await q(pc, `P.querySelector('[data-testid=office-bot-tab-log]').click(); return 1`);
await pc.sleep(700);
v = await panel(pc);
ok('[100] về tab Hoạt động → dòng thời gian còn nguyên (s5, a4), bám cuối', v?.lines.map((l) => l.id).join(',') === 's5,a4' && (await scroll()).gap <= 2, v?.lines.map((l) => l.id));

// ---------- TEST-102 (tiếp): nhớ vị trí + kích thước — đóng mở lại, mở bot khác, tải lại trang; thu nhỏ cửa sổ → tự vào lại. Đặt sau [98] / [100]
// vì đóng / mở lại hoặc tải lại sau > 200 sự kiện làm mất model / thời gian của phiên (session_start đã rơi khỏi đệm — hành vi có sẵn của TEST-98) ----------
{
  const W = 1440, H = 900, M = 8;
  type R = { x: number; y: number; w: number; h: number };
  const near = (a: number, b: number, tol = 2) => Math.abs(a - b) <= tol;
  const inside = (r: R, w: number, h: number) => r.x >= M - 0.5 && r.y >= M - 0.5 && r.x + r.w <= w - M + 0.5 && r.y + r.h <= h - M + 0.5;
  const sameRect = (a: R, b: R) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
  const rM = rM102;
  let r: R;
  // Nhớ vị trí + kích thước: đóng mở lại, mở bot khác; localStorage chỉ có vị trí
  await pc.evalJs(`document.querySelector('[data-testid=office-bot-watch-close]')?.click()`);
  await waitPanel(pc, false, 2000);
  px = await botPixel(pc);
  if (px) await click(pc, px[0], px[1]);
  v = await waitPanel(pc, true);
  ok('[102] đóng rồi mở lại → đúng vị trí + kích thước cũ', v?.bot === B.userId && sameRect(await rectOf(), rM), await rectOf());
  await pc.evalJs(`document.querySelector('[data-testid=office-bot-watch-close]')?.click()`);
  await waitPanel(pc, false, 2000);
  const bot2 = await pc.evalJs(`window.__officeScene.botInfo(${JSON.stringify(B2.userId)})`) as { x: number; z: number } | null;
  ok('[102] thấy bot thứ hai trong 3D', !!bot2, bot2);
  if (bot2) {
    await walk(pc, bot2.x + 1.6, bot2.z + 1.4);
    px = await botPixel(pc, false, B2.userId);
    if (px) await click(pc, px[0], px[1]);
    v = await waitPanel(pc, true);
    ok('[102] mở bot khác → bảng của bot đó, vẫn ở vị trí + kích thước đã nhớ', v?.bot === B2.userId && v.state.includes('TEST-102 · Bot khác') && sameRect(await rectOf(), rM), { state: v?.state, r: await rectOf() });
    await pc.evalJs(`document.querySelector('[data-testid=office-bot-watch-close]')?.click()`);
    await waitPanel(pc, false, 2000);
  }
  // Về cạnh bot đầu và mở lại bảng (các kiểm tra [98] / [100] phía sau cần bảng của B đang mở)
  await walk(pc, bot.x + 1.6, bot.z + 1.4);
  px = await botPixel(pc);
  if (px) await click(pc, px[0], px[1]);
  v = await waitPanel(pc, true);
  ok('[102] về cạnh bot đầu, mở lại → vẫn đúng vị trí + kích thước', v?.bot === B.userId && sameRect(await rectOf(), rM), await rectOf());
  const stored = await pc.evalJs(`JSON.parse(localStorage.getItem('officehub.office.agent-screen-panel') || 'null')`) as { floating?: boolean; rect?: R } | null;
  ok('[102] localStorage chỉ có vị trí / kích thước (không sự kiện, không tên bot)', !!stored?.rect && Object.keys(stored).sort().join(',') === 'floating,rect' && near(stored.rect.w, rM.w) && near(stored.rect.h, rM.h), stored);
  await pc.go(`${BASE}/office`, 2500);
  ok('[102] tải lại trang', await ready(pc));
  await walk(pc, bot.x + 1.6, bot.z + 1.4);
  px = await botPixel(pc);
  if (px) await click(pc, px[0], px[1]);
  v = await waitPanel(pc, true);
  ok('[102] tải lại trang → mở bảng vẫn đúng vị trí + kích thước', v?.bot === B.userId && sameRect(await rectOf(), rM), await rectOf());

  // Thu nhỏ cửa sổ → bảng tự vào lại; cửa sổ rộng lại → về chỗ đã nhớ
  await pc.send('Emulation.setDeviceMetricsOverride', { width: 700, height: 500, deviceScaleFactor: 1, mobile: false });
  await pc.sleep(500);
  r = await rectOf();
  ok('[102] thu nhỏ cửa sổ 700 × 500 → bảng tự vào trong màn hình', inside(r, 700, 500), r);
  await pc.shot(`${SHOTS}/desktop-102-small-window.png`);
  await pc.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await pc.sleep(500);
  ok('[102] cửa sổ rộng lại → về vị trí + kích thước đã nhớ', sameRect(await rectOf(), rM), await rectOf());
}
await pc.evalJs(`localStorage.removeItem('officehub.office.agent-screen-panel')`);

// --- Đi ra xa (> 7 m quá 3 giây) → server ngắt: bảng đóng + "Bạn đã đi ra xa"
const away = await walk(pc, bot.x + 9.5, bot.z + 1);
ok('H1 đi ra xa > 7 m', !!away && dist(away, bot) > 7.3, away && dist(away, bot));
ok('đi ra xa → bảng tự đóng (BotWatchEnded range)', (await waitPanel(pc, false, 8000)) === null);
ok('…kèm gợi ý "Bạn đã đi ra xa"', await toastHas(pc, 'Bạn đã đi ra xa', 2000));

// --- Người thật của tài khoản bot vào văn phòng → bot không còn hiện → ngắt "Bot đã offline"
await walk(pc, bot.x + 1.6, bot.z + 1.4);
px = await botPixel(pc);
if (px) await click(pc, px[0], px[1]);
ok('mở lại bảng lần 3', (await waitPanel(pc, true))?.bot === B.userId);
const botHub = new sig.HubConnectionBuilder().withUrl(`${RT}/rt/hub/office`, { headers: { cookie: B.cookie }, transport: sig.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(sig.LogLevel.Warning).build();
for (const m of ['Welcome', 'PlayerJoined', 'PlayerLeft', 'Positions', 'BotStatus', 'Chat', 'LookChanged', 'NameChanged', 'Kicked', 'ScreenChanged', 'VoiceKick', 'Teleport', 'BotActivity', 'BotWatchEnded']) botHub.on(m, () => {});
await botHub.start();
ok('người thật của tài khoản bot vào 3D → bảng đóng (BotWatchEnded offline)', (await waitPanel(pc, false, 6000)) === null);
ok('…kèm "Bot đã offline"', await toastHas(pc, 'Bot đã offline', 2000));
await botHub.stop();
await sleep(800);
ok('người thật rời → avatar bot hiện lại', !!(await pc.evalJs(`window.__officeScene.botInfo(${JSON.stringify(B.userId)})`)));
ok('không lưu gì vào localStorage về bot / sự kiện', await pc.evalJs(`Object.keys(localStorage).every((k) => !/bot|watch|activity/i.test(k) && !/${B.userId}/.test(localStorage.getItem(k) || ''))`));

// ---------- Chrome điện thoại (chạm) ----------
const pm = await launch(9342, `${tmpdir()}/bw-chrome-h2-${stamp}`, 390, 844);
await pm.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await pm.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
ok('H2 (điện thoại) vào văn phòng 3D, thấy bot', await enter(pm, H2));
ok('H2 đi tới cạnh bot', !!(await walk(pm, bot.x - 1.4, bot.z + 1.4)));
const tp = await botPixel(pm, true);
ok('có điểm chạm trúng bot (bán kính ≥ 28 px)', !!tp, tp);
if (tp) {
  await pm.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tp[0], y: tp[1] }] });
  await pm.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const mv = await waitPanel(pm, true);
  ok('chạm vào bot trên điện thoại → mở bảng', mv?.bot === B.userId, mv?.state);
  ok('…bảng nằm trong màn hình điện thoại', await pm.evalJs(`(() => { const r = document.querySelector('[data-testid=office-bot-watch]')?.getBoundingClientRect(); return !!r && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight; })()`));
  await pm.shot(`${SHOTS}/mobile-panel.png`);
  const prect = () => pm.evalJs(`(() => { const r = document.querySelector('[data-testid=office-bot-watch]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, grip: !!document.querySelector('[data-testid=office-bot-resize]') }; })()`) as Promise<{ x: number; y: number; w: number; h: number; grip: boolean }>;
  const pr = await prect();
  ok('[102] điện thoại: bảng rộng hết màn hình (lề 12 px), không có tay nắm đổi cỡ', Math.abs(pr.x - 12) <= 1 && Math.abs(pr.x + pr.w - (390 - 12)) <= 1 && !pr.grip, pr);
  const hd = await pm.evalJs(`(() => { const r = document.querySelector('[data-testid=office-bot-drag]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`) as { x: number; y: number };
  await pm.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: hd.x, y: hd.y }] });
  for (let i = 1; i <= 6; i++) await pm.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: hd.x - 20 * i, y: hd.y + 40 * i }] });
  await pm.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await pm.sleep(300);
  const pr2 = await prect();
  ok('[102] điện thoại: chạm kéo đầu bảng → bảng không di chuyển / đổi cỡ', Math.abs(pr2.x - pr.x) <= 1 && Math.abs(pr2.y - pr.y) <= 1 && Math.abs(pr2.w - pr.w) <= 1 && Math.abs(pr2.h - pr.h) <= 1, { pr, pr2 });
  await pm.evalJs(`document.querySelector('[data-testid=office-bot-tab-files]')?.click()`);
  await pm.sleep(300);
  await pm.evalJs(`document.querySelector('.bot-file-row')?.click()`);
  await pm.sleep(300);
  ok('[100] điện thoại: tab "File đã sửa" có file + diff, nằm trong bảng, không tràn ngang', await pm.evalJs(`(() => { const P = document.querySelector('[data-testid=office-bot-watch]'), l = P?.querySelector('[data-testid=office-bot-files]'), d = l?.querySelector('.bot-file-diffs .bot-act-diff');
    if (!P || !l || !d) return false; const r = P.getBoundingClientRect(), f = l.getBoundingClientRect(); return f.left >= r.left && f.right <= r.right && f.bottom <= r.bottom + 1 && l.scrollWidth <= l.clientWidth + 1; })()`));
  await pm.shot(`${SHOTS}/mobile-files.png`);
  await pm.evalJs(`document.querySelector('[data-testid=office-bot-tab-log]')?.click()`);
}
ok('hai người cùng xem một bot không chen nhau (H1 vẫn xem được)', !!(await (async () => { await walk(pc, bot.x + 1.6, bot.z + 1.4); const p = await botPixel(pc); if (p) await click(pc, p[0], p[1]); return (await waitPanel(pc, true))?.bot === B.userId; })()));
await feed([{ id: 'c4', kind: 'command', text: 'bun test' }]);
await sleep(800);
ok('sự kiện mới tới cả 2 người xem', (await panel(pc))?.lines.some((l) => l.id === 'c4') === true && (await panel(pm))?.lines.some((l) => l.id === 'c4') === true);

const noise = (errs: string[]) => errs.filter((e) => !/livekit|voice|7880|net::ERR|Failed to load resource/i.test(e));
ok('không lỗi console (máy tính)', noise(pc.errors).length === 0, noise(pc.errors));
ok('không lỗi console (điện thoại)', noise(pm.errors).length === 0, noise(pm.errors));

pc.close();
pm.close();
console.log(`\n${pass} passed, ${fail} failed · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
