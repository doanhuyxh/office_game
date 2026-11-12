// E2E: rà soát bảo mật (dự án TEST) — huỷ phiên & token (TEST-12), đăng nhập & hạn mức (TEST-20).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm + SMTP = Mailpit:
//   docker run -d --name e2e-sec-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55461:5432 postgres:18-alpine
//   docker run -d --name e2e-sec-mail -p 127.0.0.1:11061:1025 -p 127.0.0.1:18061:8025 axllent/mailpit
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5185 'ConnectionStrings__Default=Host=127.0.0.1;Port=55461;Database=e2e;Username=e2e;Password=e2e'
//        Smtp__Host=127.0.0.1 Smtp__Port=11061 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=sec-admin@officehub-e2e.vn Seed__AdminPassword=Sec-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 MAILPIT_URL=http://127.0.0.1:18061 PG_CONTAINER=e2e-sec-pg bun scripts/dev/security-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { $ } from 'bun';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5185';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18061';
const PG = process.env.PG_CONTAINER ?? 'e2e-sec-pg';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'sec-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Sec-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const rawLogin = (login: string, password: string) =>
  fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
const login = async (login: string, password: string): Promise<string> => {
  const r = await rawLogin(login, password);
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status} ${JSON.stringify(e.body)}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any, res: r };
};
const bearer = (token: string, path = '/api/auth/me') => fetch(API + path, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.status);
const PW = 'E2e-Sec-2026';
const MAIL = 'officehub-e2e.vn';
const stamp = Date.now().toString(36).slice(-4);
async function mailTo(to: string, subjectPart: string): Promise<any | null> {
  for (let i = 0; i < 30; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json();
    const m = list.messages?.find((x: any) => x.To?.some((t: any) => t.Address === to) && x.Subject.includes(subjectPart));
    if (m) return m;
    await sleep(500);
  }
  return null;
}

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });

/** Tạo nhân viên + tài khoản mật khẩu tạm; trả cookie đang ở trạng thái mật khẩu tạm. */
const mkTemp = async (code: string, user: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: `Bảo Mật ${code}`, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  return { e, user, email: `${user}@${MAIL}`, temp: acc.tempPassword as string, cookie: await login(user, acc.tempPassword) };
};

// ================= TEST-12: mật khẩu tạm bị chặn ở server =================
const A = await mkTemp(`SEC-${stamp}-A`, `e2e.sec.a${stamp}`);
const blocked = await json(A.cookie, 'GET', '/api/org/employees');
ok('mật khẩu tạm: API khác → 403 password_change_required', blocked.status === 403 && blocked.body?.title === 'password_change_required', blocked);
ok('mật khẩu tạm: /auth/me vẫn 200', (await json(A.cookie, 'GET', '/api/auth/me')).status === 200);
ok('mật khẩu tạm: tạo token → 403', (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: 'x', expiresInDays: 30 })).status === 403);
const ch = await json(A.cookie, 'POST', '/api/auth/change-password', { currentPassword: A.temp, newPassword: PW });
ok('đổi mật khẩu tạm → 204', ch.status === 204, ch.body);
let a = cookieOf(ch.res, 'officehub.auth');
ok('sau đổi mật khẩu: API dùng được', (await json(a, 'GET', '/api/auth/access-tokens')).status === 200);

