// E2E: hồ sơ cá nhân — liên hệ (tự sửa), ảnh đại diện (S3), yêu cầu đổi ngày sinh / CCCD / ngân hàng (HR duyệt / từ chối),
// HR sửa thẳng, mã hoá + lịch sử che, chặn token AI, sheet "Chuyển khoản" trong Excel bảng lương, trường CCCD cho mẫu hợp đồng.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180): E2E_LOCAL_DB=1 API_URL=http://localhost:5180 bun scripts/dev/profile-e2e.ts
// Ảnh đại diện tải lên S3 thật trong .env — script tự xoá ở cuối.
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const login = async (login: string, password: string) =>
  ((await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) })).headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('officehub.auth=')).at(-1) ?? '');
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  return { status: r.status, body: await r.json().catch(() => null) as any, headers: r.headers };
};
const PW = 'E2e-Local-2026';
const admin = await login(env.Seed__AdminEmail, env.Seed__AdminPassword);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Chuẩn bị: 1 HR có hồ sơ + 1 nhân viên ----------
const mk = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, c: await login(user, PW) };
};
const hr = await mk('NV970', 'Chị HR', 'e2e.hr', ['employee', 'hr']);
const nv = await mk('NV971', 'Anh Nhân Viên', 'e2e.nv', ['employee']);

// ---------- Liên hệ ----------
const me0 = await json(nv.c, 'GET', '/api/org/profile/me');
ok('xem hồ sơ của tôi', me0.status === 200 && me0.body.code === 'NV971' && me0.body.pending === null && me0.body.avatarUrl === null, me0.body);
ok('admin không có hồ sơ → 404', (await json(admin, 'GET', '/api/org/profile/me')).body?.title === 'no_employee_profile');
const bad = await json(nv.c, 'PUT', '/api/org/profile/me/contact', { phone: '12ab', currentAddress: null, permanentAddress: null, emergencyContactName: null, emergencyContactRelation: null, emergencyContactPhone: null });
ok('SĐT sai → 400', bad.status === 400 && bad.body.errors?.phone, bad.body);
const contact = { phone: '0901 234 567', currentAddress: '34 Nguyễn Trãi, Q.5', permanentAddress: '12 Lê Lợi, Q.1', emergencyContactName: 'Nguyễn Thị Mẹ', emergencyContactRelation: 'Mẹ', emergencyContactPhone: '0912345678' };
const saved = await json(nv.c, 'PUT', '/api/org/profile/me/contact', contact);
ok('tự sửa liên hệ — có hiệu lực ngay', saved.status === 200 && saved.body.contact.emergencyContactName === 'Nguyễn Thị Mẹ', saved.body);
ok('SĐT mới hiện trong danh bạ', (await json(hr.c, 'GET', '/api/org/employees')).body.find((x: any) => x.code === 'NV971')?.phone === '0901 234 567');

// ---------- Ảnh đại diện ----------
const { deflateSync } = await import('node:zlib');
const png = (() => { // PNG 64×64 thật
  const w = 64, raw = Buffer.alloc((w * 3 + 1) * w); for (let i = 0; i < raw.length; i++) raw[i] = i % 7 === 0 ? 0 : (i * 13) % 255;
  const crc = (b: Buffer) => { let c = ~0; for (const v of b) { c ^= v; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (t: string, d: Buffer) => { const td = Buffer.concat([Buffer.from(t), d]); const o = Buffer.alloc(td.length + 8); o.writeUInt32BE(d.length, 0); td.copy(o, 4); o.writeUInt32BE(crc(td), td.length + 4); return o; };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(w, 4); ih.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
})();
const up = (type: string, data: Buffer | string, name: string) => { const fd = new FormData(); fd.append('file', new Blob([data], { type }), name); return fetch(`${API}/api/org/profile/me/avatar`, { method: 'POST', headers: { cookie: nv.c }, body: fd }); };
ok('ảnh sai định dạng → 400', (await up('application/pdf', '%PDF-1.4', 'x.pdf')).status === 400);
const upRes = await up('image/png', png, 'me.png');
const avatarUrl = await upRes.json().catch(() => null);
ok('tải ảnh đại diện', upRes.status === 200 && String(avatarUrl).startsWith('/api/org/profile/avatars/'), avatarUrl);
const listed = (await json(hr.c, 'GET', '/api/org/employees')).body.find((x: any) => x.code === 'NV971');
ok('danh bạ có avatarUrl', listed?.avatarUrl === avatarUrl, listed?.avatarUrl);
const av = await json(hr.c, 'GET', avatarUrl);
ok('đồng nghiệp xem ảnh → chuyển hướng tới link S3 tạm', av.status === 302 && (av.headers.get('location') ?? '').startsWith('http'), av.status);

// ---------- Yêu cầu đổi thông tin nhạy cảm ----------
ok('CCCD sai → 400', (await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: { idNumber: '123' }, note: null })).status === 400);
ok('không đổi gì → 400', (await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: {}, note: null })).status === 400);
const req1 = await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: { dateOfBirth: '1995-08-15', idNumber: '079 095 001 234', bankName: 'Vietcombank', bankAccount: '0123 456 789', bankAccountHolder: 'nguyen van a' }, note: 'CCCD mới' });
ok('gửi yêu cầu (chuẩn hoá số, chủ TK viết hoa)', req1.status === 200 && req1.body.status === 'Pending' && req1.body.changes.find((c: any) => c.field === 'idNumber')?.new === '079095001234'
  && req1.body.changes.find((c: any) => c.field === 'bankAccountHolder')?.new === 'NGUYEN VAN A', req1.body);
