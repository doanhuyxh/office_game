// E2E TEST-40: dự án nhiều phòng ban — nhân viên phòng tham gia (đúng phòng, không tính phòng con) XEM được dự án, chỉ đọc; phòng chủ trì;
// kiểm tra hợp lệ; lọc ?departmentId=; tab Phụ lục (quyền do BE sinh); đổi phòng ban → chuông thành viên (TEST-38); MCP list_projects / get_project (myAccess).
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm). MCP tuỳ chọn: MCP_URL=http://localhost:5200/mcp
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=… ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-departments-e2e.ts
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

const posPlain = (await json(admin, 'POST', '/api/org/positions', { name: `NV PB ${stamp}`, level: 7, financePermissions: 0 })).body;
const posCols = (await json(admin, 'POST', '/api/org/positions', { name: `Lead PB ${stamp}`, level: 6, manageTaskColumns: true })).body;
const K = (await json(admin, 'POST', '/api/org/departments', { name: `Kỹ thuật PB ${stamp}`, code: `K${stamp}` })).body;
const S = (await json(admin, 'POST', '/api/org/departments', { name: `Kinh doanh PB ${stamp}`, code: `S${stamp}` })).body;
const KC = (await json(admin, 'POST', '/api/org/departments', { name: `Kỹ thuật con PB ${stamp}`, code: `KC${stamp}`, parentId: K })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[], dept: string, pos = posPlain) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`PK${stamp}`, 'Quản Lý PB', `e2e.pb.pm.${stamp}`, ['employee', 'manager'], K);
const Mem = await mkEmp(`PM${stamp}`, 'Thành Viên PB', `e2e.pb.mem.${stamp}`, ['employee'], S);
const K1 = await mkEmp(`PX${stamp}`, 'Kỹ Thuật Viên PB', `e2e.pb.k1.${stamp}`, ['employee'], K, posCols);
const S1 = await mkEmp(`PS${stamp}`, 'Kinh Doanh PB', `e2e.pb.s1.${stamp}`, ['employee'], S);
const C1 = await mkEmp(`PC${stamp}`, 'Phòng Con PB', `e2e.pb.c1.${stamp}`, ['employee'], KC);
ok('5 nhân viên đăng nhập', [PM, Mem, K1, S1, C1].every((x) => !!x.cookie));

// ---------- Tạo + kiểm tra hợp lệ ----------
const base = { code: `pb-${stamp}`, name: 'Dự án nhiều phòng', kind: 'Internal', startOn: today, memberIds: [Mem.e.id], sequential: false };
let r = await json(PM.cookie, 'POST', '/api/projects', { ...base, departmentIds: [K], leadDepartmentId: S });
ok('Chủ trì không nằm trong danh sách → 400 leadDepartmentId', r.status === 400 && !!r.body?.errors?.leadDepartmentId, r.body?.errors);
r = await json(PM.cookie, 'POST', '/api/projects', { ...base, departmentIds: [K, crypto.randomUUID()] });
ok('Phòng ban không tồn tại → 400 departmentIds', r.status === 400 && !!r.body?.errors?.departmentIds, r.body?.errors);
r = await json(PM.cookie, 'POST', '/api/projects', { ...base, departmentIds: [K, K], leadDepartmentId: K });
ok('Tạo dự án (phòng trùng được gộp) → 201', r.status === 201, r);
const P = r.body;
const detail = async (c: string) => json(c, 'GET', `/api/projects/${P}`);
let d = (await detail(PM.cookie)).body;
ok('Chi tiết: 1 phòng Kỹ thuật chủ trì; PM có đủ quyền', d.project.departments.length === 1 && d.project.departments[0].id === K && d.project.departments[0].isLead
  && JSON.stringify(d.myAccess) === '["view","work","manage","effort","documents"]', { deps: d.project.departments, acc: d.myAccess });
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc của dự án' })).body;

// ---------- Nhân viên phòng tham gia: xem được, chỉ đọc ----------
const listK1 = (await json(K1.cookie, 'GET', '/api/projects')).body as any[];
const inList = listK1.find((p) => p.id === P);
ok('K1 (phòng Kỹ thuật, không phải thành viên) thấy dự án trong danh sách: viaDepartment, myRole null, canWork false',
  inList?.viaDepartment === true && inList.myRole === null && inList.canWork === false && inList.canManageColumns === false, inList);
ok('K1 "Của tôi" (mine=true) không có dự án', !((await json(K1.cookie, 'GET', '/api/projects?mine=true')).body as any[]).some((p) => p.id === P));
const dK1 = await detail(K1.cookie);
ok('K1 xem chi tiết (200), myAccess = [view]', dK1.status === 200 && JSON.stringify(dK1.body.myAccess) === '["view"]', dK1.body?.myAccess);
ok('K1 xem việc / chi tiết việc / cột / mốc / CR / phụ lục (200)', (await Promise.all([`/api/projects/${P}/tasks`, `/api/projects/tasks/${T}`, `/api/projects/${P}/columns`,
  `/api/projects/${P}/change-requests`, `/api/projects/${P}/appendix`].map(async (u) => (await json(K1.cookie, 'GET', u)).status))).every((s) => s === 200));
