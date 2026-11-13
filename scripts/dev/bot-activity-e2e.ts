// E2E: xem trực tiếp agent đang làm gì (TEST-101) — xuyên Api + Realtime + Mcp, không cần FE.
// Runner được giả bằng cách gọi thẳng POST /mcp/activity + /mcp/presence với token AI của bot. Người xem kết nối hub /rt/hub/office,
// đi bộ bằng Move theo navGrid (như bot-screen-e2e.ts) rồi gọi WatchBot / UnwatchBot.
// Kiểm: 401 / 403 / 400, đệm + sự kiện mới theo seq, cùng id = cập nhật, đứng xa > 6 m / khác kênh → từ chối và không nhận gì,
// phòng họp voice "room" → góc xa cùng phòng vẫn xem được, đi ra xa → BotWatchEnded "range", session_end → xem lại nhận đệm rỗng + rảnh,
// tràn 200 sự kiện, cắt trường quá dài, bot không qua runner gọi tool MCP → sự kiện "tool" không kèm tham số (TEST-96).
// CHỈ DB tạm. Api :5180, Realtime :5190, Mcp :5200 (như bot-walk-e2e.ts, cùng Chat__InternalKey). ~1,5 phút.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 RT_URL=http://localhost:5190 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/bot-activity-e2e.ts
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
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);

const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const RT = process.env.RT_URL ?? 'http://localhost:5190';
const MCP = process.env.MCP_URL ?? 'http://localhost:5200/mcp';
const MCP_BASE = MCP.replace(/\/+$/, '');
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const nav = new NavGrid(map);
const room = (id: string) => map.rooms.find((r: any) => r.id === id);
const inside = (r: any, x: number, z: number) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
/** Kênh voice như OfficeMap.VoiceAt: phòng có tường chứa điểm → id phòng, còn lại "open". */
const channelAt = (x: number, z: number) => (map.rooms.find((r: any) => r.walls && inside(r, x, z))?.id ?? 'open') as string;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const HALL = room('meeting-hall');

// ---------- Dữ liệu: 3 người xem (A gần, B xa, C khác kênh) + bot R (giả runner) + bot K (không runner) ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Luồng bot ${stamp}`, code: `BA${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  await Bun.sleep(300); // giãn đăng nhập (30 lần / phút / IP)
  return { e, cookie, userId, token, name };
};
const A = await mkEmp('Người Xem Gần', `e2e.ba.a.${stamp}`);
const B = await mkEmp('Người Xem Xa', `e2e.ba.b.${stamp}`);
const C = await mkEmp('Người Ngoài Tường', `e2e.ba.c.${stamp}`);
const R = await mkEmp('Bot Có Runner', `e2e.ba.r.${stamp}`);
const K = await mkEmp('Bot Không Runner', `e2e.ba.k.${stamp}`);
for (const b of [R, K]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('5 tài khoản, R + K là bot', [A, B, C, R, K].every((x) => x.userId && x.token?.startsWith('ohk_')));

// ---------- Giả runner: /mcp/presence + /mcp/activity ----------
const post = async (path: string, token: string | null, body: unknown) =>
  (await fetch(MCP_BASE + path, { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body) })).status;
let lastPost = 0;
/** Gửi lô sự kiện, giãn ≥ 250 ms giữa các lần (hạn mức 5 lần / giây / token). */
const activity = async (token: string | null, events: unknown) => {
  const wait = lastPost + 250 - Date.now();
  if (wait > 0) await Bun.sleep(wait);
  lastPost = Date.now();
  return post('/activity', token, { events });
};
const presence = (token: string, body: unknown) => post('/presence', token, body);

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

// ---------- Người xem vào văn phòng 3D ----------
type Pos = { x: number; z: number; anim: number };
type Ev = { id: string; kind: string; title?: string | null; text?: string | null; path?: string | null; diff?: string | null; output?: string | null;
  ok?: boolean | null; task?: string | null; seq: number; at: string };
