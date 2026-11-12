// E2E TEST-35: PUT /api/projects/{id}/guide (chỉ hướng dẫn làm việc) + tool MCP update_project_guide.
// Quản lý dự án / HR sửa được; thành viên thường 403, người ngoài 404; dự án đóng 409; > 20 000 ký tự 400; "" = xoá; token AI (quản lý) được, PUT cả dự án vẫn 403.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`).
// MCP (tuỳ chọn): host Mcp :5200 với Mcp__ApiBaseUrl=http://localhost:5180 → MCP_URL=http://localhost:5200/mcp.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-guide-e2e.ts
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

const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV HD ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Hướng dẫn E2E ${stamp}`, code: `HD${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`GM${stamp}`, 'Quản Lý HD', `e2e.hd.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`GT${stamp}`, 'Thành Viên HD', `e2e.hd.mem.${stamp}`, ['employee']);
const O = await mkEmp(`GO${stamp}`, 'Người Ngoài HD', `e2e.hd.out.${stamp}`, ['employee']);
ok('3 nhân viên đăng nhập', [PM, M, O].every((x) => !!x.cookie));

const pr = await json(PM.cookie, 'POST', '/api/projects', { code: `hd-${stamp}`, name: 'Hướng dẫn HD', kind: 'Internal', startOn: today, memberIds: [M.e.id], workGuide: 'Bản đầu' });
ok('Tạo dự án (201)', pr.status === 201, pr);
const P = pr.body;
const guideOf = async (c: string) => (await json(c, 'GET', `/api/projects/${P}`)).body?.workGuide;

const GUIDE = '## Định nghĩa xong\n- Bình luận link sản phẩm\n- Chuyển Chờ review';
let r = await json(PM.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: `  ${GUIDE}  ` });
ok('Quản lý dự án sửa hướng dẫn (200, trả workGuide đã trim)', r.status === 200 && r.body?.workGuide === GUIDE, r);
ok('Chi tiết dự án thấy hướng dẫn mới', (await guideOf(M.cookie)) === GUIDE);
ok('Thành viên thường → 403', (await json(M.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'x' })).status === 403);
ok('Người ngoài → 404', (await json(O.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'x' })).status === 404);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'x'.repeat(20001) });
ok('> 20 000 ký tự → 400 (lỗi ở workGuide)', r.status === 400 && !!r.body?.errors?.workGuide, r.status);
ok('Đúng 20 000 ký tự → 200', (await json(PM.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'y'.repeat(20000) })).status === 200);
ok('HR (admin) sửa được', (await json(admin, 'PUT', `/api/projects/${P}/guide`, { workGuide: GUIDE })).status === 200);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: '' });
ok('"" = xoá → workGuide null', r.status === 200 && r.body?.workGuide === null && (await guideOf(PM.cookie)) === null, r);
const hist = (await json(admin, 'GET', `/api/audit/changes?entity=Project&entityId=${P}&take=50`)).body;
ok('Lịch sử sửa có thay đổi WorkGuide', JSON.stringify(hist ?? '').includes('WorkGuide'), JSON.stringify(hist ?? '').slice(0, 200));

// Token AI của quản lý dự án: được PUT /guide, KHÔNG được PUT cả dự án
const tok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `pm ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Quản lý có token AI', !!tok);
const bearer = { authorization: `Bearer ${tok}` };
ok('Token: PUT /guide → 200', (await call(bearer, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'Qua token' })).status === 200);
ok('Token: PUT cả dự án vẫn bị chặn (403)', (await call(bearer, 'PUT', `/api/projects/${P}`, { code: `hd-${stamp}`, name: 'Đổi tên', kind: 'Internal' })).status === 403);

// MCP thật
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const tools = ((await rpc('tools/list'))?.result?.tools ?? []) as any[];
  const t = tools.find((x) => x.name === 'update_project_guide');
  ok('tools/list có update_project_guide (78 tool), ghi + idempotent', !!t && tools.length === 78 && t.annotations?.readOnlyHint !== true && t.annotations?.idempotentHint === true,
    { n: tools.length, a: t?.annotations });
  const mcall = async (name: string, args: Record<string, unknown>) => {
    const x = await rpc('tools/call', { name, arguments: args });
    const text = x?.result?.content?.[0]?.text ?? '';
    try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
  };
  const MG = '## Quy trình\n- Đọc mô tả việc\n- Báo kết quả bằng bình luận';
  let m = await mcall('update_project_guide', { project: `HD-${stamp}`.toUpperCase(), guide: MG });
  ok('MCP update_project_guide theo mã dự án → before / after', !m.err && m.j.before === 'Qua token' && m.j.after === MG, m.text.slice(0, 300));
  const gp = await mcall('get_project', { project: P });
  ok('MCP get_project thấy hướng dẫn mới', !gp.err && gp.j.workGuide === MG, gp.text.slice(0, 200));
  m = await mcall('update_project_guide', { project: P, guide: 'none' });
  ok('MCP "none" = xoá', !m.err && m.j.after === null && (await guideOf(PM.cookie)) === null, m.text.slice(0, 200));
  m = await mcall('update_project_guide', { project: P, guide: '   ' });
  ok('MCP nội dung trống → lỗi, không gọi Api', m.err && m.text.includes('none'), m.text);
  // thành viên thường qua MCP → lỗi quyền từ Api
  const mtok = (await json(M.cookie, 'POST', '/api/auth/access-tokens', { name: `mem ${stamp}`, expiresInDays: 30 })).body?.token as string;
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${mtok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'update_project_guide', arguments: { project: P, guide: 'x' } } }) });
  const raw = await res.text();
  const out = JSON.parse(raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? raw)?.result;
  ok('MCP thành viên thường → lỗi "Chỉ quản lý dự án"', out?.isError === true && String(out?.content?.[0]?.text).includes('Chỉ quản lý dự án'), out);
}

// Dự án đóng → 409
const d = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.project;
const close = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { code: d.code, name: d.name, kind: d.kind, startOn: d.startOn, status: 'Closed' });
ok('Đóng dự án (204)', close.status === 204, close);
ok('Dự án đóng → 409', (await json(PM.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'x' })).status === 409);

console.log(`\n${pass} đạt / ${fail} lỗi`);
process.exit(fail ? 1 : 0);
