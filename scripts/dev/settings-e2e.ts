// E2E TEST-41: cấu hình S3 / SMTP / FCM / IP văn phòng lưu trong DB (trang Hệ thống → Cấu hình).
// Chỉ admin (HR / nhân viên / token AI → 403), GET không trả bí mật, bí mật trong DB đã mã hoá, lưu → hiệu lực ngay (không khởi động lại),
// xoá → quay về .env, IP / CIDR sai → 400, nút Kiểm tra (S3 ghi + xoá file thật, SMTP gửi Mailpit, FCM dry run, IP so với IP người gọi).
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + Mailpit (container như security-e2e.ts):
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5185 'ConnectionStrings__Default=Host=127.0.0.1;Port=55461;Database=e2e;Username=e2e;Password=e2e'
//        Smtp__Host=127.0.0.1 Smtp__Port=11061 Smtp__UseSsl=false Smtp__Username= Smtp__Password= Office__IpRanges=
//        Seed__AdminEmail=sec-admin@officehub-e2e.vn Seed__AdminPassword=Sec-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 MAILPIT_URL=http://127.0.0.1:18061 PG_CONTAINER=e2e-sec-pg bun scripts/dev/settings-e2e.ts
// S3 vẫn là bucket thật trong .env: bài thử ghi rồi xoá 1 file nhỏ ở {prefix}files/_config-check/.
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    if (!keys[user]) throw new Error(`${user} đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`);
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    const en = await post('/api/auth/2fa/enable', { code }, cookie);
    if (!en.ok) throw new Error(`Không bật được 2FA cho ${user}: ${en.status}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000);
    return login(user, password);
  }
  return cookie;
};
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, text };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);

const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV CH ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Cấu hình E2E ${stamp}`, code: `CH${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const EMP = await mkEmp(`CE${stamp}`, 'Nhân Viên CH', `e2e.ch.emp.${stamp}`, ['employee']);
const HR = await mkEmp(`CR${stamp}`, 'HR CH', `e2e.ch.hr.${stamp}`, ['employee', 'hr']);
ok('Nhân viên + HR đăng nhập', !!EMP.cookie && !!HR.cookie);

// ---- Quyền ----
ok('Nhân viên → 403', (await json(EMP.cookie, 'GET', '/api/system/settings')).status === 403);
ok('HR (không phải admin) → 403', (await json(HR.cookie, 'GET', '/api/system/settings')).status === 403);
ok('HR PUT → 403', (await json(HR.cookie, 'PUT', '/api/system/settings/office_ips', { values: { ranges: [] } })).status === 403);
const tok = (await json(admin, 'POST', '/api/auth/access-tokens', { name: `cfg ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Admin có token AI', !!tok);
ok('Token AI của admin → 403 (ngoài allowlist)', (await call({ authorization: `Bearer ${tok}` }, 'GET', '/api/system/settings')).status === 403);
ok('Token AI PUT → 403', (await call({ authorization: `Bearer ${tok}` }, 'PUT', '/api/system/settings/smtp', { values: {} })).status === 403);
ok('Chưa đăng nhập → 401', (await call({}, 'GET', '/api/system/settings')).status === 401);

// ---- Đọc ----
let r = await json(admin, 'GET', '/api/system/settings');
const groups = r.body as any[];
ok('GET 4 nhóm, đều đang đọc .env', r.status === 200 && groups.length === 4 && groups.every((g) => g.source === 'env'), r.body);
const s3env = groups.find((g) => g.group === 's3');
ok('S3 .env: có region / bucket, secretKey chỉ là cờ true', !!s3env.values.region && !!s3env.values.bucketFiles && s3env.secrets.secretKey === true
  && !('secretKey' in s3env.values), s3env);
ok('Nhóm không tồn tại → 404', (await json(admin, 'GET', '/api/system/settings/abc')).status === 404);

// ---- IP văn phòng ----
r = await json(admin, 'PUT', '/api/system/settings/office_ips', { values: { ranges: [{ cidr: '10.0.0.1/8', note: 'gõ nhầm' }, { cidr: 'abc' }] } });
ok('CIDR có bit host / sai định dạng → 400 theo dòng', r.status === 400 && !!r.body?.errors?.['ranges[0].cidr'] && !!r.body?.errors?.['ranges[1].cidr'], r.body);
r = await json(EMP.cookie, 'GET', '/api/attendance/today');
ok('Trước khi lưu: chấm công tính Remote', r.body?.currentWorkMode === 'Remote', r.body?.currentWorkMode);
r = await json(admin, 'PUT', '/api/system/settings/office_ips', { values: { ranges: [{ cidr: '127.0.0.1', note: 'Máy dev' }, { cidr: '::1', note: null }] } });
ok('Lưu IP văn phòng (200, source db, chuẩn hoá /32)', r.status === 200 && r.body.source === 'db' && r.body.values.ranges[0].cidr === '127.0.0.1/32'
  && r.body.values.ranges[0].note === 'Máy dev' && r.body.updatedBy, r.body);
r = await json(EMP.cookie, 'GET', '/api/attendance/today');
ok('Ngay sau khi lưu (không khởi động lại): chấm công tính Onsite', r.body?.currentWorkMode === 'Onsite', r.body?.currentWorkMode);
r = await json(admin, 'POST', '/api/system/settings/office_ips/test');
ok('Kiểm tra IP → khớp', r.status === 200 && r.body.ok === true && r.body.message.includes('KHỚP'), r.body);
r = await json(admin, 'DELETE', '/api/system/settings/office_ips');
ok('Xoá → quay về .env', r.status === 200 && r.body.source === 'env', r.body);
r = await json(EMP.cookie, 'GET', '/api/attendance/today');
ok('Sau khi xoá: lại Remote (Office__IpRanges trống)', r.body?.currentWorkMode === 'Remote', r.body?.currentWorkMode);

// ---- SMTP ----
const SMTP_PW = `smtp-secret-${stamp}-XyZ`;
r = await json(admin, 'PUT', '/api/system/settings/smtp', { values: { host: '127.0.0.1', port: 70000, fromEmail: 'không-phải-mail' } });
ok('SMTP cổng / email sai → 400', r.status === 400 && !!r.body?.errors?.port && !!r.body?.errors?.fromEmail, r.body);
r = await json(admin, 'PUT', '/api/system/settings/smtp', {
  values: { host: '127.0.0.1', port: 11061, useSsl: false, username: null, fromEmail: `db-config-${stamp}@officehub-e2e.vn`, fromName: 'Cấu hình DB' },
  secrets: { password: SMTP_PW },
});
ok('Lưu SMTP (200, password chỉ là cờ)', r.status === 200 && r.body.source === 'db' && r.body.secrets.password === true, r.body);
ok('Response không chứa mật khẩu', !r.text.includes(SMTP_PW));
ok('GET danh sách không chứa mật khẩu', !(await json(admin, 'GET', '/api/system/settings')).text.includes(SMTP_PW));
const row = await sql(`select "SecretsEncrypted" || ' | ' || "ValuesJson"::text from settings.system_settings where "Group"='smtp'`);
ok('DB: bí mật mã hoá (v2:…), không có bản rõ', row.startsWith('v2:') && !row.includes(SMTP_PW) && !row.includes('smtp-secret'), row.slice(0, 120));
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
r = await json(admin, 'POST', '/api/system/settings/smtp/test');
ok('Kiểm tra SMTP → gửi được', r.status === 200 && r.body.ok === true, r.body);
await Bun.sleep(1000);
let mails = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json()).messages as any[];
ok('Thư thử tới admin, gửi từ email trong DB (hiệu lực ngay)', mails.some((m) => m.From?.Address === `db-config-${stamp}@officehub-e2e.vn`
  && m.To?.some((t: any) => t.Address === ADMIN_LOGIN) && m.Subject.includes('thư thử')), mails.map((m) => [m.From?.Address, m.Subject]));
