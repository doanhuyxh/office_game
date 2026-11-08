// E2E: kho tài liệu (module Documents) — kho / quyền, thư mục, tải lên thẳng S3 (vé + presigned PUT), phiên bản, xem / tải (presigned GET,
// nhật ký), tìm kiếm, thùng rác, gửi duyệt ban hành → số hiệu, lưu trữ, huỷ, hạn lưu trữ, dự án + thành viên, bàn giao, thống kê, CORS S3.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm). File S3 thật: cuối bài huỷ / xoá hết.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/documents-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ORIGIN = process.env.APP_ORIGIN ?? 'http://localhost:5173';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
// Đăng nhập (admin bắt buộc 2FA từ 2026-11-07: tự bật lần đầu, khoá lưu theo cổng Api ở thư mục tạm). Lấy cookie officehub.auth CUỐI (đăng nhập trả 2 Set-Cookie).
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
const year = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' }).slice(0, 4);

const admin = await login(process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Chuẩn bị: 2 phòng, trưởng phòng (manager) + nhân viên cùng phòng + người phòng khác ----------
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, managerId: string | null, user: string, roles: string[], positionId = pos) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const tech = (await json(admin, 'POST', '/api/org/departments', { name: 'Công nghệ E2E', code: 'CNE2' })).body;
const acct = (await json(admin, 'POST', '/api/org/departments', { name: 'Kế toán E2E', code: 'KTE2' })).body;
const head = await mkEmp('NV980', 'Trưởng Công Nghệ', tech, null, 'e2e.doc.head', ['employee', 'manager']);
await json(admin, 'PUT', `/api/org/departments/${tech}`, { name: 'Công nghệ E2E', code: 'CNE2', parentId: null, headEmployeeId: head.e.id, mapZone: null });
const staff = await mkEmp('NV981', 'Nhân Viên Tài Liệu', tech, head.e.id, 'e2e.doc.staff', ['employee']);
const outsider = await mkEmp('NV982', 'Người Phòng Khác', acct, null, 'e2e.doc.out', ['employee']);
ok('3 nhân viên đăng nhập', !!head.cookie && !!staff.cookie && !!outsider.cookie);

const created: string[] = [];
const T = { kind: 'Department', id: tech };
const upload = async (cookie: string, name: string, content: string, type = 'text/plain') => {
  const t = await json(cookie, 'POST', '/api/documents/uploads', { fileName: name, contentType: type, size: new Blob([content]).size });
  if (t.status !== 200) return { ticket: t, put: 0 };
  const put = await fetch(t.body.url, { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: content });
  return { ticket: t, put: put.status };
};
const createAsset = async (cookie: string, name: string, content: string, space: { kind: string; id: string | null }, extra: Record<string, unknown> = {}) => {
  const u = await upload(cookie, name, content);
  const r = await json(cookie, 'POST', '/api/documents/assets', { ticketId: u.ticket.body.ticketId, spaceKind: space.kind, spaceId: space.id, folderId: null,
    docTypeId: null, title: null, description: null, tags: [], ...extra });
  if (r.status === 200) created.push(r.body.asset.id);
  return r;
};

// ---------- Kho + quyền ----------
const spaces = (c: string) => json(c, 'GET', '/api/documents/spaces').then((r) => r.body as any[]);
const sStaff = await spaces(staff.cookie);
ok('nhân viên thấy kho công ty + kho phòng mình', sStaff.some((s) => s.kind === 'Company') && sStaff.some((s) => s.kind === 'Department' && s.id === tech), sStaff);
ok('nhân viên KHÔNG thấy kho phòng khác', !sStaff.some((s) => s.id === acct));
ok('trưởng phòng quản lý kho phòng mình', (await spaces(head.cookie)).find((s) => s.id === tech)?.canManage === true);
ok('HR thấy mọi kho phòng ban', (await spaces(admin)).filter((s) => s.kind === 'Department').length >= 2);
ok('người phòng khác xem thư mục kho Công nghệ → 403', (await json(outsider.cookie, 'GET', `/api/documents/folders?spaceKind=Department&spaceId=${tech}`)).status === 403);

