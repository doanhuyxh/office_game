// E2E: báo giá (module Sales) — quyền (người phụ trách khách / quản lý / người ngoài 404), tính tổng (SL × đơn giá, chiết khấu trước VAT), kiểm tra dữ liệu,
// sửa nháp, chốt trong ngưỡng → Sẵn sàng, đã gửi, phiên bản mới (bản cũ "Đã thay"), chiết khấu vượt ngưỡng → đơn quote_discount [Duyệt chi] → duyệt / từ chối,
// ngưỡng do Quản trị tài chính đặt, xuất Word (mẫu mặc định + mẫu riêng của công ty), khách đồng ý → lập hợp đồng từ báo giá (một lần), huỷ, token AI.
// TẠO DỮ LIỆU THẬT (+ 1 file mẫu Word trên S3 sales/templates/) → CHỈ chạy trên DB tạm.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/sales-quotes-e2e.ts
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
const pDir = await mkPos('QGĐ', 1, VIEW | APPROVE | ADMIN), pPlain = await mkPos('QNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Báo giá ${stamp}`, code: `BG${stamp}` })).body;
const mkEmp = async (key: string, name: string, posId: string, managerId: string | null, roles: string[]) => {
  const user = `e2e.bg.${key}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `Q${key.toUpperCase()}${stamp}`, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp('dir', 'Giám Đốc BG', pDir, null, ['employee']);
const M = await mkEmp('mgr', 'Trưởng KD BG', pPlain, null, ['employee', 'manager']);
const S = await mkEmp('sale', 'Sale BG', pPlain, M.e.id, ['employee']);
const O = await mkEmp('out', 'Người Ngoài BG', pPlain, null, ['employee']);
ok('4 nhân viên đăng nhập', [D, M, S, O].every((x) => !!x.cookie));

const cust = (await json(S.cookie, 'POST', '/api/sales/customers', { name: `Khách BG ${stamp}`, taxCode: `03${Date.now().toString().slice(-8)}`, address: '12 Lê Lợi' })).body;
await json(S.cookie, 'POST', `/api/sales/customers/${cust}/contacts`, { name: 'Nguyễn Liên Hệ', title: 'Giám đốc', isPrimary: true });

// ---------- Cấu hình ----------
const settings = async (c: string) => (await json(c, 'GET', '/api/sales/settings')).body;
ok('Ngưỡng mặc định 15 %; sale không sửa được (403)', (await settings(S.cookie)).quoteDiscountLimitPercent === 15
  && (await json(S.cookie, 'PUT', '/api/sales/settings', { quoteDiscountLimitPercent: 50 })).status === 403);
ok('Quản trị tài chính đổi ngưỡng; ngoài 0–100 → 400', (await json(D.cookie, 'PUT', '/api/sales/settings', { quoteDiscountLimitPercent: 20 })).status === 204
  && (await settings(S.cookie)).quoteDiscountLimitPercent === 20 && (await json(D.cookie, 'PUT', '/api/sales/settings', { quoteDiscountLimitPercent: 101 })).status === 400);
await json(D.cookie, 'PUT', '/api/sales/settings', { quoteDiscountLimitPercent: 15 });

// ---------- Tạo / sửa ----------
const lines = [{ description: 'Thiết kế giao diện', unit: 'màn hình', quantity: 12, unitPrice: 2_500_000 }, { description: 'Lập trình API', unit: 'gói', quantity: 1.5, unitPrice: 40_000_000 }];
const body = { customerId: cust, title: 'App đặt lịch', validUntil: addDays(30), vatRate: 8, discountPercent: 10, lines, terms: 'Thanh toán 2 đợt' };
ok('Không hạng mục → 400; VAT 7 % → 400; người ngoài tạo cho khách → 404', (await json(S.cookie, 'POST', '/api/sales/quotes', { ...body, lines: [] })).status === 400
  && (await json(S.cookie, 'POST', '/api/sales/quotes', { ...body, vatRate: 7 })).status === 400 && (await json(O.cookie, 'POST', '/api/sales/quotes', body)).status === 404);
const c1 = await json(S.cookie, 'POST', '/api/sales/quotes', body);
ok('Sale tạo báo giá nháp', c1.status === 201, c1);
const Q1 = c1.body;
const get = async (c: string, id: string) => json(c, 'GET', `/api/sales/quotes/${id}`);
let d = (await get(S.cookie, Q1)).body;
ok('Tổng: 90tr − CK 10 % = 81tr + VAT 8 % = 87,48tr; mã BG-xxxxx', d.quote.subtotal === 90_000_000 && d.quote.discount === 9_000_000 && d.quote.beforeTax === 81_000_000
  && d.quote.vat === 6_480_000 && d.quote.total === 87_480_000 && /^BG-\d{5}$/.test(d.quote.code) && d.lines.length === 2 && d.needsApproval === false, d.quote);
ok('Quản lý của sale xem được; người ngoài 404', (await get(M.cookie, Q1)).status === 200 && (await get(O.cookie, Q1)).status === 404);
ok('Sửa nháp (thêm hạng mục); đổi khách → 400', (await json(S.cookie, 'PUT', `/api/sales/quotes/${Q1}`, { ...body, lines: [...lines, { description: 'Kiểm thử', unit: null, quantity: 1, unitPrice: 10_000_000 }] })).status === 204
  && (await json(S.cookie, 'PUT', `/api/sales/quotes/${Q1}`, { ...body, customerId: crypto.randomUUID() })).status === 400);
ok('Tổng sau sửa 100tr → 97,2tr', (await get(S.cookie, Q1)).body.quote.total === 97_200_000);

// ---------- Chốt trong ngưỡng → gửi → phiên bản mới ----------
const submit = (c: string, id: string) => json(c, 'POST', `/api/sales/quotes/${id}/submit`, {});
const s1 = await submit(S.cookie, Q1);
ok('Chốt (CK 10 % ≤ 15 %) → Sẵn sàng', s1.status === 200 && s1.body.status === 'Ready', s1);
ok('Đã chốt: không sửa (409)', (await json(S.cookie, 'PUT', `/api/sales/quotes/${Q1}`, body)).status === 409);
ok('Đánh dấu đã gửi khách', (await json(S.cookie, 'POST', `/api/sales/quotes/${Q1}/sent`, {})).status === 204 && (await get(S.cookie, Q1)).body.quote.status === 'Sent');
const docx = await fetch(`${API}/api/sales/quotes/${Q1}/export.docx`, { headers: { cookie: S.cookie } });
const bytes = new Uint8Array(await docx.arrayBuffer());
ok('Tải Word (mẫu mặc định): .docx, tên theo số báo giá', docx.status === 200 && bytes[0] === 0x50 && bytes[1] === 0x4b && (docx.headers.get('content-disposition') ?? '').includes('BG-'),
  [docx.status, docx.headers.get('content-disposition')]);
ok('Người ngoài tải Word → 404', (await fetch(`${API}/api/sales/quotes/${Q1}/export.docx`, { headers: { cookie: O.cookie } })).status === 404);
const rv = await json(S.cookie, 'POST', `/api/sales/quotes/${Q1}/revise`, {});
const Q2 = rv.body;
d = (await get(S.cookie, Q2)).body;
ok('Phiên bản mới v2 (nháp), bản cũ "Đã thay", cùng số', rv.status === 201 && d.quote.version === 2 && d.quote.status === 'Draft' && d.quote.code.endsWith('-v2')
  && d.versions.length === 2 && d.versions[0].status === 'Superseded' && d.lines.length === 3, d);
ok('Tạo phiên bản từ bản đã thay → 409', (await json(S.cookie, 'POST', `/api/sales/quotes/${Q1}/revise`, {})).status === 409);
const list = (await json(S.cookie, 'GET', '/api/sales/quotes?page=1')).body.items as any[];
ok('Danh sách mặc định chỉ bản mới nhất', list.some((x) => x.id === Q2) && !list.some((x) => x.id === Q1));

// ---------- Chiết khấu vượt ngưỡng → duyệt ----------
await json(S.cookie, 'PUT', `/api/sales/quotes/${Q2}`, { ...body, discountPercent: 25 });
ok('CK 25 % → cần duyệt', (await get(S.cookie, Q2)).body.needsApproval === true);
const s2 = await submit(S.cookie, Q2);
d = (await get(S.cookie, Q2)).body;
ok('Chốt → Chờ duyệt, có đơn duyệt', s2.status === 200 && d.quote.status === 'PendingApproval' && !!d.approvalRequestId, d);
ok('Đang chờ duyệt: không đánh dấu gửi (409), không tạo phiên bản (409)', (await json(S.cookie, 'POST', `/api/sales/quotes/${Q2}/sent`, {})).status === 409
  && (await json(S.cookie, 'POST', `/api/sales/quotes/${Q2}/revise`, {})).status === 409);
ok('Quản lý (không quyền Duyệt chi) duyệt → 403', (await json(M.cookie, 'POST', `/api/approval/${d.approvalRequestId}/approve`, {})).status === 403);
ok('Giám đốc từ chối → về Nháp kèm lý do', (await json(D.cookie, 'POST', `/api/approval/${d.approvalRequestId}/reject`, { comment: 'Tối đa 20%' })).status === 200
  && (await get(S.cookie, Q2)).body.quote.status === 'Draft' && (await get(S.cookie, Q2)).body.approvalComment === 'Tối đa 20%');
await json(S.cookie, 'PUT', `/api/sales/quotes/${Q2}`, { ...body, discountPercent: 18 });
const apr = (await submit(S.cookie, Q2), (await get(S.cookie, Q2)).body.approvalRequestId);
ok('Gửi lại 18 % → giám đốc duyệt → Sẵn sàng', (await json(D.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 200
  && (await get(S.cookie, Q2)).body.quote.status === 'Ready');

// ---------- Khách đồng ý → hợp đồng ----------
ok('Khách đồng ý', (await json(S.cookie, 'POST', `/api/sales/quotes/${Q2}/result`, { accepted: true })).status === 204);
d = (await get(S.cookie, Q2)).body;
const k = await json(S.cookie, 'POST', '/api/sales/contracts', { code: `HD-BG-${stamp}`, customerId: cust, title: d.quote.title, valueBeforeTax: d.quote.beforeTax, vatRate: d.quote.vatRate,
  signedOn: today, billing: 'OneTime', installments: [{ title: 'Trọn gói', dueOn: addDays(15), amount: d.quote.total }], quoteId: Q2 });
ok('Lập hợp đồng từ báo giá → báo giá ghi hợp đồng', k.status === 201 && (await get(S.cookie, Q2)).body.quote.contractId === k.body, k);
ok('Lập hợp đồng lần hai từ cùng báo giá → 400', (await json(S.cookie, 'POST', '/api/sales/contracts', { code: `HD-BG2-${stamp}`, customerId: cust, title: 'x', valueBeforeTax: 1, vatRate: 0,
  signedOn: today, billing: 'OneTime', installments: [{ title: 'x', dueOn: today, amount: 1 }], quoteId: Q2 })).status === 400);

// ---------- Mẫu Word riêng ----------
const tpl = new Uint8Array(await (await fetch(`${API}/api/sales/settings/quote-template/default`, { headers: { cookie: S.cookie } })).arrayBuffer());
const up = async (c: string, data: Uint8Array, name: string) => {
  const fd = new FormData(); fd.append('file', new Blob([data]), name);
  return (await fetch(`${API}/api/sales/settings/quote-template`, { method: 'POST', headers: { cookie: c }, body: fd })).status;
};
ok('Sale tải mẫu → 403; file không phải docx → 400', (await up(S.cookie, tpl, 'mau.docx')) === 403 && (await up(D.cookie, new TextEncoder().encode('x'), 'mau.docx')) === 400);
ok('Quản trị tài chính tải mẫu riêng → dùng ngay', (await up(D.cookie, tpl, `mau-cong-ty-${stamp}.docx`)) === 204 && (await settings(S.cookie)).quoteTemplateName === `mau-cong-ty-${stamp}.docx`
  && (await fetch(`${API}/api/sales/quotes/${Q2}/export.docx`, { headers: { cookie: S.cookie } })).status === 200);
ok('Bỏ mẫu riêng → mẫu mặc định', (await json(D.cookie, 'DELETE', '/api/sales/settings/quote-template')).status === 204 && (await settings(S.cookie)).quoteTemplateName === null);
ok('Danh sách trường có HM_NoiDung', ((await json(S.cookie, 'GET', '/api/sales/settings/quote-template/fields')).body as any[]).some((f) => f.name === 'HM_NoiDung'));

// ---------- Huỷ + token AI ----------
const Q3 = (await json(S.cookie, 'POST', '/api/sales/quotes', { ...body, title: 'Bảo trì' })).body;
ok('Huỷ nháp → 204; huỷ lần hai → 409; báo giá đã đồng ý không huỷ (409)', (await json(S.cookie, 'POST', `/api/sales/quotes/${Q3}/cancel`, {})).status === 204
  && (await json(S.cookie, 'POST', `/api/sales/quotes/${Q3}/cancel`, {})).status === 409 && (await json(S.cookie, 'POST', `/api/sales/quotes/${Q2}/cancel`, {})).status === 409);
const tok = (await json(S.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e bg ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI đọc được báo giá (TEST-77), không tạo / xuất Word → 403', (await fetch(`${API}/api/sales/quotes?page=1`, { headers: { authorization: `Bearer ${tok}` } })).status === 200
  && (await fetch(`${API}/api/sales/quotes`, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: '{}' })).status === 403
  && (await fetch(`${API}/api/sales/quotes/${Q2}/export.docx`, { headers: { authorization: `Bearer ${tok}` } })).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