r = await json(admin, 'PUT', '/api/system/settings/smtp', {
  values: { host: '127.0.0.1', port: 11061, fromEmail: `db-config-${stamp}@officehub-e2e.vn`, fromName: 'Đổi tên' }, secrets: { password: '' },
});
ok('Lưu lại với ô mật khẩu trống → giữ mật khẩu cũ', r.status === 200 && r.body.secrets.password === true && r.body.values.fromName === 'Đổi tên', r.body);
const row2 = await sql(`select "SecretsEncrypted" from settings.system_settings where "Group"='smtp'`);
ok('Không đổi mật khẩu → token mã hoá giữ nguyên', row2.trim() === row.split(' | ')[0].trim());
r = await json(admin, 'PUT', '/api/system/settings/smtp', {
  values: { host: '127.0.0.1', port: 11061, fromEmail: `db-config-${stamp}@officehub-e2e.vn` }, clearSecrets: ['password'],
});
ok('clearSecrets → mật khẩu chưa đặt', r.status === 200 && r.body.secrets.password === false, r.body);
const hist = await json(admin, 'GET', '/api/audit/changes?entity=SystemSetting&take=50');
ok('Lịch sử sửa có SystemSetting, không lộ mật khẩu', hist.status === 200 && hist.text.includes('SystemSetting') && !hist.text.includes(SMTP_PW), hist.text.slice(0, 300));
r = await json(admin, 'DELETE', '/api/system/settings/smtp');
ok('Xoá SMTP → .env', r.status === 200 && r.body.source === 'env' && r.body.values.host === '127.0.0.1', r.body);
await fetch(`${MAILPIT}/api/v1/messages`, { method: 'DELETE' });
await json(admin, 'POST', '/api/system/settings/smtp/test');
await Bun.sleep(1000);
mails = (await (await fetch(`${MAILPIT}/api/v1/messages?limit=20`)).json()).messages as any[];
ok('Sau khi xoá: thư thử gửi từ email trong .env', mails.length > 0 && mails.every((m) => m.From?.Address !== `db-config-${stamp}@officehub-e2e.vn`), mails.map((m) => m.From?.Address));