// ---------- Thư mục ----------
const f1 = await json(staff.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Department', spaceId: tech, parentId: null, name: 'Hợp đồng' });
ok('tạo thư mục', f1.status === 200 && f1.body.name === 'Hợp đồng', f1);
ok('trùng tên thư mục → 400', (await json(staff.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Department', spaceId: tech, parentId: null, name: 'Hợp đồng' })).status === 400);
ok('tên có "/" → 400', (await json(staff.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Department', spaceId: tech, parentId: null, name: 'a/b' })).status === 400);
const e1 = await json(staff.cookie, 'POST', '/api/documents/folders/ensure', { spaceKind: 'Department', spaceId: tech, parentId: null, path: 'Thiết kế/2026/Logo' });
const e2 = await json(staff.cookie, 'POST', '/api/documents/folders/ensure', { spaceKind: 'Department', spaceId: tech, parentId: null, path: 'Thiết kế/2026/Logo' });
ok('ensure "a/b/c" tạo chuỗi thư mục, gọi lại trả cùng thư mục', e1.status === 200 && e1.body.id === e2.body.id && e1.body.name === 'Logo', [e1, e2]);
const folders = (await json(staff.cookie, 'GET', `/api/documents/folders?spaceKind=Department&spaceId=${tech}`)).body;
ok('kho có 4 thư mục', folders.length === 4, folders);

// ---------- Tải lên ----------
ok('chặn file .exe', (await json(staff.cookie, 'POST', '/api/documents/uploads', { fileName: 'virus.exe', contentType: null, size: 10 })).status === 400);
ok('chặn file > 5 GB', (await json(staff.cookie, 'POST', '/api/documents/uploads', { fileName: 'x.mp4', contentType: 'video/mp4', size: 6e9 })).status === 400);
const notYet = await json(staff.cookie, 'POST', '/api/documents/uploads', { fileName: 'chua-tai.txt', contentType: 'text/plain', size: 5 });
ok('đăng ký khi chưa PUT lên S3 → 409', (await json(staff.cookie, 'POST', '/api/documents/assets', { ticketId: notYet.body.ticketId, spaceKind: 'Department', spaceId: tech })).status === 409);
const u1 = await upload(staff.cookie, 'Báo cáo tháng 10.txt', 'Nội dung báo cáo tháng 10 — tiếng Việt có dấu');
ok('PUT thẳng S3 bằng presigned URL', u1.put === 200, u1);
ok('dùng vé của người khác → 404', (await json(outsider.cookie, 'POST', '/api/documents/assets', { ticketId: u1.ticket.body.ticketId, spaceKind: 'Company', spaceId: null })).status === 404);
const a1 = await json(staff.cookie, 'POST', '/api/documents/assets', { ticketId: u1.ticket.body.ticketId, spaceKind: 'Department', spaceId: tech, folderId: f1.body.id,
  docTypeId: null, title: null, description: 'Báo cáo nội bộ', tags: ['báo cáo', ' Báo Cáo ', 'tháng 10'] });
if (a1.status === 200) created.push(a1.body.asset.id);
const A = a1.body?.asset;
ok('tạo tài liệu: nháp, mã TL-CNE2-năm-xxxxx, tiêu đề = tên file, thẻ bỏ trùng, người phụ trách = người tạo',
  a1.status === 200 && A.status === 'Draft' && new RegExp(`^TL-CNE2-${year}-\\d{5}$`).test(A.code) && A.title === 'Báo cáo tháng 10'
  && A.tags.length === 2 && A.custodianName === 'Nhân Viên Tài Liệu' && A.docTypeName === 'Văn bản chung' && A.kind === 'Document', a1);
ok('vé đã dùng không dùng lại được', (await json(staff.cookie, 'POST', '/api/documents/assets', { ticketId: u1.ticket.body.ticketId, spaceKind: 'Company', spaceId: null })).status === 404);
ok('người phòng khác KHÔNG tải vào kho Công nghệ (403)', (await createAsset(outsider.cookie, 'x.txt', 'x', T)).status === 403);
const img = await createAsset(staff.cookie, 'logo.png', 'png-bytes', { kind: 'Company', id: null });
ok('tải vào kho công ty (ai cũng được) — ảnh nhận loại VB vì MIME gửi là text', img.status === 200, img);

// ---------- Danh sách / tìm ----------
const inFolder = await json(staff.cookie, 'GET', `/api/documents/assets?spaceKind=Department&spaceId=${tech}&folderId=${f1.body.id}&page=1&pageSize=20`);
ok('liệt kê trong thư mục (PagedResult)', inFolder.status === 200 && inFolder.body.total === 1 && inFolder.body.items[0].id === A.id, inFolder);
const root = await json(staff.cookie, 'GET', `/api/documents/assets?spaceKind=Department&spaceId=${tech}&page=1`);
ok('gốc kho không lẫn tài liệu trong thư mục', root.body.total === 0, root.body);
ok('tìm theo thẻ trong kho', (await json(staff.cookie, 'GET', `/api/documents/assets?spaceKind=Department&spaceId=${tech}&search=th%C3%A1ng%2010&page=1`)).body.total === 1);
ok('tìm mọi kho cần từ khoá', (await json(staff.cookie, 'GET', '/api/documents/assets?page=1')).status === 400);
ok('tìm mọi kho: nhân viên thấy tài liệu phòng mình', (await json(staff.cookie, 'GET', '/api/documents/assets?search=B%C3%A1o%20c%C3%A1o&page=1')).body.total >= 1);
ok('tìm mọi kho: người phòng khác KHÔNG thấy', (await json(outsider.cookie, 'GET', '/api/documents/assets?search=B%C3%A1o%20c%C3%A1o&page=1')).body.total === 0);
ok('người phòng khác mở chi tiết → 404', (await json(outsider.cookie, 'GET', `/api/documents/assets/${A.id}`)).status === 404);

// ---------- Xem / tải ----------
const view = await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}/file`);
const got = await fetch(view.body.url);
ok('xem trực tiếp (inline) văn bản thuần, nội dung đúng', view.body.inline === true && got.status === 200 && (await got.text()).startsWith('Nội dung báo cáo'), view.body);
ok('Content-Disposition inline + tên UTF-8', (got.headers.get('content-disposition') ?? '').startsWith('inline') && (got.headers.get('content-disposition') ?? '').includes("filename*=UTF-8''B%C3%A1o"),
  got.headers.get('content-disposition'));
const dl = await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}/file?download=true`);
ok('tải về = attachment', dl.body.inline === false && ((await fetch(dl.body.url)).headers.get('content-disposition') ?? '').startsWith('attachment'));
const v1Url = view.body.url;

// ---------- Phiên bản + sửa ----------
const u2 = await upload(staff.cookie, 'Báo cáo tháng 10 (sửa).txt', 'Bản sửa lần 2');
const v2 = await json(staff.cookie, 'POST', `/api/documents/assets/${A.id}/versions`, { ticketId: u2.ticket.body.ticketId, note: 'Sửa số liệu' });
ok('phiên bản mới v2, tổng dung lượng cộng dồn', v2.status === 200 && v2.body.asset.currentVersion === 2 && v2.body.versions.length === 2
  && v2.body.asset.totalSize === v2.body.versions[0].size + v2.body.versions[1].size && v2.body.versions[0].note === 'Sửa số liệu', v2);
ok('bản cũ v1 vẫn tải được', (await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}/file?version=1`)).status === 200);
const folderLogo = e1.body.id;
const types = (await json(staff.cookie, 'GET', '/api/documents/doc-types')).body;
const typeBC = types.find((t: any) => t.code === 'BC');
const upd = await json(staff.cookie, 'PUT', `/api/documents/assets/${A.id}`, { title: 'Báo cáo tháng 10/2026', description: null, tags: ['báo cáo'], docTypeId: typeBC.id, folderId: folderLogo });
ok('sửa tiêu đề / loại / chuyển thư mục khi còn nháp', upd.status === 200 && upd.body.asset.docTypeName === 'Báo cáo' && upd.body.folderPath === 'Thiết kế / 2026 / Logo', upd);
ok('thư mục khác kho → 400', (await json(staff.cookie, 'PUT', `/api/documents/assets/${A.id}`, { title: 'x', tags: [], docTypeId: typeBC.id, folderId: crypto.randomUUID() })).status === 400);

// ---------- Ban hành ----------
const apDraft = await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}/approvers`);
ok('trước khi gửi: người duyệt = quản lý trực tiếp (trưởng phòng)', apDraft.body?.step === 'Manager' && !apDraft.body.pending
  && apDraft.body.people.length === 1 && apDraft.body.people[0].name === 'Trưởng Công Nghệ' && apDraft.body.people[0].email === 'e2e.doc.head@e2e.test', apDraft.body);
const outDoc = await createAsset(outsider.cookie, 'out.txt', 'x', { kind: 'Company', id: null });
const apHr = await json(outsider.cookie, 'GET', `/api/documents/assets/${outDoc.body.asset.id}/approvers`);
ok('người chưa có quản lý → HR (không có HR → admin), nêu lý do', apHr.body?.step === 'Hr' && apHr.body.people.length >= 1
  && apHr.body.note.includes('chưa có quản lý trực tiếp'), apHr.body);
ok('admin (không có hồ sơ) xem → báo chưa gửi được', (await json(admin, 'GET', `/api/documents/assets/${outDoc.body.asset.id}/approvers`)).body?.step === 'None');
const sub = await json(staff.cookie, 'POST', `/api/documents/assets/${A.id}/submit`);
ok('gửi duyệt → Chờ duyệt', sub.status === 200 && sub.body.asset.status === 'PendingApproval' && !!sub.body.approvalRequestId, sub);
const apPending = await json(head.cookie, 'GET', `/api/documents/assets/${A.id}/approvers`);
ok('đang chờ: hiện người đang phải duyệt + người gửi (kể cả khi người khác xem)', apPending.body?.pending === true && apPending.body.requesterName === 'Nhân Viên Tài Liệu'
  && apPending.body.people[0]?.name === 'Trưởng Công Nghệ', apPending.body);
ok('đang chờ duyệt không thay file', (await json(staff.cookie, 'POST', `/api/documents/assets/${A.id}/versions`, { ticketId: crypto.randomUUID() })).status === 409);
const inbox = (await json(head.cookie, 'GET', '/api/approval/inbox')).body;
const req = inbox.find((x: any) => x.type === 'document_publish' && x.subjectId === A.id);
ok('trưởng phòng (quản lý trực tiếp) thấy đơn ban hành', !!req, inbox);
ok('người duyệt mở được chi tiết tài liệu', (await json(head.cookie, 'GET', `/api/documents/assets/${A.id}`)).status === 200);
const appr = await json(head.cookie, 'POST', `/api/approval/${req.id}/approve`, { comment: 'OK' });
const pub = (await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}`)).body;
ok('duyệt → Ban hành, số hiệu 001/năm/BC-CNE2, hạn lưu trữ 5 năm từ hôm nay', appr.status === 200 && pub.asset.status === 'Published'
  && pub.asset.documentNumber === `001/${year}/BC-CNE2` && pub.asset.retentionUntil?.startsWith(String(Number(year) + 5)), pub);
ok('đã ban hành: không thay file (409), không xoá (409), không đổi loại (400)',
  (await json(staff.cookie, 'POST', `/api/documents/assets/${A.id}/versions`, { ticketId: crypto.randomUUID() })).status === 409
  && (await json(staff.cookie, 'DELETE', `/api/documents/assets/${A.id}`)).status === 409
  && (await json(staff.cookie, 'PUT', `/api/documents/assets/${A.id}`, { title: 'x', tags: [], docTypeId: types[0].id, folderId: null })).status === 400);
const arc = await json(staff.cookie, 'POST', `/api/documents/assets/${A.id}/archive`);
ok('lưu trữ tài liệu đã ban hành', arc.status === 200 && arc.body.asset.status === 'Archived', arc);

// Từ chối → về nháp kèm lý do
const d2 = await createAsset(staff.cookie, 'De xuat.txt', 'Đề xuất', T);
await json(staff.cookie, 'POST', `/api/documents/assets/${d2.body.asset.id}/submit`);
const req2 = (await json(head.cookie, 'GET', '/api/approval/inbox')).body.find((x: any) => x.subjectId === d2.body.asset.id);
await json(head.cookie, 'POST', `/api/approval/${req2.id}/reject`, { comment: 'Thiếu số liệu' });
const rej = (await json(staff.cookie, 'GET', `/api/documents/assets/${d2.body.asset.id}`)).body;
ok('từ chối → về Nháp + lý do', rej.asset.status === 'Draft' && rej.rejectReason === 'Thiếu số liệu', rej);

// ---------- Tự ban hành theo chức vụ (cấp Chuyên viên trở lên) ----------
ok('cấp 7 (Nhân viên) không được bật tự ban hành (400)', (await json(admin, 'POST', '/api/org/positions', { name: 'Nhân viên tự ban hành E2E', level: 7, selfPublishDocuments: true })).status === 400);
const selfPos = (await json(admin, 'POST', '/api/org/positions', { name: 'Chuyên viên tự ban hành E2E', level: 6, selfPublishDocuments: true })).body;
ok('cấp 6 (Chuyên viên) bật được tự ban hành', (await json(admin, 'GET', '/api/org/positions')).body.some((p: any) => p.id === selfPos && p.selfPublishDocuments === true));
const selfer = await mkEmp('NV983', 'Chuyên Viên Tự Ban Hành', tech, head.e.id, 'e2e.doc.self', ['employee'], selfPos);
const sd = await createAsset(selfer.cookie, 'Quy trinh.txt', 'Quy trình', T);
const apSelf = await json(selfer.cookie, 'GET', `/api/documents/assets/${sd.body.asset.id}/approvers`);
ok('khung người duyệt báo "được tự ban hành"', apSelf.body?.step === 'Self' && apSelf.body.note.includes('Chuyên viên tự ban hành E2E'), apSelf.body);
const sp = await json(selfer.cookie, 'POST', `/api/documents/assets/${sd.body.asset.id}/submit`);
ok('gửi → ban hành ngay, có số hiệu, không tạo đơn duyệt', sp.status === 200 && sp.body.asset.status === 'Published' && /^\d{3}\//.test(sp.body.asset.documentNumber ?? '')
  && !sp.body.approvalRequestId && !(await json(head.cookie, 'GET', '/api/approval/inbox')).body.some((x: any) => x.subjectId === sd.body.asset.id), sp.body);

// ---------- Nhật ký truy cập ----------
const log = await json(staff.cookie, 'GET', `/api/documents/assets/${A.id}/access-log?page=1`);
ok('người phụ trách xem nhật ký (≥ 3 lượt xem / tải)', log.status === 200 && log.body.total >= 3 && log.body.items.some((x: any) => x.action === 'Download'), log.body);
ok('người khác không xem nhật ký (403)', (await json(outsider.cookie, 'GET', `/api/documents/assets/${A.id}/access-log`)).status === 403);

// ---------- Thùng rác ----------
const d3 = await createAsset(staff.cookie, 'nhap-xoa.txt', 'sẽ xoá', T);
const d3id = d3.body.asset.id;
ok('xoá nháp → thùng rác', (await json(staff.cookie, 'DELETE', `/api/documents/assets/${d3id}`)).status === 204
  && (await json(staff.cookie, 'GET', '/api/documents/trash?page=1')).body.items.some((x: any) => x.id === d3id));
ok('tài liệu trong thùng rác không hiện ở kho', !(await json(staff.cookie, 'GET', `/api/documents/assets?spaceKind=Department&spaceId=${tech}&search=nhap-xoa&page=1`)).body.items.length);
ok('khôi phục', (await json(staff.cookie, 'POST', `/api/documents/assets/${d3id}/restore`)).status === 204);
const d3url = (await json(staff.cookie, 'GET', `/api/documents/assets/${d3id}/file`)).body.url;
await json(staff.cookie, 'DELETE', `/api/documents/assets/${d3id}`);
ok('xoá hẳn → hồ sơ + file S3 biến mất', (await json(staff.cookie, 'DELETE', `/api/documents/assets/${d3id}/purge`)).status === 204
  && (await json(staff.cookie, 'GET', `/api/documents/assets/${d3id}`)).status === 404 && [403, 404].includes((await fetch(d3url)).status));

// ---------- Dự án ----------
// Dự án thuộc module Projects từ 2026-11-08 (/api/projects); kho tài liệu dự án đọc qua IProjectDirectory. Kiểm tra đầy đủ: projects-e2e.ts.
ok('nhân viên thường không tạo dự án (403)', (await json(staff.cookie, 'POST', '/api/projects', { code: 'X', name: 'X' })).status === 403);
const pjNew = await json(head.cookie, 'POST', '/api/projects', { code: 'appe2e', name: 'Ứng dụng E2E', description: null, departmentId: tech, memberIds: [staff.e.id] });
const pj = { status: pjNew.status, body: (await json(head.cookie, 'GET', `/api/projects/${pjNew.body}`)).body?.project as any };
const pjMembers = (await json(head.cookie, 'GET', `/api/projects/${pjNew.body}`)).body?.members as any[];
ok('quản lý tạo dự án: mã viết hoa, người tạo = quản lý dự án, có thành viên', pj.status === 201 && pj.body.code === 'APPE2E' && pj.body.myRole === 'Manager'
  && pjMembers.length === 2, pj);
ok('trùng mã dự án → 400', (await json(head.cookie, 'POST', '/api/projects', { code: 'APPE2E', name: 'Y' })).status === 400);
const P = { kind: 'Project', id: pj.body.id };
const pa = await createAsset(staff.cookie, 'spec.txt', 'Đặc tả', P);
ok('thành viên tải vào kho dự án, mã TL-APPE2E-…', pa.status === 200 && pa.body.asset.code.startsWith('TL-APPE2E-'), pa);
ok('người ngoài dự án không thấy kho dự án', !(await spaces(outsider.cookie)).some((s) => s.id === pj.body.id)
  && (await json(outsider.cookie, 'GET', `/api/documents/assets/${pa.body.asset.id}`)).status === 404);
ok('thành viên thường không sửa dự án (403)', (await json(staff.cookie, 'PUT', `/api/projects/${pj.body.id}`, { code: 'APPE2E', name: 'x', status: 'Active' })).status === 403);
ok('không bỏ được quản lý cuối cùng (409)', (await json(head.cookie, 'DELETE', `/api/projects/${pj.body.id}/members/${head.e.id}`)).status === 409);
await json(head.cookie, 'PUT', `/api/projects/${pj.body.id}`, { code: 'APPE2E', name: 'Ứng dụng E2E', description: null, departmentId: tech, status: 'Closed' });
ok('dự án đã đóng: kho chỉ đọc (403 khi tải lên)', (await createAsset(staff.cookie, 'late.txt', 'x', P)).status === 403);
ok('không còn API xoá dự án (chỉ đóng)', [404, 405].includes((await json(admin, 'DELETE', `/api/projects/${pj.body.id}`)).status));

// ---------- Quản trị (HR) ----------
ok('nhân viên không vào trang quản trị (403)', (await json(staff.cookie, 'GET', '/api/documents/admin/stats')).status === 403);
const stats = await json(admin, 'GET', '/api/documents/admin/stats');
ok('thống kê: số tài liệu, theo kho, 12 tháng', stats.status === 200 && stats.body.totalAssets >= 4 && stats.body.bySpace.length >= 3 && stats.body.monthly.length === 12, stats.body);
const soon = new Date(Date.now() + 10 * 86400e3).toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
ok('HR đổi hạn lưu trữ → vào danh sách sắp hết hạn', (await json(admin, 'PUT', `/api/documents/admin/assets/${d2.body.asset.id}/retention`, { until: soon })).status === 204
  && (await json(admin, 'GET', '/api/documents/admin/retention?page=1')).body.items.some((x: any) => x.id === d2.body.asset.id));
ok('hạn trong quá khứ → 400', (await json(admin, 'PUT', `/api/documents/admin/assets/${d2.body.asset.id}/retention`, { until: '2020-01-01' })).status === 400);
const ho = await json(admin, 'POST', '/api/documents/admin/handover', { fromEmployeeId: staff.e.id, toEmployeeId: outsider.e.id });
ok('bàn giao: chuyển người phụ trách + thêm vào dự án', ho.status === 200 && ho.body >= 3
  && (await json(outsider.cookie, 'GET', '/api/projects')).body.some((p: any) => p.id === pj.body.id), ho);
ok('HR huỷ phải có lý do (400)', (await json(admin, 'POST', `/api/documents/admin/assets/${A.id}/destroy`, { reason: ' ' })).status === 400);
const des = await json(admin, 'POST', `/api/documents/admin/assets/${A.id}/destroy`, { reason: 'Hết hạn lưu trữ (E2E)' });
const desD = (await json(admin, 'GET', `/api/documents/assets/${A.id}`)).body;
ok('huỷ: xoá file S3, giữ hồ sơ làm biên bản', des.status === 204 && desD.asset.status === 'Destroyed' && desD.destroyReason === 'Hết hạn lưu trữ (E2E)'
  && desD.versions.every((v: any) => !v.available) && (await json(admin, 'GET', `/api/documents/assets/${A.id}/file`)).status === 410
  && [403, 404].includes((await fetch(v1Url)).status), desD);

// ---------- CORS S3 (trình duyệt PUT thẳng lên bucket) ----------
const probe = await upload(staff.cookie, 'cors.txt', 'cors');
const pre = await fetch(probe.ticket.body.url, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' } });
const corsOk = pre.status === 200 && !!pre.headers.get('access-control-allow-origin');
console.log(`${corsOk ? '✔' : '⚠'} CORS bucket cho PUT từ ${ORIGIN}: ${corsOk ? 'đã bật' : `CHƯA bật (HTTP ${pre.status}) — trình duyệt sẽ không tải lên được`}`);
const probeAsset = await json(staff.cookie, 'POST', '/api/documents/assets', { ticketId: probe.ticket.body.ticketId, spaceKind: 'Company', spaceId: null });
if (probeAsset.status === 200) created.push(probeAsset.body.asset.id);

// ---------- Dọn: huỷ mọi tài liệu còn file trên S3 (vé chưa dùng: job dọn sau 24 giờ; xoá luôn ở đây) ----------
for (const id of created) await json(admin, 'POST', `/api/documents/admin/assets/${id}/destroy`, { reason: 'Dọn dữ liệu E2E' });
const left = (await Promise.all(created.map((id) => json(admin, 'GET', `/api/documents/assets/${id}`))))
  .filter((r) => r.status === 200 && r.body.versions.some((v: any) => v.available));
ok('dọn: không còn file E2E trên S3', left.length === 0, left.map((r) => r.body.asset.code));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
