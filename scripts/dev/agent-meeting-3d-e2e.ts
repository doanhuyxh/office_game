// E2E TEST-76: họp agent trong văn phòng 3D — người thật kết nối hub văn phòng: mở họp → bot dự họp (kể cả chưa online) xuất hiện và ĐI BỘ
// từng bước vào ghế trong phòng họp; bong bóng "🎤 Đang phát biểu" theo lượt nói, bot khác "👥 Đang họp · chủ đề"; dừng họp → bot rời phòng;
// tài khoản bot đang được người thật dùng trong 3D → không có avatar bot thứ hai. Đường nội bộ /api/meetings/internal/live (khoá).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-agm3d-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55491:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5289
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55491;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng>
//        Seed__AdminEmail=agm3d-admin@officehub-e2e.vn Seed__AdminPassword=Agm3d-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://localhost:5299 Realtime__ApiBaseUrl=http://localhost:5289 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5289 RT_URL=http://localhost:5299 CHAT_KEY=<khoá> ADMIN_LOGIN=agm3d-admin@officehub-e2e.vn \
//     ADMIN_PASSWORD=Agm3d-Admin-2026 bun scripts/dev/agent-meeting-3d-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5289';
const RT = process.env.RT_URL ?? 'http://localhost:5299';
const CHAT_KEY = process.env.CHAT_KEY ?? '';
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
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);

const signalR = await import(new URL('../../frontend/node_modules/@microsoft/signalr/dist/esm/index.js', import.meta.url).href) as typeof import('../../frontend/node_modules/@microsoft/signalr');
const map = JSON.parse(readFileSync(new URL('../../shared/office-map.json', import.meta.url), 'utf8'));
const ROOM = 'meeting-large';
const room = map.rooms.find((r: any) => r.id === ROOM);
const inside = (x: number, z: number) => x >= room.x0 && x <= room.x1 && z >= room.z0 && z <= room.z1;
const live = (key?: string) => fetch(`${API}/api/meetings/internal/live`, { headers: key ? { 'X-Chat-Key': key } : {} });

