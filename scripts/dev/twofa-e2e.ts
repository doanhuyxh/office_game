// E2E: xác thực 2 lớp (TOTP) — bật / tắt, đăng nhập 2 bước, mã sai, mã dự phòng dùng 1 lần, admin / HR bị buộc bật (API bị chặn),
// HR đặt lại 2FA (email qua Mailpit + chuông), bảo vệ admin, token AI, khoá sau 5 lần sai, lịch sử sửa.
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm + Mailpit (admin seed của DB tạm CHƯA bật 2FA):
//   docker run -d --name e2e-2fa-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55441:5432 postgres:18-alpine
//   docker run -d --name e2e-2fa-mail -p 127.0.0.1:11041:1025 -p 127.0.0.1:18041:8025 axllent/mailpit
//   cd backend && ConnectionStrings__Default='Host=127.0.0.1;Port=55441;Database=e2e;Username=e2e;Password=e2e' Smtp__Host=127.0.0.1 Smtp__Port=11041 \
//     Smtp__UseSsl=false Smtp__Username= Smtp__Password= Seed__AdminEmail=admin2fa@officehub.test Seed__AdminPassword=Admin2fa123 \
//     ASPNETCORE_URLS=http://localhost:5181 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 MAILPIT_URL=http://127.0.0.1:18041 ADMIN_LOGIN=admin2fa@officehub.test ADMIN_PASSWORD=Admin2fa123 \
//     bun scripts/dev/twofa-e2e.ts
import { totp, wrongTotp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5181';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18041';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'admin2fa@officehub.test';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin2fa123';
const PW = 'E2e-2fa-2026';
const RUN = Date.now().toString(36).slice(-5);

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};

/** Trình duyệt giả: giữ cookie (officehub.auth + officehub.2fa), cập nhật theo mọi Set-Cookie (cookie được cấp lại khi đổi security stamp). */
class Client {
  jar = new Map<string, string>();
  bearer?: string;
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.bearer) headers.authorization = `Bearer ${this.bearer}`;
    else if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const c of r.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(';');
      const i = kv.indexOf('='), k = kv.slice(0, i).trim(), v = kv.slice(i + 1);
      const expired = !v || attrs.some((a) => /expires=thu, 01 jan 1970/i.test(a.trim()));
      expired ? this.jar.delete(k) : this.jar.set(k, v);
    }
    return { status: r.status, body: (await r.json().catch(() => null)) as any };
  }
  get = (p: string) => this.req('GET', p);
  post = (p: string, b?: unknown) => this.req('POST', p, b ?? {});
  put = (p: string, b?: unknown) => this.req('PUT', p, b);
  login = (login: string, password: string) => this.post('/api/auth/login', { login, password });
  code = (code: string, isRecoveryCode = false) => this.post('/api/auth/login/2fa', { code, isRecoveryCode });
}

/** Bật 2FA cho phiên đang đăng nhập → { key, codes }. */
async function enroll(c: Client) {
  const s = await c.post('/api/auth/2fa/setup');
  const e = await c.post('/api/auth/2fa/enable', { code: totp(s.body.sharedKey) });
  return { key: s.body?.sharedKey as string, codes: (e.body?.recoveryCodes ?? []) as string[], setup: s, enable: e };
}

async function mailTo(addr: string, subject: string) {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${addr}`)}`).then((x) => x.json()).catch(() => null) as any;
    const m = r?.messages?.find((x: any) => x.Subject.includes(subject));
    if (m) return m;
    await Bun.sleep(1000);
  }
  return null;
}

// ================= 1. Admin seed bị buộc bật 2FA =================
const admin = new Client();
const a1 = await admin.login(ADMIN_LOGIN, ADMIN_PASSWORD);
ok('admin chưa bật 2FA: đăng nhập được, mustSetupTwoFactor=true', a1.status === 200 && a1.body.mustSetupTwoFactor === true && a1.body.twoFactorEnabled === false, a1);
const blocked = await admin.get('/api/org/employees');
ok('admin chưa bật: API khác → 403 2fa_setup_required (tiếng Việt)', blocked.status === 403 && blocked.body?.title === '2fa_setup_required'
  && /xác thực 2 lớp/.test(blocked.body?.detail), blocked);
