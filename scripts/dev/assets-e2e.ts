// E2E: tài sản công ty (module Assets) — loại, thiết bị (mã, serial, cấp / thu hồi, trạng thái, lịch sử), dịch vụ + ghế (hết ghế, trùng tài khoản,
// huỷ dịch vụ), quyền xem (HR / quản lý / nhân viên / người ngoài), tổng quan, rà soát quyền, kiểm kê, xuất Excel, thông báo, nghỉ việc còn giữ tài sản.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/assets-e2e.ts a
// Pha b (sau khi KHỞI ĐỘNG LẠI Api, đợi ≥ 40 s cho job chạy): job báo HR khi nhân viên nghỉ việc còn giữ tài sản (một lần, không lặp).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '=')) ?? '';
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status} ${JSON.stringify(e.body)}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const PHASE = process.argv[2] ?? 'a';
const STATE_FILE = `${tmpdir()}/officehub-e2e-assets-state-${new URL(API).port}.json`;
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);

if (PHASE === 'b') {
  const st = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as { employeeId: string; code: string };
  const notes = await json(admin, 'GET', '/api/notifications?take=100');
  const mine = (notes.body?.items ?? []).filter((n: any) => n.category === 'asset_offboarding' && n.body.includes(st.code));
  ok('Job: HR nhận đúng 1 thông báo asset_offboarding cho người nghỉ còn giữ tài sản', mine.length === 1 && /1 thiết bị, 1 tài khoản/.test(mine[0].body), notes.body?.items?.slice(0, 3));
  const ov = await json(admin, 'GET', '/api/assets/overview');
  ok('Tổng quan vẫn liệt kê người nghỉ còn giữ', ov.body.resignedHolding.some((r: any) => r.employeeId === st.employeeId));
  console.log(`\n${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
}

// ---------- Chuẩn bị ----------
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Tài sản E2E ${stamp}`, code: `TS${stamp}` })).body;
const head = await mkEmp(`AH${stamp}`, 'Trưởng Nhóm Tài Sản', dept, null, `e2e.as.head.${stamp}`, ['employee', 'manager']);
const staff = await mkEmp(`AS${stamp}`, 'Nhân Viên Có Quản Lý', dept, head.e.id, `e2e.as.staff.${stamp}`, ['employee']);
const loner = await mkEmp(`AL${stamp}`, 'Nhân Viên Không Quản Lý', dept, null, `e2e.as.loner.${stamp}`, ['employee']);
const outsider = await mkEmp(`AO${stamp}`, 'Người Ngoài Nhóm', dept, null, `e2e.as.out.${stamp}`, ['employee']);
ok('4 nhân viên đăng nhập', !!head.cookie && !!staff.cookie && !!loner.cookie && !!outsider.cookie);

// ---------- Loại ----------
const cats = await json(admin, 'GET', '/api/assets/categories');
ok('Seed 5 loại thiết bị (MT, MH, DT, PK, KH)', cats.status === 200 && ['MT', 'MH', 'DT', 'PK', 'KH'].every((c) => cats.body.some((x: any) => x.code === c)), cats.body);
const catMT = cats.body.find((x: any) => x.code === 'MT').id;
ok('Nhân viên đọc được loại', (await json(staff.cookie, 'GET', '/api/assets/categories')).status === 200);
ok('Nhân viên không tạo được loại → 403', (await json(staff.cookie, 'POST', '/api/assets/categories', { code: 'XX', name: 'x', sortOrder: 9, isActive: true })).status === 403);
ok('Mã loại trùng → 400', (await json(admin, 'POST', '/api/assets/categories', { code: 'mt', name: 'Trùng', sortOrder: 9, isActive: true })).status === 400);
const newCat = await json(admin, 'POST', '/api/assets/categories', { code: `Z${stamp}`.slice(0, 6), name: 'Loại thử', sortOrder: 9, isActive: true });
ok('Tạo loại mới (mã viết hoa)', newCat.status === 200 && newCat.body.code === `Z${stamp}`.slice(0, 6).toUpperCase(), newCat.body);

// ---------- Thiết bị ----------
const serial = `SN-${stamp}`;
const dev = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'MacBook Pro 14', brand: 'Apple', model: 'M3', serialNumber: serial,
  purchaseDate: '2026-01-10', purchasePrice: 45000000, warrantyUntil: addDays(5), note: null });
