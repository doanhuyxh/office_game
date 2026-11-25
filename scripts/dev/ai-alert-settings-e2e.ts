// E2E TEST-232: ngưỡng cảnh báo trợ lý AI chỉnh trên web — GET / PUT / DELETE /api/audit/ai-alert-settings.
// Quyền: chỉ admin đăng nhập web (nhân viên / quản lý → 403, token AI kể cả của admin → 403). PUT sai khoảng → 400 ghi số cụ thể.
// Job AiAlertMonitor đọc ngưỡng từ DB mỗi lần chạy: hạ blocked xuống 3 + cửa sổ 10 phút → 4 lệnh 403 có cảnh báo (mặc định 10 thì không),
// người chỉ 2 lệnh 403 thì không; nội dung cảnh báo ghi "10 phút". Lịch sử sửa (entity [Audited]); khôi phục mặc định → isDefault.
// TẠO NHÂN VIÊN THẬT → CHỈ DB tạm, khởi động lại Api ngay trước khi chạy (job quét lần đầu 50 s sau khởi động). Dựng như finance-dashboard-e2e.ts:
//   docker run -d --name e2e232-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15482:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5197
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15482;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e232-admin@officehub-e2e.vn Seed__AdminPassword=E2e232-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5197 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/ai-alert-settings-e2e.ts   (~1–6 phút, chờ job)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5197';
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
const S = '/api/audit/ai-alert-settings';

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
// Bắt đầu từ mặc định (chạy lại trên cùng DB được).
await json(admin, 'DELETE', S);
const d0 = await json(admin, 'GET', S);
ok('GET mặc định: 10 / 20 / 50 % / 60 / 20 / 15 phút / 60 phút, isDefault',
  d0.status === 200 && d0.body.isDefault === true && d0.body.blockedThreshold === 10 && d0.body.errorsThreshold === 20 && d0.body.errorsPercent === 50
  && d0.body.burstWritesThreshold === 60 && d0.body.chatSpamThreshold === 20 && d0.body.windowMinutes === 15 && d0.body.cooldownMinutes === 60, d0);
ok('DTO có defaults + ranges + intervalMinutes', d0.body?.defaults?.blockedThreshold === 10 && d0.body?.ranges?.windowMinutes?.min === 5
  && d0.body?.ranges?.windowMinutes?.max === 1440 && d0.body?.intervalMinutes === 5, d0.body);

const good = { blockedThreshold: 3, errorsThreshold: 20, errorsPercent: 50, burstWritesThreshold: 60, chatSpamThreshold: 20, windowMinutes: 10, cooldownMinutes: 30 };
const bad = await json(admin, 'PUT', S, { ...good, blockedThreshold: 0, windowMinutes: 4, errorsPercent: 100, cooldownMinutes: 20000 });
const errs = bad.body?.errors ?? {};
ok('PUT sai khoảng → 400, lỗi ghi số cụ thể', bad.status === 400 && String(errs.blockedThreshold).includes('từ 1 đến 1000')
  && String(errs.windowMinutes).includes('từ 5 đến 1440') && String(errs.errorsPercent).includes('từ 0 đến 99')
  && String(errs.cooldownMinutes).includes('từ 5 đến 10080'), bad);
ok('PUT sai không ghi gì', (await json(admin, 'GET', S)).body?.isDefault === true);

