// E2E chat theo phòng + joystick cảm ứng (văn phòng 3D). Viết lại cho khung chat mới (TEST-126 / TEST-128): khung 3D dùng chung
// ConversationList / MessagePane của /chat (data-testid `chat-*` trong `[data-testid=office-chat]`), kênh phòng tự mở khi bước vào phòng.
// A, B vào Phòng họp lớn; C đứng ngoài (giả lập điện thoại). Chat phòng: chỉ A, B nhận. Chat chung: cả 3. Joystick C: nhân vật di chuyển.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm; dựng Api / Realtime / Vite như đầu `office-chat-full-e2e.ts`, rồi:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 BASE_URL=http://localhost:5173 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/office-chat-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- REST: tài khoản ----------
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 429) throw new Error('Đăng nhập bị giới hạn (429) — đợi 60 giây rồi chạy lại');
  if (r.status === 403 && body?.title === '2fa_required') {
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
    await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026', stamp = Date.now().toString(36).slice(-5);
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const mk = async (n: number, fullName: string) => {
  const user = `e2e.oc${n}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV5${stamp}${n}`.slice(0, 20), fullName, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return user;
};
const users = [await mk(1, 'Vũ Phòng Một'), await mk(2, 'Vũ Phòng Hai'), await mk(3, 'Vũ Ngoài Phòng')];

// ---------- Trình duyệt ----------
const NO_FREEZE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
  '--disable-features=PageFreeze,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'];
