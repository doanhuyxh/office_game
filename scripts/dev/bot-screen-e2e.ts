// E2E: bot chiếu màn hình lên TV phòng họp (present_screen / present_markdown / stop_presenting) — người trong phòng nhận ScreenChanged live, người ngoài không;
// ảnh chỉ lấy được bằng URL có mã ngẫu nhiên (mã sai 404, no-store); 1 ảnh / 3 giây; ảnh không hợp lệ bị từ chối; chỉ bot, chỉ khi ở trong phòng
// có tường; người trong phòng "Tắt chiếu" → bot không tự bật lại trong 1 phút; stop_presenting; bot rời phòng → tự tắt, ảnh cũ 404.
// CHỈ DB tạm. Api :5180, Realtime :5190, Mcp :5200 (như bot-walk-e2e.ts). Mất ~1,5 phút (đợi hết 1 phút sau khi người tắt chiếu).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/bot-screen-e2e.ts
import { NavGrid } from '../../frontend/src/features/office/engine/navGrid';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
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
/** Request bằng token AI; `tool` = header X-Mcp-Tool (như host Mcp gửi), `ip` = X-Forwarded-For. */
const ai = async (token: string, method: string, path: string, opts: { tool?: string; ip?: string; body?: unknown } = {}) => {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  if (opts.tool) headers['X-Mcp-Tool'] = opts.tool;
  if (opts.ip) headers['X-Forwarded-For'] = opts.ip;
  return (await fetch(API + path, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) })).status;
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const RT = process.env.RT_URL ?? 'http://localhost:5190';
const MCP = process.env.MCP_URL ?? 'http://localhost:5200/mcp';
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const nav = new NavGrid(map);
const ROOM = map.rooms.find((r: any) => r.id === 'meeting-small');
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]).toString('base64');

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot chiếu ${stamp}`, code: `BS${stamp}`.slice(0, 10) })).body;
let seq = 400 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, userId, token, name };
};
const H = await mkEmp('Người Trong Phòng', `e2e.bs.h.${stamp}`);
const O = await mkEmp('Người Ngoài Phòng', `e2e.bs.o.${stamp}`);
const B = await mkEmp('Bot Trình Bày', `e2e.bs.b.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${B.e.id}/account/bot`, { isBot: true });

// ---------- Hai người vào văn phòng; H đi bộ vào phòng họp nhỏ ----------
const connect = async (cookie: string) => {
  const screens: any[] = [];
  let welcome: any = null;
  const c = new signalR.HubConnectionBuilder()
    .withUrl(`${RT}/rt/hub/office`, { headers: { cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
    .configureLogging(signalR.LogLevel.None).build();
  c.on('Welcome', (w: any) => { welcome = w; });
  c.on('ScreenChanged', (_room: string, s: any) => { screens.push(s); });
  for (const m of ['PlayerJoined', 'Positions', 'PlayerLeft', 'BotStatus', 'Chat', 'LookChanged', 'Kicked', 'VoiceKick', 'Teleport']) c.on(m, () => {});
  await c.start();
  for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
  return { c, screens, welcome };
};
const h = await connect(H.cookie), o = await connect(O.cookie);
ok('H, O vào văn phòng 3D', !!h.welcome && !!o.welcome);
const me = h.welcome.players.find((p: any) => p.id === H.userId);
const [ti, tj] = nav.nearestFree((ROOM.x0 + ROOM.x1) / 2, (ROOM.z0 + ROOM.z1) / 2)!;
const [tx, tz] = nav.center(ti, tj);
let [x, z] = [me.x, me.z];
for (const [px, pz] of nav.findPath(x, z, tx, tz)) {
  while (Math.hypot(px - x, pz - z) > 0.01) {
    const d = Math.hypot(px - x, pz - z), step = Math.min(0.5, d);
    x += ((px - x) / d) * step; z += ((pz - z) / d) * step;
    await h.c.invoke('Move', x, z, 0, 1);
    await Bun.sleep(100);
  }
}
await h.c.invoke('Move', x, z, 0, 0);
ok('H đi bộ vào phòng họp nhỏ', x >= ROOM.x0 && x <= ROOM.x1 && z >= ROOM.z0 && z <= ROOM.z1, { x, z });

let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc(token, 'tools/call', { name, arguments: args });
  const text = r?.result?.content?.[0]?.text ?? '';
  try { return { err: !!r?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!r?.result?.isError, j: null as any, text }; }
};

// ---------- Quyền + điều kiện ----------
const names: string[] = ((await rpc(B.token, 'tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
ok('tools/list có present_screen / present_markdown / present_document / stop_presenting (76 tool)', ['present_screen', 'present_markdown', 'present_document', 'stop_presenting'].every((n) => names.includes(n)) && names.length === 76, names.length);
ok('người thật dùng token → lỗi chỉ bot', (await call(H.token, 'present_screen', { image: PNG })).text.includes('Chỉ tài khoản bot'));
ok('bot chưa ở phòng có tường → lỗi go_to phòng họp trước', (await call(B.token, 'present_screen', { image: PNG })).text.includes('phòng có tường'));
const g = await call(B.token, 'go_to', { place: 'Phòng họp nhỏ' });
await Bun.sleep(Math.ceil(g.j?.seconds ?? 6) * 1000 + 1500);

// ---------- Chiếu ----------
const p1 = await call(B.token, 'present_screen', { image: PNG, caption: 'Đang sửa lỗi đăng nhập — WEB-12' });
ok('bot chiếu ảnh màn hình → 1 người xem trong phòng', !p1.err && p1.j.viewers === 1 && p1.j.live === true, p1.text);
await Bun.sleep(500);
const s1 = h.screens.at(-1);
ok('người trong phòng nhận ScreenChanged: live, chú thích, tên bot, URL /rt/screens/…', s1?.live === true && s1.title.includes('WEB-12') && s1.byName === 'Bot Trình Bày'
  && s1.kind === 'Image' && String(s1.url).startsWith('/rt/screens/meeting-small/'), s1);
ok('người ngoài phòng không nhận gì', o.screens.length === 0, o.screens);
const asH = { headers: { cookie: H.cookie } };
const img = await fetch(RT + s1.url, asH);
ok('tải ảnh bằng URL (người trong phòng): đúng PNG, không cache', img.status === 200 && img.headers.get('content-type') === 'image/png' && img.headers.get('cache-control') === 'no-store'
  && Buffer.from(await img.arrayBuffer()).equals(Buffer.from(PNG, 'base64')));
ok('mã trong URL sai → 404', (await fetch(`${RT}/rt/screens/meeting-small/${'0'.repeat(32)}`, asH)).status === 404);
ok('TEST-18: không đăng nhập → 401', (await fetch(RT + s1.url)).status === 401);
ok('TEST-18: người ngoài phòng có link → 404', (await fetch(RT + s1.url, { headers: { cookie: O.cookie } })).status === 404);
ok('cập nhật ngay (< 3 giây) → lỗi tần suất', (await call(B.token, 'present_screen', { image: PNG })).text.includes('3 giây'));
ok('ảnh không phải PNG/JPEG/WebP (svg) → lỗi', (await call(B.token, 'present_screen', { image: Buffer.from('<svg/>').toString('base64') })).text.includes('PNG, JPEG'));
await Bun.sleep(3100);
await call(B.token, 'present_screen', { image: JPEG_HEAD });
await Bun.sleep(500);
const s2 = h.screens.at(-1);
ok('khung mới: URL đổi ?v=2, cùng mã; tải ra JPEG', s2.url !== s1.url && s2.url.split('?')[0] === s1.url.split('?')[0] && s2.url.endsWith('v=2')
  && (await fetch(RT + s2.url, asH)).headers.get('content-type') === 'image/jpeg', s2.url);
ok('người tham gia sau (GetScreen) thấy màn hình bot', (await h.c.invoke('GetScreen'))?.live === true);

// ---------- Người trong phòng tắt ----------
await h.c.invoke('ClearScreen');
await Bun.sleep(300);
ok('người trong phòng bấm Tắt chiếu → màn hình tắt', h.screens.at(-1) === null);
ok('TEST-18: tắt chiếu → link ảnh bot hết hiệu lực ngay (404)', (await fetch(RT + s2.url, asH)).status === 404);
ok('bot chiếu lại ngay → bị chặn 1 phút', (await call(B.token, 'present_screen', { image: PNG })).text.includes('vừa tắt'));
console.log('… đợi hết 1 phút sau khi người tắt chiếu');
await Bun.sleep(61_000);
ok('sau 1 phút bot chiếu lại được', !(await call(B.token, 'present_screen', { image: PNG })).err);
await Bun.sleep(300);
const s3 = h.screens.at(-1);
const st = await call(B.token, 'stop_presenting');
await Bun.sleep(300);
ok('stop_presenting → tắt, ảnh cũ 404', st.j?.stopped === true && h.screens.at(-1) === null && (await fetch(RT + s3.url, asH)).status === 404, st.text);

// ---------- TEST-18: đường nội bộ kiểm khoá + giới hạn body trước khi đọc ----------
const big = 'x'.repeat(5 * 1024 * 1024);
const noKey = await fetch(`${RT}/rt/internal/bot-screen`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: big });
ok('/rt/internal không có khoá (body 5 MB) → 401', noKey.status === 401, noKey.status);
const KEY = process.env.CHAT_INTERNAL_KEY;
if (KEY) {
  const tooBig = await fetch(`${RT}/rt/internal/bot-activity`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': KEY }, body: big });
  ok('/rt/internal có khoá nhưng body quá giới hạn → 413', tooBig.status === 413, tooBig.status);
}

// ---------- Trình bày Markdown ----------
const MD = '# Tiến độ WEB-12\n\n- [x] Tìm lỗi\n- [ ] Sửa\n\n| Bước | Trạng thái |\n|---|---|\n| test | chạy |';
const m1 = await call(B.token, 'present_markdown', { content: MD, title: 'Tiến độ WEB-12' });
await Bun.sleep(300);
const s4 = h.screens.at(-1);
ok('present_markdown → người trong phòng nhận trang Markdown (live, không URL)', !m1.err && m1.j.viewers === 1 && s4?.kind === 'Markdown' && s4.live === true
  && s4.markdown === MD && s4.url === '' && s4.title === 'Tiến độ WEB-12', { m1: m1.text, s4 });
ok('người ngoài phòng vẫn không nhận gì', o.screens.length === 0, o.screens);
ok('cập nhật ngay (< 1 giây) → lỗi tần suất', (await call(B.token, 'present_markdown', { content: MD })).text.includes('1 lần / giây'));
ok('nội dung rỗng → lỗi', (await call(B.token, 'present_markdown', { content: '   ' })).err);
ok('quá 20.000 ký tự → lỗi', (await call(B.token, 'present_markdown', { content: 'a'.repeat(20_001) })).text.includes('dài quá'));
await Bun.sleep(1100);
await call(B.token, 'present_markdown', { content: MD.replace('[ ] Sửa', '[x] Sửa') + '\u0007' });
await Bun.sleep(300);
const s5 = h.screens.at(-1);
ok('cập nhật trang: tick checklist, ký tự điều khiển bị bỏ, tiêu đề mặc định theo tên bot', s5?.markdown === MD.replace('[ ] Sửa', '[x] Sửa')
  && s5.title === 'Bot Trình Bày đang trình bày', s5);
ok('người tham gia sau (GetScreen) thấy trang Markdown', (await h.c.invoke('GetScreen'))?.kind === 'Markdown');
const st2 = await call(B.token, 'stop_presenting');
await Bun.sleep(300);
ok('stop_presenting tắt trang Markdown', st2.j?.stopped === true && h.screens.at(-1) === null, st2.text);

// ---------- Rời phòng → tự tắt ----------
await Bun.sleep(3100);
await call(B.token, 'present_screen', { image: PNG });
await Bun.sleep(300);
ok('chiếu lại', h.screens.at(-1)?.live === true);
await call(B.token, 'go_to', { place: 'Pantry' });
await Bun.sleep(800);
ok('bot đứng dậy rời phòng → màn hình tự tắt ngay', h.screens.at(-1) === null, h.screens.at(-1));

await h.c.stop(); await o.c.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