ok('yêu cầu trùng → 409', (await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: { bankName: 'ACB' }, note: null })).status === 409);
ok('chưa duyệt → hồ sơ chưa đổi', (await json(nv.c, 'GET', '/api/org/profile/me')).body.sensitive.idNumber === null);
ok('nhân viên không xem danh sách yêu cầu (403)', (await json(nv.c, 'GET', '/api/org/profile/requests')).status === 403);
ok('nhân viên không xem thông tin cá nhân người khác (403)', (await json(nv.c, 'GET', `/api/org/profile/employees/${hr.e.id}`)).status === 403);
await Bun.sleep(800);
ok('HR nhận thông báo', JSON.stringify((await json(hr.c, 'GET', '/api/notifications')).body).includes('profile_change_requested'));
const list = await json(hr.c, 'GET', '/api/org/profile/requests');
ok('HR thấy yêu cầu kèm cũ → mới', list.body.length === 1 && list.body[0].changes.length === 5 && list.body[0].note === 'CCCD mới', list.body);
ok('từ chối thiếu lý do → 400', (await json(hr.c, 'POST', `/api/org/profile/requests/${req1.body.id}/reject`, { reason: '' })).status === 400);
ok('HR từ chối', (await json(hr.c, 'POST', `/api/org/profile/requests/${req1.body.id}/reject`, { reason: 'Số CCCD không khớp ảnh' })).status === 204);
const afterReject = (await json(nv.c, 'GET', '/api/org/profile/me')).body;
ok('nhân viên thấy lý do từ chối, hồ sơ không đổi', afterReject.lastDecided?.rejectReason === 'Số CCCD không khớp ảnh' && afterReject.sensitive.idNumber === null, afterReject.lastDecided);
const req2 = await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: { idNumber: '079095009999', idIssuedOn: '2021-05-10', idIssuedPlace: 'Cục CS QLHC về TTXH', bankName: 'Vietcombank', bankAccount: '0123456789', bankAccountHolder: 'NGUYEN VAN A' }, note: null });
ok('gửi lại', req2.status === 200);
const appr = await json(hr.c, 'POST', `/api/org/profile/requests/${req2.body.id}/approve`);
ok('HR duyệt', appr.status === 200 && appr.body.status === 'Approved', appr.body);
const me2 = (await json(nv.c, 'GET', '/api/org/profile/me')).body;
ok('hồ sơ đã cập nhật', me2.sensitive.idNumber === '079095009999' && me2.sensitive.bankAccount === '0123456789' && me2.sensitive.idIssuedOn === '2021-05-10', me2.sensitive);
ok('duyệt lại → 409', (await json(hr.c, 'POST', `/api/org/profile/requests/${req2.body.id}/approve`)).status === 409);
await Bun.sleep(800);
const bell = JSON.stringify((await json(nv.c, 'GET', '/api/notifications')).body);
ok('nhân viên nhận thông báo từ chối + duyệt', bell.includes('profile_change_rejected') && bell.includes('profile_change_approved'));

// ---------- Huỷ yêu cầu ----------
const req3 = await json(nv.c, 'POST', '/api/org/profile/me/requests', { change: { bankName: 'ACB' }, note: null });
ok('huỷ yêu cầu của mình', (await json(nv.c, 'DELETE', `/api/org/profile/me/requests/${req3.body.id}`)).status === 204
  && (await json(nv.c, 'GET', '/api/org/profile/me')).body.pending === null);

