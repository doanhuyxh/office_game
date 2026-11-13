// E2E TEST-97: bấm vào bot trong văn phòng 3D để xem bot đang làm gì (FE): chọn avatar bot bằng chuột + chạm (vùng bấm theo màn hình),
// kiểm phạm vi nghe ở client (xa → gợi ý "Lại gần hơn…", không gọi hub), WatchBot → bảng tạm nhận đệm + sự kiện trực tiếp (gộp theo id,
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
const feed = (events: any[]) => internal('/rt/internal/bot-activity-feed', { userId: B.userId, events });
const first = await feed([{ id: 's1', kind: 'session_start', title: 'Bắt đầu', task: 'TEST-97 · Xem bot', model: 'claude-fable-5-1' },
  { id: 'c1', kind: 'command', title: 'Chạy lệnh', text: 'bun run build' }]);
ok('bơm 2 sự kiện đầu (đệm phiên)', first.status === 200 && first.body?.accepted === 2, first);

// ---------- Chrome máy tính ----------
const sig = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const pc = await launch(9341, `${tmpdir()}/bw-chrome-h1-${stamp}`, 1440, 900);
const enter = async (p: typeof pc, who: { user: string }) => {
  const st = await p.login(who.user, PW);
  if (st !== 200) throw new Error(`Đăng nhập ${who.user} → ${st}`);
  await p.go(`${BASE}/office`, 2500);
  for (let i = 0; i < 60; i++) {
    const ready = await p.evalJs(`!!(window.__officeScene && window.__officeScene.myPosition() && document.querySelector('.office-root .status .dot.online') && window.__officeScene.botInfo(${JSON.stringify(B.userId)}))`);
    if (ready) {
      // Tắt thẻ Hướng dẫn (che một mảng màn hình — nhất là trên điện thoại) để bấm tới được canvas
      await p.evalJs(`document.querySelector('[data-testid=office-help] button')?.click()`);
      return true;
    }
    await p.sleep(500);
  }
  return false;
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
const botPixel = (p: typeof pc, touch = false) => p.evalJs(`(() => { const s = window.__officeScene, W = innerWidth, H = innerHeight, id = ${JSON.stringify(B.userId)};
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