const bots = new Map<string, Pos>();
const connect = async (who: { cookie: string; userId: string }) => {
  const pushes: { botId: string; events: Ev[]; busy?: boolean | null; task?: string | null; cleared?: boolean }[] = [];
  const ended: { botId: string; reason: string }[] = [];
  let welcome: any = null;
  const c = new signalR.HubConnectionBuilder()
    .withUrl(`${RT}/rt/hub/office`, { headers: { cookie: who.cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
    .configureLogging(signalR.LogLevel.None).build();
  const track = (p: any) => { if (p.id !== who.userId) bots.set(p.id, { x: p.x, z: p.z, anim: p.anim }); };
  c.on('Welcome', (w: any) => { welcome = w; w.players.forEach(track); });
  c.on('PlayerJoined', track);
  c.on('Positions', (list: any[]) => list.forEach(track));
  c.on('BotActivity', (b: any) => { pushes.push(b); });
  c.on('BotWatchEnded', (botId: string, reason: string) => { ended.push({ botId, reason }); });
  let teleported = 0;
  c.on('Teleport', () => { teleported++; });
  for (const m of ['PlayerLeft', 'BotStatus', 'Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick']) c.on(m, () => {});
  await c.start();
  for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
  const me = welcome?.players.find((p: any) => p.id === who.userId);
  const self = { c, pushes, ended, welcome, x: me?.x as number, z: me?.z as number, get teleported() { return teleported; } };
  return self;
};
type Viewer = Awaited<ReturnType<typeof connect>>;
/** Đi bộ tới ô trống gần (tx, tz) theo A* của engine, bước ≤ 0,5 m / 100 ms (5 m/s < MaxSpeed 7). */
const walk = async (v: Viewer, tx: number, tz: number) => {
  const cell = nav.nearestFree(tx, tz)!;
  const [gx, gz] = nav.center(cell[0], cell[1]);
  for (const [px, pz] of nav.findPath(v.x, v.z, gx, gz)) {
    while (Math.hypot(px - v.x, pz - v.z) > 0.01) {
      const d = Math.hypot(px - v.x, pz - v.z), step = Math.min(0.5, d);
      v.x += ((px - v.x) / d) * step; v.z += ((pz - v.z) / d) * step;
      await v.c.invoke('Move', v.x, v.z, 0, 1);
      await Bun.sleep(100);
    }
  }
  await v.c.invoke('Move', v.x, v.z, 0, 0);
  await Bun.sleep(300);
  return { x: v.x, z: v.z };
};
/** Ô trống đi tới được, cùng / khác kênh với bot, khoảng cách tới bot trong [min, max] — gần max nhất trước (pick 'far') hoặc gần bot nhất ('near'). */
const spot = (from: { x: number; z: number }, bot: { x: number; z: number }, want: (x: number, z: number) => boolean, min: number, max: number, pick: 'far' | 'near') => {
  const out: { x: number; z: number; d: number }[] = [];
  for (let x = bot.x - max; x <= bot.x + max; x += 0.25)
    for (let z = bot.z - max; z <= bot.z + max; z += 0.25) {
      const cell = nav.nearestFree(x, z);
      if (!cell) continue;
      const [cx, cz] = nav.center(cell[0], cell[1]);
      const d = Math.hypot(cx - bot.x, cz - bot.z);
      if (d >= min && d <= max && want(cx, cz)) out.push({ x: cx, z: cz, d });
    }
  out.sort((a, b) => pick === 'far' ? b.d - a.d : a.d - b.d);
  return out.find((p) => nav.findPath(from.x, from.z, p.x, p.z).length > 0) ?? null;
};
const waitArrive = async (id: string, ms = 30000) => {
  for (let t = 0; t < ms; t += 250) { const p = bots.get(id); if (p && p.anim !== 1) return p; await Bun.sleep(250); }
  return bots.get(id);
};
const watch = async (v: Viewer, botId: string) => {
  try { return { dto: await v.c.invoke('WatchBot', botId) as { botId: string; name: string; busy: boolean | null; task: string | null; events: Ev[] }, error: '' }; }
  catch (e: any) { return { dto: null, error: String(e?.message ?? e) }; }
};
/** Chờ tới khi người xem nhận sự kiện có id (lần đẩy mới nhất chứa id đó). */
const waitEvent = async (v: Viewer, id: string, ms = 2500) => {
  for (let t = 0; t < ms; t += 100) {
    const e = v.pushes.flatMap((p) => p.events).filter((x) => x.id === id).at(-1);
    if (e) return e;
    await Bun.sleep(100);
  }
  return null;
};
const ascending = (events: Ev[]) => events.every((e, i) => i === 0 || e.seq > events[i - 1].seq);

const a = await connect(A), b = await connect(B), c = await connect(C);
ok('A, B, C vào văn phòng 3D (Welcome)', !!a.welcome && !!b.welcome && !!c.welcome);

// ---------- Cửa vào /mcp/activity ----------
ok('/mcp/activity không token → 401', await activity(null, [{ id: 'x', kind: 'say', text: 'hi' }]) === 401);
ok('/mcp/activity token người thường → 403', await activity(A.token, [{ id: 'x', kind: 'say', text: 'hi' }]) === 403);
ok('kind lạ → 400', await activity(R.token, [{ id: 'x', kind: 'Say' }]) === 400);
ok('thiếu id → 400', await activity(R.token, [{ kind: 'say' }]) === 400);
ok('thân > 256 KB → 400', await activity(R.token, [{ id: 'big', kind: 'say', text: 'x'.repeat(270_000) }]) === 400);

// ---------- Bot R (giả runner) đang làm → ngồi bàn; gửi session_start + vài sự kiện ----------
const TASK = 'TEST-101 · Xem bot làm việc';
ok('runner báo đang làm → 204', await presence(R.token, { state: 'working', task: TASK, activity: 'Viết e2e' }) === 204);
await Bun.sleep(1500);
const rDesk = await waitArrive(R.userId);
ok('R hiện trong 3D, ngồi bàn ở khu mở', !!rDesk && rDesk.anim === 2 && channelAt(rDesk.x, rDesk.z) === 'open', rDesk);
ok('session_start + 2 sự kiện → 204', await activity(R.token, [
  { id: 's1', kind: 'session_start', title: 'Bắt đầu', task: TASK, model: 'claude-fable-5-1' },
  { id: 'c1', kind: 'command', title: 'Chạy lệnh', text: 'dotnet build -warnaserror' },
  { id: 't1', kind: 'thinking', text: 'Cần kiểm phạm vi nghe ở back-end.' },
]) === 204);

// ---------- A đứng cạnh bot → WatchBot: đệm + sự kiện mới theo seq ----------
const aNear = spot(a, rDesk!, (x, z) => channelAt(x, z) === 'open', 1, 2.5, 'near');
await walk(a, aNear!.x, aNear!.z);
ok('A đi tới cạnh R (≤ 6 m, cùng khu mở)', dist(a, rDesk!) <= 6 && a.teleported === 0, { a: { x: a.x, z: a.z }, d: dist(a, rDesk!), tp: a.teleported });
const w1 = await watch(a, R.userId);
ok('WatchBot → đệm 3 sự kiện đúng thứ tự, seq tăng dần', w1.dto?.events.map((e) => e.id).join() === 's1,c1,t1' && ascending(w1.dto.events), w1);
ok('…kèm tên bot + đang làm + việc', w1.dto?.name === R.name && w1.dto?.busy === true && w1.dto?.task === TASK, w1.dto && { name: w1.dto.name, busy: w1.dto.busy, task: w1.dto.task });
ok('…session_start có model, at là ISO UTC', w1.dto?.events[0].kind === 'session_start' && (w1.dto?.events[0] as any).model === 'claude-fable-5-1' && /Z$/.test(w1.dto?.events[0].at ?? ''));

ok('gửi thêm 2 sự kiện → 204', await activity(R.token, [
  { id: 'c2', kind: 'command', title: 'Chạy lệnh', text: 'dotnet test' },
  { id: 'f1', kind: 'file_edit', title: 'Sửa a.ts', path: 'src/a.ts', diff: '-cũ\n+mới' },
]) === 204);
const f1 = await waitEvent(a, 'f1');
const live = a.pushes.flatMap((p) => p.events);
ok('A nhận sự kiện mới (BotActivity) — c2 rồi f1, seq tiếp sau đệm', !!f1 && live.map((e) => e.id).join() === 'c2,f1' && ascending([...w1.dto!.events, ...live]), live.map((e) => [e.id, e.seq]));
const c2seq = live.find((e) => e.id === 'c2')?.seq;

// ---------- Cùng id kèm output → cập nhật, không thành mục mới ----------
ok('gửi lại c2 kèm output + ok → 204', await activity(R.token, [{ id: 'c2', kind: 'command', output: 'Passed: 42', ok: true }]) === 204);
await Bun.sleep(800);
const c2up = a.pushes.flatMap((p) => p.events).filter((e) => e.id === 'c2').at(-1);
ok('A nhận bản cập nhật c2: giữ seq + text cũ, thêm output / ok', !!c2up && c2up.seq === c2seq && c2up.output === 'Passed: 42' && c2up.ok === true && c2up.text === 'dotnet test', c2up);
const w2 = await watch(a, R.userId);
ok('xem lại: đệm vẫn 5 mục (cập nhật không thêm dòng)', w2.dto?.events.length === 5 && w2.dto.events.filter((e) => e.id === 'c2').length === 1, w2.dto?.events.map((e) => e.id));

// ---------- B đứng xa (> 6 m, cùng khu mở) → bị từ chối ----------
const bFar = spot(b, rDesk!, (x, z) => channelAt(x, z) === 'open', 8, 11, 'near');
await walk(b, bFar!.x, bFar!.z);
ok('B đứng cùng khu mở nhưng cách R > 6 m', channelAt(b.x, b.z) === 'open' && dist(b, rDesk!) > 6 && b.teleported === 0, { d: dist(b, rDesk!) });
const wb = await watch(b, R.userId);
ok('B WatchBot → từ chối "Hãy lại gần hơn để xem"', !wb.dto && wb.error.includes('Hãy lại gần hơn'), wb.error);
ok('WatchBot người thường (không phải bot) → từ chối', !(await watch(b, A.userId)).dto);

// ---------- Quá 200 sự kiện + trường quá dài ----------
for (let i = 0; i < 210; i += 42)
  await activity(R.token, Array.from({ length: 42 }, (_, k) => ({ id: `ov${i + k}`, kind: 'say', text: `Dòng ${i + k}` })));
const long = 'a'.repeat(5000);
const diff300 = Array.from({ length: 300 }, (_, i) => `+dòng ${i}`).join('\n');
ok('sự kiện có trường quá dài → 204 (cắt, không từ chối)', await activity(R.token, [
  { id: 'long1', kind: 'command', title: 'Dòng 1\nDòng 2', text: long, output: 'b'.repeat(4500) + 'END', diff: diff300, path: 'a\r\nb' },
]) === 204);
const lv = await waitEvent(a, 'long1');
const w3 = await watch(a, R.userId);
ok('đệm chỉ còn 200 sự kiện mới nhất (s1 … ov10 bị đẩy ra)', w3.dto?.events.length === 200 && w3.dto.events[0].id === 'ov11' && w3.dto.events.at(-1)?.id === 'long1'
  && ascending(w3.dto.events), w3.dto && [w3.dto.events.length, w3.dto.events[0]?.id, w3.dto.events.at(-1)?.id]);
ok('A nhận live đủ 210 sự kiện tràn (gộp lô)', new Set(a.pushes.flatMap((p) => p.events).filter((e) => e.id.startsWith('ov')).map((e) => e.id)).size === 210);
ok('text > 4 000 → cắt còn 4 000 ký tự, cuối là "…"', !!lv && lv.text!.length === 4000 && lv.text!.endsWith('…'), lv?.text?.length);
ok('output > 4 000 → giữ phần cuối ("…" ở đầu)', !!lv && lv.output!.startsWith('…') && lv.output!.endsWith('END') && lv.output!.length === 4000, lv?.output?.length);
ok('trường một dòng: mỗi \\r / \\n → dấu cách', lv?.title === 'Dòng 1 Dòng 2' && lv?.path === 'a  b', [lv?.title, lv?.path]);
ok('diff > 200 dòng → cắt ≤ 200 dòng', !!lv && lv.diff!.split('\n').length <= 201 && lv.diff!.includes('+dòng 0') && !lv.diff!.includes('+dòng 250'), lv?.diff?.split('\n').length);
ok('B (bị từ chối) không nhận sự kiện nào', b.pushes.length === 0, b.pushes.length);

// ---------- A đi ra xa → BotWatchEnded "range", sau đó không nhận thêm ----------
const aAway = spot(a, rDesk!, (x, z) => channelAt(x, z) === 'open', 9, 12, 'near');
await walk(a, aAway!.x, aAway!.z);
const leftAt = Date.now();
for (let t = 0; t < 7000 && a.ended.length === 0; t += 100) await Bun.sleep(100);
ok('A đi ra > 7 m → BotWatchEnded(range) trong ~5 giây', a.ended.at(-1)?.reason === 'range' && a.ended.at(-1)?.botId === R.userId && Date.now() - leftAt <= 5500,
  { ended: a.ended, ms: Date.now() - leftAt });
const before = a.pushes.length;
await activity(R.token, [{ id: 'after', kind: 'say', text: 'không ai nghe' }]);
await Bun.sleep(1000);
ok('…sau đó A không nhận sự kiện mới', a.pushes.length === before && !a.pushes.flatMap((p) => p.events).some((e) => e.id === 'after'));

// ---------- Phòng họp (voice "room"): góc xa cùng phòng xem được, ngay ngoài tường thì không ----------
const g = await call(R.token, 'go_to', { place: 'meeting-hall' });
ok('R go_to Hội trường (runner vẫn báo đang làm)', !g.err && g.j?.place?.id === 'meeting-hall', g.text.slice(0, 200));
await Bun.sleep(1000);
const rHall = await waitArrive(R.userId);
ok('R tới Hội trường', !!rHall && inside(HALL, rHall.x, rHall.z), rHall);
const aCorner = spot(a, rHall!, (x, z) => channelAt(x, z) === 'meeting-hall', 6.2, 14, 'far');
await walk(a, aCorner!.x, aCorner!.z);
ok('A đứng góc xa trong Hội trường (cách R > 6 m)', channelAt(a.x, a.z) === 'meeting-hall' && dist(a, rHall!) > 6, { d: dist(a, rHall!), at: [a.x, a.z] });
const w5 = await watch(a, R.userId);
ok('phòng voice "room" → A xem được dù > 6 m, nhận đệm', !!w5.dto && w5.dto.events.length === 200, w5.error);
ok('go_to khi runner còn hiệu lực → không tự phát sự kiện "tool" (tránh trùng runner)', !!w5.dto && !w5.dto.events.some((e) => e.kind === 'tool'));
const cOut = spot(c, rHall!, (x, z) => channelAt(x, z) !== 'meeting-hall', 0, 6, 'near');
ok('có chỗ ngoài tường Hội trường cách R ≤ 6 m', !!cOut, rHall);
if (cOut) await walk(c, cOut.x, cOut.z);
ok('C đứng ngoài tường, sát R (≤ 6 m, khác kênh)', channelAt(c.x, c.z) !== 'meeting-hall' && dist(c, rHall!) <= 6, { d: dist(c, rHall!), ch: channelAt(c.x, c.z) });
const wc = await watch(c, R.userId);
ok('C WatchBot → từ chối (khác kênh)', !wc.dto && wc.error.includes('Hãy lại gần hơn'), wc.error);
await activity(R.token, [{ id: 'hall1', kind: 'say', text: 'Trong hội trường' }]);
ok('A (cùng phòng) nhận sự kiện mới', !!(await waitEvent(a, 'hall1')));
ok('C không nhận sự kiện nào', c.pushes.length === 0, c.pushes.length);

// ---------- session_end → người vào xem sau nhận đệm rỗng + rảnh ----------
ok('session_end → 204', await activity(R.token, [{ id: 'e1', kind: 'session_end', title: 'Xong', turns: 12, costUsd: 0.42 }]) === 204);
const e1 = await waitEvent(a, 'e1');
ok('A (đang xem) nhận session_end kèm lượt + chi phí', !!e1 && (e1 as any).turns === 12 && (e1 as any).costUsd === 0.42, e1);
ok('runner báo rảnh → 204', await presence(R.token, { state: 'idle' }) === 204);
await Bun.sleep(800);
ok('A nhận trạng thái rảnh (busy=false)', a.pushes.at(-1)?.busy === false, a.pushes.at(-1));
await a.c.invoke('UnwatchBot');
const w6 = await watch(a, R.userId);
ok('xem lại sau session_end → đệm rỗng + rảnh', !!w6.dto && w6.dto.events.length === 0 && w6.dto.busy === false, w6.dto ?? w6.error);
await a.c.invoke('UnwatchBot');

// ---------- Bot K không qua runner: gọi tool MCP → sự kiện "tool" không kèm tham số (TEST-96) ----------
const first = await call(K.token, 'list_my_tasks');
ok('K (không runner) gọi list_my_tasks', !first.err, first.text.slice(0, 200));
await Bun.sleep(1000);
const kAt = await waitArrive(K.userId);
ok('K hiện trong 3D', !!kAt, kAt);
const aK = spot(a, kAt!, (x, z) => channelAt(x, z) === channelAt(kAt!.x, kAt!.z), 1, 2.5, 'near');
await walk(a, aK!.x, aK!.z);
const wk = await watch(a, K.userId);
ok('A xem K: đệm có session_start tự phát + tool list_my_tasks (ok)', !!wk.dto && wk.dto.events[0]?.kind === 'session_start'
  && wk.dto.events.some((e) => e.kind === 'tool' && (e.text ?? '').includes('list_my_tasks') && e.ok === true), wk.dto?.events ?? wk.error);
const SECRET = `bi-mat-${stamp}`;
const before2 = a.pushes.length;
await call(K.token, 'search_colleagues', { query: SECRET });
let tool: Ev | undefined;
for (let t = 0; t < 3000 && !tool; t += 100) {
  tool = a.pushes.slice(before2).flatMap((p) => p.events).find((e) => e.kind === 'tool' && (e.text ?? '').includes('search_colleagues'));
  await Bun.sleep(100);
}
ok('K gọi search_colleagues → A thấy sự kiện "tool" có tiêu đề tiếng Việt', !!tool && !!tool.title && tool.title !== 'search_colleagues', tool);
ok('…không kèm tham số / kết quả tool', !!tool && !JSON.stringify(tool).includes(SECRET) && !tool.output && !tool.diff, tool);

for (const v of [a, b, c]) await v.c.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
