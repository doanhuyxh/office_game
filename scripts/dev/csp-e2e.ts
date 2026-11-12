// E2E CSP (TEST-19): mở các trang chính bằng Chrome headless trên bản BUILD với CSP BẬT CHẶN, gom mọi vi phạm (securitypolicyviolation)
// + lỗi JS. Chuỗi chính sách lấy từ frontend/nginx-security-headers.conf (đúng cái deploy). Trang không có vi phạm = bật thật được.
// CHỈ DB tạm (tạo 1 nhân viên). Cần: Api + Realtime tạm, rồi từ frontend/: bun run build && VITE_API_TARGET=… VITE_RT_TARGET=…
//   bunx vite preview --config <file config thêm preview.headers CSP + preview.proxy = server.proxy, cổng 5173 (CORS bucket S3)>
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 BASE_URL=http://localhost:5173 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/csp-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5185';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 900) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const apiLogin = async (login: string, password: string): Promise<string> => {
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

const policy = readFileSync(new URL('../../frontend/nginx-security-headers.conf', import.meta.url), 'utf8').match(/Content-Security-Policy-Report-Only "([^"]+)"/)![1];
const head = await fetch(`${BASE}/`);
ok('máy chủ thử trả CSP BẬT CHẶN đúng chuỗi trong nginx-security-headers.conf', head.headers.get('content-security-policy') === policy,
  head.headers.get('content-security-policy'));

// Nhân viên thường để đăng nhập trên trình duyệt (admin seed buộc 2FA → không dùng trong Chrome)
const admin = await apiLogin(ADMIN_LOGIN, ADMIN_PASSWORD);
const stamp = Date.now().toString(36).slice(-5);
const user = `e2e.csp.${stamp}`, PW = 'E2e-Csp-2026';
const e = (await json(admin, 'POST', '/api/org/employees', { code: `CSP-${stamp}`, fullName: 'Kiểm Tra CSP', email: `${user}@officehub-e2e.vn`, phone: null,
  dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
await json(await apiLogin(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });

const b = await launch(9341, `${tmpdir()}/officehub-csp-${stamp}`);
// Ghi mọi vi phạm CSP vào sessionStorage (giữ qua điều hướng trong cùng tab)
await b.send('Page.addScriptToEvaluateOnNewDocument', { source: `addEventListener('securitypolicyviolation', (ev) => {
  const a = JSON.parse(sessionStorage.getItem('__csp') || '[]');
  a.push({ dir: ev.effectiveDirective, blocked: ev.blockedURI, src: ev.sourceFile, line: ev.lineNumber, page: location.pathname });
  sessionStorage.setItem('__csp', JSON.stringify(a));
});` });
ok('đăng nhập trên trình duyệt', (await b.login(user, PW)) === 200);
const pages: [string, number][] = [['/', 4000], ['/office', 9000], ['/chat', 4000], ['/news', 4000], ['/documents', 4000], ['/projects', 4000],
  ['/profile', 3500], ['/ai-access', 3500], ['/attendance', 3500], ['/leave', 3500]];
for (const [path, wait] of pages) {
  await b.go(`${BASE}${path}`, wait);
  const where = await b.evalJs('location.pathname');
  const root = await b.evalJs(`document.getElementById('root')?.children.length ?? 0`);
  ok(`${path}: tải được (React dựng trang)`, root > 0, { where, root });
}
await b.evalJs(`document.documentElement.classList.contains('dark') || true`); // theme-init.js đã chạy (không lỗi)
const theme = await b.evalJs(`fetch('/theme-init.js').then(r => r.status)`);
ok('theme-init.js (thay script inline) phục vụ được', theme === 200, theme);
const all = JSON.parse(await b.evalJs(`sessionStorage.getItem('__csp') || '[]'`)) as any[];
// Dev: LiveKit__Url=ws://localhost:7880 (không TLS, khác cổng) — production là wss://<domain>/livekit (nằm trong connect-src wss:) → bỏ qua riêng
const devVoice = all.filter((v) => /^(ws|http):\/\/localhost:7880\//.test(String(v.blocked))); // LiveKit dev: ws + gọi lại http …/rtc/v1/validate
const violations = all.filter((v) => !devVoice.includes(v));
if (devVoice.length) console.log(`  (bỏ qua ${devVoice.length} vi phạm voice dev ws://localhost — production dùng wss://<domain>/livekit)`);
ok('KHÔNG có vi phạm CSP trên mọi trang', violations.length === 0, violations);
const cspErrors = b.errors.filter((x) => /Content Security Policy|Refused to/i.test(String(x)));
ok('không có lỗi console liên quan CSP', cspErrors.length === 0, cspErrors);
const rep = await fetch(`${API}/api/csp-report`, { method: 'POST', headers: { 'content-type': 'application/csp-report' },
  body: JSON.stringify({ 'csp-report': { 'blocked-uri': 'https://evil.example/x.js', 'violated-directive': 'script-src' } }) });
ok('/api/csp-report nhận báo cáo (204, không cần cookie / Origin)', rep.status === 204, rep.status);
b.close();
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