ok('Tạo thiết bị: mã TB-MT-xxxxx, trong kho', dev.status === 200 && /^TB-MT-\d{5}$/.test(dev.body.code) && dev.body.status === 'InStock', dev);
const devId = dev.body.id;
ok('Serial trùng (không phân biệt hoa thường) → 400', (await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'X', serialNumber: serial.toLowerCase() })).status === 400);
ok('Giá âm → 400', (await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'X', purchasePrice: -1 })).status === 400);
ok('Thiếu tên / loại → 400', (await json(admin, 'POST', '/api/assets/devices', { name: ' ' })).status === 400);
ok('Hạn bảo hành trước ngày mua → 400', (await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'X', purchaseDate: '2026-05-01', warrantyUntil: '2026-04-01' })).status === 400);
ok('Nhân viên không xem / tạo thiết bị → 403', (await json(staff.cookie, 'GET', '/api/assets/devices')).status === 403
  && (await json(staff.cookie, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'X' })).status === 403);
const list = await json(admin, 'GET', `/api/assets/devices?search=${serial}&page=1&pageSize=10`);
ok('Tìm theo serial (phân trang)', list.status === 200 && list.body.total === 1 && list.body.items[0].id === devId, list.body);
ok('Danh sách có giá cho HR', list.body.items[0].purchasePrice === 45000000);

const asg = await json(admin, 'POST', `/api/assets/devices/${devId}/assign`, { employeeId: staff.e.id, note: 'Cấp khi vào làm' });
ok('Cấp thiết bị → Đang dùng, người giữ đúng', asg.status === 200 && asg.body.device.status === 'InUse' && asg.body.device.holderEmployeeId === staff.e.id, asg);
ok('Cấp lại thiết bị đang dùng → 409', (await json(admin, 'POST', `/api/assets/devices/${devId}/assign`, { employeeId: loner.e.id })).status === 409);
ok('Cấp cho nhân viên không tồn tại → 409', (await json(admin, 'POST', `/api/assets/devices/${devId}/assign`, { employeeId: crypto.randomUUID() })).status === 409);
ok('Đang dùng → Bảo trì bị chặn (phải thu hồi trước) → 409', (await json(admin, 'POST', `/api/assets/devices/${devId}/status`, { status: 'Repair' })).status === 409);
ok('Không xoá được thiết bị đã cấp → 409', (await json(admin, 'DELETE', `/api/assets/devices/${devId}`)).status === 409);

const myNotes = await json(staff.cookie, 'GET', '/api/notifications?take=20');
ok('Người được cấp nhận thông báo asset_assigned', myNotes.body?.items?.some((n: any) => n.category === 'asset_assigned' && n.link === '/assets'), myNotes.body);

// quyền xem tài sản đang giữ
const my = await json(staff.cookie, 'GET', '/api/assets/my');
ok('/my: nhân viên thấy thiết bị của mình (không có giá)', my.status === 200 && my.body.devices.length === 1 && my.body.devices[0].code === dev.body.code
  && my.body.devices[0].price === undefined, my.body);
ok('Quản lý xem được cấp dưới', (await json(head.cookie, 'GET', `/api/assets/employees/${staff.e.id}/holdings`)).body?.devices?.length === 1);
ok('HR xem được mọi người', (await json(admin, 'GET', `/api/assets/employees/${staff.e.id}/holdings`)).status === 200);
ok('Chính chủ xem được mình', (await json(staff.cookie, 'GET', `/api/assets/employees/${staff.e.id}/holdings`)).status === 200);
ok('Đồng nghiệp ngoài tuyến quản lý → 404', (await json(outsider.cookie, 'GET', `/api/assets/employees/${staff.e.id}/holdings`)).status === 404);
ok('Cấp dưới không xem được quản lý → 404', (await json(staff.cookie, 'GET', `/api/assets/employees/${head.e.id}/holdings`)).status === 404);
ok('Người không có thiết bị: /my rỗng', (await json(outsider.cookie, 'GET', '/api/assets/my')).body?.devices?.length === 0);

