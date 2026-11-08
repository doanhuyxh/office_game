// Hợp đồng mẫu cho tài khoản thử (account.txt). Chạy lại an toàn: bỏ qua số HĐ đã có.
//   TEST_PASSWORD=… bun scripts/dev/seed-contracts.ts   (cần Api đang chạy)
const PW = process.env.TEST_PASSWORD ?? (() => { throw new Error('Đặt TEST_PASSWORD (mật khẩu chung trong account.txt)'); })();
const B = 'http://localhost:5080';
const r0 = await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'hr.truongphong', password: PW }) });
const cookie = [...new Map(r0.headers.getSetCookie().map((s) => s.split(';')[0]).map((kv) => [kv.slice(0, kv.indexOf('=')), kv] as const)).values()].join('; ') /* cookie cùng tên: giữ cái sau */;
const call = async (m: string, p: string, b?: unknown) => {
  const x = await fetch(B + p, { method: m, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: b ? JSON.stringify(b) : undefined });
  const t = await x.text(); if (x.status >= 400) throw new Error(`${m} ${p} → ${x.status} ${t}`); return t ? JSON.parse(t) : null;
};
const emps: any[] = await call('GET', '/api/org/employees');
const id = (u: string) => emps.find((e) => e.email === `${u}@officehub.test`)!.id;
const existing = new Set((await call('GET', '/api/contracts')).map((c: any) => c.number));
const C = [
  ['giamdoc', 'HĐLĐ-2019-001', 'Indefinite', '2019-03-01', null, 'Giám đốc', 45e6, 5e6],
  ['hr.truongphong', 'HĐLĐ-2020-004', 'Indefinite', '2020-06-15', null, 'Trưởng phòng HCNS', 30e6, 3e6],
  ['hr.nhanvien', 'HĐLĐ-2025-012', 'Fixed', '2025-02-01', '2027-01-31', 'Chuyên viên nhân sự', 15e6, 1e6],
  ['ketoan.truongphong', 'HĐLĐ-2020-007', 'Indefinite', '2020-09-01', null, 'Kế toán trưởng', 28e6, 3e6],
  ['ketoan.nhanvien', 'HĐLĐ-2025-015', 'Fixed', '2025-04-01', '2026-11-30', 'Kế toán viên', 13e6, 1e6],       // còn ~25 ngày → nhắc 30
  ['kinhdoanh.truongphong', 'HĐLĐ-2021-002', 'Indefinite', '2021-01-04', null, 'Trưởng phòng kinh doanh', 30e6, 5e6],
  ['kinhdoanh.nhanvien1', 'HĐLĐ-2025-020', 'Fixed', '2025-08-14', '2027-08-13', 'Nhân viên kinh doanh', 14e6, 2e6],
  ['kinhdoanh.nhanvien2', 'HĐTV-2026-003', 'Probation', '2026-09-01', '2026-11-09', 'Nhân viên kinh doanh', 10e6, null], // còn ~4 ngày → nhắc 7
  ['kythuat.truongphong', 'HĐLĐ-2019-009', 'Indefinite', '2019-11-11', null, 'Trưởng phòng kỹ thuật', 40e6, 4e6],
  ['kythuat.nhanvien1', 'HĐLĐ-2025-018', 'Fixed', '2025-05-03', '2027-05-02', 'Kỹ sư phần mềm', 25e6, 1.5e6],
  ['kythuat.nhanvien2', 'HĐLĐ-2024-031', 'Fixed', '2024-10-07', '2026-10-06', 'Kỹ sư phần mềm', 22e6, 1.5e6],   // đã hết hạn
  ['kythuat.nhanvien2', 'HĐLĐ-2026-040', 'Indefinite', '2026-10-07', null, 'Kỹ sư phần mềm', 26e6, 1.5e6],     // ký tiếp: vô thời hạn
  ['letan.nhanvien', 'HĐLĐ-2025-009', 'Fixed', '2025-03-03', '2027-03-02', 'Lễ tân', 9e6, 5e5],
] as const;
for (const [u, number, type, start, end, title, salary, allowance] of C) {
  if (existing.has(number)) continue;
  const c = await call('POST', '/api/contracts', { employeeId: id(u), number, type, signedDate: start, startDate: start, endDate: end, jobTitle: title,
    salary, allowance, note: 'Dữ liệu mẫu (tài khoản thử account.txt)' });
  console.log('+', number, u, c.status, c.daysLeft ?? '');
  if (number === 'HĐLĐ-2025-018')
    await call('POST', `/api/contracts/${c.id}/amendments`, { number: 'PL-01', effectiveDate: '2026-05-03', content: 'Điều chỉnh lương sau 1 năm làm việc', salary: 28e6, allowance: null });
}
