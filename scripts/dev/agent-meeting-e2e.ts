// E2E: phiên họp agent trong phòng họp (TEST-74) — mở / dừng chỉ người thật, bot chỉ xem phiên mình dự, 1 phiên / phòng,
// kiểm tra bot dự (IsBot, còn làm, 2..8, chủ trì trong danh sách), trần lượt / phút do admin chỉnh, job kết thúc phiên quá giờ.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-agm-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55474:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5187 'ConnectionStrings__Default=Host=127.0.0.1;Port=55474;Database=e2e;Username=e2e;Password=e2e'
//        Seed__AdminEmail=agm-admin@officehub-e2e.vn Seed__AdminPassword=Agm-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5187 ADMIN_LOGIN=agm-admin@officehub-e2e.vn ADMIN_PASSWORD=Agm-Admin-2026 PG_CONTAINER=e2e-agm-pg \
//     bun scripts/dev/agent-meeting-e2e.ts
// Phần "hết giờ" sửa StartedAt bằng psql trong container DB tạm rồi chờ job (mỗi phút) — ~2 phút.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5187';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const PG = process.env.PG_CONTAINER ?? 'e2e-agm-pg';
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Họp agent ${stamp}`, code: `AG${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, token: t?.token as string, name };
};
const H = await mkEmp('Chủ Họp', `e2e.agh.${stamp}`);
const N = await mkEmp('Người Thứ Hai', `e2e.agn.${stamp}`);
const B1 = await mkEmp('Bot Kinh Doanh', `e2e.agb1.${stamp}`);
const B2 = await mkEmp('Bot Tài Chính', `e2e.agb2.${stamp}`);
const B3 = await mkEmp('Bot Nhân Sự', `e2e.agb3.${stamp}`);
ok('5 tài khoản + token', [H, N, B1, B2, B3].every((x) => x.e?.id && x.token?.startsWith('ohk_')));
for (const b of [B1, B2, B3]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

const rooms = (await json(H.cookie, 'GET', '/api/meetings/rooms')).body as any[];
const room = rooms[0].id as string, room2 = rooms[1].id as string;
const body = (over: Record<string, unknown> = {}) => ({ roomId: room, topic: 'Kế hoạch doanh thu Q1', chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id], ...over });

// ---------- Cài đặt trần (admin) ----------
ok('nhân viên xem cài đặt → 403', (await json(H.cookie, 'GET', '/api/meetings/agent-settings')).status === 403);
const s0 = await json(admin, 'GET', '/api/meetings/agent-settings');
// DB mới: isDefault = true; chạy lại: lần trước đã đặt về 30 / 30.
ok('admin xem 30 lượt / 30 phút (mặc định)', s0.status === 200 && s0.body.maxTurns === 30 && s0.body.maxMinutes === 30 && s0.body.defaultMaxTurns === 30, s0);
ok('trần ngoài khoảng → 400', (await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 1, maxMinutes: 500 })).status === 400);
ok('token AI xem cài đặt → 403', (await tk(H.token, 'GET', '/api/meetings/agent-settings')).status === 403);
ok('token AI sửa cài đặt → 403', (await tk(B1.token, 'PUT', '/api/meetings/agent-settings', { maxTurns: 200, maxMinutes: 240 })).status === 403);
const s1 = await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 12, maxMinutes: 20 });
ok('admin đặt 12 lượt / 20 phút', s1.status === 200 && s1.body.maxTurns === 12 && !s1.body.isDefault && s1.body.updatedByName, s1);

// ---------- Kiểm tra dữ liệu ----------
ok('1 bot → 400', (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B1.e.id] }))).status === 400);
ok('người thật làm bot dự → 400', (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B1.e.id, N.e.id] }))).status === 400);
ok('chủ trì ngoài danh sách → 400', (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ chairEmployeeId: B3.e.id }))).status === 400);
ok('thiếu chủ đề → 400', (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ topic: '  ' }))).status === 400);
ok('phòng không tồn tại → 400', (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ roomId: 'pantry' }))).status === 400);

// ---------- Chỉ người thật mở ----------
ok('token bot mở → 403', (await tk(B1.token, 'POST', '/api/meetings/sessions', body())).status === 403);
ok('token người thật mở → 403', (await tk(H.token, 'POST', '/api/meetings/sessions', body())).status === 403);
ok('tài khoản bot mở bằng cookie → 403', (await json(B1.cookie, 'POST', '/api/meetings/sessions', body())).status === 403);
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B1.e.id, B2.e.id, B1.e.id] }));
const m = open.body;
ok('người thật mở → Active, chụp trần 12 / 20, bỏ trùng bot, chủ trì đầu danh sách', open.status === 200 && m.status === 'Active' && m.maxTurns === 12
  && m.maxMinutes === 20 && m.bots.length === 2 && m.bots[0].isChair && m.canStop && m.turnsUsed === 0, open);
