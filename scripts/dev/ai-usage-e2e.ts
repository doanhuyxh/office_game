// E2E: Báo cáo → Trợ lý AI (/api/audit/ai-usage, /ai-usage/users) + nhật ký `ai-requests?all=true` theo phạm vi quản lý.
// Quyền HR / quản lý (bản thân + cấp dưới) / nhân viên 403 / token AI 403, lọc phòng ban (gồm phòng con), ứng dụng, loại (tool / api),
// đếm lỗi / bị chặn / ghi / IP, gom theo ngày giờ VN, sắp xếp + phân trang.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/ai-usage-e2e.ts
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

// ---------- Chuẩn bị: Ban (cha) → Kỹ thuật (con) có trưởng phòng M + nhân viên S; phòng khác có O ----------
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posHead = positions.find((p: any) => p.name === 'Trưởng phòng'), posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
const root = (await json(admin, 'POST', '/api/org/departments', { name: `Ban AI ${stamp}`, code: `BA${stamp}`.slice(0, 10) })).body;
const tech = (await json(admin, 'POST', '/api/org/departments', { name: `Kỹ thuật AI ${stamp}`, code: `KA${stamp}`.slice(0, 10), parentId: root })).body;
const other = (await json(admin, 'POST', '/api/org/departments', { name: `Kế toán AI ${stamp}`, code: `TA${stamp}`.slice(0, 10) })).body;
let seq = 900 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, positionId: string, departmentId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId, positionId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Claude ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string, client: `Claude ${user}` };
};
const M = await mkEmp('Quản Lý AI', posHead.id, tech, null, `e2e.ql.${stamp}`, ['manager']);
const S = await mkEmp('Nhân Viên AI', posStaff.id, tech, M.e.id, `e2e.nv.${stamp}`, ['employee']);
const O = await mkEmp('Người Ngoài AI', posStaff.id, other, null, `e2e.ng.${stamp}`, ['employee']);
ok('3 nhân viên có tài khoản + token AI', [M, S, O].every((x) => x.cookie && x.userId && x.token?.startsWith('ohk_')), [M.userId, S.token?.slice(0, 4)]);

// ---------- Phát sinh request AI ----------
// S: 2 đọc qua tool (IP A), 1 ghi qua tool (chấm công), 1 route bị chặn (403), 1 gọi thẳng /auth/me (IP B) → 5, 2 IP, 1 ghi, 1 bị chặn
ok('S đọc qua tool', await ai(S.token, 'GET', '/api/auth/me', { tool: 'get_my_profile', ip: '203.0.113.10' }) === 200);
ok('S đọc qua tool lần 2', await ai(S.token, 'GET', '/api/attendance/today', { tool: 'get_today_attendance', ip: '203.0.113.10' }) === 200);
const check = await ai(S.token, 'POST', '/api/attendance/check', { tool: 'check_in', ip: '203.0.113.10', body: {} });
ok('S ghi qua tool (chấm công)', check < 500, check);
ok('S gọi route bị chặn → 403', await ai(S.token, 'GET', '/api/auth/access-tokens', { tool: 'get_my_profile', ip: '203.0.113.10' }) === 403);
ok('S gọi thẳng API (không tool)', await ai(S.token, 'GET', '/api/auth/me', { ip: '198.51.100.7' }) === 200);
// M: 2 request; O: 1 request
await ai(M.token, 'GET', '/api/auth/me', { tool: 'get_my_profile', ip: '203.0.113.20' });
await ai(M.token, 'GET', '/api/auth/me', { ip: '203.0.113.20' });
await ai(O.token, 'GET', '/api/auth/me', { tool: 'get_my_profile', ip: '203.0.113.30' });
await Bun.sleep(3000); // AiAuditWriter ghi theo lô

// ---------- HR / admin ----------
const rep = await json(admin, 'GET', '/api/audit/ai-usage');
const s = rep.body?.summary;
ok('admin: báo cáo mặc định 30 ngày, đến hôm nay (giờ VN)', rep.status === 200 && rep.body.to === today && rep.body.daily.length === 30, rep);
ok('admin: tổng 8 request / 3 người / 1 bị chặn', s?.total === 8 && s?.users === 3 && s?.blocked === 1, s);
ok('admin: thao tác ghi = 1 (POST chấm công)', s?.writes === 1, s);
ok('admin: cột hôm nay có đủ 8 request (gom ngày theo giờ VN)', rep.body?.daily.at(-1)?.date === today && rep.body.daily.at(-1).total === 8, rep.body?.daily.at(-1));
const toolRow = (name: string | null) => rep.body?.byTool.find((t: any) => t.tool === name);
ok('admin: theo tool (get_my_profile 4 lần / 3 người, gọi thẳng 2)', toolRow('get_my_profile')?.total === 4 && toolRow('get_my_profile')?.users === 3
  && toolRow(null)?.total === 2, rep.body?.byTool);
ok('admin: theo ứng dụng (3 token)', rep.body?.byClient.length === 3, rep.body?.byClient);
ok('admin: không có IP khi không lọc một người', rep.body?.ips === null);

const users = await json(admin, 'GET', '/api/audit/ai-usage/users?page=1&pageSize=20');
const rowS = users.body?.items?.find((r: any) => r.userId === S.userId);
ok('admin: xếp hạng 3 người, S đứng đầu', users.status === 200 && users.body.total === 3 && users.body.items[0].userId === S.userId, users.body);
ok('admin: dòng S đủ số liệu (5 / ghi 1 / chặn 1 / 2 IP / ứng dụng / phòng ban)', rowS?.total === 5 && rowS.writes === 1 && rowS.blocked === 1 && rowS.ips === 2
  && rowS.topClient === S.client && rowS.departmentName === `Kỹ thuật AI ${stamp}` && rowS.fullName === 'Nhân Viên AI', rowS);
