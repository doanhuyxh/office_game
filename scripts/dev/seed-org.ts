// Tạo phòng ban theo khu vực bản đồ + nhân viên + tài khoản thử. Chạy lại an toàn (bỏ qua cái đã có).
// Tạo phòng ban + 12 tài khoản thử (dev). Chạy lại an toàn. Từ gốc repo:
//   TEST_PASSWORD=… bun scripts/dev/seed-org.ts "$Seed__AdminEmail" "$Seed__AdminPassword" account.txt
const [adminLogin, adminPass, outPath] = process.argv.slice(2);
const PASSWORD = process.env.TEST_PASSWORD ?? (() => { throw new Error('Đặt TEST_PASSWORD (mật khẩu chung cho tài khoản thử)'); })();
const B = 'http://localhost:5080';
type Jar = { cookie: string };
const call = async (jar: Jar, m: string, p: string, b?: unknown) => {
  const r = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: jar.cookie }, body: b ? JSON.stringify(b) : undefined });
  const sc = r.headers.getSetCookie(); if (sc.length) jar.cookie = [...new Map(sc.map((s) => s.split(';')[0]).map((kv) => [kv.slice(0, kv.indexOf('=')), kv] as const)).values()].join('; ') /* cookie cùng tên: giữ cái sau */;
  const t = await r.text(); let j: any = t; try { j = JSON.parse(t); } catch {}
  if (r.status >= 400) throw new Error(`${m} ${p} → ${r.status} ${t}`);
  return j;
};
const admin: Jar = { cookie: '' };
await call(admin, 'POST', '/api/auth/login', { login: adminLogin, password: adminPass });

// ---- Phòng ban (MapZone = zones[].id trong shared/office-map.json) ----
const DEPTS = [
  { code: 'BGD', name: 'Ban Giám đốc', mapZone: 'work', sortOrder: 0 },
  { code: 'HCNS', name: 'Hành chính – Nhân sự', mapZone: 'work', sortOrder: 1 },
  { code: 'KT', name: 'Kế toán', mapZone: 'work', sortOrder: 2 },
  { code: 'KD', name: 'Kinh doanh', mapZone: 'work', sortOrder: 3 },
  { code: 'KTH', name: 'Công nghệ', mapZone: 'work', sortOrder: 4 },
  { code: 'LT', name: 'Lễ tân', mapZone: 'reception', sortOrder: 5 },
];
let depts: any[] = await call(admin, 'GET', '/api/org/departments');
for (const d of DEPTS) if (!depts.some((x) => x.code === d.code)) await call(admin, 'POST', '/api/org/departments', { ...d, parentId: null, headEmployeeId: null });
depts = await call(admin, 'GET', '/api/org/departments');
const dept = (code: string) => depts.find((x) => x.code === code);

// ---- Chức vụ ----
let positions: any[] = await call(admin, 'GET', '/api/org/positions');
// Api tự tạo thang cấp bậc mặc định khi khởi động; chỉ bổ sung nếu HR đã xoá
for (const [name, level] of [['Trưởng phòng', 3], ['Chuyên viên', 6], ['Nhân viên', 7]] as const)
  if (!positions.some((p) => p.name === name)) await call(admin, 'POST', '/api/org/positions', { name, level });
positions = await call(admin, 'GET', '/api/org/positions');
const pos = (name: string) => positions.find((p) => p.name.toLowerCase() === name.toLowerCase())?.id ?? null;

// ---- Nhân viên + tài khoản (manager khai báo trước nhân viên cấp dưới) ----
const PEOPLE = [
  { u: 'giamdoc', name: 'Nguyễn Văn Thành', dept: 'BGD', pos: 'Giám đốc', roles: ['manager'], mgr: null, joined: '2019-03-01', head: true },
  { u: 'hr.truongphong', name: 'Trần Thị Hạnh', dept: 'HCNS', pos: 'Trưởng phòng', roles: ['hr', 'manager'], mgr: 'giamdoc', joined: '2020-06-15', head: true },
  { u: 'hr.nhanvien', name: 'Lê Thu Hà', dept: 'HCNS', pos: 'Chuyên viên', roles: ['hr'], mgr: 'hr.truongphong', joined: '2023-02-01' },
  { u: 'ketoan.truongphong', name: 'Phạm Minh Khoa', dept: 'KT', pos: 'Trưởng phòng', roles: ['manager'], mgr: 'giamdoc', joined: '2020-09-01', head: true },
  { u: 'ketoan.nhanvien', name: 'Vũ Thị Lan', dept: 'KT', pos: 'Nhân viên', roles: [], mgr: 'ketoan.truongphong', joined: '2024-04-01' },
  { u: 'kinhdoanh.truongphong', name: 'Hoàng Đức Long', dept: 'KD', pos: 'Trưởng phòng', roles: ['manager'], mgr: 'giamdoc', joined: '2021-01-04', head: true },
  { u: 'kinhdoanh.nhanvien1', name: 'Đặng Thu Trang', dept: 'KD', pos: 'Nhân viên', roles: [], mgr: 'kinhdoanh.truongphong', joined: '2023-08-14' },
  { u: 'kinhdoanh.nhanvien2', name: 'Bùi Quốc Bảo', dept: 'KD', pos: 'Nhân viên', roles: [], mgr: 'kinhdoanh.truongphong', joined: '2026-09-01', status: 'Probation' },
  { u: 'kythuat.truongphong', name: 'Ngô Thanh Tùng', dept: 'KTH', pos: 'Trưởng phòng', roles: ['manager'], mgr: 'giamdoc', joined: '2019-11-11', head: true },
  { u: 'kythuat.nhanvien1', name: 'Đỗ Hải Nam', dept: 'KTH', pos: 'Chuyên viên', roles: [], mgr: 'kythuat.truongphong', joined: '2022-05-03' },
  { u: 'kythuat.nhanvien2', name: 'Mai Phương Anh', dept: 'KTH', pos: 'Chuyên viên', roles: [], mgr: 'kythuat.truongphong', joined: '2024-10-07', flexible: true },
  { u: 'letan.nhanvien', name: 'Phan Ngọc Mai', dept: 'LT', pos: 'Lễ Tân', roles: [], mgr: 'hr.truongphong', joined: '2025-03-03' },
] as const;
const email = (u: string) => `${u}@officehub.test`; // TLD .test dành riêng cho thử nghiệm, không gửi mail thật (cấp bằng mật khẩu)

