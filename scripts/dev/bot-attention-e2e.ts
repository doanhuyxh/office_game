// E2E: bot cần chú ý trong văn phòng 3D (TEST-123) — xuyên Api + Realtime + Mcp, không cần FE.
// Runner được giả bằng POST /mcp/presence (token AI của bot). Bot thao tác việc bằng token AI qua REST (byBot), người thật bằng cookie.
// Người xem kết nối hub /rt/hub/office (PlayerJoined / BotStatus / BotAlert / Positions).
// Kiểm: state lạ 400; "error" → BotAlert kind error + bot ở bàn + bong bóng ⚠, nhịp error lại vẫn giữ, "working" → hết lỗi (BotAlert null),
// "idle" → ☕ và ra Khu nghỉ sau 60–75 s; chờ người: bot chuyển việc sang "Chờ review" → ≤ 35 s BotAlert waiting + item approval,
// bot rời Khu nghỉ về bàn; người thật bình luận → hết chờ; bot bình luận ở cột "Đang làm" → item reply; việc còn dependsOn chưa xong → không tính;
// POST /api/projects/internal/bot-waiting thiếu / sai khoá → 401, đúng khoá → đúng dữ liệu; qua nginx web → 404 (WEB_URL tuỳ chọn, không có thì kiểm nginx.conf).
// CHỈ DB tạm. Api + Realtime + Mcp cùng khoá Chat__* (như bot-walk-e2e.ts). ~3 phút.
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5180 'ConnectionStrings__Default=Host=127.0.0.1;Port=55432;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Seed__AdminEmail=… Seed__AdminPassword=… dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5190 Realtime__ApiBaseUrl=http://localhost:5180 LiveKit__Enabled=false Chat__InternalKey=<cùng> + ConnectionStrings__Default
//   Mcp: env ASPNETCORE_URLS=http://localhost:5200 Mcp__ApiBaseUrl=http://localhost:5180 Mcp__RealtimeBaseUrl=http://localhost:5190 Chat__InternalKey=<cùng>
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp CHAT_KEY=<khoá> ADMIN_LOGIN=… ADMIN_PASSWORD=… \
//     [WEB_URL=http://localhost:8080] bun scripts/dev/bot-attention-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const CHAT_KEY = process.env.CHAT_KEY ?? '';
if (!CHAT_KEY) throw new Error('Đặt CHAT_KEY = Chat__InternalKey (hoặc Chat__RealtimeToApiKey) của Api tạm');
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
/** Request bằng token AI (bot thao tác qua REST → lịch sử byBot). */
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
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
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Bot chú ý ${stamp}`, code: `BA${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
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
const H = await mkEmp('Quản Lý Duyệt', `e2e.ba.h.${stamp}`, ['employee', 'manager']);
const W = await mkEmp('Bot Cần Chú Ý', `e2e.ba.w.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${W.e.id}/account/bot`, { isBot: true });
ok('2 tài khoản (quản lý H, bot W) + token AI', [H, W].every((x) => x.userId && x.token?.startsWith('ohk_')));

// ---------- Dự án: Cần làm → Đang làm → Chờ review → Xong (cần người duyệt) ----------
const P = (await json(H.cookie, 'POST', '/api/projects', { code: `ba-${stamp}`, name: 'Bot chú ý', kind: 'Internal', startOn: today, memberIds: [W.e.id] })).body as string;
const pd = (await json(H.cookie, 'GET', `/api/projects/${P}`)).body;
const col = (n: string) => pd.columns.find((c: any) => c.name === n)?.id as string;
const DOING = col('Đang làm'), REVIEW = col('Chờ review');
ok('dự án mặc định: cột sau "Chờ review" là "Xong" cần người duyệt', !!DOING && !!REVIEW && pd.columns.at(-1)?.approverOnly === true, pd.columns);
const mkTask = async (title: string, toDoing: boolean) => {
  const id = (await json(H.cookie, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: W.e.id })).body as string;
  if (toDoing) await json(H.cookie, 'POST', `/api/projects/tasks/${id}/move`, { columnId: DOING }); // người thật thao tác cuối → chưa chờ ai
  const code = (await json(H.cookie, 'GET', `/api/projects/tasks/${id}`)).body?.task?.code as string;
  return { id, code };
};
const T1 = await mkTask('Sửa form đăng nhập', true);    // bot chuyển sang Chờ review → approval
const T2 = await mkTask('Hỏi lại yêu cầu báo cáo', true); // bot bình luận ở Đang làm → reply
const T3 = await mkTask('Việc còn chờ việc khác', false);  // còn dependsOn chưa xong → không tính
const T4 = await mkTask('Việc phải xong trước', false);   // người thật thao tác cuối → không chờ
const depRes = await json(H.cookie, 'PUT', `/api/projects/tasks/${T3.id}/dependencies`, { dependsOn: [T4.id] });
ok('4 việc + T3 phụ thuộc T4 (chưa xong)', !!T1.code && !!T2.code && !!T3.code && depRes.status < 300, { T1, T2, T3, dep: depRes });

