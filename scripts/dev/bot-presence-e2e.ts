// E2E: bot đang làm / rảnh trong văn phòng 3D (2026-11-13) — agent-runner báo POST /mcp/presence (token AI, chỉ tài khoản bot);
// không có runner thì OfficeHub.Mcp suy từ bảng việc (inProgress). Đang làm → ngồi bàn, bong bóng "🛠 việc · thao tác"; rảnh ≥ 60 s → đi bộ ra Khu nghỉ.
// Người thật kết nối hub văn phòng để quan sát (PlayerJoined / BotStatus / Positions). Chờ ~75 s một lần (bot rảnh đủ lâu + nhịp quét 15 s).
// CHỈ DB tạm. Api :5180, Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5180), Mcp :5200 (Mcp__ApiBaseUrl=…5180, Mcp__RealtimeBaseUrl=…5190),
// cùng Chat__InternalKey cho cả ba.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/bot-presence-e2e.ts
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
const PRESENCE = MCP.replace(/\/+$/, '') + '/presence';
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const room = (id: string) => map.rooms.find((r: any) => r.id === id);
const inside = (r: any, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
const atRest = (x: number, z: number) => inside(room('lounge'), x, z) || inside(room('pantry'), x, z);

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot nghỉ ${stamp}`, code: `BP${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string, roles = ['employee']) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, cookie, userId, token, name };
};
const H = await mkEmp('Quản Lý Xem', `e2e.bp.h.${stamp}`, ['employee', 'manager']);
const R = await mkEmp('Bot Có Runner', `e2e.bp.r.${stamp}`);
const K = await mkEmp('Bot Bảng Việc', `e2e.bp.k.${stamp}`);
const N = await mkEmp('Người Dùng Claude', `e2e.bp.n.${stamp}`);
for (const b of [R, K]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('4 tài khoản, R + K là bot', [H, R, K, N].every((x) => x.userId && x.token?.startsWith('ohk_')));

const P = (await json(H.cookie, 'POST', '/api/projects', { code: `bp-${stamp}`, name: 'Bot nghỉ', kind: 'Internal', startOn: today, memberIds: [K.e.id] })).body;
const pd = (await json(H.cookie, 'GET', `/api/projects/${P}`)).body;
const col = (n: string) => pd.columns.find((c: any) => c.name === n)!.id as string;
const T = (await json(H.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Viết báo cáo tuần', assigneeEmployeeId: K.e.id })).body as string;
const TCODE = ((await json(H.cookie, 'GET', `/api/projects/tasks/${T}`)).body?.task?.code ?? '') as string;
ok('dự án + việc giao cho bot K (Cần làm)', !!P && !!T && !!TCODE, { P, T, TCODE });

// ---------- inProgress trên /api/projects/tasks/mine ----------
const mine = async () => ((await json(K.cookie, 'GET', '/api/projects/tasks/mine')).body as any[]).find((t) => t.id === T);
ok('Cần làm → inProgress = false', (await mine())?.inProgress === false);
await json(H.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: col('Đang làm') });
ok('Đang làm → inProgress = true', (await mine())?.inProgress === true);
await json(H.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: col('Chờ review') });
ok('Chờ review → inProgress = false (đang chờ người duyệt)', (await mine())?.inProgress === false);
ok('đặt lại Cần làm (chuyển lùi kèm lý do)', (await json(H.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: col('Cần làm'), note: 'Làm lại từ đầu' })).status === 204);

