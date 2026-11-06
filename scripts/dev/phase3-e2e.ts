// E2E: nhập nhân viên từ Excel, lịch sử sửa (Audit), nhắc quên chấm ra. TẠO DỮ LIỆU THẬT (nhân viên không xoá được) →
// CHỈ chạy với Api trỏ vào Postgres tạm (xem .agent/progress.md "Test trên DB tạm"), bắt buộc E2E_LOCAL_DB=1.
//   E2E_LOCAL_DB=1 bun scripts/dev/phase3-e2e.ts <thư-mục-có-import-good.xlsx/import-bad.xlsx> a   (rồi khởi động lại Api, đợi ~50 giây)
//   E2E_LOCAL_DB=1 bun scripts/dev/phase3-e2e.ts <thư-mục> b
// Api cần: Attendance__Reminders__FlexibleAt=00:01 (để nhắc ngay khi không có ca). Admin đăng nhập bằng Seed__* trong .env.
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5080';
const [dir, phase = 'a'] = process.argv.slice(2);
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const login = async (login: string, password: string) => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  return { status: r.status, cookie: (r.headers.get('set-cookie') ?? '').split(';')[0], body: await r.json().catch(() => null) };
};
const call = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const upload = (cookie: string, path: string, file: string) => {
  const fd = new FormData();
  fd.append('file', Bun.file(`${dir}/${file}`), file);
  return fetch(API + path, { method: 'POST', headers: { cookie }, body: fd });
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const PW = 'E2e-Local-2026';

const admin = await login(env.Seed__AdminEmail, env.Seed__AdminPassword);
if (admin.status !== 200) throw new Error('Không đăng nhập được admin seed');

if (phase === 'a') {
  // ---------- Chuẩn bị ----------
  await call(admin.cookie, 'POST', '/api/org/departments', { name: 'Kỹ thuật', code: 'KT' });
  await call(admin.cookie, 'POST', '/api/org/positions', { name: 'Chuyên viên' });

  // ---------- Nhập Excel ----------
  const tpl = await fetch(`${API}/api/org/employees/import-template`, { headers: { cookie: admin.cookie } });
  ok('tải file mẫu', tpl.status === 200 && (tpl.headers.get('content-disposition') ?? '').includes('mau-nhap-nhan-vien.xlsx'));
  const badPrev = await (await upload(admin.cookie, '/api/org/employees/import/preview', 'import-bad.xlsx')).json();
  const badRow = badPrev.rows?.find((r: any) => r.code === 'NV902');
  ok('xem trước: lỗi từng dòng (phòng ban, ngày, email trùng, quản lý, trạng thái)', badPrev.errorCount >= 2
    && ['Phòng ban', '31/13/2026', 'trùng', 'NV999', 'Trạng thái'].every((k) => badRow?.errors.some((e: string) => e.includes(k))), badPrev);
  const badCommit = await upload(admin.cookie, '/api/org/employees/import', 'import-bad.xlsx');
  const empBefore = await (await call(admin.cookie, 'GET', '/api/org/employees')).json();
  ok('file có lỗi → 400, không nhập dòng nào', badCommit.status === 400 && empBefore.length === 0, { status: badCommit.status, n: empBefore.length });
  const goodPrev = await (await upload(admin.cookie, '/api/org/employees/import/preview', 'import-good.xlsx')).json();
  ok('xem trước file đúng: 3 dòng hợp lệ, tự cấp mã, quản lý trong file', goodPrev.validCount === 3 && goodPrev.errorCount === 0
    && goodPrev.rows[0].code === 'NV001' && goodPrev.rows[1].managerName === 'Lê Quản Lý' && goodPrev.rows[2].departmentName === 'Kỹ thuật', goodPrev);
  const commit = await (await upload(admin.cookie, '/api/org/employees/import', 'import-good.xlsx')).json();
  ok('nhập 3 nhân viên', commit.created === 3, commit);
  const emps = await (await call(admin.cookie, 'GET', '/api/org/employees')).json();
  const nv900 = emps.find((e: any) => e.code === 'NV900'), nv901 = emps.find((e: any) => e.code === 'NV901');
  ok('quản lý trong cùng file được gán', nv900?.managerId === nv901?.id && nv901?.status === 'Probation' && emps.find((e: any) => e.code === 'NV001')?.status === 'Active', emps);
  ok('nhập lại cùng file → trùng mã / email', (await upload(admin.cookie, '/api/org/employees/import', 'import-good.xlsx')).status === 400);

  // ---------- Lịch sử sửa ----------
  await call(admin.cookie, 'PUT', `/api/org/employees/${nv901.id}`, { code: 'NV901', fullName: 'Lê Quản Lý', email: 'quanly@e2e.test', phone: '0909999999',
    dateOfBirth: null, departmentId: nv901.departmentId, positionId: nv901.positionId, managerId: null, status: 'Active', joinedAt: '2026-10-01', note: null });
  const acc = await (await call(admin.cookie, 'POST', `/api/org/employees/${nv901.id}/account`, { mode: 'password', roles: ['employee'], userName: 'e2e.quanly' })).json();
  await call(admin.cookie, 'PUT', `/api/org/employees/${nv901.id}/account/roles`, { roles: ['employee', 'manager'] });
  const contract = await call(admin.cookie, 'POST', '/api/contracts', { employeeId: nv901.id, number: 'E2E-HD-01', type: 'Indefinite', signedDate: null,
    startDate: '2026-10-01', endDate: null, jobTitle: 'Trưởng nhóm', salary: 20000000, allowance: null, note: null });
  ok('tạo hợp đồng có lương', contract.status === 200 || contract.status === 201, await contract.text());
  await sleep(2000);
  const changes = await (await call(admin.cookie, 'GET', '/api/audit/changes?take=100')).json();
  const empAdded = changes.filter((c: any) => c.entity === 'Employee' && c.action === 'Added');
  ok('lịch sử: 3 nhân viên được thêm (người sửa = admin, nguồn web)', empAdded.length === 3 && empAdded.every((c: any) => c.source === 'web' && c.userName), empAdded[0]);
  const phone = changes.find((c: any) => c.entity === 'Employee' && c.entityLabel === 'Lê Quản Lý' && c.changes.some((f: any) => f.field === 'Phone'));
  ok('lịch sử: sửa điện thoại + trạng thái (cũ → mới)', phone?.changes.some((f: any) => f.field === 'Phone' && f.old === null && f.new === '0909999999')
    && phone?.changes.some((f: any) => f.field === 'Status' && f.old === 'Probation' && f.new === 'Active'), phone);
  const roles = changes.find((c: any) => c.entity === 'AppUser' && c.changes.some((f: any) => f.field === 'Roles'));
  ok('lịch sử: đổi vai trò', roles?.changes[0].old === 'employee' && roles?.changes[0].new === 'employee, manager', roles);
  const hd = changes.find((c: any) => c.entity === 'LaborContract' && c.action === 'Added');
  const sal = hd?.changes.find((f: any) => f.field === 'SalaryEncrypted');
  ok('lịch sử: lương hợp đồng bị che (•••), không lộ giá trị', sal?.masked === true && sal?.new === '•••' && !JSON.stringify(hd).includes('20000000'), hd);
  ok('lịch sử: không có trường kỹ thuật / hash', !JSON.stringify(changes).match(/"field":"(UpdatedAt|SecurityStamp|ConcurrencyStamp)"/)
    && changes.filter((c: any) => c.entity === 'AppUser').every((c: any) => c.changes.every((f: any) => f.field !== 'PasswordHash' || f.masked)));
  const emp = await login('e2e.quanly', acc.tempPassword);
  ok('nhân viên không xem được lịch sử (403)', (await call(emp.cookie, 'GET', '/api/audit/changes')).status === 403);

  // ---------- Chuẩn bị nhắc quên chấm ra ----------
  await call(emp.cookie, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const emp2 = await login('e2e.quanly', PW);
  // Lịch riêng: hôm nay không có ca → nhắc theo FlexibleAt (Api chạy với 00:01)
  const sched = await call(admin.cookie, 'PUT', '/api/attendance/schedules', { employeeId: nv901.id, effectiveFrom: today,
    days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, shiftId: null })) });
  ok('đặt lịch riêng (không ca)', sched.ok, await sched.text());
  const chk = await (await call(emp2.cookie, 'POST', '/api/attendance/check', { source: 'web' })).json();
  ok('chấm công vào', chk.checkedIn === true, chk);
  console.log('\n→ Khởi động lại Api, đợi ~50 giây rồi chạy pha b');
} else {
  const emp = await login('e2e.quanly', PW);
  const n = await (await call(emp.cookie, 'GET', '/api/notifications?take=10')).json();
  const rem = n.items?.filter((x: any) => x.category === 'attendance_reminder') ?? [];
  ok('nhận nhắc "chưa chấm công ra" (chuông)', rem.length === 1 && rem[0].title.includes('chưa chấm công ra') && rem[0].link === '/attendance', n.items);
  const changes = await (await call(admin.cookie, 'GET', '/api/audit/changes?entity=ScheduleEntry')).json();
  ok('lịch sử: lịch tuần riêng được ghi', changes.length >= 7, changes.length);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
