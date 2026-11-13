// E2E TEST-69: HR đổi họ tên nhân viên → tài khoản (claim FullName) theo ngay, KHÔNG cần đăng nhập lại: /api/auth/me, tên người gửi chat,
// nhãn tên trong văn phòng 3D (người đang online nhận NameChanged — cả chính người đó; vào lại văn phòng bằng cookie cũ thấy tên mới).
// Sửa nhân viên chưa có tài khoản / không đổi tên không lỗi.
// CHỈ DB tạm. Api + Realtime trỏ DB tạm; Realtime chạy `Realtime__SessionCheckSeconds=5` (mặc định 30 s → đợi lâu hơn, đặt NAME_WAIT_MS).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 RT_URL=http://localhost:5191 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/rename-e2e.ts
// Đồng bộ dữ liệu cũ (job khởi động OrgMigrator.SyncAccountNamesAsync): sửa tay identity."AspNetUsers"."FullName" trên DB tạm → khởi động lại Api
// → /api/auth/me trả lại họ tên theo hồ sơ nhân viên (kiểm tra tay, xem bình luận TEST-69).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5181';
const RT = process.env.RT_URL ?? 'http://localhost:5191';
const NAME_WAIT_MS = Number(process.env.NAME_WAIT_MS ?? 15000);
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Đổi tên ${stamp}`, code: `RN${stamp}`.slice(0, 10) })).body;
let seq = 600 + Math.floor(Math.random() * 90);
const empBody = (code: string, name: string, email: string) => ({ code, fullName: name, email, phone: null, dateOfBirth: null, departmentId: dep,
  positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null });
const mkEmp = async (name: string, user: string, withAccount = true) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', empBody(code, name, `${user}@e2e.test`))).body.employee;
  if (!withAccount) return { e, code, user, cookie: '', userId: '' };
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
  return { e, code, user, cookie, userId };
};
const OLD = `ĐOÀN THỬ ${stamp.toUpperCase()}`, NEW = `Đoàn Thử Tên Mới ${stamp}`;
const A = await mkEmp(OLD, `e2e.rn.a.${stamp}`);
const B = await mkEmp('Người Quan Sát', `e2e.rn.b.${stamp}`);
ok('2 tài khoản', !!A.userId && !!B.userId);
ok('me của A: tên cũ', (await json(A.cookie, 'GET', '/api/auth/me')).body?.fullName === OLD);

// ---------- A và B vào văn phòng 3D ----------
type Hub = { conn: any; welcome: any; joined: any[]; renamed: [string, string][]; chats: any[] };
const connect = async (cookie: string): Promise<Hub> => {
  const h: Hub = { conn: null, welcome: null, joined: [], renamed: [], chats: [] };
  h.conn = new signalR.HubConnectionBuilder()
    .withUrl(`${RT}/rt/hub/office`, { headers: { cookie }, transport: signalR.HttpTransportType.WebSockets, skipNegotiation: true })
    .configureLogging(signalR.LogLevel.Warning).build();
  h.conn.on('Welcome', (w: any) => { h.welcome = w; });
  h.conn.on('PlayerJoined', (p: any) => { h.joined.push(p); });
  h.conn.on('NameChanged', (id: string, name: string) => { h.renamed.push([id, name]); });
  h.conn.on('Chat', (m: any) => { h.chats.push(m); });
  for (const m of ['PlayerLeft', 'Positions', 'BotStatus', 'LookChanged', 'Kicked', 'ScreenChanged', 'VoiceKick', 'Teleport']) h.conn.on(m, () => {});
  await h.conn.start();
  for (let i = 0; i < 25 && !h.welcome; i++) await Bun.sleep(200);
  return h;
};
const nameIn = (w: any, id: string) => w?.players?.find((p: any) => p.id === id)?.name;
const hb = await connect(B.cookie);
const ha = await connect(A.cookie);
ok('A vào 3D: nhãn tên cũ', nameIn(ha.welcome, A.userId) === OLD, ha.welcome);
for (let i = 0; i < 20 && !hb.joined.some((p) => p.id === A.userId); i++) await Bun.sleep(100);
ok('B thấy A vào với tên cũ', hb.joined.find((p) => p.id === A.userId)?.name === OLD, hb.joined);

// ---------- HR đổi họ tên A ----------
const put = await json(admin, 'PUT', `/api/org/employees/${A.e.id}`, empBody(A.code, NEW, `${A.user}@e2e.test`));
ok('HR sửa họ tên A → 200', put.status === 200, put);
ok('me của A (cookie cũ, không đăng nhập lại): tên mới', (await json(A.cookie, 'GET', '/api/auth/me')).body?.fullName === NEW);

// Người đang online: NameChanged tới cả văn phòng (gồm chính A) trong một nhịp SessionWatch
const t0 = Date.now();
while (Date.now() - t0 < NAME_WAIT_MS && !(hb.renamed.some(([id]) => id === A.userId) && ha.renamed.some(([id]) => id === A.userId))) await Bun.sleep(250);
ok('B nhận NameChanged(A, tên mới)', hb.renamed.some(([id, n]) => id === A.userId && n === NEW), hb.renamed);
ok('A nhận NameChanged của chính mình', ha.renamed.some(([id, n]) => id === A.userId && n === NEW), ha.renamed);
ok('không đổi tên B', !hb.renamed.some(([id]) => id === B.userId));

// Chat từ 3D (hub → Api bằng cookie cũ của A) → tên người gửi mới
await ha.conn.invoke('SendChat', `xin chào ${stamp}`);
for (let i = 0; i < 30 && !hb.chats.some((m) => m.text === `xin chào ${stamp}`); i++) await Bun.sleep(100);
ok('chat 3D của A hiện tên mới', hb.chats.find((m) => m.text === `xin chào ${stamp}`)?.name === NEW, hb.chats);

// Vào lại văn phòng bằng ĐÚNG cookie cũ (chưa được Api cấp lại) → nhãn tên mới cho mình và người khác
await ha.conn.stop();
hb.joined.length = 0;
const ha2 = await connect(A.cookie);
ok('A vào lại 3D (cookie cũ): nhãn tên mới', nameIn(ha2.welcome, A.userId) === NEW, ha2.welcome);
for (let i = 0; i < 20 && !hb.joined.some((p) => p.id === A.userId); i++) await Bun.sleep(100);
ok('B thấy A vào lại với tên mới', hb.joined.find((p) => p.id === A.userId)?.name === NEW, hb.joined);

// Tên người gửi chat qua Api (claim dựng lại mỗi request)
await Bun.sleep(1200); // chat giới hạn 1 tin / giây / người
const office = (await json(A.cookie, 'GET', '/api/chat/conversations')).body;
const officeId = (Array.isArray(office) ? office : office?.items ?? []).find((c: any) => c.kind === 'Office' || c.type === 'Office')?.id ?? 'office';
const sent = await json(A.cookie, 'POST', `/api/chat/conversations/${officeId}/messages`, { text: `REST ${stamp}`, clientId: crypto.randomUUID() });
ok('chat web của A: tên người gửi mới', sent.body?.senderName === NEW || sent.body?.message?.senderName === NEW, sent);

// ---------- Trường hợp không có tài khoản / không đổi tên ----------
const C = await mkEmp('Không Tài Khoản', `e2e.rn.c.${stamp}`, false);
ok('sửa nhân viên chưa có tài khoản → 200', (await json(admin, 'PUT', `/api/org/employees/${C.e.id}`, empBody(C.code, 'Không Tài Khoản 2', `${C.user}@e2e.test`))).status === 200);
ok('sửa B giữ nguyên tên → 200', (await json(admin, 'PUT', `/api/org/employees/${B.e.id}`, empBody(B.code, 'Người Quan Sát', `${B.user}@e2e.test`))).status === 200);
ok('me của B vẫn đúng', (await json(B.cookie, 'GET', '/api/auth/me')).body?.fullName === 'Người Quan Sát');

await ha2.conn.stop();
await hb.conn.stop();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