// ---------- Đường nội bộ ----------
ok('internal/live: không khoá → 401', (await live()).status === 401);
ok('internal/live: sai khoá → 401', (await live('x'.repeat(40))).status === 401);
ok('internal/live: đúng khoá → 200 (danh sách)', Array.isArray(await (await live(CHAT_KEY)).json().catch(() => null)));

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
for (const s of (await json(admin, 'GET', '/api/meetings/sessions?active=true')).body ?? []) await json(admin, 'POST', `/api/meetings/sessions/${s.id}/stop`);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Họp AI 3D ${stamp}`, code: `A3${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, code: e.code as string, user, cookie, userId, token: t?.token as string, name };
};
const H = await mkEmp('Người Mở Họp 3D', `e2e.a3.h.${stamp}`);
const N = await mkEmp('Người Vào Sau', `e2e.a3.n.${stamp}`);
const B1 = await mkEmp('Bot Chủ Trì', `e2e.a3.b1.${stamp}`);
const B2 = await mkEmp('Bot Thành Viên', `e2e.a3.b2.${stamp}`);
const B3 = await mkEmp('Bot Có Người Dùng', `e2e.a3.b3.${stamp}`);
for (const b of [B1, B2, B3]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('5 tài khoản, 3 bot (chưa bot nào gọi MCP → chưa online)', [H, N, B1, B2, B3].every((x) => x.userId && x.token?.startsWith('ohk_')));

// ---------- H vào văn phòng 3D để quan sát; B3 do người thật dùng trong 3D ----------
type Pos = { id: string; x: number; z: number; r: number; anim: number };
const joined: any[] = [], left: string[] = [], moves: Pos[] = [], status: { id: string; s: string | null }[] = [];
const connect = async (cookie: string, watch: boolean) => {
  const c = new signalR.HubConnectionBuilder()
    .withUrl(`${RT}/rt/hub/office`, { headers: { cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
    .configureLogging(signalR.LogLevel.Warning).build();
  let welcome: any = null;
  c.on('Welcome', (w: any) => { welcome = w; });
  if (watch) {
    c.on('PlayerJoined', (p: any) => { joined.push(p); });
    c.on('PlayerLeft', (id: string) => { left.push(id); });
    c.on('Positions', (list: Pos[]) => { moves.push(...list); });
    c.on('BotStatus', (id: string, s: string | null) => { status.push({ id, s }); });
  } else for (const m of ['PlayerJoined', 'PlayerLeft', 'Positions', 'BotStatus']) c.on(m, () => {});
  for (const m of ['Chat', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick', 'NameChanged']) c.on(m, () => {});
  await c.start();
  for (let i = 0; i < 20 && !welcome; i++) await Bun.sleep(200);
  return { c, welcome };
};
const h = await connect(H.cookie, true);
ok('H vào văn phòng 3D (Welcome), chưa thấy bot nào của bài', !!h.welcome && !h.welcome.players.some((p: any) => [B1.userId, B2.userId].includes(p.id)), h.welcome);
const own = await connect(B3.cookie, false);
ok('người thật đăng nhập tài khoản B3 vào 3D', !!own.welcome);

// ---------- Mở họp → bot đi bộ vào phòng ----------
const topic = `Kế hoạch ${stamp}`;
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic, chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id, B3.e.id] });
ok('H mở họp ở Phòng họp lớn (B1 chủ trì, B2, B3)', open.status === 200 && open.body.status === 'Active', open);
const lv = (await (await live(CHAT_KEY)).json()) as any[];
const mine = lv.find((m) => m.sessionId === open.body?.id);
ok('internal/live: phiên mới, đúng phòng / chủ đề / lượt / bot giữ lượt = B1', !!mine && mine.roomId === ROOM && mine.topic === topic && mine.maxTurns === open.body.maxTurns
  && mine.speakerUserId === B1.userId && mine.bots.length === 3 && mine.bots[0].userId === B1.userId, lv);

await Bun.sleep(4000);
ok('bot chưa online xuất hiện (PlayerJoined bot=true, B1 + B2)', [B1, B2].every((b) => joined.some((p) => p.id === b.userId && p.bot === true)), joined);
ok('B3 (người thật đang dùng) → không có avatar bot thứ hai', !joined.some((p) => p.id === B3.userId && p.bot));
const walkOf = (id: string) => moves.filter((m) => m.id === id && m.anim === 1);
ok('bot đi từng bước (nhiều gói anim 1, vị trí đổi dần)', [B1, B2].every((b) => walkOf(b.userId).length >= 3
  && new Set(walkOf(b.userId).map((m) => `${m.x.toFixed(1)},${m.z.toFixed(1)}`)).size >= 3), [walkOf(B1.userId).length, walkOf(B2.userId).length]);
ok('bước ≤ 0,5 m mỗi nhịp (không dịch chuyển)', [B1, B2].every((b) => walkOf(b.userId).every((m, i, a) => i === 0 || Math.hypot(m.x - a[i - 1].x, m.z - a[i - 1].z) <= 0.5)));
ok('đang đi: bong bóng "🚶 Phòng họp lớn" (hoặc đã tới)', [B1, B2].every((b) => status.some((s) => s.id === b.userId && (s.s?.startsWith('🚶') || s.s?.startsWith('🎤') || s.s?.startsWith('👥')))), status);
for (let i = 0; i < 40; i++) {
  const done = [B1, B2].every((b) => moves.filter((m) => m.id === b.userId).at(-1)?.anim === 2);
  if (done) break;
  await Bun.sleep(1000);
}
await Bun.sleep(3500); // một nhịp hỏi Api → bong bóng sau khi tới chỗ
const lastOf = (id: string) => moves.filter((m) => m.id === id).at(-1);
const p1 = lastOf(B1.userId), p2 = lastOf(B2.userId);
ok('tới nơi: cả hai ngồi (anim 2) trong Phòng họp lớn, khác ghế', !!p1 && !!p2 && p1.anim === 2 && p2.anim === 2 && inside(p1.x, p1.z) && inside(p2.x, p2.z)
  && Math.hypot(p1.x - p2.x, p1.z - p2.z) > 0.3, { p1, p2 });
const statusOf = (id: string) => status.filter((s) => s.id === id).at(-1)?.s;
ok('B1 giữ lượt → "🎤 Đang phát biểu"', statusOf(B1.userId) === '🎤 Đang phát biểu', status.filter((s) => s.id === B1.userId));
ok('B2 → "👥 Đang họp · chủ đề"', statusOf(B2.userId) === `👥 Đang họp · ${topic}`, statusOf(B2.userId));
ok('B3 (người thật dùng) → bong bóng không gắn (không có bot riêng)', !status.some((s) => s.id === B3.userId));
const h2 = await connect(N.cookie, false); // tài khoản khác (một tài khoản chỉ giữ một kết nối hub)
const w2 = h2.welcome?.players ?? [];
ok('người vào sau thấy ngay 2 bot trong phòng kèm bong bóng (Welcome)', w2.some((p: any) => p.id === B1.userId && p.bot && p.status === '🎤 Đang phát biểu' && inside(p.x, p.z))
  && w2.some((p: any) => p.id === B2.userId && inside(p.x, p.z)), w2.filter((p: any) => p.bot));
await h2.c.stop();

// ---------- Đổi lượt: B1 nhắc B2 ----------
const conv = ((await json(H.cookie, 'GET', '/api/chat/conversations')).body as any[] ?? []).find((c) => c.type === 'Room' && c.roomId === ROOM);
const said = await tk(B1.token, 'POST', `/api/chat/conversations/${conv?.id}/messages`, { text: `Mời @${B2.code} trình bày`, uploadIds: [], clientId: crypto.randomUUID() });
ok('B1 nói trong kênh phòng, @nhắc B2', said.status === 200, said);
await Bun.sleep(4000);
ok('lượt sang B2 → B2 "🎤 Đang phát biểu" (≤ 4 giây)', statusOf(B2.userId) === '🎤 Đang phát biểu', status.filter((s) => s.id === B2.userId));
ok('B1 hết lượt → "👥 Đang họp · chủ đề"', statusOf(B1.userId) === `👥 Đang họp · ${topic}`, statusOf(B1.userId));
const lv2 = ((await (await live(CHAT_KEY)).json()) as any[]).find((m) => m.sessionId === open.body?.id);
ok('internal/live: lượt 1, B2 giữ lượt', lv2?.turnsUsed === 1 && lv2?.speakerUserId === B2.userId, lv2);
const before = moves.length;
await Bun.sleep(1500);
ok('trong phiên bot không rời phòng', !moves.slice(before).some((m) => [B1.userId, B2.userId].includes(m.id) && m.anim === 1));

// ---------- Dừng họp → bot rời phòng ----------
const stop = await json(H.cookie, 'POST', `/api/meetings/sessions/${open.body?.id}/stop`);
ok('H dừng họp', stop.status === 200 && stop.body.status === 'Ended', stop);
const mark = moves.length, markLeft = left.length;
await Bun.sleep(4500);
ok('internal/live: không còn phiên', !((await (await live(CHAT_KEY)).json()) as any[]).some((m) => m.sessionId === open.body?.id));
ok('bot đứng dậy đi bộ (anim 1) — bong bóng "🚶 …"', [B1, B2].every((b) => moves.slice(mark).some((m) => m.id === b.userId && m.anim === 1)
  && statusOf(b.userId)?.startsWith('🚶')), [statusOf(B1.userId), statusOf(B2.userId)]);
for (let i = 0; i < 40; i++) {
  if ([B1, B2].every((b) => { const l = lastOf(b.userId); return l && l.anim !== 1; })) break;
  await Bun.sleep(1000);
}
const q1 = lastOf(B1.userId), q2 = lastOf(B2.userId);
ok('tới chỗ mới ngoài Phòng họp lớn (bàn), không biến mất ngay', !!q1 && !!q2 && !inside(q1.x, q1.z) && !inside(q2.x, q2.z) && q1.anim !== 1
  && !left.slice(markLeft).includes(B1.userId) && !left.slice(markLeft).includes(B2.userId), { q1, q2, left: left.slice(markLeft) });

await own.c.stop();
await h.c.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