const listEmps = async () => { const r = await call(admin, 'GET', '/api/org/employees?includeResigned=true'); return (r.items ?? r) as any[]; };
let emps = await listEmps();
const ids: Record<string, string> = {};
for (const p of PEOPLE) {
  let e = emps.find((x) => x.email === email(p.u));
  if (!e) {
    const created = await call(admin, 'POST', '/api/org/employees', {
      code: null, fullName: p.name, email: email(p.u), phone: null, dateOfBirth: null, departmentId: dept(p.dept).id, positionId: pos(p.pos),
      managerId: p.mgr ? ids[p.mgr] : null, status: (p as any).status ?? 'Active', joinedAt: p.joined, note: 'Tài khoản thử nghiệm (account.txt)',
    });
    e = created.employee;
    console.log('+ nhân viên', e.code, p.name);
  }
  ids[p.u] = e.id;
  if (!e.account && !e.userId) {
    const acc = await call(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', userName: p.u, roles: p.roles });
    const u: Jar = { cookie: '' };
    await call(u, 'POST', '/api/auth/login', { login: p.u, password: acc.tempPassword });
    await call(u, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PASSWORD });
    console.log('+ tài khoản', p.u, p.roles.join(',') || 'employee');
  }
}

// Trưởng phòng
for (const p of PEOPLE.filter((x) => (x as any).head)) {
  const d = dept(p.dept);
  if (d.headEmployeeId !== ids[p.u])
    await call(admin, 'PUT', `/api/org/departments/${d.id}`, { name: d.name, code: d.code, parentId: d.parentId ?? null, headEmployeeId: ids[p.u], mapZone: d.mapZone, sortOrder: d.sortOrder });
}

// Lịch riêng: Mai Phương Anh làm ca linh hoạt T2–T6 (để thử quy tắc ca linh hoạt)
const shifts: any[] = await call(admin, 'GET', '/api/attendance/shifts');
const flex = shifts.find((s) => s.type === 'Flexible');
const schedules: any[] = await call(admin, 'GET', '/api/attendance/schedules');
for (const p of PEOPLE.filter((x) => (x as any).flexible))
  if (flex && !schedules.some((s) => s.employeeId === ids[p.u]))
    await call(admin, 'PUT', '/api/attendance/schedules', { employeeId: ids[p.u], effectiveFrom: '2026-11-01',
      days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dayOfWeek: d, shiftId: d >= 1 && d <= 5 ? flex.id : null })) });

// ---- Ghi account.txt ----
emps = await listEmps();
const by = (u: string) => emps.find((x) => x.email === email(u));
const ROLE = (r: readonly string[]) => ['employee', ...r].join(', ');
const lines = [
  '# Tài khoản thử nghiệm OfficeHub (dev) — KHÔNG commit (đã gitignore). Dùng lại để test, không cần tạo/xoá.',
  `# Mật khẩu chung: ${PASSWORD}   ·   Đăng nhập bằng tên đăng nhập hoặc email.`,
  '# Admin hệ thống (không có hồ sơ nhân viên): xem Seed__AdminEmail / Seed__AdminPassword trong .env',
  '# Luồng duyệt: nhân viên → quản lý trực tiếp (cột "Quản lý") → HR (hr.truongphong / hr.nhanvien).',
  '# Phòng ban theo khu vực trên bản đồ 3D (MapZone): work = Khu làm việc, reception = Lễ tân.',
  '',
];
for (const d of DEPTS) {
  const head = PEOPLE.find((p) => p.dept === d.code && (p as any).head);
  lines.push(`## ${d.name} (${d.code}) · khu vực: ${d.mapZone}${head ? ` · trưởng phòng: ${head.u}` : ''}`);
  for (const p of PEOPLE.filter((x) => x.dept === d.code)) {
    const e = by(p.u);
    const extra = [(p as any).status === 'Probation' ? 'thử việc' : '', (p as any).flexible ? 'ca linh hoạt T2–T6' : ''].filter(Boolean).join(', ');
    lines.push(`${e.code.padEnd(6)} ${p.u.padEnd(22)} ${PASSWORD}  ${p.name.padEnd(18)} ${p.pos.padEnd(13)} vai trò: ${ROLE(p.roles).padEnd(24)} quản lý: ${p.mgr ?? '—'}${extra ? `  (${extra})` : ''}`);
  }
  lines.push('');
}
await Bun.write(outPath, lines.join('\n'));
console.log('đã ghi', outPath);
