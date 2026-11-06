// E2E giai đoạn 2 (Api :5080 trực tiếp): báo cáo + Excel, tiền tăng ca / phép, mẫu hợp đồng Word, đặt phòng họp.
//   TEST_PASSWORD=<mật khẩu trong account.txt> bun scripts/dev/phase2-e2e.ts <đường-dẫn-mẫu.docx>
// Mẫu .docx cần có {{HoTen}}, {{SoHopDong}}, {{Luong}}, {{LuongBangChu}}. Dọn dẹp: xoá mẫu thử, huỷ lịch họp thử.
const API = process.env.API_URL ?? 'http://localhost:5080';
const PASS = process.env.TEST_PASSWORD ?? (() => { throw new Error('Thiếu TEST_PASSWORD'); })();
const DOCX = process.argv[2];
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const login = async (user: string) => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: user, password: PASS }) });
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
};
const get = (cookie: string, path: string) => fetch(API + path, { headers: { cookie } });
const json = (cookie: string, method: string, path: string, body?: unknown) =>
  fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const isXlsx = (b: ArrayBuffer) => new Uint8Array(b)[0] === 0x50 && new Uint8Array(b)[1] === 0x4b; // "PK" (zip)

const hr = await login('hr.truongphong');
const emp = await login('kythuat.nhanvien1');
const mgr = await login('kythuat.truongphong');
const month = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 7);

// ---------- Báo cáo ----------
const xlsx = await get(hr, `/api/reports/timesheet.xlsx?month=${month}`);
const xbuf = await xlsx.arrayBuffer();
ok('HR xuất bảng công Excel', xlsx.status === 200 && isXlsx(xbuf) && (xlsx.headers.get('content-disposition') ?? '').includes(`bang-cong-${month}.xlsx`));
ok('quản lý xuất bảng công (cấp dưới)', (await get(mgr, `/api/reports/timesheet.xlsx?month=${month}`)).status === 200);
ok('nhân viên không xuất bảng công (403)', (await get(emp, `/api/reports/timesheet.xlsx`)).status === 403);
ok('tháng sai → 400', (await get(hr, `/api/reports/timesheet.xlsx?month=11-2026`)).status === 400);

const ot = await (await get(hr, `/api/reports/overtime-pay?month=${month}`)).json();
ok('tiền tăng ca: có dòng nhân viên + tổng', Array.isArray(ot.rows) && ot.rows.length > 0 && typeof ot.totalAmount === 'number', ot);
const withOt = ot.rows.find((r: any) => r.totalMinutes > 0);
if (withOt) ok('dòng có tăng ca: lương giờ = lương ÷ công chuẩn ÷ 8', withOt.salary == null || Math.abs(withOt.hourlyWage - withOt.salary / withOt.standardDays / 8) < 1, withOt);
ok('nhân viên không xem tiền tăng ca (403)', (await get(emp, `/api/reports/overtime-pay`)).status === 403);
ok('Excel tiền tăng ca', isXlsx(await (await get(hr, `/api/reports/overtime-pay.xlsx?month=${month}`)).arrayBuffer()));

const leave = await (await get(hr, `/api/reports/leave-payout`)).json();
const sample = leave.find((r: any) => r.salary != null && r.available > 0);
ok('tiền phép: dòng có lương → tiền = còn lại × lương ngày', !!sample && Math.abs(sample.payoutAmount - sample.available * sample.salary / sample.standardDays) <= 1, sample ?? leave.slice(0, 2));
ok('Excel phép năm', isXlsx(await (await get(hr, `/api/reports/leave-payout.xlsx`)).arrayBuffer()));
const mine = await (await get(emp, `/api/reports/leave-payout/me`)).json();
ok('nhân viên xem tiền phép ước tính của mình', mine.employee?.code && mine.payoutDue === false, mine);

