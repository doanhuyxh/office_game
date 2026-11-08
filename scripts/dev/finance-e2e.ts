// E2E: module Finance — quyền tài chính theo chức vụ (HR không đổi được, admin không tự có quyền xem tiền), quỹ + số dư (thu / chi / chuyển),
// kiểm tra dữ liệu, huỷ giao dịch, khoá sổ, đề nghị chi qua luồng duyệt [quản lý → Duyệt chi], không tự duyệt, chi tiền + chống chi trùng, huỷ chi → duyệt lại.
// TẠO NHÂN VIÊN / DỮ LIỆU TIỀN THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/finance-e2e.ts
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

// ---------- Chức vụ + nhân viên ----------
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin }));
const pDir = await mkPos('GĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('KT', 3, RECORD), pPlain = await mkPos('NV', 7, 0);
ok('Admin tạo chức vụ có quyền tài chính (201)', pDir.status === 201 && pAcc.status === 201 && pPlain.status === 201, [pDir.status, pDir.body]);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Tài chính E2E ${stamp}`, code: `TC${stamp}` })).body;
const mkEmp = async (code: string, name: string, posId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp(`FD${stamp}`, 'Giám Đốc E2E', pDir.body, null, `e2e.fin.dir.${stamp}`, ['employee']);
const A = await mkEmp(`FA${stamp}`, 'Kế Toán E2E', pAcc.body, null, `e2e.fin.acc.${stamp}`, ['employee']);
const M = await mkEmp(`FM${stamp}`, 'Quản Lý E2E', pPlain.body, null, `e2e.fin.mgr.${stamp}`, ['employee', 'manager']);
const S = await mkEmp(`FS${stamp}`, 'Nhân Viên E2E', pPlain.body, M.e.id, `e2e.fin.staff.${stamp}`, ['employee']);
const H = await mkEmp(`FH${stamp}`, 'Nhân Sự E2E', pPlain.body, null, `e2e.fin.hr.${stamp}`, ['employee', 'hr']);
ok('5 nhân viên đăng nhập', [D, A, M, S, H].every((x) => !!x.cookie));

// ---------- Quyền theo chức vụ ----------
const me = async (c: { cookie: string }) => (await json(c.cookie, 'GET', '/api/org/positions/my-finance')).body;
const mD = await me(D), mA = await me(A), mS = await me(S);
ok('Giám đốc: Xem + Duyệt + Quản trị (Quản trị kéo theo Xem)', mD.permissions === (VIEW | APPROVE | ADMIN) && mD.canManage === true, mD);
ok('Kế toán chỉ bật Ghi sổ → tự có thêm Xem (3)', mA.permissions === (VIEW | RECORD) && mA.canManage === false, mA);
ok('Nhân viên thường: không quyền', mS.permissions === 0 && mS.canManage === false, mS);
const posList = (await json(admin, 'GET', '/api/org/positions')).body as any[];
ok('Danh sách chức vụ trả financePermissions + departmentCount', posList.find((p) => p.id === pAcc.body)?.financePermissions === 3 && posList.find((p) => p.id === pAcc.body)?.departmentCount === 1);
const putPos = (c: string, id: string, name: string, level: number, fin?: number) => json(c, 'PUT', `/api/org/positions/${id}`, { name, level, sortOrder: 0, selfPublishDocuments: false, ...(fin === undefined ? {} : { financePermissions: fin }) });
ok('HR đổi quyền tài chính của chức vụ → 403', (await putPos(H.cookie, pPlain.body, `NV ${stamp}`, 7, VIEW)).status === 403);
ok('HR đổi tên chức vụ (không gửi quyền) → 204, quyền giữ nguyên', (await putPos(H.cookie, pAcc.body, `KT ${stamp}`, 3)).status === 204
  && ((await json(admin, 'GET', '/api/org/positions')).body as any[]).find((p) => p.id === pAcc.body).financePermissions === 3);
ok('HR gửi lại đúng quyền cũ → 204 (không coi là đổi)', (await putPos(H.cookie, pAcc.body, `KT ${stamp}`, 3, 3)).status === 204);
ok('HR tạo chức vụ KHÔNG kèm quyền → 201', (await json(H.cookie, 'POST', '/api/org/positions', { name: `HR tạo ${stamp}`, level: 7 })).status === 201);
ok('HR tạo chức vụ CÓ quyền → 403', (await json(H.cookie, 'POST', '/api/org/positions', { name: `HR tạo2 ${stamp}`, level: 7, financePermissions: VIEW })).status === 403);
ok('Bit quyền không hợp lệ → 400', (await putPos(admin, pPlain.body, `NV ${stamp}`, 7, 16)).status === 400);

// ---------- Phân quyền endpoint ----------
ok('Admin (vai trò) KHÔNG tự xem được tiền → 403', (await json(admin, 'GET', '/api/finance/overview')).status === 403);
ok('HR không xem được tiền → 403', (await json(H.cookie, 'GET', '/api/finance/overview')).status === 403);
ok('Nhân viên không xem tổng quan / quỹ / sổ → 403', [(await json(S.cookie, 'GET', '/api/finance/overview')).status, (await json(S.cookie, 'GET', '/api/finance/accounts')).status,
  (await json(S.cookie, 'GET', '/api/finance/entries?page=1')).status].every((x) => x === 403));
ok('Nhân viên đọc được mảng + danh mục (form đề nghị chi)', (await json(S.cookie, 'GET', '/api/finance/lines')).status === 200 && (await json(S.cookie, 'GET', '/api/finance/categories')).status === 200);
const lines = (await json(S.cookie, 'GET', '/api/finance/lines')).body as any[];
const cats = (await json(S.cookie, 'GET', '/api/finance/categories')).body as any[];
ok('Seed 4 mảng (Chung, Outsource, Affiliate, Kênh MXH)', ['CHUNG', 'OUTSOURCE', 'AFFILIATE', 'KENH-MXH'].every((c) => lines.some((l) => l.code === c)), lines);
const catIn = cats.find((c) => c.kind === 'Income').id, catEx = cats.find((c) => c.kind === 'Expense').id;
ok('Kế toán (chỉ Ghi sổ) không tạo được quỹ → 403', (await json(A.cookie, 'POST', '/api/finance/accounts', { name: 'x', kind: 'Cash', openingBalance: 0, openingDate: '2026-01-01' })).status === 403);

// ---------- Quỹ ----------
const mkAcc = (name: string, kind: string, opening: number, last4?: string) => json(D.cookie, 'POST', '/api/finance/accounts', { name: `${name} ${stamp}`, kind, bankName: kind === 'Bank' ? 'VCB' : null, last4: last4 ?? null, openingBalance: opening, openingDate: '2026-01-01' });
ok('Số 4 cuối sai → 400', (await mkAcc('Lỗi', 'Bank', 0, '12')).status === 400);
const cash = await mkAcc('Tiền mặt', 'Cash', 10_000_000), bank = await mkAcc('VCB', 'Bank', 0, '1234');
ok('Giám đốc (Quản trị) tạo 2 quỹ', cash.status === 201 && bank.status === 201, [cash.status, cash.body]);
ok('Trùng tên quỹ → 400', (await mkAcc('Tiền mặt', 'Cash', 0)).status === 400);
const cashId = cash.body, bankId = bank.body;
const bal = async (id: string) => ((await json(D.cookie, 'GET', '/api/finance/accounts')).body as any[]).find((a) => a.id === id)?.balance;
ok('Số dư ban đầu = số dư đầu kỳ', (await bal(cashId)) === 10_000_000 && (await bal(bankId)) === 0);

// ---------- Giao dịch ----------
const ent = (c: string, b: object) => json(c, 'POST', '/api/finance/entries', b);
ok('Giám đốc (không có Ghi sổ) không ghi được → 403', (await ent(D.cookie, { kind: 'Income', date: today, amount: 1, accountId: cashId })).status === 403);
ok('Nhân viên không ghi được → 403', (await ent(S.cookie, { kind: 'Income', date: today, amount: 1, accountId: cashId })).status === 403);
const inc = await ent(A.cookie, { kind: 'Income', date: today, amount: 5_000_000, accountId: bankId, categoryId: catIn, businessLineId: lines.find((l) => l.code === 'OUTSOURCE').id, counterparty: 'Khách A', description: `Thu đợt 1 ${stamp}` });
const exp = await ent(A.cookie, { kind: 'Expense', date: today, amount: 1_000_000, accountId: cashId, categoryId: catEx, businessLineId: lines.find((l) => l.code === 'CHUNG').id });
const trf = await ent(A.cookie, { kind: 'Transfer', date: today, amount: 2_000_000, accountId: cashId, toAccountId: bankId });
ok('Kế toán ghi thu / chi / chuyển quỹ (201)', [inc.status, exp.status, trf.status].every((x) => x === 201), [inc, exp, trf]);
ok('Số dư: tiền mặt 10M − 1M − 2M = 7M; ngân hàng 5M + 2M = 7M', (await bal(cashId)) === 7_000_000 && (await bal(bankId)) === 7_000_000);
const bad = async (b: object, field: string, label: string) => { const r = await ent(A.cookie, b); ok(label, r.status === 400 && !!r.body?.errors?.[field], r); };
await bad({ kind: 'Expense', date: today, amount: 0, accountId: cashId }, 'amount', 'Số tiền 0 → 400');
await bad({ kind: 'Expense', date: today, amount: 1e15, accountId: cashId }, 'amount', 'Số tiền quá lớn → 400');
await bad({ kind: 'Expense', date: addDays(1), amount: 1, accountId: cashId }, 'date', 'Ngày tương lai → 400');
await bad({ kind: 'Expense', date: '2025-12-31', amount: 1, accountId: cashId }, 'date', 'Ngày trước ngày đầu kỳ của quỹ → 400');
await bad({ kind: 'Transfer', date: today, amount: 1, accountId: cashId, toAccountId: cashId }, 'toAccountId', 'Chuyển quỹ cùng quỹ → 400');
await bad({ kind: 'Income', date: today, amount: 1, accountId: cashId, toAccountId: bankId }, 'toAccountId', 'Thu mà có quỹ nhận → 400');
await bad({ kind: 'Income', date: today, amount: 1, accountId: cashId, categoryId: catEx }, 'categoryId', 'Danh mục chi cho giao dịch thu → 400');
await bad({ kind: 'Income', date: today, amount: 1, accountId: crypto.randomUUID() }, 'accountId', 'Quỹ không tồn tại → 400');
const ov = (await json(D.cookie, 'GET', '/api/finance/overview')).body;
// DB tạm dùng lại giữa các lần chạy → chỉ so quỹ của lần này; tổng = tổng các quỹ đang dùng.
const mine2 = (ov.accounts as any[]).filter((a) => a.id === cashId || a.id === bankId);
ok('Tổng quan: 2 quỹ của lần chạy này = 14M; tổng số dư = tổng quỹ đang dùng; thu / chi tháng; theo mảng (chuyển quỹ không tính)',
  mine2.reduce((t, a) => t + a.balance, 0) === 14_000_000 && ov.totalBalance === (ov.accounts as any[]).filter((a) => a.isActive).reduce((t, a) => t + a.balance, 0)
  && ov.monthIncome >= 5_000_000 && ov.monthExpense >= 1_000_000 && ov.byLine.some((l: any) => l.name.includes('Outsource') && l.income >= 5_000_000), ov);
const list = (await json(A.cookie, 'GET', '/api/finance/entries?page=1&pageSize=50')).body;
ok('Danh sách sổ: có tên quỹ / danh mục / mảng, phân trang', list.items.length >= 3 && list.items.some((e: any) => e.accountName.includes('VCB') && e.categoryName && e.businessLineName), list.items?.[0]);
ok('Lọc theo loại + tìm kiếm', (await json(A.cookie, 'GET', `/api/finance/entries?page=1&kind=Income&search=${encodeURIComponent(`đợt 1 ${stamp}`)}`)).body.items.length === 1
  && (await json(A.cookie, 'GET', `/api/finance/entries?page=1&kind=Expense&search=${encodeURIComponent(`đợt 1 ${stamp}`)}`)).body.items.length === 0);

// ---------- Huỷ + khoá sổ ----------
const expId = exp.body;
ok('Huỷ không có lý do → 400', (await json(A.cookie, 'POST', `/api/finance/entries/${expId}/void`, { reason: ' ' })).status === 400);
ok('Huỷ giao dịch chi → số dư tiền mặt hoàn lại', (await json(A.cookie, 'POST', `/api/finance/entries/${expId}/void`, { reason: 'Ghi nhầm' })).status === 204 && (await bal(cashId)) === 8_000_000);
ok('Huỷ lần hai → 409', (await json(A.cookie, 'POST', `/api/finance/entries/${expId}/void`, { reason: 'x' })).status === 409);
ok('Giao dịch đã huỷ ẩn khỏi sổ, hiện khi lọc "đã huỷ"', !(await json(A.cookie, 'GET', '/api/finance/entries?page=1&pageSize=50')).body.items.some((e: any) => e.id === expId)
  && (await json(A.cookie, 'GET', '/api/finance/entries?page=1&voided=true')).body.items.some((e: any) => e.id === expId));
const lockTo = addDays(-1);
ok('Kế toán không đặt khoá sổ được → 403', (await json(A.cookie, 'PUT', '/api/finance/lock', { lockedThrough: lockTo })).status === 403);
ok('Không khoá sổ đến ngày tương lai → 400', (await json(D.cookie, 'PUT', '/api/finance/lock', { lockedThrough: addDays(3) })).status === 400);
const old = await ent(A.cookie, { kind: 'Expense', date: addDays(-2), amount: 100_000, accountId: cashId });
ok('Ghi giao dịch 2 ngày trước (chưa khoá) → 201', old.status === 201, old);
ok('Giám đốc khoá sổ đến hôm qua', (await json(D.cookie, 'PUT', '/api/finance/lock', { lockedThrough: lockTo })).status === 204);
await bad({ kind: 'Expense', date: addDays(-2), amount: 1, accountId: cashId }, 'date', 'Ghi vào kỳ đã khoá → 400');
ok('Huỷ giao dịch trong kỳ đã khoá → 409', (await json(A.cookie, 'POST', `/api/finance/entries/${old.body}/void`, { reason: 'x' })).status === 409);
ok('Hôm nay (sau ngày khoá) vẫn ghi được', (await ent(A.cookie, { kind: 'Expense', date: today, amount: 50_000, accountId: cashId })).status === 201);
ok('Mở khoá sổ', (await json(D.cookie, 'PUT', '/api/finance/lock', { lockedThrough: null })).status === 204 && (await json(D.cookie, 'GET', '/api/finance/lock')).body.lockedThrough === null);
ok('Không sửa số dư đầu kỳ khi quỹ đã có giao dịch → 409', (await json(D.cookie, 'PUT', `/api/finance/accounts/${cashId}`, { name: `Tiền mặt ${stamp}`, kind: 'Cash', openingBalance: 99, openingDate: '2026-01-01' })).status === 409);

// ---------- Đề nghị chi ----------
const mkExp = (c: string, amount = 3_000_000, extra: object = {}) => json(c, 'POST', '/api/finance/expenses', { amount, reason: 'Mua thiết bị', payee: 'Cty X', categoryId: catEx, ...extra });
const myExp = async (c: string) => (await json(c, 'GET', '/api/finance/expenses?page=1&pageSize=50')).body.items as any[];
ok('Thiếu lý do / số tiền 0 → 400', (await json(S.cookie, 'POST', '/api/finance/expenses', { amount: 0, reason: '' })).status === 400);
ok('Danh mục thu cho đề nghị chi → 400', (await mkExp(S.cookie, 1000, { categoryId: catIn })).status === 400);
ok('Tài khoản không có hồ sơ (admin seed) không gửi được → 403', (await mkExp(admin)).status === 403);
const e1 = await mkExp(S.cookie);
ok('Nhân viên gửi đề nghị chi (201)', e1.status === 201, e1);
let mine = await myExp(S.cookie);
const r1 = mine.find((x) => x.id === e1.body);
ok('Đề nghị: mã CP-xxxxx, Chờ duyệt, có mã đơn duyệt', /^CP-\d{5}$/.test(r1?.code) && r1.status === 'Pending' && !!r1.approvalRequestId, r1);
ok('Nhân viên không xem được toàn bộ (scope=all) → 403', (await json(S.cookie, 'GET', '/api/finance/expenses?scope=all&page=1')).status === 403);
ok('Kế toán xem được toàn bộ', (await json(A.cookie, 'GET', '/api/finance/expenses?scope=all&page=1')).body.items.some((x: any) => x.id === e1.body));
ok('Đề nghị chưa duyệt không chi được → 409', (await json(A.cookie, 'POST', `/api/finance/expenses/${e1.body}/pay`, { accountId: cashId, date: today })).status === 409);
const apr = r1.approvalRequestId;
const inboxOf = async (c: string) => (await json(c, 'GET', '/api/approval/inbox')).body as any[];
ok('Bước 1: quản lý thấy đơn; giám đốc CHƯA thấy', (await inboxOf(M.cookie)).some((x) => x.id === apr) && !(await inboxOf(D.cookie)).some((x) => x.id === apr));
ok('Bước tài chính hiện đúng nhãn', ((await json(S.cookie, 'GET', `/api/approval/${apr}`)).body.steps as any[]).some((s) => s.kind === 'Finance' && s.approverName === 'Tài chính'));
ok('Giám đốc duyệt khi chưa tới bước → 403', (await json(D.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 403);
ok('Quản lý duyệt bước 1 → 200', (await json(M.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 200);
ok('Bước 2: giám đốc (Duyệt chi) thấy đơn', (await inboxOf(D.cookie)).some((x) => x.id === apr));
ok('Kế toán chỉ Ghi sổ KHÔNG duyệt được → 403', (await json(A.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 403);
ok('Admin / HR (vai trò) không duyệt được tiền → 403', (await json(admin, 'POST', `/api/approval/${apr}/approve`, {})).status === 403 && (await json(H.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 403);
ok('Người gửi không tự duyệt → 403', (await json(S.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 403);
ok('Giám đốc duyệt → 200; đề nghị thành Đã duyệt', (await json(D.cookie, 'POST', `/api/approval/${apr}/approve`, {})).status === 200 && (await myExp(S.cookie)).find((x) => x.id === e1.body).status === 'Approved');
const notesA = (await json(A.cookie, 'GET', '/api/notifications?take=50')).body?.items ?? [];
ok('Kế toán nhận chuông "chờ chi"', notesA.some((n: any) => n.category === 'expense_ready' && n.title.includes(r1.code)), notesA.slice(0, 2));
const pay = (c: string, b: object) => json(c, 'POST', `/api/finance/expenses/${e1.body}/pay`, b);
ok('Nhân viên / giám đốc (không Ghi sổ) không chi được → 403', (await pay(S.cookie, { accountId: cashId, date: today })).status === 403 && (await pay(D.cookie, { accountId: cashId, date: today })).status === 403);
const before = await bal(cashId);
ok('Chi tiền ngày tương lai → 400', (await pay(A.cookie, { accountId: cashId, date: addDays(1) })).status === 400);
ok('Kế toán chi → 204; trừ quỹ 3M; đề nghị Đã chi', (await pay(A.cookie, { accountId: cashId, date: today, invoiceNumber: 'HD-001' })).status === 204 && (await bal(cashId)) === before - 3_000_000
  && (await myExp(S.cookie)).find((x) => x.id === e1.body).status === 'Paid');
ok('Chi lần hai (chống chi trùng) → 409, quỹ không trừ thêm', (await pay(A.cookie, { accountId: cashId, date: today })).status === 409 && (await bal(cashId)) === before - 3_000_000);
const paidEntry = (await myExp(S.cookie)).find((x) => x.id === e1.body).paidEntryId;
ok('Dòng sổ gắn nguồn đề nghị + số hoá đơn', ((await json(A.cookie, 'GET', '/api/finance/entries?page=1&pageSize=50&search=HD-001')).body.items as any[]).some((e: any) => e.id === paidEntry && e.sourceType === 'expense_request' && e.invoiceNumber === 'HD-001'));
ok('Nhân viên nhận chuông "đã chi"', ((await json(S.cookie, 'GET', '/api/notifications?take=50')).body?.items ?? []).some((n: any) => n.category === 'expense_paid'));
ok('Huỷ giao dịch chi → đề nghị trở lại Đã duyệt, hoàn tiền quỹ', (await json(A.cookie, 'POST', `/api/finance/entries/${paidEntry}/void`, { reason: 'Chi nhầm quỹ' })).status === 204
  && (await myExp(S.cookie)).find((x) => x.id === e1.body).status === 'Approved' && (await bal(cashId)) === before);
ok('Chi lại sau khi huỷ → 204', (await pay(A.cookie, { accountId: bankId, date: today })).status === 204 && (await myExp(S.cookie)).find((x) => x.id === e1.body).status === 'Paid');

// Từ chối + huỷ
const e2 = await mkExp(S.cookie, 700_000);
const apr2 = (await myExp(S.cookie)).find((x) => x.id === e2.body).approvalRequestId;
await json(M.cookie, 'POST', `/api/approval/${apr2}/approve`, {});
ok('Từ chối phải có lý do → 400', (await json(D.cookie, 'POST', `/api/approval/${apr2}/reject`, {})).status === 400);
ok('Giám đốc từ chối → Rejected + lý do', (await json(D.cookie, 'POST', `/api/approval/${apr2}/reject`, { comment: 'Vượt ngân sách' })).status === 200
  && (await myExp(S.cookie)).find((x) => x.id === e2.body).rejectReason === 'Vượt ngân sách');
const e3 = await mkExp(S.cookie, 500_000);
const apr3 = (await myExp(S.cookie)).find((x) => x.id === e3.body).approvalRequestId;
ok('Người gửi huỷ đơn → Cancelled', (await json(S.cookie, 'POST', `/api/approval/${apr3}/cancel`, {})).status === 200 && (await myExp(S.cookie)).find((x) => x.id === e3.body).status === 'Cancelled');
// Không tự duyệt khoản chi của chính mình (kế toán có thể vừa Ghi sổ vừa Duyệt chi ở cấu hình thật)
const e4 = await mkExp(D.cookie, 400_000);
const apr4 = (await myExp(D.cookie)).find((x) => x.id === e4.body).approvalRequestId;
ok('Giám đốc không tự duyệt đề nghị của chính mình → 403', (await json(D.cookie, 'POST', `/api/approval/${apr4}/approve`, {})).status === 403);

// ---------- Token AI: không mở tiền cho AI ----------
const e5 = await mkExp(S.cookie, 600_000);
const apr5 = (await myExp(S.cookie)).find((x) => x.id === e5.body).approvalRequestId;
await json(M.cookie, 'POST', `/api/approval/${apr5}/approve`, {});
const tok = (await json(D.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e ${stamp}`, expiresInDays: 30 })).body?.token as string;
const ai = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
ok('Tạo token AI cho giám đốc', !!tok?.startsWith('ohk_'));
ok('Token AI không gọi được /api/finance (ngoài allowlist) → 403', (await ai('GET', '/api/finance/overview')).status === 403 && (await ai('GET', '/api/finance/expenses?page=1')).status === 403);
ok('Hộp duyệt qua AI KHÔNG thấy đề nghị chi (web thì thấy)', !((await ai('GET', '/api/approval/inbox')).body as any[]).some((x) => x.id === apr5) && (await inboxOf(D.cookie)).some((x) => x.id === apr5));
ok('AI xem chi tiết đề nghị chi → 404', (await ai('GET', `/api/approval/${apr5}`)).status === 404);
ok('AI duyệt / từ chối đề nghị chi → 403; đơn vẫn chờ', (await ai('POST', `/api/approval/${apr5}/approve`, {})).status === 403 && (await ai('POST', `/api/approval/${apr5}/reject`, { comment: 'x' })).status === 403
  && (await myExp(S.cookie)).find((x) => x.id === e5.body).status === 'Pending');
const tokS = (await json(S.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e s ${stamp}`, expiresInDays: 30 })).body?.token as string;
const aiS = (method: string, path: string) => fetch(API + path, { method, headers: { authorization: `Bearer ${tokS}` } });
ok('AI của người gửi: "đơn của tôi" ẩn đề nghị chi, không huỷ được → 403', !((await (await aiS('GET', '/api/approval/mine')).json()) as any[]).some((x) => x.id === apr5)
  && (await aiS('POST', `/api/approval/${apr5}/cancel`)).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
