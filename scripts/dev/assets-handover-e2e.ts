// E2E: tài sản — khấu hao (loại / riêng thiết bị, tổng quan, Excel), biên bản giao nhận (lập khi cấp / thu hồi, nhân viên xác nhận, quyền, Word
// theo mẫu mặc định / mẫu riêng, danh sách chờ xác nhận), ảnh / hoá đơn thiết bị (xin link → PUT S3 THẬT `assets/devices/` → xác nhận, loại tệp,
// quyền, xoá mềm — file giữ lại trên S3), tab Vận hành của trang Hệ thống (/api/system/ops, chỉ admin).
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm). Chạy từ frontend/ để có fflate (đọc nội dung Word):
//   cd frontend && E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun ../scripts/dev/assets-handover-e2e.ts
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
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
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
const raw = (cookie: string, path: string, init: RequestInit = {}) => fetch(API + path, { ...init, headers: { cookie, ...(init.headers ?? {}) } });
const { unzipSync, strFromU8 } = await import('fflate').catch(() => ({ unzipSync: null as any, strFromU8: null as any }));
/** Chữ trong word/document.xml (bỏ thẻ) — null nếu không có fflate. */
const docxText = (buf: ArrayBuffer): string | null => {
  if (!unzipSync) return null;
  const xml = strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml']);
  return xml.replace(/<[^>]+>/g, '');
};
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;