// ---- S3 ----
const s3v = { ...s3env.values };
r = await json(admin, 'PUT', '/api/system/settings/s3', { values: { ...s3v, region: '' } });
ok('S3 thiếu region → 400', r.status === 400 && !!r.body?.errors?.region, r.body);
r = await json(admin, 'PUT', '/api/system/settings/s3', { values: s3v, secrets: { secretKey: '' } });
ok('Lưu S3 lần đầu với secret trống → giữ secret đang dùng (.env)', r.status === 200 && r.body.source === 'db' && r.body.secrets.secretKey === true, r.body);
r = await json(admin, 'POST', '/api/system/settings/s3/test');
ok('Kiểm tra S3 (cấu hình DB) → ghi + xoá file thật', r.status === 200 && r.body.ok === true, r.body);
r = await json(admin, 'PUT', '/api/system/settings/s3', { values: { ...s3v, accessKey: 'AKIAE2EFAKEKEY000000' }, secrets: { secretKey: 'fake-secret-e2e' } });
ok('Đổi sang access key sai (200)', r.status === 200 && !r.text.includes('fake-secret-e2e'), r.body);
r = await json(admin, 'POST', '/api/system/settings/s3/test');
ok('Ngay sau khi lưu: kiểm tra S3 thất bại (client S3 tạo lại)', r.status === 200 && r.body.ok === false, r.body);
r = await json(admin, 'DELETE', '/api/system/settings/s3');
ok('Xoá S3 → .env', r.status === 200 && r.body.source === 'env');
r = await json(admin, 'POST', '/api/system/settings/s3/test');
ok('Sau khi xoá: kiểm tra S3 lại thành công', r.status === 200 && r.body.ok === true, r.body);

// ---- FCM ----
r = await json(admin, 'PUT', '/api/system/settings/fcm', { values: {}, secrets: { serviceAccountJson: '{không phải json' } });
ok('FCM JSON sai → 400', r.status === 400 && !!r.body?.errors?.serviceAccountJson, r.body);
r = await json(admin, 'PUT', '/api/system/settings/fcm', { values: {}, secrets: { serviceAccountJson: '{"type":"authorized_user"}' } });
ok('FCM không phải service account → 400', r.status === 400 && !!r.body?.errors?.serviceAccountJson, r.body);
const FAKE_KEY = `-----BEGIN PRIVATE KEY-----\\nMIIfake${stamp}\\n-----END PRIVATE KEY-----\\n`;
const sa = `{"type":"service_account","project_id":"officehub-e2e-${stamp}","private_key_id":"x","private_key":"${FAKE_KEY}","client_email":"e2e@officehub-e2e.iam.gserviceaccount.com","client_id":"1","token_uri":"https://oauth2.googleapis.com/token"}`;
r = await json(admin, 'PUT', '/api/system/settings/fcm', { values: { projectId: '' }, secrets: { serviceAccountJson: sa } });
ok('Lưu FCM (project id lấy từ JSON, không trả JSON)', r.status === 200 && r.body.values.projectId === `officehub-e2e-${stamp}` && r.body.secrets.serviceAccountJson === true
  && !r.text.includes('MIIfake'), r.body);
const fcmRow = await sql(`select "SecretsEncrypted" from settings.system_settings where "Group"='fcm'`);
ok('DB: service account mã hoá', fcmRow.startsWith('v2:') && !fcmRow.includes('MIIfake') && !fcmRow.includes('service_account'));
r = await json(admin, 'POST', '/api/system/settings/fcm/test');
ok('Kiểm tra FCM với khoá giả → báo lỗi, không 500', r.status === 200 && r.body.ok === false && typeof r.body.message === 'string', r.body);
r = await json(admin, 'DELETE', '/api/system/settings/fcm');
ok('Xoá FCM → .env', r.status === 200 && r.body.source === 'env');
ok('Không còn dòng nào trong DB', (await sql(`select count(*) from settings.system_settings`)).trim() === '0');

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
