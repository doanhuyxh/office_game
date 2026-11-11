// E2E: theo dõi trợ lý AI — (A) nội dung lệnh ghi trong nhật ký, (B) cảnh báo bất thường gửi admin.
// A: lệnh ghi bằng token có requestSummary (che trường nhạy cảm), lệnh đọc / bị chặn thì không, cookie web không ghi nhật ký.
// B: job AiAlertMonitor (chạy 50 s sau khi Api khởi động, rồi 5 phút / lần) → bot gọi duyệt đơn = bot_approval, ≥ 10 lệnh 403 = blocked,
//    chuông ai_alert cho admin, quản lý chỉ thấy cảnh báo của cấp dưới, nhân viên / token AI 403, không báo lặp trong 1 giờ.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm, khởi động lại Api ngay trước khi chạy (để job quét sớm):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/ai-monitor-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
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
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posHead = positions.find((p: any) => p.name === 'Trưởng phòng'), posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `Giám sát AI ${stamp}`, code: `GS${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, positionId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string };
};
const M = await mkEmp('Quản Lý Giám Sát', posHead.id, null, `e2e.gsql.${stamp}`, ['manager']);
const B = await mkEmp('Bot Giám Sát', posStaff.id, M.e.id, `e2e.gsbot.${stamp}`, ['employee']);
const O = await mkEmp('Người Ngoài Giám Sát', posStaff.id, null, `e2e.gsng.${stamp}`, ['employee']);
ok('3 tài khoản + token', [M, B, O].every((x) => x.userId && x.token?.startsWith('ohk_')));
ok('HR đánh dấu B là bot', (await json(admin, 'PUT', `/api/org/employees/${B.e.id}/account/bot`, { isBot: true })).status === 204);

// ---------- A: nội dung lệnh ghi ----------
const fakeReq = crypto.randomUUID();
const approve = await ai(B.token, 'POST', `/api/approval/${fakeReq}/approve`, { tool: 'approve_request', body: { comment: 'Bot tự duyệt', password: 'lộ-mật-khẩu' } });
ok('bot gọi duyệt đơn (không tồn tại) → 4xx nhưng không phải 403', approve >= 400 && approve !== 403, approve);
await ai(B.token, 'GET', '/api/auth/me', { tool: 'get_my_profile' });
await ai(B.token, 'POST', '/api/contracts', { body: { secretNote: 'không được lưu' } });
await json(B.cookie, 'POST', '/api/attendance/check', {});
await Bun.sleep(3000); // AiAuditWriter ghi theo lô
const bLog = (await json(B.cookie, 'GET', '/api/audit/ai-requests?page=1&pageSize=50')).body;
const row = (pred: (r: any) => boolean) => bLog?.items?.find(pred);
const ap = row((r) => r.path.endsWith('/approve'));
const sum = ap?.requestSummary ? JSON.parse(ap.requestSummary) : null;
ok('lệnh duyệt có nội dung, comment giữ nguyên', sum?.comment === 'Bot tự duyệt', ap);
ok('trường password bị che', sum?.password === '•••', sum);
ok('lệnh đọc không có nội dung', row((r) => r.method === 'GET')?.requestSummary == null);
const blocked = row((r) => r.path === '/api/contracts');
ok('route bị chặn (403) không lưu nội dung', blocked?.status === 403 && blocked.requestSummary == null, blocked);
ok('chấm công bằng cookie web không vào nhật ký AI', bLog?.total === 3, bLog?.total);
const mLog = (await json(M.cookie, 'GET', `/api/audit/ai-requests?all=true&userId=${B.userId}&page=1`)).body;
ok('quản lý thấy nội dung lệnh ghi của cấp dưới', mLog?.items?.some((r: any) => r.requestSummary?.includes('Bot tự duyệt')), mLog?.total);

// ---------- B: cảnh báo ----------
for (let i = 0; i < 10; i++) await ai(O.token, 'GET', '/api/contracts');
console.log('… đợi job cảnh báo (tối đa 6 phút)');
let alerts: any = null;
for (let i = 0; i < 72; i++) {
  alerts = (await json(admin, 'GET', '/api/audit/ai-alerts?page=1&pageSize=50')).body;
  const rules = new Set((alerts?.items ?? []).filter((a: any) => a.userId === B.userId || a.userId === O.userId).map((a: any) => `${a.userId}:${a.rule}`));
  if (rules.has(`${B.userId}:bot_approval`) && rules.has(`${O.userId}:blocked`)) break;
  await Bun.sleep(5000);
}
const find = (uid: string, rule: string) => alerts?.items?.find((a: any) => a.userId === uid && a.rule === rule);
const ba = find(B.userId, 'bot_approval'), ob = find(O.userId, 'blocked');
ok('bot gọi duyệt đơn → cảnh báo bot_approval (isBot)', ba?.count === 1 && ba.isBot === true && ba.title.includes('Bot Giám Sát'), ba);
ok('≥ 10 lệnh bị chặn → cảnh báo blocked', ob?.count >= 10 && ob.isBot === false, ob);
ok('người thường không có bot_approval, B không có blocked', !find(O.userId, 'bot_approval') && !find(B.userId, 'blocked'));
const bell = (await json(admin, 'GET', '/api/notifications?take=50')).body;
ok('admin nhận chuông ai_alert (link /reports?tab=ai)', bell?.items?.filter((n: any) => n.category === 'ai_alert' && n.link === '/reports?tab=ai').length >= 2, bell?.items?.slice(0, 3));
const mBell = (await json(M.cookie, 'GET', '/api/notifications?take=50')).body;
ok('quản lý (không phải admin) không nhận chuông ai_alert', !mBell?.items?.some((n: any) => n.category === 'ai_alert'));
const mAlerts = (await json(M.cookie, 'GET', '/api/audit/ai-alerts?page=1')).body;
ok('quản lý thấy cảnh báo của cấp dưới, không thấy người ngoài', mAlerts?.items?.some((a: any) => a.userId === B.userId)
  && !mAlerts.items.some((a: any) => a.userId === O.userId), mAlerts?.items);
ok('quản lý xem cảnh báo người ngoài → 403', (await json(M.cookie, 'GET', `/api/audit/ai-alerts?userId=${O.userId}`)).status === 403);
ok('nhân viên → 403', (await json(O.cookie, 'GET', '/api/audit/ai-alerts')).status === 403);
ok('token AI → 403', await ai(M.token, 'GET', '/api/audit/ai-alerts') === 403);

console.log('… đợi lần quét kế tiếp (5 phút) để kiểm tra không báo lặp');
for (let i = 0; i < 10; i++) await ai(O.token, 'GET', '/api/contracts');
await Bun.sleep(5 * 60_000 + 10_000);
const again = (await json(admin, 'GET', `/api/audit/ai-alerts?userId=${O.userId}&page=1`)).body;
ok('trong 1 giờ không báo lặp cùng luật', again?.items?.filter((a: any) => a.rule === 'blocked').length === 1, again?.items);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