const det = await json(admin, 'GET', `/api/assets/devices/${devId}`);
ok('Chi tiết có lịch sử giao nhận', det.status === 200 && det.body.history.length === 1 && det.body.history[0].returnedAt == null, det.body);
const ret = await json(admin, 'POST', `/api/assets/devices/${devId}/return`, { note: 'Máy trầy xước' });
ok('Thu hồi → Trong kho, đóng bản ghi', ret.status === 200 && ret.body.device.status === 'InStock' && ret.body.device.holderEmployeeId == null
  && ret.body.history[0].returnedAt && ret.body.history[0].returnNote === 'Máy trầy xước', ret.body);
ok('Thu hồi thiết bị không ai dùng → 409', (await json(admin, 'POST', `/api/assets/devices/${devId}/return`, {})).status === 409);
const sNotes = await json(staff.cookie, 'GET', '/api/notifications?take=20');
ok('Người bị thu hồi nhận asset_returned', sNotes.body?.items?.some((n: any) => n.category === 'asset_returned'), sNotes.body);
ok('Thanh lý thiếu lý do → 400', (await json(admin, 'POST', `/api/assets/devices/${devId}/status`, { status: 'Retired', reason: ' ' })).status === 400);
ok('Bảo trì → về kho', (await json(admin, 'POST', `/api/assets/devices/${devId}/status`, { status: 'Repair' })).body?.device?.status === 'Repair'
  && (await json(admin, 'POST', `/api/assets/devices/${devId}/status`, { status: 'InStock' })).body?.device?.status === 'InStock');
ok('Đổi sang "Đang dùng" qua /status bị chặn → 409', (await json(admin, 'POST', `/api/assets/devices/${devId}/status`, { status: 'InUse' })).status === 409);
const upd = await json(admin, 'PUT', `/api/assets/devices/${devId}`, { categoryId: catMT, name: 'MacBook Pro 14 (đã sửa)', brand: 'Apple', model: 'M3', serialNumber: serial,
  purchaseDate: '2026-01-10', purchasePrice: 44000000, warrantyUntil: addDays(5), note: 'sửa' });
ok('Sửa thiết bị', upd.status === 200 && upd.body.name.includes('đã sửa') && upd.body.purchasePrice === 44000000, upd);
ok('Không đổi loại sau khi tạo → 400', (await json(admin, 'PUT', `/api/assets/devices/${devId}`, { categoryId: newCat.body.id, name: 'x' })).status === 400);
const spare = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'Máy dự phòng' });
ok('Xoá thiết bị chưa từng cấp → 204', (await json(admin, 'DELETE', `/api/assets/devices/${spare.body.id}`)).status === 204
  && (await json(admin, 'GET', `/api/assets/devices/${spare.body.id}`)).status === 404);

// ---------- Dịch vụ + ghế ----------
const svc = await json(admin, 'POST', '/api/assets/services', { name: `Figma ${stamp}`, vendor: 'Figma Inc', plan: 'Professional', url: 'https://figma.com', seatLimit: 2,
  billingCycle: 'Monthly', cost: 300000, renewalDate: addDays(20), adminEmployeeId: head.e.id, ownerDepartmentId: dept, note: null });