// Tài khoản thử: P (bị chặn 4 lần → có cảnh báo với ngưỡng 3), Q (2 lần → không), E (nhân viên, kiểm quyền).
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Ngưỡng AI ${stamp}`, code: `NG${stamp}`.slice(0, 10) })).body;
let seq = 800 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string };
};
const P = await mkEmp('Bot Bị Chặn Ngưỡng', `e2e.ngp.${stamp}`, ['employee']);
const Q = await mkEmp('Bot Dưới Ngưỡng', `e2e.ngq.${stamp}`, ['employee']);
const E = await mkEmp('Quản Lý Ngưỡng', `e2e.nge.${stamp}`, ['manager']);
ok('3 tài khoản + token', [P, Q, E].every((x) => x.userId && x.token?.startsWith('ohk_')));

ok('quản lý GET → 403', (await json(E.cookie, 'GET', S)).status === 403);
ok('quản lý PUT → 403', (await json(E.cookie, 'PUT', S, good)).status === 403);
ok('nhân viên DELETE → 403', (await json(P.cookie, 'DELETE', S)).status === 403);
ok('token AI GET / PUT / DELETE → 403', await ai(E.token, 'GET', S) === 403 && await ai(E.token, 'PUT', S, { body: good }) === 403
  && await ai(E.token, 'DELETE', S) === 403); // token của E (không xét cảnh báo) — 403 của P sẽ bị đếm vào luật blocked
const adminTok = (await json(admin, 'POST', '/api/auth/access-tokens', { name: `Agent admin ${stamp}`, expiresInDays: 1 })).body?.token;
if (adminTok) ok('token AI của admin GET / PUT → 403', await ai(adminTok, 'GET', S) === 403 && await ai(adminTok, 'PUT', S, { body: good }) === 403);
else console.log('… bỏ qua token admin (không tạo được token cho admin seed)');
ok('vẫn mặc định sau các lệnh bị từ chối', (await json(admin, 'GET', S)).body?.isDefault === true);

const put = await json(admin, 'PUT', S, good);
ok('admin PUT → 200, lưu đúng + người sửa', put.status === 200 && put.body.isDefault === false && put.body.blockedThreshold === 3
  && put.body.windowMinutes === 10 && put.body.cooldownMinutes === 30 && !!put.body.updatedAt && !!put.body.updatedByName, put.body);
const ch = await json(admin, 'GET', '/api/audit/changes?entity=AiAlertSettings&page=1&pageSize=20');
if (ch.status === 200) {
  const items = ch.body?.items ?? ch.body ?? [];
  ok('lịch sử sửa ghi AiAlertSettings', JSON.stringify(items).includes('BlockedThreshold'), ch.body);
} else console.log(`… bỏ qua lịch sử sửa (GET /changes ${ch.status} — chỉ HR)`);

// Job: P 4 lệnh 403 (≥ 3, < mặc định 10), Q 2 lệnh 403.
for (let i = 0; i < 4; i++) await ai(P.token, 'GET', '/api/contracts');
for (let i = 0; i < 2; i++) await ai(Q.token, 'GET', '/api/contracts');
console.log('… đợi job cảnh báo (tối đa 6 phút)');
let alerts: any = null;
for (let i = 0; i < 72; i++) {
  alerts = (await json(admin, 'GET', '/api/audit/ai-alerts?page=1&pageSize=50')).body;
  if ((alerts?.items ?? []).some((a: any) => a.userId === P.userId && a.rule === 'blocked')) break;
  await Bun.sleep(5000);
}
const pa = alerts?.items?.find((a: any) => a.userId === P.userId && a.rule === 'blocked');
ok('4 lệnh 403 + ngưỡng 3 → cảnh báo blocked', pa?.count === 4, alerts?.items);
const mins = pa ? Math.round((Date.parse(pa.windowEnd) - Date.parse(pa.windowStart)) / 60000) : -1;
ok('cửa sổ cảnh báo = 10 phút, nội dung ghi "10 phút"', mins === 10 && String(pa?.body).includes('trong 10 phút qua'), pa);
ok('2 lệnh 403 (dưới ngưỡng) → không cảnh báo', !(alerts?.items ?? []).some((a: any) => a.userId === Q.userId));

const rs = await json(admin, 'DELETE', S);
ok('Khôi phục mặc định → 200, isDefault, giá trị gốc', rs.status === 200 && rs.body.isDefault === true && rs.body.blockedThreshold === 10
  && rs.body.windowMinutes === 15 && rs.body.updatedAt === null, rs.body);
ok('GET sau khôi phục vẫn mặc định', (await json(admin, 'GET', S)).body?.isDefault === true);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