// ---------- Người thật vào văn phòng 3D để quan sát ----------
type Pos = { id: string; x: number; z: number; r: number; anim: number };
const joined: any[] = [], moves: Pos[] = [], status: { id: string; s: string | null }[] = [];
const hub = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: H.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.Warning).build();
let welcome: any = null;
hub.on('Welcome', (w: any) => { welcome = w; });
hub.on('PlayerJoined', (p: any) => { joined.push(p); });
hub.on('Positions', (list: Pos[]) => { moves.push(...list); });
hub.on('BotStatus', (id: string, s: string | null) => { status.push({ id, s }); });
for (const m of ['PlayerLeft', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick']) hub.on(m, () => {});
await hub.start();
for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
ok('người thật vào văn phòng 3D (Welcome)', !!welcome);
const lastStatus = (id: string) => status.filter((x) => x.id === id).at(-1)?.s;
const lastPos = (id: string) => moves.filter((m) => m.id === id).at(-1);
const waitArrive = async (id: string, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) { const p = lastPos(id); if (p && p.anim !== 1) return p; await Bun.sleep(250); }
  return lastPos(id);
};

// ---------- agent-runner báo qua /mcp/presence ----------
const presence = async (token: string | null, body: unknown) =>
  (await fetch(PRESENCE, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;
ok('thiếu token → 401', await presence(null, { state: 'idle' }) === 401);
ok('tài khoản không phải bot → 403', await presence(N.token, { state: 'idle' }) === 403);
ok('state lạ → 400', await presence(R.token, { state: 'sleeping' }) === 400);

ok('runner báo rảnh → 204', await presence(R.token, { state: 'idle' }) === 204);
await Bun.sleep(800);
const rj = joined.find((p) => p.id === R.userId);
ok('bot R hiện ở Khu nghỉ (ngồi), bong bóng "☕ Đang nghỉ"', !!rj && rj.bot === true && atRest(rj.x, rj.z) && rj.anim === 2 && rj.status === '☕ Đang nghỉ', rj);

moves.length = 0;
ok('runner báo đang làm → 204', await presence(R.token, { state: 'working', task: 'WEB-12 · Sửa form đăng nhập', activity: 'Sửa code' }) === 204);
await Bun.sleep(500);
ok('bong bóng "🛠 WEB-12 · Sửa code"', lastStatus(R.userId) === '🛠 WEB-12 · Sửa code', status.filter((x) => x.id === R.userId));
const rWalk = moves.filter((m) => m.id === R.userId && m.anim === 1);
const rAt = await waitArrive(R.userId);
ok('bot R đi bộ về bàn (nhiều bước, bước ≤ 0,5 m) rồi ngồi ngoài Khu nghỉ', rWalk.length >= 1 && !!rAt && rAt.anim === 2 && !atRest(rAt.x, rAt.z)
  && moves.filter((m) => m.id === R.userId && m.anim === 1).every((m, i, a) => i === 0 || Math.hypot(m.x - a[i - 1].x, m.z - a[i - 1].z) <= 0.5), rAt);

// ---------- Không có runner: Mcp suy từ bảng việc ----------
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
  return { err: !!x?.result?.isError, text: x?.result?.content?.[0]?.text ?? '' };
};
await call(K.token, 'list_my_tasks');
await Bun.sleep(1500);
const kj = joined.find((p) => p.id === K.userId);
ok('bot K (việc ở Cần làm) online → Khu nghỉ, "☕ Đang nghỉ"', !!kj && atRest(kj.x, kj.z) && lastStatus(K.userId) === '☕ Đang nghỉ', { kj, s: lastStatus(K.userId) });

moves.length = 0;
const st = await call(K.token, 'update_task_status', { task: TCODE, state: 'Đang làm' });
ok('K chuyển việc sang Đang làm qua MCP', !st.err, st.text);
await Bun.sleep(1500);
ok(`bong bóng K ghi mã việc ${TCODE}`, (lastStatus(K.userId) ?? '').includes(TCODE), lastStatus(K.userId));
const kAt = await waitArrive(K.userId);
ok('bot K đi bộ về bàn ngay (không chờ)', moves.some((m) => m.id === K.userId && m.anim === 1) && !!kAt && kAt.anim === 2 && !atRest(kAt.x, kAt.z), kAt);

await call(R.token, 'list_my_tasks'); // bảng việc của R: không có việc → nhưng runner vừa báo đang làm → giữ
await Bun.sleep(1500);
ok('runner ưu tiên hơn bảng việc: R vẫn "🛠 WEB-12 · …"', (lastStatus(R.userId) ?? '').startsWith('🛠 WEB-12'), lastStatus(R.userId));

// ---------- Rảnh: chờ ≥ 60 s rồi mới ra Khu nghỉ ----------
const st2 = await call(K.token, 'update_task_status', { task: TCODE, state: 'Chờ review' });
ok('K gửi việc sang Chờ review', !st2.err, st2.text);
ok('runner R báo hết việc', await presence(R.token, { state: 'idle' }) === 204);
await Bun.sleep(1500);
ok('bong bóng K + R → "☕ Đang nghỉ"', lastStatus(K.userId) === '☕ Đang nghỉ' && lastStatus(R.userId) === '☕ Đang nghỉ', [lastStatus(K.userId), lastStatus(R.userId)]);
moves.length = 0;
await Bun.sleep(20000);
ok('20 s sau vẫn ngồi bàn (chưa đủ 60 s)', !moves.some((m) => (m.id === K.userId || m.id === R.userId) && m.anim === 1));
// giữ bot online trong lúc chờ (như runner gửi nhịp còn sống)
for (let i = 0; i < 6; i++) { await Bun.sleep(10000); await presence(R.token, { state: 'idle' }); await call(K.token, 'list_chats'); }
const kRest = await waitArrive(K.userId, 20000), rRest = await waitArrive(R.userId, 20000);
ok('sau ~60 s: K và R đi bộ ra Khu nghỉ / Pantry và ngồi', !!kRest && !!rRest && atRest(kRest.x, kRest.z) && atRest(rRest.x, rRest.z) && kRest.anim === 2 && rRest.anim === 2
  && moves.filter((m) => m.id === K.userId && m.anim === 1).length >= 3, { kRest, rRest });
ok('hai bot không ngồi chung ghế', !!kRest && !!rRest && Math.hypot(kRest.x - rRest.x, kRest.z - rRest.z) > 0.3);

await hub.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