ok('admin chưa bật: /me vẫn 200', (await admin.get('/api/auth/me')).status === 200);
ok('admin chưa bật: không tạo được token AI (403)', (await admin.post('/api/auth/access-tokens', { name: 'x', expiresInDays: 30 })).status === 403);
ok('admin chưa bật: không tự tắt / tạo lại mã dự phòng (403 gate)', (await admin.post('/api/auth/2fa/recovery-codes', { code: '000000' })).status === 403);
const st0 = await admin.get('/api/auth/2fa/status');
ok('status: chưa bật, bắt buộc', st0.status === 200 && st0.body.enabled === false && st0.body.required === true, st0);

const s1 = await admin.post('/api/auth/2fa/setup');
ok('setup: khoá nhóm 4 + otpauth URI có issuer', s1.status === 200 && /^([a-z2-7]{4} )+[a-z2-7]{1,4}$/.test(s1.body.sharedKey)
  && s1.body.authenticatorUri.startsWith('otpauth://totp/') && s1.body.authenticatorUri.includes('issuer=') && s1.body.authenticatorUri.includes('digits=6'), s1);
const s2 = await admin.post('/api/auth/2fa/setup');
ok('setup lần 2 (không reset) → giữ khoá chờ xác nhận', s2.body?.sharedKey === s1.body.sharedKey);
const s3 = await admin.post('/api/auth/2fa/setup', { reset: true });
ok('setup reset → khoá mới, phiên vẫn dùng được (cookie cấp lại)', s3.status === 200 && s3.body.sharedKey !== s1.body.sharedKey
  && (await admin.get('/api/auth/me')).status === 200, s3);
const adminKey = s3.body.sharedKey as string;
const badEnable = await admin.post('/api/auth/2fa/enable', { code: wrongTotp(adminKey) });
ok('enable mã sai → 400 theo trường code', badEnable.status === 400 && !!badEnable.body?.errors?.code, badEnable);
ok('enable mã khoá cũ → 400', (await admin.post('/api/auth/2fa/enable', { code: totp(s1.body.sharedKey) })).status === 400);
const en = await admin.post('/api/auth/2fa/enable', { code: totp(adminKey).replace(/(\d{3})/, '$1 ') });
ok('enable đúng (có khoảng trắng) → 10 mã dự phòng XXXXX-XXXXX', en.status === 200 && en.body.recoveryCodes.length === 10
  && en.body.recoveryCodes.every((c: string) => /^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(c)), en);
const adminCodes = en.body.recoveryCodes as string[];
const me1 = await admin.get('/api/auth/me');
ok('sau khi bật: me twoFactorEnabled, hết mustSetup; API mở', me1.body.twoFactorEnabled === true && me1.body.mustSetupTwoFactor === false
  && (await admin.get('/api/org/employees')).status === 200, me1.body);
ok('enable lần nữa → 409', (await admin.post('/api/auth/2fa/enable', { code: totp(adminKey) })).status === 409);
ok('setup khi đã bật → 409', (await admin.post('/api/auth/2fa/setup')).status === 409);
const dis = await admin.post('/api/auth/2fa/disable', { currentPassword: ADMIN_PASSWORD, code: totp(adminKey) });
ok('admin không tự tắt được (409, bắt buộc)', dis.status === 409 && /bắt buộc/.test(dis.body?.detail), dis);

// ================= 2. Đăng nhập 2 bước =================
const a2 = new Client();
const step1 = await a2.login(ADMIN_LOGIN, ADMIN_PASSWORD);
ok('login: mật khẩu đúng → 403 2fa_required + cookie tạm officehub.2fa, chưa có officehub.auth', step1.status === 403 && step1.body?.title === '2fa_required'
  && a2.jar.has('officehub.2fa') && !a2.jar.has('officehub.auth'), { step1, jar: [...a2.jar.keys()] });
ok('chưa nhập mã: /me → 401', (await a2.get('/api/auth/me')).status === 401);
const wrong = await a2.code(wrongTotp(adminKey));
ok('mã sai → 401 2fa_invalid', wrong.status === 401 && wrong.body?.title === '2fa_invalid', wrong);
const right = await a2.code(totp(adminKey));
ok('mã đúng → 200 MeResponse + cookie đăng nhập', right.status === 200 && right.body.userName && a2.jar.has('officehub.auth'), right);
ok('sau bước 2: API dùng được', (await a2.get('/api/org/employees')).status === 200);
ok('không có cookie tạm → login/2fa 401 2fa_expired', (await new Client().code(totp(adminKey))).body?.title === '2fa_expired');