ok('phòng đang họp → 409', (await json(N.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B2.e.id, B3.e.id], chairEmployeeId: B2.e.id }))).status === 409);
await json(admin, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 });
ok('admin đổi trần sau → phiên đang họp giữ trần cũ', (await json(H.cookie, 'GET', `/api/meetings/sessions/${m.id}`)).body?.maxTurns === 12);

// ---------- Xem ----------
const b1Get = await tk(B1.token, 'GET', `/api/meetings/sessions/${m.id}`);
ok('bot dự xem phiên (canStop=false)', b1Get.status === 200 && b1Get.body.canStop === false, b1Get);
ok('bot không dự xem → 404', (await tk(B3.token, 'GET', `/api/meetings/sessions/${m.id}`)).status === 404);
const b1List = await tk(B1.token, 'GET', `/api/meetings/sessions?roomId=${room}&active=true`);
ok('bot dự: danh sách đang họp có phiên', b1List.status === 200 && b1List.body.length === 1 && b1List.body[0].id === m.id, b1List);
ok('bot không dự: danh sách rỗng', (await tk(B3.token, 'GET', `/api/meetings/sessions?active=true`)).body?.length === 0);
const nList = await json(N.cookie, 'GET', `/api/meetings/sessions?roomId=${room}&active=true`);
ok('người thật khác xem được (canStop=false)', nList.body?.length === 1 && nList.body[0].canStop === false, nList);

// ---------- Dừng ----------
ok('token bot dừng → 403', (await tk(B1.token, 'POST', `/api/meetings/sessions/${m.id}/stop`)).status === 403);
ok('token người mở dừng → 403', (await tk(H.token, 'POST', `/api/meetings/sessions/${m.id}/stop`)).status === 403);
ok('người khác dừng → 403', (await json(N.cookie, 'POST', `/api/meetings/sessions/${m.id}/stop`)).status === 403);
const stop = await json(H.cookie, 'POST', `/api/meetings/sessions/${m.id}/stop`);
ok('người mở dừng → Ended / Stopped', stop.status === 200 && stop.body.status === 'Ended' && stop.body.endReason === 'Stopped'
  && stop.body.endedByName === H.name && stop.body.endedAt, stop);
ok('dừng lần nữa → 409', (await json(H.cookie, 'POST', `/api/meetings/sessions/${m.id}/stop`)).status === 409);
const m2 = (await json(N.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B2.e.id, B3.e.id], chairEmployeeId: B2.e.id }))).body;
ok('phòng trống lại → người khác mở được', m2?.status === 'Active', m2);
const hrStop = await json(admin, 'POST', `/api/meetings/sessions/${m2.id}/stop`);
ok('admin dừng hộ', hrStop.status === 200 && hrStop.body.endReason === 'Stopped', hrStop);

// ---------- Hết giờ ----------
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();
const m3 = (await json(H.cookie, 'POST', '/api/meetings/sessions', body({ roomId: room2 }))).body;
const m4 = (await json(H.cookie, 'POST', '/api/meetings/sessions', body())).body;
ok('mở 2 phiên ở 2 phòng', m3?.status === 'Active' && m4?.status === 'Active');
await sql(`UPDATE meetings.agent_sessions SET "StartedAt" = now() - interval '31 minutes' WHERE "Id" IN ('${m3.id}', '${m4.id}')`);
// Phòng có phiên quá giờ mà job chưa đóng → mở mới được, phiên cũ đóng TimeLimit.
const m5 = await json(N.cookie, 'POST', '/api/meetings/sessions', body({ botIds: [B2.e.id, B3.e.id], chairEmployeeId: B2.e.id }));
ok('phiên quá giờ không chặn mở mới', m5.status === 200, m5);
ok('phiên cũ đóng TimeLimit khi mở mới', (await json(H.cookie, 'GET', `/api/meetings/sessions/${m4.id}`)).body?.endReason === 'TimeLimit');
let ended: any = null;
for (let i = 0; i < 20 && ended?.status !== 'Ended'; i++) {
  await Bun.sleep(6000);
  ended = (await json(H.cookie, 'GET', `/api/meetings/sessions/${m3.id}`)).body;
}
ok('job nền kết thúc phiên quá giờ (TimeLimit, không ghi người dừng)', ended?.status === 'Ended' && ended.endReason === 'TimeLimit' && !ended.endedByName, ended);
const ops = await json(admin, 'GET', '/api/system/ops');
ok('job hiện ở trang Vận hành', JSON.stringify(ops.body ?? {}).includes('meetings.agent-expiry'), ops.status);
await json(N.cookie, 'POST', `/api/meetings/sessions/${m5.body.id}/stop`);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