ok('Tạo dịch vụ (2 ghế)', svc.status === 200 && svc.body.seatsUsed === 0 && svc.body.status === 'Active' && svc.body.adminName === 'Trưởng Nhóm Tài Sản', svc);
const sid = svc.body.id;
ok('Số ghế 0 → 400', (await json(admin, 'POST', '/api/assets/services', { name: 'X', seatLimit: 0, billingCycle: 'None' })).status === 400);
ok('Nhân viên không xem / tạo dịch vụ → 403', (await json(staff.cookie, 'GET', '/api/assets/services')).status === 403);
const s1 = await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: staff.e.id, accountLogin: `staff.${stamp}@figma.test`, role: 'Editor' });
ok('Cấp ghế cho nhân viên có quản lý', s1.status === 200 && s1.body.employeeName === 'Nhân Viên Có Quản Lý', s1);
ok('Tài khoản trùng trên dịch vụ → 400', (await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: loner.e.id, accountLogin: `STAFF.${stamp}@figma.test` })).status === 400);
const s2 = await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: loner.e.id, accountLogin: `loner.${stamp}@figma.test` });
ok('Cấp ghế thứ hai', s2.status === 200, s2);
const s3 = await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: outsider.e.id, accountLogin: `out.${stamp}@figma.test` });
ok('Hết ghế → 409 "Đã hết ghế"', s3.status === 409 && /hết ghế/.test(s3.body?.detail ?? ''), s3);
ok('Hạ số ghế thấp hơn đang dùng → 400', (await json(admin, 'PUT', `/api/assets/services/${sid}`, { name: `Figma ${stamp}`, seatLimit: 1, billingCycle: 'Monthly' })).status === 400);
const sNotes2 = await json(staff.cookie, 'GET', '/api/notifications?take=20');
ok('Người được cấp ghế nhận thông báo asset_assigned', sNotes2.body?.items?.filter((n: any) => n.category === 'asset_assigned').length >= 2, sNotes2.body);
const mySeats = await json(staff.cookie, 'GET', '/api/assets/my');
ok('/my: thấy tài khoản dịch vụ (kèm url)', mySeats.body.seats.length === 1 && mySeats.body.seats[0].accountLogin === `staff.${stamp}@figma.test` && mySeats.body.seats[0].url === 'https://figma.com', mySeats.body);
const rv = await json(admin, 'POST', `/api/assets/seats/${s2.body.id}/revoke`);
ok('Thu hồi ghế', rv.status === 200 && rv.body.revokedAt, rv);
ok('Thu hồi lần hai → 409', (await json(admin, 'POST', `/api/assets/seats/${s2.body.id}/revoke`)).status === 409);
const seatList = await json(admin, 'GET', `/api/assets/services/${sid}/seats`);
ok('Danh sách ghế chỉ ghế đang dùng; includeRevoked thấy cả ghế đã thu hồi', seatList.body.length === 1
  && (await json(admin, 'GET', `/api/assets/services/${sid}/seats?includeRevoked=true`)).body.length === 2, seatList.body);
ok('Sau thu hồi cấp được lại cho người khác', (await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: loner.e.id, accountLogin: `loner.${stamp}@figma.test` })).status === 200);

// ---------- Tổng quan ----------
const ov = await json(admin, 'GET', '/api/assets/overview');
ok('Tổng quan HR: đếm theo trạng thái, giá trị, dịch vụ, sắp hết hạn', ov.status === 200 && ov.body.deviceTotal >= 1 && ov.body.totalPurchaseValue >= 44000000
  && ov.body.activeServices >= 1 && ov.body.seatsInUse >= 2 && ov.body.monthlyServiceCost >= 300000
  && ov.body.warrantiesDue.some((w: any) => w.id === devId) && ov.body.renewalsDue.some((r: any) => r.id === sid), ov.body);
ok('Tổng quan: nhân viên → 403', (await json(staff.cookie, 'GET', '/api/assets/overview')).status === 403);

// ---------- Rà soát quyền ----------
ok('Nhân viên không bắt đầu được rà soát → 403', (await json(staff.cookie, 'POST', '/api/assets/reviews', { title: 'x', dueDate: addDays(3) })).status === 403);
ok('Hạn trong quá khứ → 400', (await json(admin, 'POST', '/api/assets/reviews', { title: 'x', dueDate: addDays(-2) })).status === 400);
const rvw = await json(admin, 'POST', '/api/assets/reviews', { title: `Rà soát ${stamp}`, dueDate: addDays(7), serviceId: sid });
ok('Bắt đầu rà soát: chụp 2 ghế', rvw.status === 200 && rvw.body.total === 2 && rvw.body.status === 'Open', rvw);
ok('Đang có đợt mở → 409', (await json(admin, 'POST', '/api/assets/reviews', { title: 'y', dueDate: addDays(7) })).status === 409);
const hNotes = await json(head.cookie, 'GET', '/api/notifications?take=20');
ok('Quản lý nhận thông báo asset_review', hNotes.body?.items?.some((n: any) => n.category === 'asset_review'), hNotes.body);
const pend = await json(head.cookie, 'GET', '/api/assets/reviews/pending');
ok('Quản lý thấy đúng mục của cấp dưới (1 mục)', pend.status === 200 && pend.body.length === 1 && pend.body[0].employeeId === staff.e.id, pend.body);
ok('Người ngoài: không có mục chờ', (await json(outsider.cookie, 'GET', '/api/assets/reviews/pending')).body?.length === 0);
const hrPend = await json(admin, 'GET', '/api/assets/reviews/pending');
ok('HR thấy mục không có quản lý (loner)', hrPend.body?.some((i: any) => i.employeeId === loner.e.id && i.reviewerEmployeeId == null), hrPend.body);
const itemStaff = pend.body[0].id;
const itemLoner = hrPend.body.find((i: any) => i.employeeId === loner.e.id).id;
ok('Nhân viên không quyết được mục của người khác → 404', (await json(staff.cookie, 'POST', `/api/assets/reviews/items/${itemStaff}/decide`, { decision: 'Keep' })).status === 404);
ok('Quản lý khác (người ngoài) không quyết được → 404', (await json(outsider.cookie, 'POST', `/api/assets/reviews/items/${itemStaff}/decide`, { decision: 'Keep' })).status === 404);
ok('Quản lý không quyết mục của HR → 404', (await json(head.cookie, 'POST', `/api/assets/reviews/items/${itemLoner}/decide`, { decision: 'Keep' })).status === 404);
ok('Quyết "Pending" → 400', (await json(head.cookie, 'POST', `/api/assets/reviews/items/${itemStaff}/decide`, { decision: 'Pending' })).status === 400);
const dec = await json(head.cookie, 'POST', `/api/assets/reviews/items/${itemStaff}/decide`, { decision: 'Revoke', note: 'Không còn dùng Figma' });
ok('Quản lý chọn Thu hồi (chưa thu hồi thật)', dec.status === 200 && dec.body.decision === 'Revoke'
  && (await json(staff.cookie, 'GET', '/api/assets/my')).body.seats.length === 1);