// Mã dự phòng: dùng được một lần (gõ thường, bỏ gạch)
const a3 = new Client();
await a3.login(ADMIN_LOGIN, ADMIN_PASSWORD);
const rc = await a3.code(adminCodes[0].replace('-', '').toLowerCase(), true);
ok('mã dự phòng (thường, không gạch) → 200', rc.status === 200 && a3.jar.has('officehub.auth'), rc);
const st1 = await a3.get('/api/auth/2fa/status');
ok('status: còn 9 mã dự phòng', st1.body?.recoveryCodesLeft === 9, st1);
const a4 = new Client();
await a4.login(ADMIN_LOGIN, ADMIN_PASSWORD);
ok('dùng lại mã dự phòng cũ → 401', (await a4.code(adminCodes[0], true)).status === 401);
ok('mã dự phòng khác vẫn dùng được', (await a4.code(adminCodes[1], true)).status === 200);

// ================= 3. Nhân viên thường: tự bật / tạo lại mã / tắt =================
const mkEmp = async (code: string, name: string, roles: string[]) => {
  const user = `e2e.${code.toLowerCase()}`;
  const e = (await admin.post('/api/org/employees', { code, fullName: name, email: `${user}.${RUN}@e2e-2fa.vn`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body?.employee;
  const acc = (await admin.post(`/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = new Client();
  const l = await c.login(user, acc.tempPassword);
  const cp = await c.post('/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { id: e.id as string, user, email: `${user}.${RUN}@e2e-2fa.vn`, c, first: l, changed: cp.status };
};
const nv = await mkEmp(`NV2F${RUN}`.slice(0, 10), 'Nhân Viên Hai Lớp', ['employee']);
ok('nhân viên: không bắt buộc 2FA', nv.first.body.mustSetupTwoFactor === false && (await nv.c.get('/api/auth/2fa/status')).body.required === false);
const nvE = await enroll(nv.c);
ok('nhân viên tự bật 2FA', nvE.enable.status === 200 && nvE.codes.length === 10, nvE.enable);
const regenBad = await nv.c.post('/api/auth/2fa/recovery-codes', { code: wrongTotp(nvE.key) });
ok('tạo lại mã dự phòng cần mã đúng (400)', regenBad.status === 400, regenBad);
const regen = await nv.c.post('/api/auth/2fa/recovery-codes', { code: totp(nvE.key) });
ok('tạo lại mã dự phòng → 10 mã mới', regen.status === 200 && regen.body.recoveryCodes.length === 10 && regen.body.recoveryCodes[0] !== nvE.codes[0], regen);
const nvOld = new Client();
await nvOld.login(nv.user, PW);
ok('mã dự phòng đợt cũ hết hiệu lực', (await nvOld.code(nvE.codes[2], true)).status === 401);
ok('mã dự phòng đợt mới dùng được', (await nvOld.code(regen.body.recoveryCodes[0], true)).status === 200);
const disBadPw = await nv.c.post('/api/auth/2fa/disable', { currentPassword: 'sai-mat-khau-1', code: totp(nvE.key) });
ok('tắt: sai mật khẩu → 400 currentPassword', disBadPw.status === 400 && !!disBadPw.body?.errors?.currentPassword, disBadPw);
const disBadCode = await nv.c.post('/api/auth/2fa/disable', { currentPassword: PW, code: wrongTotp(nvE.key) });
ok('tắt: sai mã → 400 code', disBadCode.status === 400 && !!disBadCode.body?.errors?.code, disBadCode);
const disOk = await nv.c.post('/api/auth/2fa/disable', { currentPassword: PW, code: totp(nvE.key) });
ok('tắt đúng → 204, phiên hiện tại vẫn dùng được', disOk.status === 204 && (await nv.c.get('/api/auth/me')).body?.twoFactorEnabled === false, disOk);
ok('đã tắt → đăng nhập 1 bước', (await new Client().login(nv.user, PW)).status === 200);

// ================= 4. HR bị buộc bật; token AI =================
const hr = await mkEmp(`HR2F${RUN}`.slice(0, 10), 'Nhân Sự Hai Lớp', ['hr']);
ok('HR mật khẩu tạm: mustChangePassword + mustSetup; change-password vẫn chạy', hr.first.body.mustChangePassword === true
  && hr.first.body.mustSetupTwoFactor === true && hr.changed === 204, hr.first.body);
const hrMe = await hr.c.get('/api/auth/me');
ok('HR sau đổi mật khẩu: vẫn mustSetupTwoFactor, API bị chặn', hrMe.body.mustSetupTwoFactor === true
  && (await hr.c.get('/api/leave/requests')).body?.title === '2fa_setup_required', hrMe.body);
ok('HR chưa bật: không tạo token AI', (await hr.c.post('/api/auth/access-tokens', { name: 'Claude', expiresInDays: 30 })).status === 403);
const hrE = await enroll(hr.c);
ok('HR bật 2FA → API mở', hrE.enable.status === 200 && (await hr.c.get('/api/org/employees')).status === 200);
const tok = await hr.c.post('/api/auth/access-tokens', { name: 'Claude', expiresInDays: 30 });
ok('HR đã bật: tạo token AI', tok.status === 200 && tok.body.token?.startsWith('ohk_'), tok);
const ai = new Client(); ai.bearer = tok.body.token;
ok('token AI của HR (đã bật 2FA) dùng được', (await ai.get('/api/auth/me')).status === 200);
const nvTok = await nv.c.post('/api/auth/access-tokens', { name: 'Cursor', expiresInDays: 30 });
const nvAi = new Client(); nvAi.bearer = nvTok.body?.token;
ok('nhân viên không bật 2FA vẫn dùng token AI', nvTok.status === 200 && (await nvAi.get('/api/auth/me')).status === 200);
ok('token AI không gọi được API 2FA', (await ai.post('/api/auth/2fa/setup')).status === 403);

// ================= 5. HR / admin đặt lại 2FA =================
// HR tự đặt lại cho mình → 403; HR đặt lại admin → 403; admin (có hồ sơ) do admin seed tạo
const hrSelf = await hr.c.post(`/api/org/employees/${hr.id}/account/reset-2fa`);
ok('HR không tự đặt lại 2FA của mình (403)', hrSelf.status === 403, hrSelf);
const adm2 = await mkEmp(`AD2F${RUN}`.slice(0, 10), 'Quản Trị Hai', ['admin']);
const adm2E = await enroll(adm2.c);
ok('admin thứ 2 bật 2FA', adm2E.enable.status === 200);
const hrOnAdmin = await hr.c.post(`/api/org/employees/${adm2.id}/account/reset-2fa`);
ok('HR không đặt lại 2FA của admin (403 "Chỉ admin")', hrOnAdmin.status === 403 && /Chỉ admin/.test(hrOnAdmin.body?.detail), hrOnAdmin);
ok('nhân viên thường không gọi được reset-2fa (403)', (await nv.c.post(`/api/org/employees/${hr.id}/account/reset-2fa`)).status === 403);
ok('reset-2fa cho người chưa bật → 409', (await hr.c.post(`/api/org/employees/${nv.id}/account/reset-2fa`)).status === 409);

// Nhân viên bật lại → khoá mình 5 lần sai → HR đặt lại (mở khoá luôn)
const nvE2 = await enroll(nv.c);
const lock = new Client();
await lock.login(nv.user, PW);
const fails: number[] = [];
for (let i = 0; i < 5; i++) fails.push((await lock.code(wrongTotp(nvE2.key), i % 2 === 1)).status);
ok('5 lần sai mã (TOTP + dự phòng) → khoá 423', fails.slice(0, 4).every((s) => s === 401) && fails[4] === 423, fails);
ok('đang khoá: mã đúng cũng bị từ chối (423)', (await lock.code(totp(nvE2.key))).status === 423);
ok('đang khoá: mật khẩu đúng → 423', (await new Client().login(nv.user, PW)).status === 423);

const reset = await hr.c.post(`/api/org/employees/${nv.id}/account/reset-2fa`);
ok('HR đặt lại 2FA nhân viên → 204', reset.status === 204, reset);
ok('phiên cũ của nhân viên bị đăng xuất (401)', (await nv.c.get('/api/auth/me')).status === 401);
const nvAgain = await new Client().login(nv.user, PW);
ok('sau đặt lại: mở khoá + đăng nhập 1 bước, 2FA tắt', nvAgain.status === 200 && nvAgain.body.twoFactorEnabled === false, nvAgain);
const list = (await hr.c.get('/api/org/employees?search=' + encodeURIComponent('Hai Lớp'))).body as any[];
ok('danh bạ (HR): account.twoFactorEnabled', list.find((e) => e.id === nv.id)?.account?.twoFactorEnabled === false
  && list.find((e) => e.id === hr.id)?.account?.twoFactorEnabled === true, list.map((e) => e.account));
const mail = await mailTo(nv.email, 'Xác thực 2 lớp đã được đặt lại');
ok('email báo đặt lại 2FA (Mailpit)', !!mail, mail);
const nvC2 = new Client(); await nvC2.login(nv.user, PW);
const bell = await nvC2.get('/api/notifications?take=5');
ok('chuông: account_security', bell.body?.items?.some((n: any) => n.category === 'account_security'), bell.body);

// Admin đặt lại 2FA của HR → HR bị buộc bật lại, token AI của HR ngừng
const adminOnHr = await admin.post(`/api/org/employees/${hr.id}/account/reset-2fa`);
ok('admin đặt lại 2FA của HR → 204', adminOnHr.status === 204, adminOnHr);
const aiBlocked = await ai.get('/api/auth/me');
ok('token AI của HR chưa bật lại → 401 (cần bật 2FA)', aiBlocked.status === 401 && /xác thực 2 lớp/.test(aiBlocked.body?.detail), aiBlocked);
const hrC2 = new Client();
const hrL2 = await hrC2.login(hr.user, PW);
ok('HR đăng nhập lại: không hỏi mã, nhưng buộc bật lại', hrL2.status === 200 && hrL2.body.mustSetupTwoFactor === true
  && (await hrC2.get('/api/org/employees')).status === 403, hrL2);
const hrE2 = await enroll(hrC2);
ok('HR bật lại → token AI hoạt động lại', hrE2.enable.status === 200 && (await ai.get('/api/auth/me')).status === 200);

// Admin thứ 2 đặt lại admin (admin seed không có hồ sơ → dùng admin thứ 2 làm đích, admin seed làm người gọi)
ok('admin đặt lại 2FA của admin khác → 204', (await admin.post(`/api/org/employees/${adm2.id}/account/reset-2fa`)).status === 204);

// ================= 6. Đổi vai trò → yêu cầu áp dụng ngay =================
const mgr = await mkEmp(`MG2F${RUN}`.slice(0, 10), 'Nâng Quyền Hai Lớp', ['employee']);
ok('nhân viên → API mở', (await mgr.c.get('/api/org/employees')).status === 200);
await admin.put(`/api/org/employees/${mgr.id}/account/roles`, { roles: ['hr'] });
ok('được cấp vai trò HR → phiên cũ hết hạn (401)', (await mgr.c.get('/api/org/employees')).status === 401);
const mgrL = await new Client().login(mgr.user, PW);
ok('đăng nhập lại với vai trò HR → buộc bật 2FA', mgrL.body?.mustSetupTwoFactor === true, mgrL.body);

// ================= 7. Lịch sử sửa: ghi TwoFactorEnabled, không lộ khoá =================
const changes = (await admin.get('/api/audit/changes?take=200')).body as any[];
const tf = changes.filter((c) => c.entity === 'AppUser' && c.changes.some((f: any) => f.field === 'TwoFactorEnabled'));
ok('lịch sử sửa có TwoFactorEnabled', tf.length >= 3, changes.slice(0, 3));
const dump = JSON.stringify(changes);
ok('lịch sử sửa không chứa khoá / mã dự phòng', ![adminKey.replace(/ /g, '').toUpperCase(), nvE2.key.replace(/ /g, '').toUpperCase(), adminCodes[3]]
  .some((s) => dump.toUpperCase().includes(s)));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