const paged = await json(admin, 'GET', '/api/audit/ai-usage/users?page=2&pageSize=2&sort=name');
ok('admin: phân trang + sắp xếp theo tên (trang 2 còn 1 người)', paged.body?.total === 3 && paged.body?.items.length === 1, paged.body);
const byIps = await json(admin, 'GET', '/api/audit/ai-usage/users?page=1&sort=ips');
ok('admin: sắp xếp theo số IP', byIps.body?.items?.[0]?.userId === S.userId, byIps.body);

const dep = await json(admin, 'GET', `/api/audit/ai-usage/users?departmentId=${root}`);
ok('admin: lọc phòng cha → gồm phòng con (M, S), không có O', dep.status === 200 && dep.body.length === 2 && !dep.body.some((r: any) => r.userId === O.userId), dep.body);
const kindTool = await json(admin, 'GET', '/api/audit/ai-usage?kind=tool');
ok('admin: lọc loại tool → 6', kindTool.body?.summary?.total === 6, kindTool.body?.summary);
const kindApi = await json(admin, 'GET', '/api/audit/ai-usage?kind=api');
ok('admin: lọc loại api → 2', kindApi.body?.summary?.total === 2, kindApi.body?.summary);
const byClient = await json(admin, 'GET', `/api/audit/ai-usage?client=${encodeURIComponent(M.client)}`);
ok('admin: lọc ứng dụng của M → 2', byClient.body?.summary?.total === 2, byClient.body?.summary);
const one = await json(admin, 'GET', `/api/audit/ai-usage?userId=${S.userId}`);
ok('admin: chi tiết S có 2 IP, IP nhiều nhất trước', one.body?.ips?.length === 2 && one.body.ips[0].ip === '203.0.113.10' && one.body.ips[0].total === 4, one.body?.ips);
const range = await json(admin, 'GET', `/api/audit/ai-usage?from=2020-01-01&to=2099-01-01`);
ok('admin: khoảng ngày bị kẹp về 180 ngày, tới hôm nay', range.body?.daily?.length === 180 && range.body?.to === today, [range.body?.from, range.body?.to]);
ok('ngày sai định dạng → 400 from', (await json(admin, 'GET', '/api/audit/ai-usage?from=11/11/2026')).body?.errors?.from !== undefined);
ok('loại sai → 400 kind', (await json(admin, 'GET', '/api/audit/ai-usage?kind=x')).status === 400);

// ---------- Quản lý: bản thân + cấp dưới ----------
const mUsers = await json(M.cookie, 'GET', '/api/audit/ai-usage/users');
ok('quản lý: chỉ thấy mình + cấp dưới (M, S)', mUsers.status === 200 && mUsers.body.length === 2
  && mUsers.body.every((r: any) => r.userId === M.userId || r.userId === S.userId), mUsers.body);
const mRep = await json(M.cookie, 'GET', '/api/audit/ai-usage');
ok('quản lý: tổng chỉ tính phạm vi mình (7)', mRep.body?.summary?.total === 7 && mRep.body?.summary?.users === 2, mRep.body?.summary);
ok('quản lý: xem chi tiết cấp dưới (200)', (await json(M.cookie, 'GET', `/api/audit/ai-usage?userId=${S.userId}`)).status === 200);
ok('quản lý: xem người ngoài → 403', (await json(M.cookie, 'GET', `/api/audit/ai-usage?userId=${O.userId}`)).status === 403);
ok('quản lý: lọc phòng ban khác → không có ai', (await json(M.cookie, 'GET', `/api/audit/ai-usage/users?departmentId=${other}`)).body?.length === 0);
const mLog = await json(M.cookie, 'GET', '/api/audit/ai-requests?all=true&page=1&pageSize=50');
ok('quản lý: nhật ký all=true chỉ M + S (7 dòng)', mLog.status === 200 && mLog.body.total === 7
  && mLog.body.items.every((r: any) => r.userId === M.userId || r.userId === S.userId), mLog.body?.total);
ok('quản lý: nhật ký của người ngoài → 403', (await json(M.cookie, 'GET', `/api/audit/ai-requests?all=true&userId=${O.userId}`)).status === 403);
const mOwn = await json(M.cookie, 'GET', '/api/audit/ai-requests?page=1');
ok('quản lý: không all → chỉ của mình (2)', mOwn.body?.total === 2, mOwn.body?.total);

// ---------- Nhân viên / token AI ----------
ok('nhân viên: báo cáo → 403', (await json(S.cookie, 'GET', '/api/audit/ai-usage')).status === 403);
ok('nhân viên: xếp hạng → 403', (await json(S.cookie, 'GET', '/api/audit/ai-usage/users')).status === 403);
ok('nhân viên: nhật ký all=true → 403', (await json(S.cookie, 'GET', '/api/audit/ai-requests?all=true')).status === 403);
const sOwn = await json(S.cookie, 'GET', '/api/audit/ai-requests?page=1');
ok('nhân viên: nhật ký của mình (5)', sOwn.body?.total === 5 && sOwn.body.items.every((r: any) => r.userId === S.userId), sOwn.body?.total);
const adminOwn = await json(admin, 'GET', '/api/audit/ai-requests?page=1');
ok('admin: không all → chỉ của mình (0), không lẫn người khác', adminOwn.body?.total === 0, adminOwn.body?.total);
ok('token AI: báo cáo → 403', await ai(M.token, 'GET', '/api/audit/ai-usage') === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
