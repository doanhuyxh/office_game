// E2E: dự án giai đoạn 2b-2 — yêu cầu thay đổi (CR): quyền (thành viên 403, người ngoài 404), mã {DỰ ÁN}-CR{n}, tính tiền cần hợp đồng, chuyển trạng thái
// (ngày tương lai, trạng thái cuối không sửa / huỷ), khách đồng ý → cộng ngân sách ngày công + chuông người phụ trách HĐ / kế toán; phụ lục hợp đồng bán
// (CR chờ lập phụ lục, tăng kèm đợt thu, vượt phần tăng, giảm khi đợt đã lên lịch đủ, số trùng, CR dùng hai lần, CR không hợp lệ), giá trị gốc / hiện tại,
// lãi / lỗ dự án gồm phụ lục, huỷ phụ lục (trừ lại + huỷ đợt, CR chờ lại), giảm giá trị, dự án đóng, token AI.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm; cách script khác ≥ 60 s).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/projects-cr-e2e.ts
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

const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('RGĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('RKT', 3, RECORD), pPlain = await mkPos('RNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `CR DA ${stamp}`, code: `CR${stamp}` })).body;
const mkEmp = async (key: string, code: string, name: string, posId: string, managerId: string | null, roles: string[]) => {
  const user = `e2e.cr.${key}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp('dir', `RD${stamp}`, 'Giám Đốc CR', pDir, null, ['employee']);
const A = await mkEmp('acc', `RA${stamp}`, 'Kế Toán CR', pAcc, null, ['employee']);
const PM = await mkEmp('pm', `RM${stamp}`, 'Quản Lý CR', pPlain, null, ['employee', 'manager']);
const Dev1 = await mkEmp('d1', `R1${stamp}`, 'Dev CR', pPlain, PM.e.id, ['employee']);
const O = await mkEmp('out', `RO${stamp}`, 'Người Ngoài CR', pPlain, null, ['employee']);
ok('5 nhân viên đăng nhập', [D, A, PM, Dev1, O].every((x) => !!x.cookie));

const cust = (await json(PM.cookie, 'POST', '/api/sales/customers', { name: `Khách CR ${stamp}` })).body;
const kc = await json(PM.cookie, 'POST', '/api/sales/contracts', { code: `HD-R-${stamp}`, customerId: cust, title: 'App CR', valueBeforeTax: 100_000_000, vatRate: 10,
  signedOn: today, billing: 'Milestone', installments: [{ title: 'Trọn gói', dueOn: addDays(30), amount: 110_000_000 }] });
ok('Hợp đồng bán 100tr + VAT 10 %', kc.status === 201, kc);
const K = kc.body;
const base = { code: `CR-${stamp}`, name: 'Dự án CR', kind: 'Client', salesContractIds: [K], startOn: today, budgetManDays: 40, memberIds: [Dev1.e.id] };
const P = (await json(PM.cookie, 'POST', '/api/projects', base)).body;
const P2 = (await json(PM.cookie, 'POST', '/api/projects', { code: `NB-${stamp}`, name: 'Nội bộ CR', kind: 'Internal' })).body;
const CODE = base.code.toUpperCase();

// ---------- Yêu cầu thay đổi ----------
const crs = async (c: string, id = P) => json(c, 'GET', `/api/projects/${id}/change-requests`);
const mkCr = (c: string, b: object, id = P) => json(c, 'POST', `/api/projects/${id}/change-requests`, b);
ok('Thành viên tạo CR → 403; người ngoài → 404', (await mkCr(Dev1.cookie, { title: 'x' })).status === 403 && (await mkCr(O.cookie, { title: 'x' })).status === 404);
ok('CR tính tiền ở dự án không có hợp đồng → 400', (await mkCr(PM.cookie, { title: 'x', billable: true }, P2)).status === 400);
ok('Thiếu tên → 400', (await mkCr(PM.cookie, { title: '' })).status === 400);
const cr1 = await mkCr(PM.cookie, { title: 'Thêm thanh toán QR', description: 'Khách muốn thêm', estimateManDays: 5, billable: true });
const cr2 = await mkCr(PM.cookie, { title: 'Đổi màu chủ đạo', estimateManDays: 3, billable: false });
ok('Quản lý tạo 2 CR', cr1.status === 201 && cr2.status === 201, [cr1, cr2]);
let list = (await crs(Dev1.cookie)).body as any[];
ok('Thành viên xem được; mã CR theo dự án, mới trước', list.length === 2 && list[0].code === `${CODE}-CR2` && list[1].code === `${CODE}-CR1` && list[1].status === 'Draft', list);
ok('Người ngoài xem CR → 404', (await crs(O.cookie)).status === 404);
ok('Sửa CR nháp', (await json(PM.cookie, 'PUT', `/api/projects/change-requests/${cr1.body}`, { title: 'Thêm thanh toán QR + ví', estimateManDays: 5, billable: true })).status === 204);
const move = (c: string, id: string, b: object) => json(c, 'POST', `/api/projects/change-requests/${id}/status`, b);
ok('Thành viên đổi trạng thái → 403', (await move(Dev1.cookie, cr1.body, { status: 'Sent' })).status === 403);
ok('Nháp → Đã gửi khách', (await move(PM.cookie, cr1.body, { status: 'Sent' })).status === 204);
ok('Khách đồng ý ngày tương lai → 400', (await move(PM.cookie, cr1.body, { status: 'Approved', decidedOn: addDays(1) })).status === 400);
ok('Khách đồng ý → 204', (await move(PM.cookie, cr1.body, { status: 'Approved', decidedOn: today, note: 'Email 8/11' })).status === 204);
const pd = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
list = (await crs(PM.cookie)).body;
const c1 = list.find((x) => x.id === cr1.body);
ok('Ngân sách ngày công 40 → 45, CR ghi đã cộng 5', pd.project.budgetManDays === 45 && c1.budgetAddedManDays === 5 && c1.status === 'Approved' && c1.decidedOn === today, [pd.project.budgetManDays, c1]);
ok('CR đã đồng ý: không sửa (409), không huỷ (409)', (await json(PM.cookie, 'PUT', `/api/projects/change-requests/${cr1.body}`, { title: 'x', billable: true })).status === 409
  && (await move(PM.cookie, cr1.body, { status: 'Cancelled' })).status === 409);
const bell = async (c: string) => ((await json(c, 'GET', '/api/notifications?take=20')).body?.items ?? []) as any[];
ok('Kế toán + người phụ trách HĐ nhận chuông lập phụ lục', (await bell(A.cookie)).some((n) => n.category === 'change_request_approved' && n.title.includes(`${CODE}-CR1`))
  && (await bell(PM.cookie)).some((n) => n.category === 'change_request_approved'));
ok('Từ chối CR2 → ngân sách không đổi', (await move(PM.cookie, cr2.body, { status: 'Rejected' })).status === 204
  && (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.project.budgetManDays === 45);

// ---------- Phụ lục hợp đồng ----------
const kd = async (c = PM.cookie) => (await json(c, 'GET', `/api/sales/contracts/${K}`)).body;
let k = await kd();
ok('Hợp đồng: CR1 chờ lập phụ lục (không có CR2)', k.pendingChangeRequests.length === 1 && k.pendingChangeRequests[0].id === cr1.body && k.appendices.length === 0, k.pendingChangeRequests);
const appx = (c: string, b: object) => json(c, 'POST', `/api/sales/contracts/${K}/appendices`, b);
const ap = { code: 'PL01', title: 'Thanh toán QR', signedOn: today, valueBeforeTaxDelta: 20_000_000, changeRequestId: cr1.body,
  installments: [{ title: 'PL01 – trọn gói', dueOn: addDays(20), amount: 22_000_000 }] };
ok('Người ngoài lập phụ lục → 404', (await appx(O.cookie, ap)).status === 404);
ok('Giảm 10tr khi đợt đã lên lịch đủ 110tr → 400', (await appx(PM.cookie, { ...ap, valueBeforeTaxDelta: -10_000_000, installments: [], changeRequestId: null })).status === 400);
ok('Đợt mới vượt phần tăng (22tr) → 400', (await appx(PM.cookie, { ...ap, installments: [{ title: 'x', dueOn: today, amount: 22_000_001 }] })).status === 400);
ok('Gắn CR đã bị từ chối → 400', (await appx(PM.cookie, { ...ap, changeRequestId: cr2.body })).status === 400);
const a1 = await appx(PM.cookie, ap);
ok('Lập phụ lục PL01 +20tr (sau thuế +22tr) từ CR1', a1.status === 201, a1);
k = await kd();
ok('Giá trị hiện tại 132tr, gốc 110tr; đợt mới thuộc phụ lục; hết CR chờ', k.contract.totalValue === 132_000_000 && k.valueBeforeTax === 120_000_000
  && k.originalTotalValue === 110_000_000 && k.installments.some((i: any) => i.appendixId === a1.body && i.amount === 22_000_000) && k.pendingChangeRequests.length === 0
  && k.appendices[0].changeRequestCode === `${CODE}-CR1`, k);
ok('Số phụ lục trùng → 400; dùng lại CR1 → 400', (await appx(PM.cookie, { ...ap, installments: [] })).status === 400
  && (await appx(PM.cookie, { ...ap, code: 'PL02', installments: [] })).status === 400);
ok('Dự án thấy CR1 đã có phụ lục PL01 (không tiền)', ((await crs(PM.cookie)).body as any[]).find((x) => x.id === cr1.body)?.appendix?.code === 'PL01'
  && !('totalDelta' in (((await crs(PM.cookie)).body as any[]).find((x) => x.id === cr1.body)?.appendix ?? {})));
let f = (await json(A.cookie, 'GET', `/api/projects/${P}/financials`)).body;
ok('Lãi / lỗ dự án gồm phụ lục: doanh thu 132tr, VAT 12tr', f.revenue === 132_000_000 && f.vat === 12_000_000, f);
ok('Thêm đợt vượt giá trị mới (đã lên lịch đủ 132tr) → 400', (await json(PM.cookie, 'POST', `/api/sales/contracts/${K}/installments`, { title: 'x', dueOn: today, amount: 1 })).status === 400);

// Huỷ phụ lục
ok('Huỷ phụ lục thiếu lý do → 400', (await json(PM.cookie, 'POST', `/api/sales/appendices/${a1.body}/cancel`, { reason: '' })).status === 400);
ok('Huỷ phụ lục → 204', (await json(PM.cookie, 'POST', `/api/sales/appendices/${a1.body}/cancel`, { reason: 'Khách đổi ý' })).status === 204);
k = await kd();
ok('Sau huỷ: giá trị về 110tr, đợt của phụ lục bị huỷ, CR1 chờ lập lại', k.contract.totalValue === 110_000_000
  && k.installments.find((i: any) => i.appendixId === a1.body)?.state === 'Cancelled' && k.pendingChangeRequests.length === 1 && k.appendices[0].cancelled === true, k);
ok('Huỷ lần hai → 409', (await json(PM.cookie, 'POST', `/api/sales/appendices/${a1.body}/cancel`, { reason: 'x' })).status === 409);

// Giảm giá trị: huỷ đợt gốc trước
const orig = k.installments.find((i: any) => !i.appendixId);
ok('Huỷ đợt gốc rồi lập phụ lục giảm 10tr', (await json(PM.cookie, 'POST', `/api/sales/installments/${orig.id}/cancel`, { reason: 'Chia lại' })).status === 204
  && (await appx(PM.cookie, { code: 'PL02', title: 'Bớt hạng mục', signedOn: today, valueBeforeTaxDelta: -10_000_000, installments: [] })).status === 201);
k = await kd();
ok('Giá trị còn 99tr (90tr + VAT)', k.contract.totalValue === 99_000_000 && k.valueBeforeTax === 90_000_000, k.contract);
f = (await json(A.cookie, 'GET', `/api/projects/${P}/financials`)).body;
ok('Lãi / lỗ: doanh thu 99tr, VAT 9tr', f.revenue === 99_000_000 && f.vat === 9_000_000, f);

// ---------- Dự án đóng + token AI ----------
ok('Đóng dự án → tạo CR 409', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, budgetManDays: 45, status: 'Closed' })).status === 204
  && (await mkCr(PM.cookie, { title: 'x' })).status === 409);
const tok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e cr ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI không gọi được CR → 403', (await fetch(`${API}/api/projects/${P}/change-requests`, { headers: { authorization: `Bearer ${tok}` } })).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