ok('HR quyết mục của loner = Keep', (await json(admin, 'POST', `/api/assets/reviews/items/${itemLoner}/decide`, { decision: 'Keep' })).body?.decision === 'Keep');
const detail = await json(admin, 'GET', `/api/assets/reviews/${rvw.body.id}`);
ok('Chi tiết đợt: đã quyết 2, thu hồi 1', detail.body?.review?.decided === 2 && detail.body.review.toRevoke === 1, detail.body?.review);
ok('Nhân viên không đóng được đợt → 403', (await json(staff.cookie, 'POST', `/api/assets/reviews/${rvw.body.id}/close`)).status === 403);
const closed = await json(admin, 'POST', `/api/assets/reviews/${rvw.body.id}/close`);
ok('Đóng đợt: ghế "Thu hồi" bị thu hồi thật, ghế "Giữ" còn', closed.status === 200 && closed.body.status === 'Closed'
  && (await json(staff.cookie, 'GET', '/api/assets/my')).body.seats.length === 0
  && (await json(loner.cookie, 'GET', '/api/assets/my')).body.seats.length === 1, closed);
ok('Đóng lại / quyết khi đã đóng → 409', (await json(admin, 'POST', `/api/assets/reviews/${rvw.body.id}/close`)).status === 409
  && (await json(head.cookie, 'POST', `/api/assets/reviews/items/${itemStaff}/decide`, { decision: 'Keep' })).status === 409);
ok('Danh sách đợt rà soát', (await json(admin, 'GET', '/api/assets/reviews')).body?.some((r: any) => r.id === rvw.body.id));

// ---------- Huỷ dịch vụ ----------
const svc2 = await json(admin, 'POST', '/api/assets/services', { name: `Slack ${stamp}`, seatLimit: null, billingCycle: 'Yearly', cost: 12000000 });
await json(admin, 'POST', `/api/assets/services/${svc2.body.id}/seats`, { employeeId: staff.e.id, accountLogin: `s.${stamp}@slack.test` });
const canc = await json(admin, 'POST', `/api/assets/services/${svc2.body.id}/cancel`);
ok('Huỷ dịch vụ: tự thu hồi mọi ghế', canc.status === 200 && canc.body.status === 'Cancelled' && canc.body.seatsUsed === 0
  && (await json(staff.cookie, 'GET', '/api/assets/my')).body.seats.length === 0, canc);
ok('Cấp ghế trên dịch vụ đã huỷ → 409', (await json(admin, 'POST', `/api/assets/services/${svc2.body.id}/seats`, { employeeId: staff.e.id, accountLogin: 'z@z.test' })).status === 409);
ok('Huỷ lần hai → 409', (await json(admin, 'POST', `/api/assets/services/${svc2.body.id}/cancel`)).status === 409);

