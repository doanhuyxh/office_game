// E2E TEST-245 (Cache phía server — B2b): danh mục ít đổi (nhân viên / cây quản lý / phòng ban / chức vụ, ca / lịch / ngày lễ) đọc từ
// ảnh chụp trong RAM; HR ghi → lần đọc kế tiếp thấy NGAY (không chờ TTL 5 phút), cả với lệnh ExecuteUpdate / ExecuteDelete.
// Dùng dữ liệu của db-query-count-e2e.ts (chạy `seed` trước, cùng API_URL → cùng file STATE), rồi:
//   1. HR đổi quản lý của nhân viên s0 (cấp dưới trưởng nhóm 0.0) sang quản lý mới M: M thấy s0 ở bảng chấm công team + đơn nghỉ của s0
//      ngay; trưởng nhóm cũ không thấy nữa (luật 1: manager chỉ thấy bản thân + cấp dưới).
//   2. s0 chuyển sang dưới X (cấp dưới của M) → M vẫn thấy (gián tiếp); X nghỉ việc → API gỡ quản lý bằng ExecuteUpdate → M không thấy s0.
//   3. Đổi tên phòng ban → tên phòng mới ở bảng chấm công ngay.
//   4. Thêm ngày lễ hôm nay → /attendance/today là ngày lễ ngay; xoá (ExecuteDelete) → hết ngay.
//   5. Trả s0 về trưởng nhóm 0.0, phòng ban về tên cũ (để chạy lại measure).
// CHỈ DB tạm (xem đầu db-query-count-e2e.ts): E2E_LOCAL_DB=1 API_URL=http://localhost:5243 bun scripts/dev/catalog-cache-e2e.ts
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5243';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e243-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e243-Admin-2026';
const STATE = `${tmpdir()}/officehub-e2e243-state-${new URL(API).port}.json`;
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
if (!existsSync(STATE) || !existsSync(KEYS_FILE)) throw new Error(`Chưa seed: chạy db-query-count-e2e.ts seed trước (${STATE})`);
const st = JSON.parse(readFileSync(STATE, 'utf8')) as { dirUser: string; leadUser: string; staffUsers: string[] };
const keys: Record<string, string> = JSON.parse(readFileSync(KEYS_FILE, 'utf8'));
const PW = 'E2e-Local-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const r = await post('/api/auth/login', { login: user, password });
    if (r.status === 429 && attempt < 5) { await sleep(15000); continue; }
    const body = await r.json().catch(() => null) as any;
    if (r.status === 403 && body?.title === '2fa_required') {
      const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
      return cookieOf(r2, 'officehub.auth');
    }
    const cookie = cookieOf(r, 'officehub.auth');
    if (!cookie) throw new Error(`Đăng nhập ${user} lỗi ${r.status}`);
    return cookie;
  }
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed };
};
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const lead = await login(st.leadUser, PW);
const s0 = await login(st.staffUsers[0], PW);
const s0Id = (await json(s0, 'GET', '/api/attendance/today')).body?.employee?.id as string;
const leadId = (await json(lead, 'GET', '/api/attendance/today')).body?.employee?.id as string;
ok('đọc được id nhân viên s0 và trưởng nhóm', !!s0Id && !!leadId);
const detail = async (id: string) => (await json(admin, 'GET', `/api/org/employees/${id}`)).body.employee;
const s0Emp = await detail(s0Id);
const dirId = (await detail(leadId)).managerId; // trưởng phòng 0 (cấp trên trưởng nhóm 0.0)
const upsert = (e: any, patch: Record<string, unknown>) => ({
  code: e.code, fullName: e.fullName, email: e.email, phone: e.phone, dateOfBirth: null, departmentId: e.departmentId, positionId: e.positionId,
  managerId: e.managerId, status: e.status ?? 'Active', joinedAt: e.joinedAt ?? '2026-01-05', note: null, jobTitle: e.jobTitle, ...patch,
});
const setManager = async (id: string, managerId: string | null) => {
  const r = await json(admin, 'PUT', `/api/org/employees/${id}`, upsert(await detail(id), { managerId }));
  if (r.status >= 300) throw new Error(`Đổi quản lý lỗi ${r.status} ${JSON.stringify(r.body)}`);
};