// ---------- Chuẩn bị: 2 nhân viên ----------
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Biên bản E2E ${stamp}`, code: `BB${stamp}` })).body;
const staff = await mkEmp(`BS${stamp}`, 'Người Nhận Máy', dept, `e2e.bb.staff.${stamp}`);
const outsider = await mkEmp(`BO${stamp}`, 'Người Ngoài', dept, `e2e.bb.out.${stamp}`);
ok('2 nhân viên đăng nhập', !!staff.cookie && !!outsider.cookie);

// ---------- Khấu hao ----------
const cats = (await json(admin, 'GET', '/api/assets/categories')).body as any[];
const mt = cats.find((c) => c.code === 'MT'), dt = cats.find((c) => c.code === 'DT');
ok('Loại seed có số tháng khấu hao mặc định (MT 36, DT 24)', mt?.depreciationMonths === 36 && dt?.depreciationMonths === 24, cats);
ok('Số tháng khấu hao loại > 600 → 400',
  (await json(admin, 'PUT', `/api/assets/categories/${mt.id}`, { code: 'MT', name: mt.name, sortOrder: mt.sortOrder, isActive: true, depreciationMonths: 601 })).status === 400);
const dev = await json(admin, 'POST', '/api/assets/devices', { categoryId: mt.id, name: 'ThinkPad X1', brand: 'Lenovo', model: 'Gen 12', serialNumber: `BB-${stamp}`,
  purchaseDate: yearAgo, purchasePrice: 36000000, warrantyUntil: null, note: null });
ok('Thiết bị mua đúng 1 năm trước, 36 tháng: đã dùng 12 tháng, còn 24 000 000',
  dev.status === 200 && dev.body.effectiveDepreciationMonths === 36 && dev.body.depreciationMonths == null && dev.body.monthsUsed === 12
  && dev.body.accumulatedDepreciation === 12000000 && dev.body.bookValue === 24000000, dev.body);
const devId = dev.body.id;
const upd = (months: number | null) => json(admin, 'PUT', `/api/assets/devices/${devId}`, { categoryId: mt.id, name: 'ThinkPad X1', brand: 'Lenovo', model: 'Gen 12',
  serialNumber: `BB-${stamp}`, purchaseDate: yearAgo, purchasePrice: 36000000, warrantyUntil: null, note: null, depreciationMonths: months });
const u0 = await upd(0);
ok('Riêng thiết bị 0 tháng → không khấu hao (còn nguyên giá)', u0.status === 200 && u0.body.depreciationMonths === 0 && u0.body.bookValue === 36000000, u0.body);
const u12 = await upd(12);
ok('Riêng thiết bị 12 tháng → hết khấu hao (còn 0)', u12.body.effectiveDepreciationMonths === 12 && u12.body.bookValue === 0, u12.body);
ok('Số tháng âm → 400', (await upd(-1)).status === 400);
const uNull = await upd(null);
ok('Bỏ số tháng riêng → theo loại lại', uNull.body.depreciationMonths == null && uNull.body.bookValue === 24000000, uNull.body);
const ov0 = await json(admin, 'GET', '/api/assets/overview');
ok('Tổng quan có tổng giá trị còn lại (≤ tổng giá mua) + số biên bản chờ',
  ov0.status === 200 && typeof ov0.body.totalBookValue === 'number' && ov0.body.totalBookValue <= ov0.body.totalPurchaseValue
  && typeof ov0.body.unconfirmedHandovers === 'number', ov0.body);
const xl = await raw(admin, '/api/assets/export/devices');
ok('Excel thiết bị vẫn xuất được (có cột khấu hao)', xl.status === 200 && (await xl.arrayBuffer()).byteLength > 1000);

// ---------- Biên bản: cấp ----------
const asg = await json(admin, 'POST', `/api/assets/devices/${devId}/assign`, { employeeId: staff.e.id, note: 'Kèm sạc 65W, túi chống sốc' });
const h1 = asg.body?.handovers?.[0];
ok('Cấp thiết bị → lập biên bản bàn giao BB-năm-số, chờ xác nhận',
  asg.status === 200 && asg.body.handovers.length === 1 && h1.kind === 'Assign' && /^BB-\d{4}-\d{5}$/.test(h1.number) && h1.requiresConfirmation
  && !h1.confirmedAt && h1.note === 'Kèm sạc 65W, túi chống sốc' && h1.employeeId === staff.e.id, asg.body);
const note = (await json(staff.cookie, 'GET', '/api/notifications?take=10')).body?.items?.find((n: any) => n.category === 'asset_assigned');
ok('Thông báo cấp có nhắc xác nhận biên bản', !!note && note.body.includes(h1.number), note);
const myH = await json(staff.cookie, 'GET', '/api/assets/handovers/my');
ok('/handovers/my: nhân viên thấy biên bản chờ', myH.status === 200 && myH.body[0]?.id === h1.id, myH.body);
ok('Người ngoài: /handovers/my rỗng', (await json(outsider.cookie, 'GET', '/api/assets/handovers/my')).body?.length === 0);
ok('Người ngoài xác nhận hộ → 404', (await json(outsider.cookie, 'POST', `/api/assets/handovers/${h1.id}/confirm`)).status === 404);
ok('Admin (không phải người nhận) xác nhận hộ → 404', (await json(admin, 'POST', `/api/assets/handovers/${h1.id}/confirm`)).status === 404);
ok('Nhân viên không xem danh sách biên bản của HR → 403', (await json(staff.cookie, 'GET', '/api/assets/handovers')).status === 403);
const pend = await json(admin, 'GET', '/api/assets/handovers?unconfirmed=true');
ok('HR: danh sách chờ xác nhận có biên bản', pend.status === 200 && pend.body.some((h: any) => h.id === h1.id));

// Word (mẫu mặc định)
const w1 = await raw(staff.cookie, `/api/assets/handovers/${h1.id}/docx`);
const w1buf = await w1.arrayBuffer();
ok('Nhân viên tải Word biên bản của mình (.docx)', w1.status === 200 && (w1.headers.get('content-type') ?? '').startsWith(DOCX)
  && (w1.headers.get('content-disposition') ?? '').includes(h1.number));
const t1 = docxText(w1buf);
if (t1 === null) console.log('   (bỏ qua kiểm tra nội dung Word: chạy từ frontend/ để có fflate)');
else ok('Word đã điền: số, BÀN GIAO, tên, mã thiết bị, serial, ghi chú, "Chưa xác nhận"',
  t1.includes(h1.number) && t1.includes('BÀN GIAO') && t1.includes('Người Nhận Máy') && t1.includes(dev.body.code) && t1.includes(`BB-${stamp}`)
  && t1.includes('Kèm sạc 65W') && t1.includes('Chưa xác nhận') && !t1.includes('{{'), t1.slice(0, 400));
ok('Người ngoài tải Word → 404', (await raw(outsider.cookie, `/api/assets/handovers/${h1.id}/docx`)).status === 404);
ok('HR tải Word được', (await raw(admin, `/api/assets/handovers/${h1.id}/docx`)).status === 200);

// Xác nhận
const cf = await json(staff.cookie, 'POST', `/api/assets/handovers/${h1.id}/confirm`);
ok('Nhân viên xác nhận → có thời điểm + IP', cf.status === 200 && !!cf.body.confirmedAt && !!cf.body.confirmedIp, cf.body);
ok('Xác nhận lần 2 → 409', (await json(staff.cookie, 'POST', `/api/assets/handovers/${h1.id}/confirm`)).status === 409);
const t1b = docxText(await (await raw(admin, `/api/assets/handovers/${h1.id}/docx`)).arrayBuffer());
if (t1b !== null) ok('Word sau xác nhận ghi "Đã xác nhận … (IP …)"', /Đã xác nhận trên OfficeHub lúc \d{2}:\d{2} \d{2}\/\d{2}\/\d{4}/.test(t1b), t1b.slice(0, 600));
ok('Không còn trong danh sách chờ', !(await json(admin, 'GET', '/api/assets/handovers?unconfirmed=true')).body.some((h: any) => h.id === h1.id));

// ---------- Biên bản: thu hồi ----------
const ret = await json(admin, 'POST', `/api/assets/devices/${devId}/return`, { note: 'Bàn phím mòn' });
const h2 = ret.body?.handovers?.find((h: any) => h.kind === 'Return');
ok('Thu hồi → biên bản thu hồi chờ nhân viên xác nhận, số khác biên bản cấp',
  ret.status === 200 && ret.body.handovers.length === 2 && !!h2 && h2.requiresConfirmation && h2.number !== h1.number && h2.note === 'Bàn phím mòn', ret.body);
const ov1 = await json(admin, 'GET', '/api/assets/overview');
ok('Tổng quan đếm biên bản chờ ≥ 1', ov1.body.unconfirmedHandovers >= 1, ov1.body);
const t2 = docxText(await (await raw(staff.cookie, `/api/assets/handovers/${h2.id}/docx`)).arrayBuffer());
if (t2 !== null) ok('Word biên bản thu hồi ghi "THU HỒI"', t2.includes('THU HỒI') && t2.includes('Bàn phím mòn'), t2.slice(0, 300));
ok('Nhân viên xác nhận đã trả', (await json(staff.cookie, 'POST', `/api/assets/handovers/${h2.id}/confirm`)).status === 200);

// ---------- Mẫu Word riêng ----------
ok('Nhân viên không đọc cấu hình mẫu → 403', (await json(staff.cookie, 'GET', '/api/assets/settings')).status === 403);
const fields = await json(admin, 'GET', '/api/assets/settings/handover-template/fields');
ok('Danh sách trường mẫu có SoBienBan, XacNhan', fields.status === 200 && ['SoBienBan', 'XacNhan', 'SoSerial'].every((f) => fields.body.some((x: any) => x.name === f)));
const def = await raw(admin, '/api/assets/settings/handover-template/default');
const defBuf = await def.arrayBuffer();
ok('Tải mẫu mặc định (.docx)', def.status === 200 && defBuf.byteLength > 500);
const up = async (name: string, bytes: ArrayBuffer | Uint8Array, type = DOCX) => {
  const fd = new FormData();
  fd.append('file', new File([bytes], name, { type }));
  return (await raw(admin, '/api/assets/settings/handover-template', { method: 'POST', body: fd })).status;
};
ok('Tải lên file không phải .docx → 400', (await up('mau.txt', new TextEncoder().encode('xin chào'), 'text/plain')) === 400);
ok('Tải lên .docx hỏng → 400', (await up('hong.docx', new TextEncoder().encode('not a zip'))) === 400);
ok('Tải lên mẫu riêng (dùng mẫu mặc định làm mẫu) → 204', (await up(`mau-rieng-${stamp}.docx`, defBuf)) === 204);
const st = await json(admin, 'GET', '/api/assets/settings');
ok('Cấu hình ghi tên mẫu riêng + người đổi', st.body?.handoverTemplateName === `mau-rieng-${stamp}.docx` && !!st.body.updatedByName, st.body);
const w3 = await raw(admin, `/api/assets/handovers/${h1.id}/docx`);
const t3 = docxText(await w3.arrayBuffer());
ok('Word theo mẫu riêng vẫn điền đúng', w3.status === 200 && (t3 === null || t3.includes(h1.number)));
ok('Bỏ mẫu riêng → 204, quay về mặc định', (await raw(admin, '/api/assets/settings/handover-template', { method: 'DELETE' })).status === 204
  && (await json(admin, 'GET', '/api/assets/settings')).body.handoverTemplateName === null);

// ---------- Ảnh / hoá đơn (S3 thật) ----------
const ticket = (kind: string, fileName: string, size: number, contentType: string | null = null, cookie = admin) =>
  json(cookie, 'POST', `/api/assets/devices/${devId}/attachments`, { kind, fileName, contentType, size });
ok('Ảnh mà gửi PDF → 400', (await ticket('Photo', 'hoa-don.pdf', 1000)).status === 400);
ok('Hoá đơn > 20 MB → 400', (await ticket('Invoice', 'hd.pdf', 21 * 1024 * 1024)).status === 400);
ok('Tệp .exe → 400', (await ticket('Other', 'x.exe', 100)).status === 400);
ok('Nhân viên xin link → 403', (await ticket('Photo', 'a.png', 100, 'image/png', staff.cookie)).status === 403);
ok('Thiết bị không tồn tại → 404', (await json(admin, 'POST', `/api/assets/devices/${crypto.randomUUID()}/attachments`, { kind: 'Photo', fileName: 'a.png', size: 1 })).status === 404);
// PNG 1×1
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const tk = await ticket('Photo', 'Máy ảnh mặt trước.png', png.byteLength, 'image/png');
ok('Xin link ảnh → presigned PUT, Content-Type image/png', tk.status === 200 && tk.body.uploadUrl.includes('assets/devices/') && tk.body.contentType === 'image/png', tk.body);
ok('Xác nhận khi chưa PUT → 409', (await json(admin, 'POST', `/api/assets/attachments/${tk.body.id}/confirm`)).status === 409);
const put = await fetch(tk.body.uploadUrl, { method: 'PUT', headers: { 'Content-Type': tk.body.contentType }, body: png });
ok('PUT ảnh lên S3', put.ok, put.status);
ok('Người khác xác nhận hộ → 404 (nhân viên bị chặn trước bởi quyền HR → 403)',
  (await json(staff.cookie, 'POST', `/api/assets/attachments/${tk.body.id}/confirm`)).status === 403);
const cfa = await json(admin, 'POST', `/api/assets/attachments/${tk.body.id}/confirm`);
ok('Xác nhận → đúng kích thước', cfa.status === 200 && cfa.body.size === png.byteLength && cfa.body.kind === 'Photo' && cfa.body.fileName === 'Máy ảnh mặt trước.png', cfa.body);
const lst = await json(admin, 'GET', `/api/assets/devices/${devId}/attachments`);
ok('Danh sách tệp có 1 ảnh', lst.status === 200 && lst.body.length === 1);
ok('Chi tiết thiết bị đếm 1 tệp', (await json(admin, 'GET', `/api/assets/devices/${devId}`)).body.attachmentCount === 1);
ok('Nhân viên không xem danh sách tệp → 403', (await json(staff.cookie, 'GET', `/api/assets/devices/${devId}/attachments`)).status === 403);
const url = await json(admin, 'GET', `/api/assets/attachments/${tk.body.id}/url`);
const got = url.status === 200 ? await fetch(url.body.url) : null;
ok('Presigned GET tải đúng file', !!got && got.ok && (await got.arrayBuffer()).byteLength === png.byteLength);
const urlDl = await json(admin, 'GET', `/api/assets/attachments/${tk.body.id}/url?download=true`);
ok('Link tải về (attachment)', urlDl.status === 200 && decodeURIComponent(urlDl.body.url).includes('attachment'), urlDl.body);
ok('Xoá tệp (ẩn) → 204', (await json(admin, 'DELETE', `/api/assets/attachments/${tk.body.id}`)).status === 204);
ok('Danh sách còn 0, link → 404', (await json(admin, 'GET', `/api/assets/devices/${devId}/attachments`)).body.length === 0
  && (await json(admin, 'GET', `/api/assets/attachments/${tk.body.id}/url`)).status === 404);

// ---------- Vận hành (trang Hệ thống) ----------
const ops = await json(admin, 'GET', '/api/system/ops');
const jobKeys = (ops.body?.jobs ?? []).map((j: any) => j.key);
ok('/api/system/ops: build, backup, email, job', ops.status === 200 && !!ops.body.build.startedAt && typeof ops.body.backup.status === 'string'
  && typeof ops.body.email.pending === 'number' && Array.isArray(ops.body.email.recentFailures), ops.body);
ok('Job nền được theo dõi (email, tài sản, hợp đồng, nhắc chấm ra…)',
  ['notification.email', 'assets.maintenance', 'contracts.reminders', 'attendance.checkout-reminder', 'documents.maintenance', 'sales.reminders',
    'projects.task-reminder', 'projects.allocation-freeze'].every((k) => jobKeys.includes(k)), jobKeys);
const emailJob = ops.body.jobs.find((j: any) => j.key === 'notification.email');
ok('Job gửi email (mỗi 5 giây) đã chạy, trạng thái ok', emailJob?.runs > 0 && emailJob.status === 'ok' && emailJob.lastSucceeded === true, emailJob);
ok('Nhân viên gọi /api/system/ops → 403', (await json(staff.cookie, 'GET', '/api/system/ops')).status === 403);
const rt = await json(admin, 'POST', '/api/system/ops/email/retry');
ok('Gửi lại email lỗi → 200 + số thư', rt.status === 200 && typeof rt.body.count === 'number', rt.body);
ok('Nhân viên gửi lại email → 403', (await json(staff.cookie, 'POST', '/api/system/ops/email/retry')).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