// ---------- Mẫu hợp đồng ----------
if (DOCX) {
  const fields = await (await get(hr, '/api/contracts/templates/fields')).json();
  ok('danh sách trường mẫu', fields.some((f: any) => f.name === 'LuongBangChu'));
  const fd = new FormData();
  fd.append('file', new File([await Bun.file(DOCX).arrayBuffer()], 'mau-thu.docx'));
  fd.append('name', 'E2E mẫu thử');
  const up = await fetch(`${API}/api/contracts/templates`, { method: 'POST', headers: { cookie: hr }, body: fd });
  const tpl = await up.json();
  ok('tải mẫu .docx lên + nhận diện trường (cả trường bị tách run)', up.status === 200 && tpl.fields.includes('SoHopDong') && tpl.unknownFields.includes('TruongLa'), tpl);
  const badFd = new FormData();
  badFd.append('file', new File(['not a docx'], 'x.docx'));
  badFd.append('name', 'hỏng');
  ok('file hỏng → 400', (await fetch(`${API}/api/contracts/templates`, { method: 'POST', headers: { cookie: hr }, body: badFd })).status === 400);
  ok('nhân viên không xem mẫu (403)', (await get(emp, '/api/contracts/templates')).status === 403);

  const contracts = await (await get(hr, '/api/contracts')).json();
  // Chỉ dùng hợp đồng của tài khoản thử NV010–NV021 (NV001, NV009 là dữ liệu thật — không đụng tới).
  const isTest = (code: string) => /^NV0(1\d|2[01])$/.test(code);
  const c = contracts.find((x: any) => isTest(x.employee.code) && x.salary != null) ?? contracts.find((x: any) => isTest(x.employee.code));
  const gen = await get(hr, `/api/contracts/${c.id}/generate?templateId=${tpl.id}`);
  const out = new Uint8Array(await gen.arrayBuffer());
  ok('xuất hợp đồng từ mẫu (.docx)', gen.status === 200 && out[0] === 0x50 && out[1] === 0x4b);
  // Đọc document.xml trong file trả về để kiểm tra đã điền
  const { unzipSync, strFromU8 } = await import('fflate').catch(() => ({ unzipSync: null as any, strFromU8: null as any }));
  if (unzipSync) {
    const xml = strFromU8(unzipSync(out)['word/document.xml']);
    const text = xml.replace(/<[^>]+>/g, '');
    ok('nội dung đã điền: họ tên, số HĐ, lương bằng chữ; giữ trường lạ', text.includes(c.employee.fullName) && text.includes(c.number)
      && (c.salary == null || text.includes('đồng (bằng chữ:')) && text.includes('{{TruongLa}}') && !text.includes('{{HoTen}}'), text.slice(0, 400));
  } else console.log('   (bỏ qua kiểm tra nội dung: chưa có fflate)');
  ok('xoá mẫu', (await json(hr, 'DELETE', `/api/contracts/templates/${tpl.id}`)).status === 204);
}

// ---------- Đặt phòng họp ----------
const rooms = await (await get(emp, '/api/meetings/rooms')).json();
ok('phòng họp từ bản đồ', rooms.length === 3 && rooms.some((r: any) => r.id === 'meeting-small' && r.capacity === 6), rooms);
const me = await (await get(mgr, '/api/org/employees?search=kythuat.nhanvien')).json();
const day = new Date(Date.now() + 3 * 864e5).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const body = { roomId: 'meeting-small', title: 'E2E họp thử', startAt: `${day}T09:00:00+07:00`, endAt: `${day}T10:00:00+07:00`, attendeeIds: me.slice(0, 1).map((x: any) => x.id) };
const noZone = await json(mgr, 'POST', '/api/meetings/bookings', { ...body, startAt: `${day}T09:00:00` });
ok('thời điểm thiếu múi giờ → 400', noZone.status === 400);
const created = await json(mgr, 'POST', '/api/meetings/bookings', body);
const b = await created.json();
ok('đặt phòng', created.status === 200 && b.booking?.startAt === `${day}T02:00:00Z` && b.booking.attendees.length === 1, b);
const clash = await json(emp, 'POST', '/api/meetings/bookings', { ...body, startAt: `${day}T02:30:00Z`, endAt: `${day}T03:30:00Z`, title: 'trùng' });
const clashBody = await clash.json();
ok('trùng giờ (cùng thời điểm, khác cách ghi múi giờ) → 409', clash.status === 409 && String(clashBody.detail).includes('E2E họp thử'), clashBody);
const adjacent = await json(emp, 'POST', '/api/meetings/bookings', { ...body, startAt: `${day}T10:00:00+07:00`, endAt: `${day}T10:30:00+07:00`, title: 'E2E sát giờ', attendeeIds: [] });
const adj = await adjacent.json();
ok('lịch sát nhau (10:00) không tính trùng', adjacent.status === 200, adj);
const list = await (await get(emp, `/api/meetings/bookings?from=${encodeURIComponent(`${day}T00:00:00+07:00`)}&to=${encodeURIComponent(`${day}T23:59:00+07:00`)}&mine=true`)).json();
ok('nhân viên thấy lịch được mời (mine)', list.some((x: any) => x.id === b.booking.id && x.isMine && !x.canCancel), list);
ok('người được mời không huỷ được (403)', (await json(emp, 'DELETE', `/api/meetings/bookings/${b.booking.id}`)).status === 403);
const notif = await (await get(emp, '/api/notifications?take=5')).json();
ok('người được mời nhận thông báo', notif.items.some((n: any) => n.category === 'meeting_invited' && n.title.includes('E2E họp thử')), notif.items.slice(0, 2));
const now = await (await get(emp, '/api/meetings/bookings/now')).json();
ok('trạng thái phòng (now)', now.length === 2 && now.every((r: any) => 'current' in r && 'next' in r), now);
ok('người đặt huỷ', (await json(mgr, 'DELETE', `/api/meetings/bookings/${b.booking.id}`)).status === 204);
ok('HR huỷ hộ', (await json(hr, 'DELETE', `/api/meetings/bookings/${adj.booking.id}`)).status === 204);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