// ---- quản lý mới M (có tài khoản, vai trò manager), cùng cấp trưởng nhóm — ngoài nhánh của trưởng nhóm 0.0 ----
const stamp = Date.now().toString(36).slice(-5);
const mkEmp = async (name: string, managerId: string | null) => {
  const r = await json(admin, 'POST', '/api/org/employees', upsert(s0Emp, { code: `C${stamp}${name.length}${Math.floor(Math.random() * 1e4)}`, fullName: name,
    email: `c245.${stamp}.${Math.floor(Math.random() * 1e6)}@e2e.test`, managerId, status: 'Active', joinedAt: '2026-01-05' }));
  if (r.status >= 300) throw new Error(`Tạo nhân viên lỗi ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.employee.id as string;
};
const M = await mkEmp('Quản Lý Mới 245', dirId);
const mUser = `e2e.t245.m.${stamp}`;
const acc = (await json(admin, 'POST', `/api/org/employees/${M}/account`, { mode: 'password', roles: ['employee', 'manager'], userName: mUser })).body;
let m = await login(mUser, acc.tempPassword);
await json(m, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
m = await login(mUser, PW);

const boardHas = async (cookie: string, id: string) => {
  const r = await json(cookie, 'GET', '/api/attendance/board');
  return { status: r.status, has: Array.isArray(r.body) && r.body.some((x: any) => x.employee?.id === id), body: r.body };
};
const from = addDays(today, -15), to = addDays(today, 60);
const leaveHas = async (cookie: string, id: string) => JSON.stringify((await json(cookie, 'GET', `/api/leave/requests?from=${from}&to=${to}`)).body ?? '').includes(id);

// làm nóng cache: trước khi đổi, trưởng nhóm thấy s0, M không thấy
ok('trước: trưởng nhóm 0.0 thấy s0 ở bảng chấm công team', (await boardHas(lead, s0Id)).has);
ok('trước: trưởng nhóm 0.0 thấy đơn nghỉ của s0', await leaveHas(lead, s0Id));
ok('trước: quản lý mới M không thấy s0', !(await boardHas(m, s0Id)).has && !(await leaveHas(m, s0Id)));

// ---- 1. đổi quản lý (SaveChanges) ----
await setManager(s0Id, M);
ok('sau đổi quản lý: M thấy s0 ở bảng chấm công NGAY', (await boardHas(m, s0Id)).has);
ok('sau đổi quản lý: M thấy đơn nghỉ của s0 NGAY', await leaveHas(m, s0Id));
ok('sau đổi quản lý: trưởng nhóm cũ không thấy s0 ở bảng chấm công', !(await boardHas(lead, s0Id)).has);
ok('sau đổi quản lý: trưởng nhóm cũ không thấy đơn nghỉ của s0', !(await leaveHas(lead, s0Id)));
const tsOld = await json(lead, 'GET', `/api/attendance/employees/${s0Id}?month=${today.slice(0, 7)}`);
const tsNew = await json(m, 'GET', `/api/attendance/employees/${s0Id}?month=${today.slice(0, 7)}`);
ok(`bảng công tháng của s0: quản lý cũ 403, quản lý mới 200 (${tsOld.status} / ${tsNew.status})`, tsOld.status === 403 && tsNew.status === 200);

// ---- 2. cấp dưới gián tiếp + nghỉ việc (ExecuteUpdate gỡ quản lý) ----
const X = await mkEmp('Trưởng Nhóm Tạm 245', M);
await setManager(s0Id, X);
ok('s0 dưới X (cấp dưới của M): M vẫn thấy s0 (gián tiếp)', (await boardHas(m, s0Id)).has);
const rs = await json(admin, 'POST', `/api/org/employees/${X}/resign`, { leftAt: today });
ok('X nghỉ việc (API gỡ quản lý của cấp dưới bằng ExecuteUpdate)', rs.status === 204, rs);
ok('sau X nghỉ việc: s0 không còn quản lý → M không thấy s0 NGAY', !(await boardHas(m, s0Id)).has);
ok('s0 không còn quản lý (đọc lại hồ sơ)', (await detail(s0Id)).managerId === null);

// ---- 3. đổi tên phòng ban ----
await setManager(s0Id, M);
const depts = (await json(admin, 'GET', '/api/org/departments')).body as any[];
const dep = depts.find((d) => d.id === s0Emp.departmentId);
const putDept = (name: string) => json(admin, 'PUT', `/api/org/departments/${dep.id}`, { name, code: dep.code, parentId: dep.parentId ?? null,
  headEmployeeId: dep.headEmployeeId ?? null, mapZone: dep.mapZone ?? null, sortOrder: dep.sortOrder ?? 0 });
const before = (await boardHas(m, s0Id)).body.find((x: any) => x.employee.id === s0Id)?.employee.departmentName;
const renamed = `${dep.name} (đổi 245)`;
const pr = await putDept(renamed);
const after = (await boardHas(m, s0Id)).body.find((x: any) => x.employee.id === s0Id)?.employee.departmentName;
ok(`đổi tên phòng ban: bảng chấm công hiện tên mới ngay ("${before}" → "${after}")`, pr.status < 300 && before === dep.name && after === renamed, pr);
await putDept(dep.name);

// ---- 4. ngày lễ (thêm = SaveChanges, xoá = ExecuteDelete) ----
const todayDay = async () => (await json(s0, 'GET', '/api/attendance/today')).body?.day;
ok('trước: hôm nay không phải ngày lễ', (await todayDay())?.holidayName == null);
const h = await json(admin, 'POST', '/api/attendance/holidays', { date: today, name: 'Lễ thử 245' });
ok('HR thêm ngày lễ hôm nay', h.status < 300, h);
const d1 = await todayDay();
ok(`sau thêm: /attendance/today là ngày lễ NGAY (${d1?.status} / ${d1?.holidayName})`, d1?.holidayName === 'Lễ thử 245');
const hid = h.body?.id ?? h.body;
const del = await json(admin, 'DELETE', `/api/attendance/holidays/${hid}`);
const d2 = await todayDay();
ok(`sau xoá (ExecuteDelete): hết ngày lễ NGAY (${d2?.status})`, del.status < 300 && d2?.holidayName == null, del);

// ---- 5. trả lại như cũ ----
await setManager(s0Id, leadId);
ok('trả s0 về trưởng nhóm 0.0: trưởng nhóm thấy lại s0 ngay', (await boardHas(lead, s0Id)).has && !(await boardHas(m, s0Id)).has);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