// ---------- Đường nội bộ Realtime → Api ----------
const waitingApi = async (key: string | null, body: unknown = { userIds: [W.userId] }) => {
  const r = await fetch(API + '/api/projects/internal/bot-waiting', { method: 'POST',
    headers: { 'content-type': 'application/json', ...(key === null ? {} : { 'X-Chat-Key': key }) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
ok('bot-waiting thiếu khoá → 401', (await waitingApi(null)).status === 401);
ok('bot-waiting sai khoá → 401', (await waitingApi(CHAT_KEY + 'x')).status === 401);
ok('bot-waiting cookie người thật (không khoá) → 401', (await fetch(API + '/api/projects/internal/bot-waiting', { method: 'POST',
  headers: { 'content-type': 'application/json', cookie: admin }, body: JSON.stringify({ userIds: [W.userId] }) })).status === 401);
ok('bot-waiting > 200 tài khoản → 400', (await waitingApi(CHAT_KEY, { userIds: Array.from({ length: 201 }, () => crypto.randomUUID()) })).status === 400);
const w0 = await waitingApi(CHAT_KEY);
ok('bot-waiting đúng khoá: người thật thao tác cuối → W chưa chờ ai', w0.status === 200 && Array.isArray(w0.body) && w0.body.length === 0, w0);
const WEB = process.env.WEB_URL;
if (WEB) {
  const r = await fetch(WEB.replace(/\/+$/, '') + '/api/projects/internal/bot-waiting', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Chat-Key': CHAT_KEY }, body: '{"userIds":[]}' });
  ok('qua nginx web (WEB_URL) → 404', r.status === 404, r.status);
} else {
  const conf = readFileSync(new URL('../../frontend/nginx.conf', import.meta.url), 'utf8');
  ok('nginx web chặn /api/projects/internal/ → 404 (kiểm frontend/nginx.conf, không có WEB_URL)', /location \^~ \/api\/projects\/internal\/\s*\{\s*return 404;\s*\}/.test(conf));
}

// ---------- Người thật vào văn phòng 3D để quan sát ----------
type Pos = { id: string; x: number; z: number; r: number; anim: number };
const joined: any[] = [], moves: Pos[] = [], status: { id: string; s: string | null }[] = [], alerts: { id: string; a: any; at: number }[] = [];
const hub = new signalR.HubConnectionBuilder()
  .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: H.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
  .configureLogging(signalR.LogLevel.Warning).build();
let welcome: any = null;
hub.on('Welcome', (w: any) => { welcome = w; });
hub.on('PlayerJoined', (p: any) => { joined.push(p); });
hub.on('Positions', (list: Pos[]) => { moves.push(...list); });
hub.on('BotStatus', (id: string, s: string | null) => { status.push({ id, s }); });
hub.on('BotAlert', (id: string, a: any) => { alerts.push({ id, a, at: Date.now() }); });
for (const m of ['PlayerLeft', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick', 'NameChanged', 'BotWatchEnded', 'BotActivity']) hub.on(m, () => {});
await hub.start();
for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
ok('người thật vào văn phòng 3D (Welcome)', !!welcome);
const lastStatus = (id: string) => status.filter((x) => x.id === id).at(-1)?.s;
const lastPos = (id: string) => moves.filter((m) => m.id === id).at(-1);
const waitArrive = async (id: string, ms = 30000) => {
  for (let i = 0; i < ms / 250; i++) { const p = lastPos(id); if (p && p.anim !== 1) return p; await Bun.sleep(250); }
  return lastPos(id);
};
const alertsOf = (id: string) => alerts.filter((x) => x.id === id);
const waitAlert = async (pred: (a: any) => boolean, ms: number, from = 0) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const hit = alerts.slice(from).find((x) => x.id === W.userId && pred(x.a));
    if (hit) return { hit, secs: (hit.at - t0) / 1000 };
    await Bun.sleep(250);
    if (Date.now() - lastPing > 10000) await keepAlive();
  }
  return null;
};

// ---------- Runner giả qua /mcp/presence ----------
const presence = async (token: string | null, body: unknown) =>
  (await fetch(PRESENCE, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;
let lastPing = 0, lastBody: unknown = { state: 'idle' };
const report = async (body: unknown) => { lastBody = body; lastPing = Date.now(); return presence(W.token, body); };
const keepAlive = async () => { lastPing = Date.now(); await presence(W.token, lastBody); };

ok('state lạ → 400', await presence(W.token, { state: 'sleeping' }) === 400);
ok('state thiếu → 400', await presence(W.token, {}) === 400);

// (1) Lỗi
const errBody = { state: 'error', task: `${T1.code} · Sửa form đăng nhập`, error: 'Hết giờ', taskId: T1.id, projectId: P };
ok('runner báo error → 204', await report(errBody) === 204);
await Bun.sleep(1200);
const wj = joined.find((p) => p.id === W.userId);
ok('bot W vừa online + lỗi → đặt ở bàn (không ở Khu nghỉ), PlayerJoined kèm alert kind "error"', !!wj && wj.bot === true && !atRest(wj.x, wj.z) && wj.alert?.kind === 'error', wj);
ok(`bong bóng "⚠ ${T1.code} · Hết giờ"`, (wj?.status ?? lastStatus(W.userId)) === `⚠ ${T1.code} · Hết giờ`, { j: wj?.status, s: lastStatus(W.userId) });
const errItem = wj?.alert?.items?.[0];
ok('alert: text như bong bóng, item đầu kind "error" + mã việc + link /projects/{P}?task={T1}', wj?.alert?.text === `⚠ ${T1.code} · Hết giờ` && errItem?.kind === 'error'
  && errItem?.code === T1.code && errItem?.link === `/projects/${P}?task=${T1.id}`, wj?.alert);

const nAlerts = alertsOf(W.userId).length;
ok('nhịp error lại → 204', await report(errBody) === 204);
await Bun.sleep(1500);
ok('nhịp error lại: vẫn giữ lỗi (không BotAlert null, bong bóng ⚠)', alertsOf(W.userId).slice(nAlerts).every((x) => x.a?.kind === 'error')
  && (lastStatus(W.userId) ?? wj?.status ?? '').startsWith('⚠'), { a: alertsOf(W.userId).slice(nAlerts), s: lastStatus(W.userId) });

// (2) working → hết lỗi
ok('runner báo working → 204', await report({ state: 'working', task: `${T1.code} · Sửa form đăng nhập`, activity: 'Sửa code' }) === 204);
await Bun.sleep(1500);
ok('working → BotAlert null (hết lỗi), bong bóng 🛠', alertsOf(W.userId).at(-1)?.a === null && (lastStatus(W.userId) ?? '').startsWith('🛠'), { a: alertsOf(W.userId).at(-1), s: lastStatus(W.userId) });

// (3) idle → ☕ rồi ra Khu nghỉ sau 60–75 s
ok('runner báo idle → 204', await report({ state: 'idle' }) === 204);
await Bun.sleep(1500);
ok('bong bóng → "☕ Đang nghỉ"', lastStatus(W.userId) === '☕ Đang nghỉ', lastStatus(W.userId));
moves.length = 0;
const tIdle = Date.now();
await Bun.sleep(20000);
ok('20 s sau W vẫn ngồi bàn', !moves.some((m) => m.id === W.userId && m.anim === 1));
let leftAt = 0;
for (let i = 0; i < 80 && !leftAt; i++) {
  await Bun.sleep(1000);
  if (Date.now() - lastPing > 10000) await keepAlive();
  if (moves.some((m) => m.id === W.userId && m.anim === 1)) leftAt = Date.now();
}
const wRest = await waitArrive(W.userId, 30000);
const leftSecs = (leftAt - tIdle) / 1000;
ok(`rảnh → đi ra Khu nghỉ / Pantry sau 60–75 s (${leftSecs.toFixed(0)} s) và ngồi`, leftAt > 0 && leftSecs >= 55 && leftSecs <= 80 && !!wRest && atRest(wRest.x, wRest.z) && wRest.anim === 2, { leftSecs, wRest });

// (4) Chờ người duyệt: bot bình luận + chuyển T1 sang Chờ review
const cm1 = await tk(W.token, 'POST', `/api/projects/tasks/${T1.id}/comments`, { content: 'Đã sửa xong, nhờ anh review.' });
const mv1 = await tk(W.token, 'POST', `/api/projects/tasks/${T1.id}/move`, { columnId: REVIEW });
ok('bot W (token) bình luận + chuyển T1 sang Chờ review', cm1.status === 201 && mv1.status === 204, { cm1, mv1 });
const w1 = await waitingApi(CHAT_KEY);
const w1t = w1.body?.[0]?.tasks ?? [];
ok('bot-waiting: W chờ T1 kind "approval", cột "Chờ review"', w1.status === 200 && w1t.length === 1 && w1t[0].taskId === T1.id && w1t[0].kind === 'approval'
  && w1t[0].column === 'Chờ review' && w1t[0].code === T1.code, w1.body);
moves.length = 0;
const a1 = await waitAlert((a) => a?.kind === 'waiting', 36000, alerts.length);
ok(`≤ 35 s: BotAlert kind "waiting" (${a1?.secs.toFixed(1)} s)`, !!a1 && a1.secs <= 35, a1);
const it1 = a1?.hit.a.items ?? [];
ok(`alert: 1 việc approval ${T1.code}, text "⏳ ${T1.code} · Chờ duyệt", link đúng`, it1.length === 1 && it1[0].kind === 'approval' && it1[0].code === T1.code
  && it1[0].link === `/projects/${P}?task=${T1.id}` && a1?.hit.a.text === `⏳ ${T1.code} · Chờ duyệt`, a1?.hit.a);
await Bun.sleep(800);
ok('bong bóng → "⏳ … Chờ duyệt"', lastStatus(W.userId) === `⏳ ${T1.code} · Chờ duyệt`, lastStatus(W.userId));
const wBack = await waitArrive(W.userId, 30000);
ok('bot W rời Khu nghỉ đi bộ về bàn (bước ≤ 0,5 m) rồi ngồi', moves.some((m) => m.id === W.userId && m.anim === 1) && !!wBack && wBack.anim === 2 && !atRest(wBack.x, wBack.z)
  && moves.filter((m) => m.id === W.userId && m.anim === 1).every((m, i, a) => i === 0 || Math.hypot(m.x - a[i - 1].x, m.z - a[i - 1].z) <= 0.5), wBack);

// (5) Người thật bình luận → hết chờ
ok('quản lý H bình luận trên T1', (await json(H.cookie, 'POST', `/api/projects/tasks/${T1.id}/comments`, { content: 'Mình xem chiều nay.' })).status === 201);
ok('bot-waiting: hết chờ T1', ((await waitingApi(CHAT_KEY)).body ?? []).length === 0);
const a2 = await waitAlert((a) => a === null, 36000, alerts.length);
ok(`≤ 35 s: BotAlert null (${a2?.secs.toFixed(1)} s)`, !!a2 && a2.secs <= 35, a2);

// (6) Bot bình luận ở cột "Đang làm" → reply; việc còn dependsOn chưa xong → không tính
ok('bot W bình luận hỏi lại ở T2 (Đang làm)', (await tk(W.token, 'POST', `/api/projects/tasks/${T2.id}/comments`, { content: 'Báo cáo lấy theo tháng hay quý ạ?' })).status === 201);
ok('bot W bình luận ở T3 (còn chờ T4)', (await tk(W.token, 'POST', `/api/projects/tasks/${T3.id}/comments`, { content: 'Em chờ T4 xong nhé.' })).status === 201);
const w3 = await waitingApi(CHAT_KEY);
const w3t = w3.body?.[0]?.tasks ?? [];
ok('bot-waiting: chỉ T2 kind "reply" (T3 còn phụ thuộc không tính)', w3t.length === 1 && w3t[0].taskId === T2.id && w3t[0].kind === 'reply', w3.body);
const a3 = await waitAlert((a) => a?.kind === 'waiting', 36000, alerts.length);
const it3 = a3?.hit.a.items ?? [];
ok(`≤ 35 s: BotAlert waiting, item reply ${T2.code}, không có ${T3.code}, text "⏳ … Chờ phản hồi"`, !!a3 && a3.secs <= 35 && it3.length === 1 && it3[0].kind === 'reply'
  && it3[0].code === T2.code && !it3.some((x: any) => x.code === T3.code) && a3.hit.a.text === `⏳ ${T2.code} · Chờ phản hồi`, a3);

// (7) Lỗi + việc chờ: kind "error", mục lỗi đứng đầu rồi các việc chờ; working → còn lại waiting
let mark = alerts.length; // BotAlert có thể tới trước khi /mcp/presence trả 204 → đánh dấu trước khi báo
ok('runner báo error lần nữa', await report({ ...errBody, error: 'Build lỗi' }) === 204);
const a4 = await waitAlert((a) => a?.kind === 'error', 5000, mark);
const it4 = a4?.hit.a.items ?? [];
ok('lỗi + chờ: kind "error", text "⚠ … Build lỗi", mục lỗi trước, rồi việc chờ T2', a4?.hit.a.text === `⚠ ${T1.code} · Build lỗi` && it4.length === 2 && it4[0].kind === 'error' && it4[1].kind === 'reply' && it4[1].code === T2.code, a4?.hit.a);
mark = alerts.length;
ok('runner báo idle → hết lỗi, còn chờ', await report({ state: 'idle' }) === 204);
const a5 = await waitAlert((a) => a?.kind === 'waiting', 5000, mark);
ok('BotAlert về "waiting" (chỉ còn T2), bong bóng "⏳ … Chờ phản hồi"', lastStatus(W.userId) === `⏳ ${T2.code} · Chờ phản hồi` && (a5?.hit.a.items ?? []).length === 1 && a5?.hit.a.items[0].code === T2.code, a5?.hit.a);

// Dọn: người thật trả lời T2 để bot không giữ việc chờ
await json(H.cookie, 'POST', `/api/projects/tasks/${T2.id}/comments`, { content: 'Theo tháng nhé.' });
await hub.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