// ---------- Kiểm kê ----------
const d2 = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'Dell XPS', serialNumber: `SN2-${stamp}` });
const d3 = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'Lenovo T14', serialNumber: `SN3-${stamp}` });
await json(admin, 'POST', `/api/assets/devices/${d3.body.id}/assign`, { employeeId: staff.e.id });
ok('Nhân viên không kiểm kê được → 403', (await json(staff.cookie, 'POST', '/api/assets/stocktakes', { title: 'x' })).status === 403);
const st = await json(admin, 'POST', '/api/assets/stocktakes', { title: `Kiểm kê ${stamp}` });
ok('Bắt đầu kiểm kê: chụp thiết bị chưa thanh lý / mất', st.status === 200 && st.body.total >= 3 && st.body.status === 'Open', st);
ok('Đang có đợt mở → 409', (await json(admin, 'POST', '/api/assets/stocktakes', {})).status === 409);
const stDet = await json(admin, 'GET', `/api/assets/stocktakes/${st.body.id}`);
const itemOf = (id: string) => stDet.body.items.find((i: any) => i.deviceId === id);
ok('Mục kiểm kê ghi người giữ lúc chụp', itemOf(d3.body.id)?.expectedHolderName === 'Nhân Viên Có Quản Lý', stDet.body.items);
ok('Chưa kiểm hết mà chọn "chuyển Mất" → 409', (await json(admin, 'POST', `/api/assets/stocktakes/${st.body.id}/close`, { markMissingAsLost: true })).status === 409);
ok('Đánh dấu Pending → 400', (await json(admin, 'POST', `/api/assets/stocktakes/items/${itemOf(d2.body.id).id}/check`, { result: 'Pending' })).status === 400);
for (const it of stDet.body.items) {
  const result = it.deviceId === d3.body.id ? 'Missing' : 'Found';
  await json(admin, 'POST', `/api/assets/stocktakes/items/${it.id}/check`, { result, note: result === 'Missing' ? 'Không thấy tại bàn' : null });
}
const stNow = (await json(admin, 'GET', `/api/assets/stocktakes/${st.body.id}`)).body.stocktake;
ok('Đã kiểm hết, 1 không thấy', stNow.checked === stNow.total && stNow.missing === 1, stNow);
const stClose = await json(admin, 'POST', `/api/assets/stocktakes/${st.body.id}/close`, { markMissingAsLost: true });
ok('Đóng + chuyển thiết bị không thấy sang Mất', stClose.status === 200 && stClose.body.status === 'Closed', stClose);
const lost = await json(admin, 'GET', `/api/assets/devices/${d3.body.id}`);
ok('Thiết bị không thấy → Mất, lý do kiểm kê, đóng giao nhận, hết ở người giữ', lost.body.device.status === 'Lost' && /Kiểm kê/.test(lost.body.device.statusReason ?? '')
  && lost.body.history[0].returnedAt && (await json(staff.cookie, 'GET', '/api/assets/my')).body.devices.length === 0, lost.body);
ok('Thiết bị Mất không cấp lại được → 409', (await json(admin, 'POST', `/api/assets/devices/${d3.body.id}/assign`, { employeeId: staff.e.id })).status === 409);
ok('Không đổi trạng thái thiết bị Mất → 409', (await json(admin, 'POST', `/api/assets/devices/${d3.body.id}/status`, { status: 'InStock' })).status === 409);
ok('Sau khi đóng có thể bắt đầu đợt mới', (await json(admin, 'POST', '/api/assets/stocktakes', { title: 'Đợt 2' })).status === 200);
const st2 = (await json(admin, 'GET', '/api/assets/stocktakes')).body.find((s: any) => s.title === 'Đợt 2');
const st2Close = await json(admin, 'POST', `/api/assets/stocktakes/${st2.id}/close`, { markMissingAsLost: false });
ok('Đóng đợt khi chưa kiểm: coi là Không thấy, KHÔNG đổi trạng thái thiết bị', st2Close.status === 200 && st2Close.body.missing === st2Close.body.total
  && (await json(admin, 'GET', `/api/assets/devices/${d2.body.id}`)).body.device.status === 'InStock', st2Close.body);