const A = await launch(9501, `${tmpdir()}/office-chat-${stamp}-a`, 1440, 900, NO_FREEZE), B = await launch(9502, `${tmpdir()}/office-chat-${stamp}-b`, 1440, 900, NO_FREEZE);
const C = await launch(9503, `${tmpdir()}/office-chat-${stamp}-c`, 390, 844, [...NO_FREEZE, '--touch-events=enabled']);
await C.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await C.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const all = [A, B, C];
type Br = typeof A;
const P3 = `document.querySelector('[data-testid=office-chat]')`;
const waitFor = async (b: Br, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await b.evalJs(expr)) return true; await sleep(250); } return false; };
const title = (b: Br) => b.evalJs(`${P3}?.querySelector('[data-testid=chat-title]')?.textContent ?? null`) as Promise<string | null>;
const hasMsg = (b: Br, text: string, ms = 8000) => waitFor(b, `[...(${P3}?.querySelectorAll('[data-testid=chat-message]') ?? [])].some((e) => e.textContent.includes(${JSON.stringify(text)}))`, ms);
const say = async (b: Br, text: string) => {
  await b.evalJs(`(() => { const i = ${P3}.querySelector('[data-testid=chat-input]'); const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await b.evalJs(`${P3}.querySelector('[data-testid=chat-send]').click()`);
  await sleep(1250); // 1 tin / giây / tài khoản
};
/** Chọn hội thoại theo tên (khung hẹp hai màn hình → "quay lại" danh sách trước). */
const pickConv = async (b: Br, name: string) => {
  const find = `[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].find((e) => e.textContent.includes(${JSON.stringify(name)}))`;
  if (!(await b.evalJs(`!!${find}`))) await b.evalJs(`${P3}.querySelector('[data-testid=chat-back]')?.click()`);
  await waitFor(b, `!!${find}`, 3000);
  await b.evalJs(`${find}?.click()`);
  return waitFor(b, `${P3}.querySelector('[data-testid=chat-title]')?.textContent === ${JSON.stringify(name)}`, 3000);
};
try {
  check('login', (await A.login(users[0], PW)) === 200 && (await B.login(users[1], PW)) === 200 && (await C.login(users[2], PW)) === 200);
  for (const b of all) { await b.evalJs(`localStorage.setItem('officehub.avatar.prompt-dismissed', '1')`); await b.go(`${BASE}/office`, 3000); }
  for (const b of all) await waitFor(b, `!!window.__officeScene?.myPosition() && !!document.querySelector('.office-root .status .dot.online')`, 25000);
  check('điện thoại: có joystick, chat đóng mặc định (nút "Tin nhắn")', await C.evalJs(`!!document.querySelector('[data-testid=office-joystick]') && !${P3} && !!document.querySelector('[data-testid=office-chat-open]')`));
  check('máy tính: không có joystick, khung chat mở sẵn', !(await A.evalJs("!!document.querySelector('[data-testid=office-joystick]')")) && await A.evalJs(`!!${P3}`));
  await C.evalJs(`document.querySelector('[data-testid=office-chat-open]').click()`);
  check('điện thoại: mở chat → danh sách hội thoại', await waitFor(C, `!!${P3}?.querySelector('[data-testid=chat-conversations]')`, 4000));

  await A.evalJs('window.__officeScene.walkTo(25, 6.5)');
  await B.evalJs('window.__officeScene.walkTo(27, 6.5)');
  check('A, B vào Phòng họp lớn → kênh phòng tự mở', await waitFor(A, `!!document.querySelector('[data-testid=office-chat-room-notice]')`, 20000)
    && await waitFor(B, `!!document.querySelector('[data-testid=office-chat-room-notice]')`, 20000) && (await title(A)) === 'Phòng họp lớn' && (await title(B)) === 'Phòng họp lớn',
    [await title(A), await title(B)]);
  check('C ngoài phòng: danh sách không có kênh phòng', !(await C.evalJs(`[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].some((e) => e.textContent.includes('Phòng họp lớn'))`)));

  await say(A, 'bí mật phòng họp');
  check('A thấy tin phòng ở kênh phòng', await hasMsg(A, 'bí mật phòng họp'));
  check('B nhận tin phòng', await hasMsg(B, 'bí mật phòng họp'));
  check('C KHÔNG có kênh phòng (Api 404)', await C.evalJs(`fetch('/api/chat/conversations/room:meeting-large/messages').then((r) => r.status)`) === 404
    && !(await C.evalJs(`${P3}.textContent.includes('bí mật')`)));

  check('C mở Toàn văn phòng', await pickConv(C, 'Toàn văn phòng'));
  await say(C, 'xin chào cả văn phòng');
  check('C thấy tin chung', await hasMsg(C, 'xin chào cả văn phòng'));
  check('A (đang ở kênh phòng): Toàn văn phòng có tin chưa đọc', await waitFor(A, `[...${P3}.querySelectorAll('[data-testid=chat-conversation]')].some((e) => e.textContent.includes('Toàn văn phòng') && !!e.querySelector('[data-testid=chat-conversation-unread]'))
    || !!document.querySelector('[data-testid=office-chat-button-unread]')`));
  check('chat chung tới A, B', await pickConv(A, 'Toàn văn phòng') && await hasMsg(A, 'xin chào cả văn phòng') && await pickConv(B, 'Toàn văn phòng') && await hasMsg(B, 'xin chào cả văn phòng'));
  check('tin phòng không lẫn vào kênh chung', !(await A.evalJs(`${P3}.querySelector('[data-testid=chat-messages]').textContent.includes('bí mật phòng họp')`)));

  // Joystick trên điện thoại: đóng khung chat, kéo phải 1 giây → nhân vật di chuyển
  await C.evalJs(`document.querySelector('[data-testid=office-chat-close]').click()`);
  await sleep(300);
  const before = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  const box = await C.evalJs("(() => { const r = document.querySelector('[data-testid=office-joystick]').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()");
  await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1 }] });
  for (let i = 1; i <= 10; i++) { await C.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + i * 6, y: box.y - i * 3, id: 1 }] }); await C.sleep(100); }
  await C.sleep(500);
  await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  const d = (a: string, b: string) => { const p = JSON.parse(a), q = JSON.parse(b); return Math.hypot(p.x - q.x, p.z - q.z); };
  check('joystick làm nhân vật di chuyển', d(before, after) > 0.5, { before, after });
  await C.sleep(800);
  const stopped = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  check('thả joystick → đứng lại', d(after, stopped) < 0.05, { after, stopped });
  for (const [n, b] of [['A', A], ['B', B], ['C', C]] as const) check(`không lỗi console ${n}`, b.errors.filter((e) => !/livekit|voice|ICE|WebSocket|getUserMedia|NotAllowed|favicon/i.test(e)).length === 0, b.errors.slice(0, 3));
} finally { for (const b of all) b.close(); }
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
