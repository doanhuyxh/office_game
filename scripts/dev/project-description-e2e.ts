// E2E TEST-103: PUT /api/projects/{id}/description (chỉ mô tả dự án) + tool MCP update_project_description.
// Quản lý dự án / HR sửa được; thành viên thường 403, người ngoài 404; dự án đóng 409; > 2000 ký tự 400; "" / null = xoá; token AI (quản lý) được, PUT cả dự án vẫn 403.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-pd-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55492:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5180
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55492;Database=e2e;Username=e2e;Password=e2e'
//        Smtp__Host=127.0.0.1 Smtp__Port=11092 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=pd-admin@officehub-e2e.vn Seed__AdminPassword=Pd-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp :5200 (tuỳ chọn): env Mcp__ApiBaseUrl=http://localhost:5180 ASPNETCORE_URLS=http://localhost:5200 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=pd-admin@officehub-e2e.vn ADMIN_PASSWORD=Pd-Admin-2026 \
//     bun scripts/dev/project-description-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const MCP = process.env.MCP_URL ?? '';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
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
    while (totp(s.sharedKey) === code) await Bun.sleep(1000); // mã đã dùng không dùng lại được
    return login(user, password);
  }
  return cookie;
};
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV MT ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Mô tả E2E ${stamp}`, code: `MT${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`DM${stamp}`, 'Quản Lý MT', `e2e.mt.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`DT${stamp}`, 'Thành Viên MT', `e2e.mt.mem.${stamp}`, ['employee']);
const O = await mkEmp(`DO${stamp}`, 'Người Ngoài MT', `e2e.mt.out.${stamp}`, ['employee']);
ok('3 nhân viên đăng nhập', [PM, M, O].every((x) => !!x.cookie));

const CODE = `MT-${stamp}`.toUpperCase();
const pr = await json(PM.cookie, 'POST', '/api/projects', { code: CODE, name: 'Mô tả MT', kind: 'Internal', startOn: today, memberIds: [M.e.id],
  description: 'Bản đầu', workGuide: 'Hướng dẫn giữ nguyên' });
ok('Tạo dự án (201)', pr.status === 201, pr);
const P = pr.body;
const detail = async (c: string) => (await json(c, 'GET', `/api/projects/${P}`)).body;
const descOf = async (c: string) => (await detail(c))?.project?.description;

const DESC = 'Mục tiêu: rà soát bảo mật\nPhạm vi: Api + MCP\nKhách hàng: nội bộ';
let r = await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: `  ${DESC}  ` });
ok('Quản lý dự án sửa mô tả (200, trả description đã trim)', r.status === 200 && r.body?.description === DESC, r);
const d0 = await detail(M.cookie);
ok('Chi tiết dự án thấy mô tả mới, tên / hướng dẫn giữ nguyên', d0?.project?.description === DESC && d0?.project?.name === 'Mô tả MT' && d0?.workGuide === 'Hướng dẫn giữ nguyên', d0?.project);
ok('Thành viên thường → 403', (await json(M.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'x' })).status === 403);
ok('Người ngoài → 404', (await json(O.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'x' })).status === 404);
ok('Dự án không tồn tại → 404', (await json(PM.cookie, 'PUT', `/api/projects/00000000-0000-7000-8000-000000000000/description`, { description: 'x' })).status === 404);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'x'.repeat(2001) });
ok('> 2000 ký tự → 400 (lỗi ở description)', r.status === 400 && !!r.body?.errors?.description, r.status);
ok('Đúng 2000 ký tự → 200', (await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'y'.repeat(2000) })).status === 200);
ok('HR (admin) sửa được', (await json(admin, 'PUT', `/api/projects/${P}/description`, { description: DESC })).status === 200);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: '' });
ok('"" = xoá → description null', r.status === 200 && r.body?.description === null && (await descOf(PM.cookie)) === null, r);
await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'Lại có' });
r = await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, {});
ok('null = xoá → description null', r.status === 200 && r.body?.description === null && (await descOf(PM.cookie)) === null, r);
const hist = (await json(admin, 'GET', `/api/audit/changes?entity=Project&entityId=${P}&take=50`)).body;
ok('Lịch sử sửa có thay đổi Description', JSON.stringify(hist ?? '').includes('Description'), JSON.stringify(hist ?? '').slice(0, 200));
const bell = (await json(M.cookie, 'GET', '/api/notifications?take=20')).body;
ok('Thành viên nhận chuông "Mô tả: đã sửa"', JSON.stringify(bell ?? '').includes('Mô tả: đã sửa'), JSON.stringify(bell ?? '').slice(0, 300));

// Token AI của quản lý dự án: được PUT /description, KHÔNG được PUT cả dự án
const tok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `pm ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Quản lý có token AI', !!tok);
const bearer = { authorization: `Bearer ${tok}` };
ok('Token: PUT /description → 200', (await call(bearer, 'PUT', `/api/projects/${P}/description`, { description: 'Qua token' })).status === 200);
ok('Token: PUT cả dự án vẫn bị chặn (403)', (await call(bearer, 'PUT', `/api/projects/${P}`, { code: CODE, name: 'Đổi tên', kind: 'Internal' })).status === 403);
await Bun.sleep(2000); // nhật ký AI ghi nền
const ai = (await json(PM.cookie, 'GET', '/api/audit/ai-requests?page=1&pageSize=20')).body;
ok('Nhật ký AI ghi lệnh PUT /description kèm nội dung', JSON.stringify(ai ?? '').includes('/description') && JSON.stringify(ai ?? '').includes('Qua token'),
  JSON.stringify(ai ?? '').slice(0, 300));

// MCP thật
if (MCP) {
  let rid = 0;
  const rpcAs = async (auth: Record<string, string>, method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text; }
  };
  const rpc = (method: string, params: unknown = {}) => rpcAs(bearer, method, params);
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const tools = ((await rpc('tools/list'))?.result?.tools ?? []) as any[];
  const t = tools.find((x) => x.name === 'update_project_description');
  ok('tools/list có update_project_description (102 tool), ghi + idempotent, không destructive', !!t && tools.length === 102 && t.annotations?.readOnlyHint !== true
    && t.annotations?.idempotentHint === true && t.annotations?.destructiveHint === false && !!t.inputSchema?.properties?.project && !!t.inputSchema?.properties?.description,
    { n: tools.length, a: t?.annotations, s: t?.inputSchema });
  const mcallAs = async (auth: Record<string, string>, name: string, args: Record<string, unknown>) => {
    const x = await rpcAs(auth, 'tools/call', { name, arguments: args });
    const text = x?.result?.content?.[0]?.text ?? '';
    try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
  };
  const mcall = (name: string, args: Record<string, unknown>) => mcallAs(bearer, name, args);
  const MD = 'Mục tiêu: sửa qua MCP\nPhạm vi: OfficeHub';
  let m = await mcall('update_project_description', { project: CODE, description: MD });
  ok('MCP update_project_description theo mã dự án → before / after', !m.err && m.j.before === 'Qua token' && m.j.after === MD, m.text.slice(0, 300));
  const gp = await mcall('get_project', { project: P });
  ok('MCP get_project thấy mô tả mới', !gp.err && gp.j.project?.description === MD, gp.text.slice(0, 200));
  m = await mcall('update_project_description', { project: P, description: MD });
  ok('MCP gửi lại cùng nội dung (idempotent) → before = after', !m.err && m.j.before === MD && m.j.after === MD, m.text.slice(0, 200));
  m = await mcall('update_project_description', { project: P, description: 'none' });
  ok('MCP "none" = xoá', !m.err && m.j.after === null && (await descOf(PM.cookie)) === null, m.text.slice(0, 200));
  m = await mcall('update_project_description', { project: P, description: '   ' });
  ok('MCP nội dung trống → lỗi, không gọi Api', m.err && m.text.includes('none'), m.text);
  m = await mcall('update_project_description', { project: P, description: 'z'.repeat(2001) });
  ok('MCP > 2000 ký tự → lỗi', m.err && m.text.includes('2.000') || m.err && m.text.includes('2,000'), m.text);
  const mtok = (await json(M.cookie, 'POST', '/api/auth/access-tokens', { name: `mem ${stamp}`, expiresInDays: 30 })).body?.token as string;
  m = await mcallAs({ authorization: `Bearer ${mtok}` }, 'update_project_description', { project: P, description: 'x' });
  ok('MCP thành viên thường → lỗi "Chỉ quản lý dự án"', m.err && m.text.includes('Chỉ quản lý dự án'), m.text);
}

// Dự án đóng → 409
const d = (await detail(PM.cookie)).project;
const close = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { code: d.code, name: d.name, kind: d.kind, startOn: d.startOn, status: 'Closed' });
ok('Đóng dự án (204)', close.status === 204, close);
ok('Dự án đóng → 409', (await json(PM.cookie, 'PUT', `/api/projects/${P}/description`, { description: 'x' })).status === 409);
ok('Token: dự án đóng → 409', (await call(bearer, 'PUT', `/api/projects/${P}/description`, { description: 'x' })).status === 409);

console.log(`\n${pass} đạt / ${fail} lỗi`);
process.exit(fail ? 1 : 0);
