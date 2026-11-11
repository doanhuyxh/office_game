// E2E: bot đi bộ trong văn phòng 3D (tool MCP go_to / list_office_places) — người thật kết nối hub văn phòng thấy bot xuất hiện, đi từng bước
// (anim 1, vị trí đổi dần) rồi ngồi trong phòng họp nhỏ; bot thành thành viên kênh chat phòng và nhắn được; cạnh một người; về bàn;
// tên chỗ sai → lỗi kèm danh sách; người thật dùng token → lỗi; người thật của tài khoản bot đang trong văn phòng → không đi.
// CHỈ DB tạm. Api :5180, Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5180), Mcp :5200 (Mcp__ApiBaseUrl=…5180, Mcp__RealtimeBaseUrl=…5190).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/bot-walk-e2e.ts
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
const room = (id: string) => map.rooms.find((r: any) => r.id === id);
const inside = (r: any, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot đi ${stamp}`, code: `BW${stamp}`.slice(0, 10) })).body;
let seq = 500 + Math.floor(Math.random() * 90);
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
const H = await mkEmp('Người Xem Văn Phòng', `e2e.bw.h.${stamp}`);
const B = await mkEmp('Bot Đi Bộ', `e2e.bw.b.${stamp}`);
const N = await mkEmp('Người Dùng Claude', `e2e.bw.n.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${B.e.id}/account/bot`, { isBot: true });
ok('3 tài khoản, B là bot', [H, B, N].every((x) => x.userId && x.token?.startsWith('ohk_')));

// ---------- Người thật vào văn phòng 3D (hub) để quan sát ----------
type Pos = { id: string; x: number; z: number; r: number; anim: number };
const joined: any[] = [], moves: Pos[] = [];
const hub = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: H.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.Warning).build();
let welcome: any = null;
hub.on('Welcome', (w: any) => { welcome = w; });
hub.on('PlayerJoined', (p: any) => { joined.push(p); });
hub.on('Positions', (list: Pos[]) => { moves.push(...list); }); // không trả giá trị (SignalR coi là kết quả)
for (const m of ['PlayerLeft', 'BotStatus', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick']) hub.on(m, () => {});
await hub.start();
for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
ok('người thật vào văn phòng 3D (Welcome)', !!welcome, welcome);

let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const x = await rpc(token, 'tools/call', { name, arguments: args });
  const text = x?.result?.content?.[0]?.text ?? '';
  try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
};
const names: string[] = ((await rpc(B.token, 'tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
ok('tools/list có go_to + list_office_places (74 tool)', names.includes('go_to') && names.includes('list_office_places') && names.length === 74, names.length);
ok('người thật dùng token gọi go_to → lỗi "chỉ tài khoản bot"', (await call(N.token, 'go_to', { place: 'Phòng họp nhỏ' })).text.includes('Chỉ tài khoản bot'));

const lp = await call(B.token, 'list_office_places');
ok('list_office_places: bàn của tôi, phòng họp nhỏ, khu phòng ban, người đang online', !lp.err && lp.j.some((p: any) => p.kind === 'desk')
  && lp.j.some((p: any) => p.id === 'meeting-small') && lp.j.some((p: any) => p.kind === 'zone') && lp.j.some((p: any) => p.kind === 'person' && p.id === H.userId), lp.text.slice(0, 300));
const bad = await call(B.token, 'go_to', { place: 'sao hoả' });
ok('chỗ không có → lỗi kèm danh sách chỗ', bad.err && bad.text.includes('Không tìm thấy') && bad.text.includes('Phòng họp nhỏ'), bad.text.slice(0, 200));

// ---------- Đi bộ tới phòng họp nhỏ ----------
moves.length = 0;
const g1 = await call(B.token, 'go_to', { place: 'phong hop nho' });
ok('go_to "phong hop nho" (không dấu) → phòng họp nhỏ, có quãng đường + thời gian, ngồi', !g1.err && g1.j.place.id === 'meeting-small' && g1.j.distance > 1 && g1.j.seconds > 0 && g1.j.sit === true, g1.text);
ok('người thật thấy avatar bot xuất hiện (PlayerJoined, bot=true)', joined.some((p) => p.id === B.userId && p.bot === true), joined);
await Bun.sleep(Math.ceil(g1.j?.seconds ?? 5) * 1000 + 1500);
const botMoves = moves.filter((m) => m.id === B.userId);
const walking = botMoves.filter((m) => m.anim === 1);
const last = botMoves.at(-1);
ok('bot đi từng bước (nhiều gói Positions anim=1, vị trí đổi dần)', walking.length >= 3 && new Set(walking.map((m) => `${m.x.toFixed(1)},${m.z.toFixed(1)}`)).size >= 3, walking.length);
ok('bước đi ≤ 0,5 m mỗi nhịp (không dịch chuyển tức thì)', walking.every((m, i) => i === 0 || Math.hypot(m.x - walking[i - 1].x, m.z - walking[i - 1].z) <= 0.5));
ok('tới nơi: ngồi (anim 2) trong phòng họp nhỏ', !!last && last.anim === 2 && inside(room('meeting-small'), last.x, last.z), last);

// ---------- Kênh chat phòng ----------
await Bun.sleep(1000);
const lc = await call(B.token, 'list_chats');
const roomConv = lc.j?.find((c: any) => c.type === 'room');
ok('bot thành thành viên kênh chat "Phòng họp nhỏ"', roomConv?.title === 'Phòng họp nhỏ', lc.text.slice(0, 300));
const sent = await call(B.token, 'send_chat_message', { conversation: roomConv?.conversation, text: 'Mình đã vào phòng họp nhỏ.' });
ok('bot nhắn trong kênh phòng → gửi được, phát ngay', !sent.err && sent.j.sent === true && sent.j.deliveredLive === true, sent.text);
ok('người thật đăng nhập tài khoản bot (web) thấy kênh phòng + tin (lưu theo tài khoản)',
  ((await json(B.cookie, 'GET', '/api/chat/conversations')).body as any[]).some((c) => c.type === 'Room' && c.lastPreview?.includes('phòng họp nhỏ')));

// ---------- Ở lại; cạnh một người; về bàn ----------
moves.length = 0;
await call(B.token, 'list_my_tasks'); // gọi tool khác: bot không về bàn
await Bun.sleep(1500);
ok('gọi tool khác → bot vẫn ở phòng họp (không về bàn)', !moves.some((m) => m.id === B.userId && m.anim === 1));
const g2 = await call(B.token, 'go_to', { place: `cạnh ${H.name}` });
ok('go_to cạnh người đang online', !g2.err && g2.j.place.kind === 'person', g2.text);
const hPos = welcome.players.find((p: any) => p.id === H.userId);
await Bun.sleep(Math.ceil(g2.j?.seconds ?? 5) * 1000 + 1500);
const near = moves.filter((m) => m.id === B.userId).at(-1);
ok('tới đứng cạnh người đó (≤ 1,6 m, anim 0)', !!near && near.anim === 0 && Math.hypot(near.x - hPos.x, near.z - hPos.z) <= 1.6, { near, hPos });
const g3 = await call(B.token, 'go_to', { place: 'bàn của tôi' });
await Bun.sleep(Math.ceil(g3.j?.seconds ?? 5) * 1000 + 1500);
const desk = moves.filter((m) => m.id === B.userId).at(-1);
ok('"bàn của tôi" → về bàn và ngồi', !g3.err && g3.j.place.kind === 'desk' && desk?.anim === 2, { g3: g3.text, desk });
await hub.stop();

// ---------- Người thật của tài khoản bot đang trong văn phòng → bot không đi ----------
const own = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: B.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.None).build();
for (const m of ['Welcome', 'PlayerJoined', 'Positions', 'PlayerLeft', 'BotStatus', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick']) own.on(m, () => {});
await own.start();
await Bun.sleep(800);
const busy = await call(B.token, 'go_to', { place: 'Pantry' });
ok('người thật đang dùng tài khoản bot trong 3D → go_to báo lỗi', busy.err && busy.text.includes('người thật'), busy.text);
await own.stop();

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