// ---------- Excel ----------
for (const [path, name] of [['devices', 'thiet-bi'], ['services', 'dich-vu']]) {
  const r = await fetch(`${API}/api/assets/export/${path}`, { headers: { cookie: admin } });
  const buf = new Uint8Array(await r.arrayBuffer());
  ok(`Xuất Excel ${path}: xlsx hợp lệ, tên file`, r.status === 200 && /spreadsheetml/.test(r.headers.get('content-type') ?? '') && buf[0] === 0x50 && buf[1] === 0x4b
    && (r.headers.get('content-disposition') ?? '').includes(name), { status: r.status, cd: r.headers.get('content-disposition') });
  ok(`Xuất Excel ${path}: nhân viên → 403`, (await fetch(`${API}/api/assets/export/${path}`, { headers: { cookie: staff.cookie } })).status === 403);
}

// ---------- Nghỉ việc còn giữ tài sản ----------
await json(admin, 'POST', `/api/assets/devices/${d2.body.id}/assign`, { employeeId: loner.e.id });
const resign = await json(admin, 'POST', `/api/org/employees/${loner.e.id}/resign`, { leftAt: today });
const ov2 = await json(admin, 'GET', '/api/assets/overview');
const rh = ov2.body?.resignedHolding?.find((r: any) => r.employeeId === loner.e.id);
ok('Nghỉ việc còn giữ: tổng quan liệt kê (1 thiết bị, 1 tài khoản)', resign.status === 204 && rh?.devices === 1 && rh?.seats === 1, { resign: resign.status, rh });
const resignedHold = await json(admin, 'GET', `/api/assets/employees/${loner.e.id}/holdings`);
ok('HR vẫn xem được tài sản người đã nghỉ', resignedHold.status === 200 && resignedHold.body.devices.length === 1);
const d4 = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'Máy trống để thử cấp người đã nghỉ' });
const toResigned = await json(admin, 'POST', `/api/assets/devices/${d4.body.id}/assign`, { employeeId: loner.e.id });
ok('Cấp thiết bị (đang trong kho) cho người đã nghỉ → 409', toResigned.status === 409 && /nghỉ việc/.test(toResigned.body?.detail ?? ''), toResigned);
await json(admin, 'POST', `/api/assets/devices/${d4.body.id}/status`, { status: 'Retired', reason: 'Dọn e2e' });
await json(admin, 'POST', `/api/assets/devices/${d2.body.id}/return`, {});
const seatLoner = (await json(admin, 'GET', `/api/assets/services/${sid}/seats`)).body.find((s: any) => s.employeeId === loner.e.id);
await json(admin, 'POST', `/api/assets/seats/${seatLoner.id}/revoke`);
ok('Thu hồi xong: không còn trong danh sách nghỉ việc còn giữ', !(await json(admin, 'GET', '/api/assets/overview')).body.resignedHolding.some((r: any) => r.employeeId === loner.e.id));

// Chuẩn bị cho pha b: nhân viên nghỉ việc còn giữ 1 thiết bị + 1 tài khoản (job sẽ báo HR)
const ghost = await mkEmp(`AG${stamp}`, 'Nhân Viên Nghỉ Còn Giữ', dept, null, `e2e.as.ghost.${stamp}`, ['employee']);
const gd = await json(admin, 'POST', '/api/assets/devices', { categoryId: catMT, name: 'Máy người nghỉ' });
await json(admin, 'POST', `/api/assets/devices/${gd.body.id}/assign`, { employeeId: ghost.e.id });
await json(admin, 'POST', `/api/assets/services/${sid}/seats`, { employeeId: ghost.e.id, accountLogin: `ghost.${stamp}@figma.test` });
await json(admin, 'POST', `/api/org/employees/${ghost.e.id}/resign`, { leftAt: today });
writeFileSync(STATE_FILE, JSON.stringify({ employeeId: ghost.e.id, code: ghost.e.code }));

// ---------- Lịch sử sửa ----------
const audit = await json(admin, 'GET', '/api/audit/changes?page=1&pageSize=50');
ok('Lịch sử sửa ghi thay đổi thiết bị / dịch vụ', audit.status === 200 && JSON.stringify(audit.body).includes('Device'), { status: audit.status, body: JSON.stringify(audit.body).slice(0, 200) });

// ---------- Dọn ----------
for (const id of [d2.body.id, d3.body.id, devId]) await json(admin, 'POST', `/api/assets/devices/${id}/status`, { status: 'Retired', reason: 'Dọn e2e' });

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
