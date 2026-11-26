// E2E TEST-244 (Cache phía server — B2a): cache xác thực trong RAM (AuthCache) — huỷ phiên / thu hồi vẫn có hiệu lực NGAY.
// Mỗi kịch bản: làm nóng cache (gọi ≥ 2 lần bằng cookie / token) → đổi trạng thái → request KẾ TIẾP phải bị chặn / thấy quyền mới.
// Đo thêm số câu DB của request "rỗng" + /auth/me (header Server-Timing, Api Development): cache trúng → phần xác thực 0 câu.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e244-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15444:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5244
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15444;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=9 Sentry__Dsn= Seq__Url= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng> Database__MigrateOnStartup=true
//        Seed__AdminEmail=e2e244-admin@officehub-e2e.vn Seed__AdminPassword=E2e244-Admin-2026
//        (+ App__BaseUrl, DataProtection__KeysPath, Smtp__FromEmail, S3__* trỏ 127.0.0.1:9, Realtime__MapPath nếu chạy ngoài repo / không .env)
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5244 bun scripts/dev/auth-cache-e2e.ts
//   Dọn: docker rm -f e2e244-pg
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5244';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e244-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e244-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const r = await post('/api/auth/login', { login: user, password });
    if (r.status === 429 && attempt < 5) { await sleep(15000); continue; }
    const body = await r.json().catch(() => null) as any;
    if (r.status === 403 && body?.title === '2fa_required') {
      const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
      return cookieOf(r2, 'officehub.auth');
    }
    let cookie = cookieOf(r, 'officehub.auth');
    if (r.ok && body?.mustSetupTwoFactor) {
      const p = async (path: string, b: unknown) => {
        const x = await post(path, b, cookie);
        cookie = cookieOf(x, 'officehub.auth') || cookie;
        return { status: x.status, body: await x.json().catch(() => null) as any };
      };
      const s = await p('/api/auth/2fa/setup', {});
      const e = await p('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
      if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${user}: ${e.status}`);
      keys[user] = s.body.sharedKey;
      writeFileSync(KEYS_FILE, JSON.stringify(keys));
    }
    return cookie;
  }
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any, res: r, timing: r.headers.get('server-timing') ?? '' };
};
const bearer = async (token: string, path = '/api/auth/me') => {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}` } });
  return { status: r.status, body: await r.json().catch(() => null) as any, timing: r.headers.get('server-timing') ?? '' };
};
const queries = (timing: string) => Number(/desc="(\d+) queries"/.exec(timing)?.[1] ?? NaN);
/** Làm nóng: 2 lần liên tiếp đều 200 → ảnh chụp đã nằm trong cache. */
const warmCookie = async (c: string) => (await json(c, 'GET', '/api/auth/me')).status === 200 && (await json(c, 'GET', '/api/auth/me')).status === 200;
const warmToken = async (t: string) => (await bearer(t)).status === 200 && (await bearer(t)).status === 200;
const PW = 'E2e244-User-2026';
const stamp = Date.now().toString(36).slice(-4);

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const emp = await json(admin, 'POST', '/api/org/employees', { code: `AC-${stamp}`, fullName: `Cache Xác Thực ${stamp}`, email: `e2e.ac${stamp}@officehub-e2e.vn`,
  phone: null, dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
if (emp.status >= 300) throw new Error(`Tạo nhân viên lỗi: ${JSON.stringify(emp.body)}`);
const E = emp.body.employee, USER = `e2e.ac${stamp}`;
const acc = (await json(admin, 'POST', `/api/org/employees/${E.id}/account`, { mode: 'password', roles: ['employee'], userName: USER })).body;
const tempCookie = await login(USER, acc.tempPassword);
const ch = await json(tempCookie, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
ok('tạo tài khoản nhân viên + đổi mật khẩu tạm', ch.status === 204, ch.body);
let a = await login(USER, PW);
const mkToken = async (cookie: string, name: string) => {
  const r = await json(cookie, 'POST', '/api/auth/access-tokens', { name, expiresInDays: 30 });
  return { token: r.body?.token as string, id: r.body?.accessToken?.id as string };
};
let T1 = await mkToken(a, 'token chính');
ok('tạo token AI', !!T1.token && !!T1.id);

// ---- số câu DB khi cache đã nóng ----
const NONE = '/api/khong-co-route-244';
await json(a, 'GET', NONE);
const cNone = queries((await json(a, 'GET', NONE)).timing), cMe = queries((await json(a, 'GET', '/api/auth/me')).timing);
// Lần dùng token đầu ghi LastUsedAt + bỏ ảnh chụp token khỏi cache (đọc lại 1 câu ở lần sau) → làm nóng 2 lần.
await bearer(T1.token); await bearer(T1.token);
const tNone = queries((await bearer(T1.token, NONE)).timing), tMe = queries((await bearer(T1.token)).timing);
console.log(`  số câu khi cache nóng: cookie rỗng ${cNone}, cookie /auth/me ${cMe}, token rỗng ${tNone}, token /auth/me ${tMe}`);
ok('cookie: request rỗng 0 câu (trước cache 5)', cNone === 0, cNone);
ok('token: request rỗng 0 câu (trước cache 3)', tNone === 0, tNone);
ok('/auth/me chỉ còn 3 câu của endpoint (users, user_avatars, user_roles; trước cache cookie 7 / token 9)', cMe === 3 && tMe === 3, [cMe, tMe]);

// ---- 1. đăng nhập thiết bị B → cookie A bị 401 ngay ----
ok('cookie A nóng', await warmCookie(a));
const b = await login(USER, PW);
ok('đăng nhập thiết bị B → cookie A 401 ngay', (await json(a, 'GET', '/api/auth/me')).status === 401);
ok('cookie B dùng được', (await json(b, 'GET', '/api/auth/me')).status === 200);

// ---- 2. thu hồi một token → 401 ngay, token khác vẫn chạy ----
const T2 = await mkToken(b, 'token sẽ thu hồi');
ok('token 2 nóng', await warmToken(T2.token) && await warmToken(T1.token));
const del = await json(b, 'DELETE', `/api/auth/access-tokens/${T2.id}`);
ok('thu hồi token 2 → 401 ngay', del.status < 300 && (await bearer(T2.token)).status === 401, del.status);
ok('token 1 không bị ảnh hưởng', (await bearer(T1.token)).status === 200);

// ---- 3. đổi vai trò → quyền mới ngay ----
ok('cookie B + token 1 nóng (vai trò employee)', await warmCookie(b) && await warmToken(T1.token));
const r1 = await json(admin, 'PUT', `/api/org/employees/${E.id}/account/roles`, { roles: ['employee', 'manager'] });
const me1 = await bearer(T1.token);
ok('thêm vai trò manager → token thấy manager ngay', r1.status < 300 && me1.status === 200 && me1.body?.roles?.includes('manager'), [r1.status, me1.body?.roles]);
ok('đổi vai trò đổi security stamp → cookie B 401 ngay', (await json(b, 'GET', '/api/auth/me')).status === 401);
let c = await login(USER, PW);
ok('đăng nhập lại → cookie có vai trò mới', (await json(c, 'GET', '/api/auth/me')).body?.roles?.includes('manager'));

// ---- 4. vai trò cần 2FA (hr) mà chưa bật → token bị chặn ngay; bỏ vai trò → chạy lại ngay ----
ok('token 1 nóng (manager)', await warmToken(T1.token));
await json(admin, 'PUT', `/api/org/employees/${E.id}/account/roles`, { roles: ['employee', 'hr'] });
const blocked = await bearer(T1.token);
ok('thêm vai trò hr (chưa bật 2FA) → token 401 ngay', blocked.status === 401, blocked);
await json(admin, 'PUT', `/api/org/employees/${E.id}/account/roles`, { roles: ['employee'] });
const back = await bearer(T1.token);
ok('bỏ vai trò hr → token chạy lại ngay, không còn manager', back.status === 200 && !back.body?.roles?.includes('manager'), back.body?.roles);

// ---- 5. HR cấp mật khẩu tạm → cookie + token 401 ngay; đăng nhập bằng mật khẩu tạm → 403 password_change_required ----
c = await login(USER, PW);
ok('cookie + token 1 nóng', await warmCookie(c) && await warmToken(T1.token));
const rp = await json(admin, 'POST', `/api/org/employees/${E.id}/account/reset-password`);
ok('HR cấp mật khẩu tạm → cookie 401 ngay', rp.status === 200 && (await json(c, 'GET', '/api/auth/me')).status === 401, rp.status);
ok('HR cấp mật khẩu tạm → token 401 ngay', (await bearer(T1.token)).status === 401);
const t = await login(USER, rp.body.tempPassword);
const must = await json(t, 'GET', '/api/notifications/unread-count');
ok('mật khẩu tạm → API 403 password_change_required', must.status === 403 && must.body?.title === 'password_change_required', must);
ok('đổi mật khẩu tạm → 204', (await json(t, 'POST', '/api/auth/change-password', { currentPassword: rp.body.tempPassword, newPassword: PW })).status === 204);

// ---- 6. lockout (sai mật khẩu hiện tại 5 lần → AccessFailedAsync) → token 401 ngay ----
let d = await login(USER, PW);
const T3 = await mkToken(d, 'token trước lockout');
ok('token 3 nóng', await warmToken(T3.token));
for (let i = 0; i < 5; i++) await json(d, 'POST', '/api/auth/change-password', { currentPassword: 'Sai-Mat-Khau-1', newPassword: PW + '!' });
const lk = await bearer(T3.token);
ok('sai mật khẩu hiện tại 5 lần (tạm khoá) → token 401 ngay', lk.status === 401, lk);
const cl = await json(admin, 'GET', `/api/org/employees/${E.id}`);
ok('nhân viên vẫn đọc được (khoá không ảnh hưởng HR)', cl.status === 200);

// ---- 7. HR khoá tài khoản (nghỉ việc) → cookie + token 401 ngay; mở lại → token cũ vẫn 401 ----
// Tạm khoá ở bước 6 còn 15 phút → mở khoá bằng HR cấp mật khẩu tạm (xoá lockout) rồi đổi lại.
const rp2 = await json(admin, 'POST', `/api/org/employees/${E.id}/account/reset-password`);
const t2 = await login(USER, rp2.body.tempPassword);
await json(t2, 'POST', '/api/auth/change-password', { currentPassword: rp2.body.tempPassword, newPassword: PW });
d = await login(USER, PW);
const T4 = await mkToken(d, 'token trước khi khoá');
ok('cookie + token 4 nóng', !!T4.token && await warmCookie(d) && await warmToken(T4.token), T4);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const off = await json(admin, 'POST', `/api/org/employees/${E.id}/resign`, { leftAt: today });
ok('HR khoá tài khoản → cookie 401 ngay', off.status < 300 && (await json(d, 'GET', '/api/auth/me')).status === 401, off);
ok('HR khoá tài khoản → token 401 ngay', (await bearer(T4.token)).status === 401);
const on = await json(admin, 'POST', `/api/org/employees/${E.id}/reactivate`);
ok('mở lại tài khoản → token cũ vẫn 401', on.status < 300 && (await bearer(T4.token)).status === 401, on.status);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
