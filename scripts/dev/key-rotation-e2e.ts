// E2E xoay Encryption__Key (TEST-17): script TỰ khởi động Api 3 lần trên DB tạm với bộ khoá khác nhau:
//   1) khoá A (keyId mặc định k1) → HR lưu số tài khoản (v2:k1:…) + ghi thẳng 1 giá trị định dạng cũ v1 (khoá A) vào DB
//   2) khoá B + Encryption__KeyId=k2 + Encryption__PreviousKeys=k1:A → đọc được cả hai, job nền mã hoá lại → mọi giá trị thành v2:k2:
//   3) chỉ khoá B (bỏ PreviousKeys) → vẫn đọc được (không còn phụ thuộc khoá A)
// CHỈ DB tạm. Khoá A / B sinh ngẫu nhiên trong script (không dùng khoá trong .env). Chạy từ gốc repo (cần dotnet build trước):
//   docker run -d --name officehub-e2e-pg -e POSTGRES_DB=officehub_e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e_pw_7391 -p 127.0.0.1:55432:5432 postgres:18-alpine
//   E2E_LOCAL_DB=1 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/key-rotation-e2e.ts   (Api do script chạy ở :5186, ~3 phút vì job đợi 60 s sau khởi động)
import { $ } from 'bun';
import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const PORT = 5186, API = `http://localhost:${PORT}`;
const PG = process.env.PG_CONTAINER ?? 'officehub-e2e-pg';
const CONN = process.env.E2E_CONN ?? 'Host=127.0.0.1;Port=55432;Database=officehub_e2e;Username=e2e;Password=e2e_pw_7391';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d officehub_e2e -tAc ${q}`.text();
const KEY_A = randomBytes(32).toString('base64'), KEY_B = randomBytes(32).toString('base64');

let api: ReturnType<typeof Bun.spawn> | null = null;
const startApi = async (enc: Record<string, string>) => {
  api = Bun.spawn(['dotnet', 'run', '--no-build', '--project', 'src/OfficeHub.Api', '--no-launch-profile'], {
    cwd: new URL('../../backend', import.meta.url).pathname, stdout: 'ignore', stderr: 'ignore',
    env: { ...process.env, ASPNETCORE_URLS: API, ASPNETCORE_ENVIRONMENT: 'Development', ConnectionStrings__Default: CONN,
      Encryption__KeyId: '', Encryption__PreviousKeys: '', ...enc },
  });
  for (let i = 0; i < 90; i++) { try { if ((await fetch(`${API}/health`)).ok) return; } catch {} await sleep(1000); }
  throw new Error('Api không khởi động được');
};
const stopApi = async () => { api?.kill(); await api?.exited; api = null; await sleep(1000); };

const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${PORT}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await fetch(`${API}/api/auth/login/2fa`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: cookieOf(r, 'officehub.2fa') },
      body: JSON.stringify({ code: totp(keys[login]), isRecoveryCode: false, rememberMe: true }) });
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const post = async (path: string, b: unknown) => {
      const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) });
      cookie = cookieOf(x, 'officehub.auth') || cookie;
      return (await x.json().catch(() => null)) as any;
    };
    const s = await post('/api/auth/2fa/setup', {});
    await post('/api/auth/2fa/enable', { code: totp(s.sharedKey) });
    keys[login] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
/** Token định dạng cũ "v1:" (AES-256-GCM, không AAD) như dữ liệu ghi trước keyring. */
const legacyV1 = (b64Key: string, plain: string) => {
  const nonce = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', Buffer.from(b64Key, 'base64'), nonce);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64');
};
const contact = { phone: null, currentAddress: null, permanentAddress: null, emergencyContactName: null, emergencyContactRelation: null, emergencyContactPhone: null };
const sensitive = (bank: string) => ({ dateOfBirth: null, idNumber: null, idIssuedOn: null, idIssuedPlace: null, bankName: 'Vietcombank', bankAccount: bank, bankAccountHolder: 'KIEM TRA' });
const stamp = Date.now().toString(36).slice(-5);
const bankOf = async (c: string, id: string) => (await json(c, 'GET', `/api/org/profile/employees/${id}`)).body?.sensitive?.bankAccount;
const tokens = async () => (await sql(`SELECT "BankAccountEncrypted" FROM org.employees WHERE "Code" ILIKE 'KR-${stamp}-%' ORDER BY "Code"`)).trim().split('\n');

try {
  // ---------- 1) Khoá A ----------
  await startApi({ Encryption__Key: KEY_A });
  let admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  const mk = async (suffix: string) => (await json(admin, 'POST', '/api/org/employees', { code: `KR-${stamp}-${suffix}`, fullName: `Xoay Khoá ${suffix}`, email: null,
    phone: null, dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body.employee;
  const e1 = await mk('1'), e2 = await mk('2');
  ok('HR lưu số tài khoản (khoá A)', (await json(admin, 'PUT', `/api/org/profile/employees/${e1.id}`, { contact, sensitive: sensitive('0123456789') })).status === 200);
  await sql(`UPDATE org.employees SET "BankAccountEncrypted" = '${legacyV1(KEY_A, '9988776655')}' WHERE "Id" = '${e2.id}'`);
  const t1 = await tokens();
  ok('DB: giá trị mới dạng v2:k1:, giá trị cũ dạng v1:', t1[0].startsWith('v2:k1:') && t1[1].startsWith('v1:'), t1.map((t) => t.slice(0, 8)));
  ok('khoá A đọc được cả v2:k1 lẫn v1', (await bankOf(admin, e1.id)) === '0123456789' && (await bankOf(admin, e2.id)) === '9988776655');
  await stopApi();

  // ---------- 2) Xoay: khoá B (k2) + khoá A cũ chỉ để giải mã ----------
  await startApi({ Encryption__Key: KEY_B, Encryption__KeyId: 'k2', Encryption__PreviousKeys: `k1:${KEY_A}` });
  admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  ok('sau khi xoay: vẫn đọc được dữ liệu khoá cũ (v2:k1 + v1)', (await bankOf(admin, e1.id)) === '0123456789' && (await bankOf(admin, e2.id)) === '9988776655');
  ok('ghi mới dùng khoá k2', (await json(admin, 'PUT', `/api/org/profile/employees/${e1.id}`, { contact, sensitive: sensitive('1111222233') })).status === 200
    && (await tokens())[0].startsWith('v2:k2:'));
  console.log('… đợi job mã hoá lại (chạy 60 s sau khởi động)');
  let t2: string[] = [];
  for (let i = 0; i < 40; i++) {
    t2 = await tokens();
    const others = (await sql(`SELECT count(*) FROM org.employees WHERE "BankAccountEncrypted" IS NOT NULL AND "BankAccountEncrypted" NOT LIKE 'v2:k2:%'`)).trim();
    if (t2.every((t) => t.startsWith('v2:k2:')) && others === '0') break;
    await sleep(3000);
  }
  ok('job nền mã hoá lại mọi giá trị sang v2:k2: (cả v1 cũ)', t2.every((t) => t.startsWith('v2:k2:')), t2.map((t) => t.slice(0, 8)));
  ok('giá trị không đổi sau khi mã hoá lại', (await bankOf(admin, e2.id)) === '9988776655');
  const audit = (await sql(`SELECT count(*) FROM audit.changes WHERE "EntityId" = '${e2.id}' AND "Action" = 'Modified'`).catch(() => '0')).trim();
  ok('job không sinh lịch sử sửa giả cho nhân viên', audit === '0' || audit === '', audit);
  await stopApi();

  // ---------- 3) Chỉ còn khoá B ----------
  await startApi({ Encryption__Key: KEY_B, Encryption__KeyId: 'k2' });
  admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  ok('bỏ khoá cũ khỏi PreviousKeys: dữ liệu vẫn đọc được', (await bankOf(admin, e1.id)) === '1111222233' && (await bankOf(admin, e2.id)) === '9988776655');
} finally {
  await stopApi();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