// ---------- HR sửa thẳng ----------
const hrPut = await json(hr.c, 'PUT', `/api/org/profile/employees/${nv.e.id}`, { contact, sensitive: { ...me2.sensitive, bankName: 'Techcombank', bankAccount: '19033333333' } });
ok('HR sửa thẳng thông tin cá nhân', hrPut.status === 200 && hrPut.body.sensitive.bankName === 'Techcombank', hrPut.body);
const changes = (await json(admin, 'GET', '/api/audit/changes?take=100')).body;
const bankChange = changes.find((c: any) => c.entity === 'Employee' && c.changes.some((f: any) => f.field === 'BankAccountEncrypted'));
ok('lịch sử sửa: số tài khoản bị che (•••), không lộ giá trị', bankChange?.changes.find((f: any) => f.field === 'BankAccountEncrypted')?.masked === true
  && !JSON.stringify(changes).includes('19033333333') && !JSON.stringify(changes).includes('079095009999'), bankChange);

// ---------- Token AI ----------
const tok = (await json(nv.c, 'POST', '/api/auth/access-tokens', { name: 'e2e-profile', expiresInDays: 30 })).body.token;
const st = async (p: string) => (await fetch(API + p, { headers: { authorization: `Bearer ${tok}` } })).status;
ok('token AI: /api/org/profile/me bị chặn', [401, 403].includes(await st('/api/org/profile/me')));
const dirRow = (await (await fetch(`${API}/api/org/employees?search=NV971`, { headers: { authorization: `Bearer ${tok}` } })).json())[0];
ok('token AI: danh bạ không có CCCD / ngân hàng / địa chỉ', !JSON.stringify(dirRow).match(/079095|19033333|Lê Lợi|Techcombank/), dirRow);

// ---------- Mẫu hợp đồng + Excel bảng lương ----------
const fields = (await json(hr.c, 'GET', '/api/contracts/templates/fields')).body.map((f: any) => f.name);
ok('mẫu hợp đồng có trường CCCD + địa chỉ', ['SoCCCD', 'NgayCapCCCD', 'NoiCapCCCD', 'DiaChiThuongTru', 'DiaChiHienTai'].every((n) => fields.includes(n)), fields);
await json(hr.c, 'POST', '/api/contracts', { employeeId: nv.e.id, number: 'E2E-PF-01', type: 'Indefinite', signedDate: null, startDate: '2026-01-05', endDate: null, jobTitle: null, salary: 15000000, allowance: null, note: null });
const period = await json(hr.c, 'POST', '/api/payroll/periods', { month: '2026-10' });
await json(hr.c, 'POST', `/api/payroll/periods/${period.body.id}/adjustments`, { employeeId: nv.e.id, label: 'Thưởng', amount: 5000000, taxable: true });
await json(hr.c, 'POST', `/api/payroll/periods/${period.body.id}/adjustments`, { employeeId: hr.e.id, label: 'Thưởng', amount: 1000000, taxable: true }); // NV970 chưa khai TK
const x = await fetch(`${API}/api/payroll/periods/${period.body.id}/export.xlsx`, { headers: { cookie: hr.c } });
const path = `${process.env.TMPDIR ?? '/tmp'}/e2e-payroll-${Date.now()}.xlsx`;
await Bun.write(path, await x.arrayBuffer());
const wbXml = await Bun.$`unzip -p ${path} xl/workbook.xml`.text();
const strings = await Bun.$`unzip -p ${path} xl/sharedStrings.xml`.text().catch(() => '');
const sheets = await Bun.$`unzip -p ${path} xl/worksheets/sheet2.xml`.text().catch(() => '');
ok('Excel bảng lương có sheet "Chuyển khoản" với tài khoản đã duyệt', wbXml.includes('Chuyển khoản') && (strings + sheets).includes('19033333333') && (strings + sheets).includes('CHƯA KHAI TÀI KHOẢN'), { wb: wbXml.slice(0, 200) });
await Bun.$`rm -f ${path}`;

// ---------- Dọn: xoá ảnh trên S3 ----------
ok('xoá ảnh đại diện', (await json(nv.c, 'DELETE', '/api/org/profile/me/avatar')).status === 204 && (await json(nv.c, 'GET', '/api/org/profile/me')).body.avatarUrl === null);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
