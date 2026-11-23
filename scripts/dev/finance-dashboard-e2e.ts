// E2E TEST-220: Tổng quan giám đốc 1/3 — GET /api/finance/dashboard (thu / chi / lãi theo tháng × mảng, không tính chuyển quỹ / dòng huỷ,
// công nợ quá hạn + tuổi nợ khớp /api/sales/receivables, pipeline khớp /api/sales/opportunities) + GET /api/projects/financials/alerts
// (dự án đang chạy lỗ / vượt / sắp vượt ngân sách ngày công; dự án đã đóng không ra) + quyền (Xem tài chính 200; HR, admin seed, quản lý dự án,
// nhân viên thường 403; token AI kể cả của người có Xem → 403). So sánh theo phần chênh trước / sau khi seed → chạy lại được trên cùng DB.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3). Dựng như project-wiki-e2e.ts:
//   docker run -d --name e2e220-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15476:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5196
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15476;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e220-admin@officehub-e2e.vn Seed__AdminPassword=E2e220-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5196 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/finance-dashboard-e2e.ts
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5196 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-wiki-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5196';
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
type Res = { status: number; body: any };
const json = async (cookie: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const bearer = async (token: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