ok('K1 tạo việc → 403', (await json(K1.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'x' })).status === 403);
ok('K1 bình luận → 403', (await json(K1.cookie, 'POST', `/api/projects/tasks/${T}/comments`, { content: 'x' })).status === 403);
ok('K1 sửa việc → 403', (await json(K1.cookie, 'PUT', `/api/projects/tasks/${T}`, { title: 'y' })).status === 403);
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body;
ok('K1 chuyển việc → 403', (await json(K1.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: cols[1].id })).status === 403);
ok('K1 có chức vụ "Quản lý trạng thái công việc" vẫn không sửa cột → 403', (await json(K1.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Thử', isDone: false, approverOnly: false })).status === 403);
ok('K1 xem ngày công → 403', (await json(K1.cookie, 'GET', `/api/projects/${P}/effort`)).status === 403);
ok('K1 sửa dự án / hướng dẫn → 403', (await json(K1.cookie, 'PUT', `/api/projects/${P}/guide`, { workGuide: 'x' })).status === 403);
ok('S1 (phòng khác) → 404', (await detail(S1.cookie)).status === 404);
ok('C1 (phòng con của Kỹ thuật) → 404 (không tính phòng con)', (await detail(C1.cookie)).status === 404);

// ---------- Lọc theo phòng ban ----------
const ids = async (q: string) => ((await json(admin, 'GET', `/api/projects${q}`)).body as any[]).map((p) => p.id);
ok('Lọc ?departmentId=K có dự án, =S không', (await ids(`?departmentId=${K}`)).includes(P) && !(await ids(`?departmentId=${S}`)).includes(P));

// ---------- Đổi phòng ban: thêm Kinh doanh làm chủ trì, bỏ Kỹ thuật ----------
const UPD = `Dự án ${`pb-${stamp}`.toUpperCase()} đã được cập nhật`;
const bellsOf = async (c: string) => ((await json(c, 'GET', '/api/notifications?take=50')).body?.items ?? []).filter((n: any) => n.title === UPD);
const memBefore = (await bellsOf(Mem.cookie)).length;
const k1Before = (await json(K1.cookie, 'GET', '/api/notifications?take=50')).body?.items?.length ?? 0;
r = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, code: `PB-${stamp}`.toUpperCase(), departmentIds: [S], leadDepartmentId: S, status: 'Active' });
ok('PM đổi phòng ban (204)', r.status === 204, r);
d = (await detail(PM.cookie)).body;
ok('Phòng ban mới: Kinh doanh chủ trì', d.project.departments.length === 1 && d.project.departments[0].id === S && d.project.departments[0].isLead);
ok('Bỏ Kỹ thuật → K1 mất quyền xem (404)', (await detail(K1.cookie)).status === 404);
ok('Thêm Kinh doanh → S1 xem được', (await detail(S1.cookie)).status === 200);
const memBells = await bellsOf(Mem.cookie);
ok('Thành viên nhận chuông "Phòng ban tham gia: … → …"', memBells.length === memBefore + 1 && memBells[0].body.includes('Phòng ban tham gia:'), memBells[0]);
ok('Nhân viên phòng ban (không phải thành viên) không nhận chuông dự án', ((await json(K1.cookie, 'GET', '/api/notifications?take=50')).body?.items?.length ?? 0) === k1Before);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, code: `PB-${stamp}`.toUpperCase(), departmentIds: [S, K], leadDepartmentId: S, status: 'Active' });
ok('Thêm lại Kỹ thuật (2 phòng) → K1 xem lại được', r.status === 204 && (await detail(K1.cookie)).status === 200);
r = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, code: `PB-${stamp}`.toUpperCase(), status: 'Active' });
ok('PUT không gửi departmentIds → giữ nguyên 2 phòng', r.status === 204 && (await detail(PM.cookie)).body.project.departments.length === 2);

// ---------- Phụ lục ----------
const a = (await json(S1.cookie, 'GET', `/api/projects/${P}/appendix`)).body;
ok('Phụ lục (người xem nhờ phòng ban mở được): phòng chủ trì đứng đầu, đếm nhân viên', a.departments.map((x: any) => x.id).join() === [S, K].join() && a.departments[0].isLead
  && a.departments[0].employeeCount >= 2, a.departments);
ok('Phụ lục: thành viên PM (Quản lý) + Mem, có phòng ban', a.members.length === 2 && a.members[0].role === 'Manager' && a.members.some((m: any) => m.departmentName?.startsWith('Kinh doanh PB')), a.members);
const persona = (k: string) => a.personas.find((p: any) => p.key === k)?.allowed?.join(',');
ok('Phụ lục: quyền theo vai trò khớp back-end', persona('department') === 'view' && persona('member') === 'view,work,documents'
  && persona('manager') === 'view,work,manage,effort,documents' && a.capabilities.length === 7, a.personas);
ok('Người ngoài xem phụ lục → 404', (await json(C1.cookie, 'GET', `/api/projects/${P}/appendix`)).status === 404);

// ---------- MCP ----------
if (MCP) {
  const tok = (await json(S1.cookie, 'POST', '/api/auth/access-tokens', { name: `s1 ${stamp}`, expiresInDays: 30 })).body?.token as string;
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    return JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text);
  };
  const call = async (name: string, args: Record<string, unknown>) => { const x = await rpc('tools/call', { name, arguments: args }); const t = x?.result?.content?.[0]?.text ?? '';
    try { return { err: !!x?.result?.isError, j: JSON.parse(t), t }; } catch { return { err: !!x?.result?.isError, j: null as any, t }; } };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  const lp = await call('list_projects', {});
  ok('MCP list_projects (token nhân viên phòng tham gia): có dự án, viaDepartment, departments', !lp.err && lp.j.some((p: any) => p.id === P && p.viaDepartment && p.departments.length === 2), lp.t.slice(0, 300));
  const gp = await call('get_project', { project: P });
  ok('MCP get_project: myAccess = [view]', !gp.err && JSON.stringify(gp.j.myAccess) === '["view"]', gp.t.slice(0, 300));
  const ct = await call('create_task', { project: P, title: 'Bot thử tạo' });
  ok('MCP create_task → bị chặn', ct.err, ct.t);
}

console.log(`\n${pass} đạt / ${fail} lỗi`);
process.exit(fail ? 1 : 0);