// ================= TEST-12: tạo token cần xác nhận (trừ khi vừa đăng nhập) =================
a = await login(A.user, PW);
const t1 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'vừa đăng nhập', expiresInDays: 30 });
ok('vừa đăng nhập ≤ 10 phút: tạo token không cần xác nhận', t1.status === 200 && !!t1.body?.token, t1.body);
await sql(`UPDATE identity.users SET "LastLoginAt" = now() - interval '1 hour' WHERE "UserName" = '${A.user}'`);
const t2 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'thiếu xác nhận', expiresInDays: 30 });
ok('đăng nhập lâu rồi + thiếu confirm → 400 errors.confirm', t2.status === 400 && !!t2.body?.errors?.confirm, t2.body);
const t3 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'sai', expiresInDays: 30, confirm: 'sai-mat-khau' });
ok('confirm sai → 400', t3.status === 400 && !!t3.body?.errors?.confirm, t3.body);
const failed = Number((await sql(`SELECT "AccessFailedCount" FROM identity.users WHERE "UserName" = '${A.user}'`)).trim());
ok('confirm sai → tăng AccessFailedCount', failed >= 2, failed);
const t4 = await json(a, 'POST', '/api/auth/access-tokens', { name: 'đúng', expiresInDays: 30, confirm: PW });
ok('confirm = mật khẩu đúng → 200', t4.status === 200 && !!t4.body?.token, t4.body);
const tokA1 = t1.body.token as string, tokA2 = t4.body.token as string;
ok('token dùng được', (await bearer(tokA1)) === 200 && (await bearer(tokA2)) === 200);

// ================= TEST-12: đăng xuất đổi security stamp =================
const copy = a; // "bản sao cookie" bị chép
const lo = await json(a, 'POST', '/api/auth/logout');
ok('đăng xuất → 204', lo.status === 204);
ok('bản sao cookie sau đăng xuất → 401', (await json(copy, 'GET', '/api/auth/me')).status === 401);
ok('đăng xuất web KHÔNG ngắt token AI', (await bearer(tokA1)) === 200);

// ================= TEST-12: tự đổi mật khẩu → thu hồi token AI =================
a = await login(A.user, PW);
const PW2 = PW + '!';
ok('tự đổi mật khẩu → 204', (await json(a, 'POST', '/api/auth/change-password', { currentPassword: PW, newPassword: PW2 })).status === 204);
ok('sau đổi mật khẩu: mọi token AI → 401', (await bearer(tokA1)) === 401 && (await bearer(tokA2)) === 401);

// ================= TEST-12: HR cấp mật khẩu tạm → thu hồi token + báo chính chủ =================
a = await login(A.user, PW2);
const t5 = (await json(a, 'POST', '/api/auth/access-tokens', { name: 'trước khi HR reset', expiresInDays: 30 })).body?.token as string;
ok('token mới dùng được', (await bearer(t5)) === 200);
const rp = await json(admin, 'POST', `/api/org/employees/${A.e.id}/account/reset-password`);
ok('HR cấp mật khẩu tạm → 200', rp.status === 200 && !!rp.body?.tempPassword, rp);
ok('HR reset: token AI → 401', (await bearer(t5)) === 401);
ok('HR reset: cookie cũ → 401', (await json(a, 'GET', '/api/auth/me')).status === 401);
const bellA = await login(A.user, rp.body.tempPassword);
ok('HR reset: email tới chính chủ', !!(await mailTo(A.email, 'Mật khẩu đã được đặt lại')));
const ch2 = await json(bellA, 'POST', '/api/auth/change-password', { currentPassword: rp.body.tempPassword, newPassword: PW });
a = await login(A.user, PW);
const notes = (await json(a, 'GET', '/api/notifications?take=20')).body?.items ?? [];
ok('HR reset: chuông "Mật khẩu đã được đặt lại"', notes.some((n: any) => n.title === 'Mật khẩu đã được đặt lại'), notes.map((n: any) => n.title));

// ================= TEST-12: khoá tài khoản → token không sống lại khi mở lại =================
const t6 = (await json(a, 'POST', '/api/auth/access-tokens', { name: 'trước khi khoá', expiresInDays: 30 })).body?.token as string;
ok('token trước khi khoá dùng được', ch2.status === 204 && (await bearer(t6)) === 200);
const off = await json(admin, 'POST', `/api/org/employees/${A.e.id}/resign`, { leftAt: new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }) });
const on = await json(admin, 'POST', `/api/org/employees/${A.e.id}/reactivate`);
ok('nghỉ việc (khoá) rồi đi làm lại (mở)', off.status < 300 && on.status < 300, [off.status, on.status, off.body, on.body]);
ok('mở lại: token cũ vẫn 401', (await bearer(t6)) === 401);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
