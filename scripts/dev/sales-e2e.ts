// E2E: module Sales — khách hàng (quyền xem theo người phụ trách / quản lý / quyền Xem tài chính, MST trùng), người liên hệ, chăm sóc + việc hẹn,
// cơ hội (xác suất theo giai đoạn, lý do thua), hợp đồng bán (VAT, lịch thu, số trùng, từ cơ hội → Thắng), công nợ (quá hạn, sắp đến hạn, tuổi nợ),
// ghi nhận thu → dòng THU ở sổ Finance, kế toán huỷ dòng sổ → tự trừ, huỷ / thêm đợt thu, token AI chỉ đọc (TEST-77: GET theo quyền người xem, ghi / export / settings → 403; MCP thật khi có MCP_URL).
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/sales-e2e.ts
//   MCP tuỳ chọn: MCP_URL=http://localhost:5200/mcp (host Mcp chạy Mcp__ApiBaseUrl=http://localhost:5180 ASPNETCORE_URLS=http://localhost:5200).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
// Đăng nhập trả 2 Set-Cookie cùng tên (đổi security stamp rồi cấp lại) → lấy cái CUỐI như trình duyệt.
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status}`);
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
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);
const VIEW = 1, RECORD = 2, APPROVE = 4, ADMIN = 8;

// ---------- Chuẩn bị: chức vụ, nhân viên, quỹ ----------
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('SGĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('SKT', 3, RECORD), pPlain = await mkPos('SNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Kinh doanh E2E ${stamp}`, code: `KD${stamp}` })).body;
const mkEmp = async (code: string, name: string, posId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp(`SD${stamp}`, 'Giám Đốc KD', pDir, null, `e2e.sal.dir.${stamp}`, ['employee']);
const A = await mkEmp(`SA${stamp}`, 'Kế Toán KD', pAcc, null, `e2e.sal.acc.${stamp}`, ['employee']);
const M = await mkEmp(`SM${stamp}`, 'Trưởng Phòng KD', pPlain, null, `e2e.sal.mgr.${stamp}`, ['employee', 'manager']);
const S1 = await mkEmp(`S1${stamp}`, 'Sale Một', pPlain, M.e.id, `e2e.sal.s1.${stamp}`, ['employee']);
const S2 = await mkEmp(`S2${stamp}`, 'Sale Hai', pPlain, M.e.id, `e2e.sal.s2.${stamp}`, ['employee']);
const O = await mkEmp(`SO${stamp}`, 'Người Ngoài', pPlain, null, `e2e.sal.out.${stamp}`, ['employee']);
ok('6 nhân viên đăng nhập', [D, A, M, S1, S2, O].every((x) => !!x.cookie));
const cash = (await json(D.cookie, 'POST', '/api/finance/accounts', { name: `Quỹ KD ${stamp}`, kind: 'Cash', openingBalance: 0, openingDate: '2026-01-01' })).body;
const catIn = ((await json(A.cookie, 'GET', '/api/finance/categories')).body as any[]).find((c) => c.kind === 'Income').id;
const tax = String(Date.now()).slice(-10);

// ---------- Khách hàng + quyền xem ----------
const c1 = await json(S1.cookie, 'POST', '/api/sales/customers', { name: `Cty Alpha ${stamp}`, kind: 'Company', taxCode: tax, phone: '0901', email: 'Contact@Alpha.vn', source: 'Giới thiệu' });
const c2 = await json(S2.cookie, 'POST', '/api/sales/customers', { name: `Cty Beta ${stamp}`, kind: 'Company' });
ok('Sale tạo khách (201)', c1.status === 201 && c2.status === 201, [c1, c2]);
const C1 = c1.body, C2 = c2.body;
const dup = await json(S2.cookie, 'POST', '/api/sales/customers', { name: 'Trùng MST', taxCode: tax });
ok('MST trùng → 400 kèm mã khách cũ', dup.status === 400 && /KH-\d{5}/.test(dup.body?.errors?.taxCode?.[0] ?? ''), dup.body);
ok('Thiếu tên / email sai → 400', (await json(S1.cookie, 'POST', '/api/sales/customers', { name: ' ', email: 'abc' })).status === 400);
ok('Admin seed (không hồ sơ) không tạo được khách → 403', (await json(admin, 'POST', '/api/sales/customers', { name: 'X' })).status === 403);
const listOf = async (c: string) => ((await json(c, 'GET', `/api/sales/customers?page=1&pageSize=200&search=${stamp}`)).body.items as any[]).map((x) => x.id);
ok('Sale 1 chỉ thấy khách của mình', (await listOf(S1.cookie)).includes(C1) && !(await listOf(S1.cookie)).includes(C2));
ok('Sale 1 mở khách của Sale 2 → 404', (await json(S1.cookie, 'GET', `/api/sales/customers/${C2}`)).status === 404);
ok('Quản lý thấy khách của cả 2 cấp dưới', (await listOf(M.cookie)).includes(C1) && (await listOf(M.cookie)).includes(C2));
ok('Người ngoài không thấy gì', (await listOf(O.cookie)).length === 0);
ok('Kế toán / giám đốc (quyền Xem tài chính) thấy tất cả', (await listOf(A.cookie)).includes(C2) && (await listOf(D.cookie)).includes(C1));
const det = (await json(S1.cookie, 'GET', `/api/sales/customers/${C1}`)).body;
ok('Chi tiết: mã KH, email chữ thường, canEdit', /^KH-\d{5}$/.test(det.customer.code) && det.customer.email === 'contact@alpha.vn' && det.canEdit === true, det.customer);
ok('Kế toán xem được nhưng không sửa (không phải người phụ trách)', (await json(A.cookie, 'GET', `/api/sales/customers/${C1}`)).body.canEdit === false
  && (await json(A.cookie, 'PUT', `/api/sales/customers/${C1}`, { name: 'x' })).status === 403);
ok('Sale 1 giao khách cho Sale 2 (không phải cấp dưới) → 400', (await json(S1.cookie, 'PUT', `/api/sales/customers/${C1}`, { name: `Cty Alpha ${stamp}`, taxCode: tax, ownerEmployeeId: S2.e.id })).status === 400);
ok('Quản lý chuyển khách C1 sang Sale 2 rồi trả lại', (await json(M.cookie, 'PUT', `/api/sales/customers/${C1}`, { name: `Cty Alpha ${stamp}`, taxCode: tax, ownerEmployeeId: S2.e.id })).status === 204
  && (await json(S1.cookie, 'GET', `/api/sales/customers/${C1}`)).status === 404
  && (await json(M.cookie, 'PUT', `/api/sales/customers/${C1}`, { name: `Cty Alpha ${stamp}`, taxCode: tax, email: 'contact@alpha.vn', ownerEmployeeId: S1.e.id })).status === 204);

// ---------- Liên hệ + chăm sóc ----------
const k1 = await json(S1.cookie, 'POST', `/api/sales/customers/${C1}/contacts`, { name: 'Anh Nam', title: 'Giám đốc', phone: '0912' });
const k2 = await json(S1.cookie, 'POST', `/api/sales/customers/${C1}/contacts`, { name: 'Chị Lan', title: 'Kế toán', isPrimary: true });
const contacts = (await json(S1.cookie, 'GET', `/api/sales/customers/${C1}`)).body.contacts as any[];
ok('Liên hệ đầu tiên tự là chính; đặt người khác làm chính → bỏ người cũ', k1.status === 201 && k2.status === 201
  && contacts.filter((x) => x.isPrimary).length === 1 && contacts.find((x) => x.isPrimary).name === 'Chị Lan');
ok('Sale 2 sửa liên hệ của khách Sale 1 → 404', (await json(S2.cookie, 'PUT', `/api/sales/contacts/${k1.body}`, { name: 'x' })).status === 404);
ok('Xoá liên hệ', (await json(S1.cookie, 'DELETE', `/api/sales/contacts/${k1.body}`)).status === 204);
ok('Hẹn ngày mà thiếu việc → 400', (await json(S1.cookie, 'POST', `/api/sales/customers/${C1}/activities`, { kind: 'Call', content: 'Gọi', nextActionOn: today })).status === 400);
const act = await json(S1.cookie, 'POST', `/api/sales/customers/${C1}/activities`, { kind: 'Meeting', content: 'Gặp trao đổi yêu cầu', nextAction: 'Gửi báo giá', nextActionOn: addDays(2) });
ok('Ghi chăm sóc + việc hẹn → có trong "việc sắp tới"', act.status === 201 && ((await json(S1.cookie, 'GET', '/api/sales/activities/upcoming')).body as any[]).some((x) => x.id === act.body && x.customerName?.includes('Alpha')));

// ---------- Cơ hội ----------
const op = await json(S1.cookie, 'POST', '/api/sales/opportunities', { customerId: C1, title: 'Web bán hàng', stage: 'Quoted', value: 100_000_000 });
const opps = async (c: string) => (await json(c, 'GET', `/api/sales/opportunities?customerId=${C1}`)).body as any[];
const o1 = (await opps(S1.cookie)).find((x) => x.id === op.body);
ok('Cơ hội: xác suất mặc định theo giai đoạn (40%), trọng số 40M', op.status === 201 && o1.probability === 40 && o1.weighted === 40_000_000, o1);
ok('Thua mà không có lý do → 400', (await json(S1.cookie, 'PUT', `/api/sales/opportunities/${op.body}`, { customerId: C1, title: 'Web bán hàng', stage: 'Lost', value: 1 })).status === 400);
ok('Chuyển Đàm phán → xác suất 70%', (await json(S1.cookie, 'PUT', `/api/sales/opportunities/${op.body}`, { customerId: C1, title: 'Web bán hàng', stage: 'Negotiating', value: 100_000_000 })).status === 204
  && (await opps(S1.cookie)).find((x) => x.id === op.body).probability === 70);
ok('Sale 2 không thấy cơ hội của Sale 1', !((await json(S2.cookie, 'GET', '/api/sales/opportunities')).body as any[]).some((x) => x.id === op.body));

// ---------- Hợp đồng ----------
const code = `HD-${stamp}`;
const signed = addDays(-10);
const base = { code, customerId: C1, opportunityId: op.body, title: 'Thiết kế web bán hàng', valueBeforeTax: 100_000_000, vatRate: 10, signedOn: signed, billing: 'Milestone' };
ok('Tổng các đợt ≠ giá trị sau thuế → 400', (await json(S1.cookie, 'POST', '/api/sales/contracts', { ...base, installments: [{ title: 'Đợt 1', dueOn: addDays(-5), amount: 100_000_000 }] })).status === 400);
ok('VAT lạ (7%) → 400', (await json(S1.cookie, 'POST', '/api/sales/contracts', { ...base, vatRate: 7, installments: [{ title: 'Đợt 1', dueOn: addDays(-5), amount: 107_000_000 }] })).status === 400);
ok('Ngày ký tương lai → 400', (await json(S1.cookie, 'POST', '/api/sales/contracts', { ...base, signedOn: addDays(1), installments: [{ title: 'Đợt 1', dueOn: addDays(2), amount: 110_000_000 }] })).status === 400);
const ct1 = await json(S1.cookie, 'POST', '/api/sales/contracts', { ...base, installments: [{ title: 'Tạm ứng 55%', dueOn: addDays(-5), amount: 60_500_000 }, { title: 'Nghiệm thu', dueOn: addDays(5), amount: 49_500_000 }] });
ok('Tạo hợp đồng 100M + VAT 10% = 110M, 2 đợt (201)', ct1.status === 201, ct1);
ok('Số hợp đồng trùng → 400', (await json(S1.cookie, 'POST', '/api/sales/contracts', { ...base, opportunityId: null, installments: [{ title: 'x', dueOn: today, amount: 110_000_000 }] })).status === 400);
ok('Ký từ cơ hội → cơ hội thành Thắng (100%)', (await opps(S1.cookie)).find((x) => x.id === op.body).stage === 'Won');
const K1 = ct1.body;
const cd = async (c: string, id = K1) => (await json(c, 'GET', `/api/sales/contracts/${id}`)).body;
let d1 = await cd(S1.cookie);
ok('Chi tiết: tổng 110M, đợt 1 Quá hạn (1-30), đợt 2 Sắp đến hạn; Sale không ghi thu được', d1.contract.totalValue === 110_000_000 && d1.installments[0].state === 'Overdue'
  && d1.installments[0].agingBucket === '1-30' && d1.installments[1].state === 'DueSoon' && d1.canCollect === false && d1.contract.overdue === 60_500_000, d1);
ok('Sale 2 / người ngoài không xem được hợp đồng → 404', (await json(S2.cookie, 'GET', `/api/sales/contracts/${K1}`)).status === 404 && (await json(O.cookie, 'GET', `/api/sales/contracts/${K1}`)).status === 404);
const ct2 = await json(S2.cookie, 'POST', '/api/sales/contracts', { code: `HD-M-${stamp}`, customerId: C2, title: 'Xây kênh TikTok', valueBeforeTax: 12_000_000, vatRate: 0, signedOn: today,
  billing: 'Monthly', installments: [{ title: 'Tháng 1', dueOn: addDays(20), amount: 1_000_000 }, { title: 'Tháng 2', dueOn: addDays(50), amount: 1_000_000 }] });
ok('Hợp đồng định kỳ tháng: tổng đợt < giá trị vẫn hợp lệ', ct2.status === 201, ct2);

// ---------- Công nợ ----------
const rec = async (c: string) => (await json(c, 'GET', '/api/sales/receivables')).body;
const r1 = await rec(S1.cookie);
ok('Công nợ của Sale 1: 2 đợt của HĐ mình, quá hạn 60.5M, tuổi nợ 1-30', r1.items.filter((x: any) => x.contractId === K1).length === 2 && !r1.items.some((x: any) => x.contractCode === `HD-M-${stamp}`)
  && r1.overdue >= 60_500_000 && r1.buckets['1-30'] >= 60_500_000, r1);
ok('Lọc công nợ theo trạng thái Quá hạn', ((await json(S1.cookie, 'GET', '/api/sales/receivables?state=Overdue')).body.items as any[]).every((x) => x.state === 'Overdue'));
ok('Người ngoài: công nợ trống', (await rec(O.cookie)).items.length === 0);
ok('Kế toán thấy công nợ cả 2 hợp đồng', (await rec(A.cookie)).items.some((x: any) => x.contractCode === `HD-M-${stamp}`) && (await rec(A.cookie)).items.some((x: any) => x.contractId === K1));

// ---------- Ghi nhận thu → sổ Finance ----------
const inst1 = d1.installments[0].id, inst2 = d1.installments[1].id;
const collect = (c: string, id: string, b: object) => json(c, 'POST', `/api/sales/installments/${id}/collect`, b);
ok('Sale / giám đốc (không Ghi sổ) ghi thu → 403', (await collect(S1.cookie, inst1, { amount: 1, date: today, accountId: cash })).status === 403
  && (await collect(D.cookie, inst1, { amount: 1, date: today, accountId: cash })).status === 403);
ok('Thu vượt số còn lại → 400', (await collect(A.cookie, inst1, { amount: 60_500_001, date: today, accountId: cash })).status === 400);
const fut = await collect(A.cookie, inst1, { amount: 1, date: addDays(1), accountId: cash });
ok('Ngày thu tương lai → 400 (kiểm tra của sổ Finance)', fut.status === 400 && !!fut.body?.errors?.date, fut.body);
ok('Lỗi ghi sổ không để lại lần thu rác', (await cd(A.cookie)).installments[0].collections.length === 0);
const bal = async () => ((await json(D.cookie, 'GET', '/api/finance/accounts')).body as any[]).find((a) => a.id === cash).balance;
const col1 = await collect(A.cookie, inst1, { amount: 50_000_000, date: today, accountId: cash, categoryId: catIn, invoiceNumber: `VAT-${stamp}` });
d1 = await cd(A.cookie);
ok('Kế toán thu 50M: quỹ +50M, đợt 1 còn 10.5M (vẫn quá hạn)', col1.status === 201 && (await bal()) === 50_000_000 && d1.installments[0].collected === 50_000_000
  && d1.installments[0].remaining === 10_500_000 && d1.installments[0].state === 'Overdue', d1.installments[0]);
const entry = ((await json(A.cookie, 'GET', `/api/finance/entries?page=1&search=${encodeURIComponent(`VAT-${stamp}`)}`)).body.items as any[])[0];
ok('Sổ Finance có dòng THU: nguồn sales_collection, đối tác = khách, diễn giải theo HĐ', entry?.kind === 'Income' && entry.sourceType === 'sales_collection'
  && entry.counterparty?.includes('Alpha') && entry.description?.includes(code), entry);
ok('Kế toán huỷ dòng thu ở sổ → hợp đồng tự trừ (đã thu 0, lần thu "không hiệu lực")', (await json(A.cookie, 'POST', `/api/finance/entries/${entry.id}/void`, { reason: 'Nhầm quỹ' })).status === 204
  && (await cd(A.cookie)).installments[0].collected === 0 && (await cd(A.cookie)).installments[0].collections[0].active === false && (await bal()) === 0);
ok('Thu đủ 60.5M → đợt 1 Đã thu, rời khỏi công nợ', (await collect(A.cookie, inst1, { amount: 60_500_000, date: today, accountId: cash })).status === 201
  && (await cd(A.cookie)).installments[0].state === 'Paid' && !(await rec(A.cookie)).items.some((x: any) => x.installmentId === inst1));
ok('Thu thêm vào đợt đã đủ → 409', (await collect(A.cookie, inst1, { amount: 1, date: today, accountId: cash })).status === 409);

// ---------- Huỷ / thêm đợt ----------
ok('Huỷ đợt đã có tiền → 409', (await json(S1.cookie, 'POST', `/api/sales/installments/${inst1}/cancel`, { reason: 'x' })).status === 409);
ok('Huỷ đợt không lý do → 400', (await json(S1.cookie, 'POST', `/api/sales/installments/${inst2}/cancel`, { reason: '' })).status === 400);
ok('Thêm đợt vượt giá trị HĐ → 400', (await json(S1.cookie, 'POST', `/api/sales/contracts/${K1}/installments`, { title: 'Phát sinh', dueOn: today, amount: 1 })).status === 400);
ok('Huỷ đợt 2 (có lý do) → không còn trong công nợ', (await json(S1.cookie, 'POST', `/api/sales/installments/${inst2}/cancel`, { reason: 'Đổi lịch' })).status === 204
  && !(await rec(S1.cookie)).items.some((x: any) => x.installmentId === inst2));
ok('Thêm lại đợt trong giá trị còn trống → 201', (await json(S1.cookie, 'POST', `/api/sales/contracts/${K1}/installments`, { title: 'Nghiệm thu (dời)', dueOn: addDays(30), amount: 49_500_000 })).status === 201);
ok('Thu vào đợt đã huỷ → 409', (await collect(A.cookie, inst2, { amount: 1, date: today, accountId: cash })).status === 409);
const lst = (await json(S1.cookie, 'GET', `/api/sales/contracts?page=1&search=${stamp}`)).body.items as any[];
ok('Danh sách HĐ: đã thu 60.5M, còn 49.5M, không quá hạn', lst.find((x) => x.id === K1)?.collected === 60_500_000 && lst.find((x) => x.id === K1)?.outstanding === 49_500_000
  && lst.find((x) => x.id === K1)?.overdue === 0, lst);
ok('Kết thúc HĐ → không thêm đợt (409)', (await json(S1.cookie, 'PUT', `/api/sales/contracts/${K1}`, { title: 'Thiết kế web bán hàng', status: 'Completed' })).status === 204
  && (await json(S1.cookie, 'POST', `/api/sales/contracts/${K1}/installments`, { title: 'x', dueOn: today, amount: 1 })).status === 409);

// ---------- Token AI: chỉ đọc (TEST-77) ----------
const mkTok = async (c: string, who: string) => (await json(c, 'POST', '/api/auth/access-tokens', { name: `e2e sales ${who} ${stamp}`, expiresInDays: 30 })).body?.token as string;
const tS1 = await mkTok(S1.cookie, 's1'), tO = await mkTok(O.cookie, 'out');
const tGet = async (t: string, path: string) => {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${t}` } });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const tCall = async (t: string, method: string, path: string, body: unknown = {}) =>
  (await fetch(API + path, { method, headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, body: JSON.stringify(body) })).status;
ok('Token tạo được (S1, người ngoài)', !!tS1 && !!tO);
const tl = await tGet(tS1, `/api/sales/customers?page=1&search=${stamp}`);
ok('Token người phụ trách: danh sách khách chỉ có khách của mình', tl.status === 200 && tl.body.items.some((x: any) => x.id === C1) && !tl.body.items.some((x: any) => x.id === C2), tl);
ok('Token người phụ trách: chi tiết khách mình 200, khách người khác 404', (await tGet(tS1, `/api/sales/customers/${C1}`)).status === 200 && (await tGet(tS1, `/api/sales/customers/${C2}`)).status === 404);
ok('Token người ngoài: khách / HĐ → 404, danh sách trống', (await tGet(tO, `/api/sales/customers/${C1}`)).status === 404 && (await tGet(tO, `/api/sales/contracts/${K1}`)).status === 404
  && (await tGet(tO, `/api/sales/customers?page=1&search=${stamp}`)).body?.items?.length === 0);
ok('Token đọc HĐ, cơ hội, công nợ, việc hẹn, báo giá (200)', (await tGet(tS1, `/api/sales/contracts/${K1}`)).body?.contract?.id === K1
  && (await tGet(tS1, `/api/sales/contracts?page=1&search=${stamp}`)).status === 200
  && ((await tGet(tS1, `/api/sales/opportunities?customerId=${C1}`)).body as any[]).some((x) => x.id === op.body)
  && (await tGet(tS1, '/api/sales/receivables')).status === 200
  && ((await tGet(tS1, '/api/sales/activities/upcoming')).body as any[]).some((x) => x.id === act.body)
  && (await tGet(tS1, '/api/sales/quotes?page=1')).status === 200);
const writes: [string, string][] = [
  ['POST', '/api/sales/customers'], ['PUT', `/api/sales/customers/${C1}`], ['POST', `/api/sales/customers/${C1}/contacts`], ['DELETE', `/api/sales/contacts/${k2.body}`],
  ['POST', `/api/sales/customers/${C1}/activities`], ['POST', '/api/sales/opportunities'], ['PUT', `/api/sales/opportunities/${op.body}`], ['POST', '/api/sales/contracts'],
  ['PUT', `/api/sales/contracts/${K1}`], ['POST', `/api/sales/contracts/${K1}/installments`], ['POST', `/api/sales/installments/${inst1}/collect`], ['POST', `/api/sales/installments/${inst2}/cancel`],
  ['POST', '/api/sales/quotes'], ['PUT', '/api/sales/settings'],
];
const ws = await Promise.all(writes.map(([m, p]) => tCall(tS1, m, p)));
ok('Token: mọi POST / PUT / DELETE /api/sales → 403', ws.every((x) => x === 403), writes.map((w, i) => `${w[0]} ${w[1]} ${ws[i]}`));
ok('Token: /settings + export.docx → 403', (await tGet(tS1, '/api/sales/settings')).status === 403
  && (await tGet(tS1, '/api/sales/quotes/0193a000-0000-7000-8000-000000000000/export.docx')).status === 403);
ok('Token ghi không đổi dữ liệu (khách C1 giữ tên)', (await json(S1.cookie, 'GET', `/api/sales/customers/${C1}`)).body.customer.name === `Cty Alpha ${stamp}`);

if (process.env.MCP_URL) {
  let rid = 0;
  const rpc = async (method: string, params: unknown, t: string) => {
    const res = await fetch(process.env.MCP_URL!, { method: 'POST', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text as any; }
  };
  const call = async (name: string, args: Record<string, unknown>, t = tS1) => {
    const r = await rpc('tools/call', { name, arguments: args }, t);
    const text = r?.result?.content?.[0]?.text ?? '';
    try { return { err: !!r?.result?.isError, j: JSON.parse(text) as any }; } catch { return { err: true, j: text as any }; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } }, tS1);
  const tools = ((await rpc('tools/list', {}, tS1))?.result?.tools ?? []) as any[];
  const salesTools = ['search_customers', 'get_customer', 'list_sales_followups', 'list_opportunities', 'list_quotes', 'get_quote', 'list_sales_contracts', 'get_sales_contract', 'list_receivables'];
  ok('MCP tools/list có 9 tool Kinh doanh, đều readOnly', salesTools.every((n) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint === true), tools.map((t) => t.name));
  const sc = await call('search_customers', { search: stamp });
  ok('MCP search_customers: chỉ khách của mình', !sc.err && sc.j.items.some((x: any) => x.id === C1) && !sc.j.items.some((x: any) => x.id === C2), sc.j);
  const gc = await call('get_customer', { customerId: C1 });
  ok('MCP get_customer: có liên hệ + HĐ', !gc.err && gc.j.customer.id === C1 && gc.j.contracts.some((x: any) => x.id === K1), gc.j);
  ok('MCP get_customer khách người khác → lỗi', (await call('get_customer', { customerId: C2 })).err);
  ok('MCP get_sales_contract, list_receivables, list_opportunities, list_sales_followups, list_quotes, list_sales_contracts',
    !(await call('get_sales_contract', { contractId: K1 })).err && !(await call('list_receivables', { state: 'overdue' })).err
    && !(await call('list_opportunities', { customerId: C1, stage: 'won' })).err && !(await call('list_sales_followups', {})).err
    && !(await call('list_quotes', {})).err && !(await call('list_sales_contracts', { search: stamp, status: 'completed' })).err);
  ok('MCP giai đoạn lạ → lỗi tiếng Việt', String((await call('list_opportunities', { stage: 'abc' })).j).includes('Giai đoạn'));
  ok('MCP người ngoài: get_sales_contract → lỗi', (await call('get_sales_contract', { contractId: K1 }, tO)).err);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
