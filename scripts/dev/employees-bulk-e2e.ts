// E2E: thao tác hàng loạt trên danh sách nhân viên (HR) — đổi phòng ban / chức vụ / quản lý (vòng lặp, bỏ trống), cho nghỉ việc
// (ngày trước ngày vào làm, gỡ quản lý, khoá tài khoản, bỏ qua người đã nghỉ), xuất Excel (theo id / theo bộ lọc), quyền (không phải HR → 403).
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/employees-bulk-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
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
    const st = await post('/api/auth/2fa/setup', {});
    const en = await post('/api/auth/2fa/enable', { code: totp(st.body?.sharedKey ?? '') });
    if (en.status !== 200) throw new Error(`Không bật được 2FA cho ${login}`);
    keys[login] = st.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const tag = Date.now().toString(36).slice(-4).toUpperCase();

const admin = await login(process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Chuẩn bị: 2 phòng, chuỗi quản lý boss ← lead ← dev1, dev2; staff (không phải HR) có tài khoản ----------
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const deptA = (await json(admin, 'POST', '/api/org/departments', { name: `Bulk A ${tag}`, code: `BA${tag}` })).body;
const deptB = (await json(admin, 'POST', '/api/org/departments', { name: `Bulk B ${tag}`, code: `BB${tag}` })).body;
let seq = 0;
const mk = async (name: string, managerId: string | null, joinedAt = '2026-01-05') => (await json(admin, 'POST', '/api/org/employees', {
  code: `B${tag}${seq++}`, fullName: name, email: `bulk.${tag.toLowerCase()}.${seq}@e2e.test`, phone: '0901234567', dateOfBirth: null,
  departmentId: deptA, positionId: positions[0].id, managerId, status: 'Active', joinedAt, note: null, jobTitle: null,
})).body.employee;
const boss = await mk('Sếp Bulk', null);
const lead = await mk('Trưởng nhóm Bulk', boss.id);
const dev1 = await mk('Dev Một', lead.id);
const dev2 = await mk('Dev Hai', lead.id);
const late = await mk('Người vào muộn', null, '2026-12-01');
const user = `bulk.staff.${tag.toLowerCase()}`;
const acc = (await json(admin, 'POST', `/api/org/employees/${lead.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
let staff = await login(user, acc.tempPassword);
await json(staff, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
staff = await login(user, PW);
ok('chuẩn bị 5 nhân viên + 1 tài khoản', !!boss?.id && !!late?.id && !!staff);

const get = async (id: string) => (await json(admin, 'GET', `/api/org/employees/${id}`)).body.employee;
const upd = (b: Record<string, unknown>) => json(admin, 'POST', '/api/org/employees/bulk/update',
  { setDepartment: false, departmentId: null, setPosition: false, positionId: null, setManager: false, managerId: null, ...b });

// ---------- Quyền ----------
ok('không phải HR: bulk/update → 403', (await json(staff, 'POST', '/api/org/employees/bulk/update', { ids: [dev1.id], setDepartment: true, departmentId: deptB })).status === 403);
ok('không phải HR: bulk/resign → 403', (await json(staff, 'POST', '/api/org/employees/bulk/resign', { ids: [dev1.id], leftAt: '2026-11-09' })).status === 403);
ok('không phải HR: export → 403', (await fetch(`${API}/api/org/employees/export?ids=${dev1.id}`, { headers: { cookie: staff } })).status === 403);

// ---------- Đổi hàng loạt ----------
ok('không chọn ai → 400', (await upd({ ids: [], setDepartment: true, departmentId: deptB })).status === 400);
ok('không tích mục nào → 400', (await upd({ ids: [dev1.id] })).status === 400);
ok('id không tồn tại → 400', (await upd({ ids: [dev1.id, crypto.randomUUID()], setDepartment: true, departmentId: deptB })).status === 400);
ok('phòng ban không tồn tại → 400', (await upd({ ids: [dev1.id], setDepartment: true, departmentId: crypto.randomUUID() })).status === 400);
const r1 = await upd({ ids: [dev1.id, dev2.id], setDepartment: true, departmentId: deptB, setPosition: true, positionId: positions.at(-1).id });
const d1 = await get(dev1.id);
ok('đổi phòng ban + chức vụ 2 người', r1.status === 200 && r1.body.affected === 2 && d1.departmentId === deptB && d1.positionId === positions.at(-1).id, r1);
ok('mục không tích giữ nguyên (quản lý)', d1.managerId === lead.id, d1);
ok('quản lý nằm trong nhóm → 400', (await upd({ ids: [dev1.id, dev2.id], setManager: true, managerId: dev1.id })).status === 400);
const cyc = await upd({ ids: [boss.id], setManager: true, managerId: dev1.id });
ok('quản lý là cấp dưới gián tiếp → 400 (vòng lặp)', cyc.status === 400 && JSON.stringify(cyc.body).includes('vòng lặp'), cyc);
ok('đổi quản lý dev1, dev2 → boss', (await upd({ ids: [dev1.id, dev2.id], setManager: true, managerId: boss.id })).status === 200 && (await get(dev2.id)).managerId === boss.id);
ok('bỏ trống quản lý (null)', (await upd({ ids: [dev2.id], setManager: true, managerId: null })).status === 200 && (await get(dev2.id)).managerId === null);
await Bun.sleep(1500); // lịch sử sửa có thể ghi bất đồng bộ
const audit = await json(admin, 'GET', `/api/audit/changes?entityId=${dev1.id}`);
ok('lịch sử sửa ghi từng người (có thay đổi phòng ban)', audit.status === 200 && JSON.stringify(audit.body).includes(deptB), audit);

// ---------- Xuất Excel ----------
const x1 = await fetch(`${API}/api/org/employees/export?ids=${dev1.id},${dev2.id}`, { headers: { cookie: admin } });
const b1 = new Uint8Array(await x1.arrayBuffer());
ok('export theo id → xlsx', x1.status === 200 && (x1.headers.get('content-type') ?? '').includes('spreadsheetml') && b1[0] === 0x50 && b1[1] === 0x4b, x1.status);
ok('export id sai → 400', (await fetch(`${API}/api/org/employees/export?ids=abc`, { headers: { cookie: admin } })).status === 400);
const x2 = await fetch(`${API}/api/org/employees/export?departmentId=${deptB}`, { headers: { cookie: admin } });
ok('export theo bộ lọc → xlsx', x2.status === 200 && (await x2.arrayBuffer()).byteLength > 1000, x2.status);

// ---------- Nghỉ việc hàng loạt ----------
const early = await json(admin, 'POST', '/api/org/employees/bulk/resign', { ids: [lead.id, late.id], leftAt: '2026-11-09' });
ok('ngày nghỉ trước ngày vào làm → 400, nêu mã', early.status === 400 && JSON.stringify(early.body).includes(late.code), early);
ok('lỗi một người thì không ai bị nghỉ', (await get(lead.id)).status !== 'Resigned');
const r2 = await json(admin, 'POST', '/api/org/employees/bulk/resign', { ids: [boss.id, lead.id], leftAt: '2026-11-09' });
ok('cho 2 người nghỉ', r2.status === 200 && r2.body.affected === 2, r2);
ok('trạng thái Đã nghỉ + ngày nghỉ', (await get(lead.id)).status === 'Resigned' && (await get(boss.id)).leftAt === '2026-11-09');
ok('cấp dưới được gỡ quản lý', (await get(dev1.id)).managerId === null);
ok('tài khoản bị khoá (không đăng nhập được)', !(await login(user, PW).catch(() => '')));
const r3 = await json(admin, 'POST', '/api/org/employees/bulk/resign', { ids: [boss.id, lead.id], leftAt: '2026-11-09' });
ok('người đã nghỉ được bỏ qua', r3.status === 200 && r3.body.affected === 0, r3);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
