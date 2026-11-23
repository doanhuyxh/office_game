// E2E TEST-220: Tổng quan giám đốc 1/3 — GET /api/finance/dashboard (thu / chi / lãi theo tháng × mảng, không tính chuyển quỹ / dòng huỷ,
// công nợ quá hạn + tuổi nợ khớp /api/sales/receivables, pipeline khớp /api/sales/opportunities) + GET /api/projects/financials/alerts
// (dự án đang chạy lỗ / vượt / sắp vượt ngân sách ngày công; dự án đã đóng không ra) + quyền (Xem tài chính 200; HR, admin seed, quản lý dự án,
// nhân viên thường 403; token AI kể cả của người có Xem → 403). So sánh theo phần chênh trước / sau khi seed → chạy lại được trên cùng DB.
// TEST-221: GET /api/finance/forecast (dự báo dòng tiền 13 tuần: đợt thu, công nợ quá hạn, cơ hội × xác suất, lương, gia hạn dịch vụ, đề nghị chi,
// khoản định kỳ) + PUT /forecast/settings + /recurring — kiểm theo id từng khoản nên cũng chạy lại được.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3). Dựng như project-wiki-e2e.ts:
//   docker run -d --name e2e220-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15476:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5196
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15476;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e220-admin@officehub-e2e.vn Seed__AdminPassword=E2e220-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5196 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/finance-dashboard-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5196';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
type Res = { status: number; body: any };
const json = async (cookie: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const bearer = async (token: string, method: string, path: string, body?: unknown): Promise<Res> => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

const PW = 'E2e-Local-2026';
const VIEW = 1, RECORD = 2, APPROVE = 4, ADMIN = 8;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);
/** Ngày đầu tháng cách tháng này k tháng (k > 0 = về trước). */
const monthStart = (k: number) => { const [y, m] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 10); };
const day = (k: number, dd: number) => monthStart(k).slice(0, 8) + String(dd).padStart(2, '0');

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('TGĐ', 1, VIEW | RECORD | APPROVE | ADMIN), pView = await mkPos('TXem', 3, VIEW), pAcc = await mkPos('TKT', 4, RECORD), pPlain = await mkPos('TNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Tổng quan ${stamp}`, code: `TQ${stamp}` })).body;
const mkEmp = async (key: string, posId: string, roles: string[], managerId: string | null = null) => {
  const user = `e2e.dash.${key}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `T${key.toUpperCase()}${stamp}`, fullName: `TQ ${key} ${stamp}`, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2025-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp('dir', pDir, ['employee']);
const V = await mkEmp('view', pView, ['employee']);
const A = await mkEmp('acc', pAcc, ['employee']);
const PM = await mkEmp('pm', pPlain, ['employee', 'manager']);
const H = await mkEmp('hr', pPlain, ['employee', 'hr']);
const E = await mkEmp('emp', pPlain, ['employee'], PM.e.id);
const DevO = await mkEmp('devo', pPlain, ['employee'], PM.e.id), DevN = await mkEmp('devn', pPlain, ['employee'], PM.e.id), DevS = await mkEmp('devs', pPlain, ['employee'], PM.e.id);
ok('9 nhân viên đăng nhập', [D, V, A, PM, H, E, DevO, DevN, DevS].every((x) => !!x.cookie));

const dash = (c: string, q = '') => json(c, 'GET', `/api/finance/dashboard${q}`);
const alerts = (c: string) => json(c, 'GET', '/api/projects/financials/alerts');

// ---------- Quyền ----------
for (const [name, c] of [['HR', H.cookie], ['admin seed', admin], ['quản lý dự án', PM.cookie], ['nhân viên thường', E.cookie]] as const) {
  ok(`${name}: /finance/dashboard → 403, /projects/financials/alerts → 403`, (await dash(c)).status === 403 && (await alerts(c)).status === 403);
}
const b0 = await dash(V.cookie);
ok('Người có Xem tài chính: dashboard 200 (mặc định 12 tháng)', b0.status === 200 && b0.body.months === 12 && b0.body.monthly.length === 12, b0);
ok('Tháng đầu = 11 tháng trước, tháng cuối = tháng này, today theo giờ VN', b0.body.from === monthStart(11) && b0.body.monthly[0].month === monthStart(11)
  && b0.body.monthly[11].month === monthStart(0) && b0.body.today === today, b0.body);
ok('months=0 / 25 / abc → 400; months=1 → 1 dòng', (await dash(V.cookie, '?months=0')).status === 400 && (await dash(V.cookie, '?months=25')).status === 400
  && (await dash(V.cookie, '?months=abc')).status === 400 && (await dash(V.cookie, '?months=1')).body.monthly.length === 1);
ok('Ghi sổ không có Xem: dashboard cùng mã với /overview', (await dash(A.cookie)).status === (await json(A.cookie, 'GET', '/api/finance/overview')).status);
const a0 = await alerts(V.cookie);
ok('Người có Xem tài chính: alerts 200', a0.status === 200 && Array.isArray(a0.body), a0);
const tokV = (await json(V.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e dash ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI của người có Xem: 2 route mới → 403; /finance/overview vẫn 200', !!tokV && (await bearer(tokV, 'GET', '/api/finance/dashboard')).status === 403
  && (await bearer(tokV, 'GET', '/api/projects/financials/alerts')).status === 403 && (await bearer(tokV, 'GET', '/api/finance/overview')).status === 200);
const b24 = (await dash(V.cookie, '?months=24')).body;

// ---------- Seed sổ thu chi ----------
const mkLine = (name: string) => json(D.cookie, 'POST', '/api/finance/lines', { code: `${name}${stamp}`.slice(0, 20), name: `${name} ${stamp}` });
const l1 = await mkLine('Web'), l2 = await mkLine('MXH');
ok('Tạo 2 mảng', [200, 201].includes(l1.status) && [200, 201].includes(l2.status), [l1, l2]);
const L1 = l1.body, L2 = l2.body;
const mkAcc = async (name: string) => (await json(D.cookie, 'POST', '/api/finance/accounts', { name: `${name} ${stamp}`, kind: 'Cash', bankName: null, last4: null,
  openingBalance: 500_000_000, openingDate: '2025-01-01' })).body;
const cash = await mkAcc('Quỹ TQ'), cash2 = await mkAcc('Quỹ TQ 2');
const entry = (b: object) => json(A.cookie, 'POST', '/api/finance/entries', { accountId: cash, ...b });
const seeded = [
  await entry({ kind: 'Income', amount: 10_000_000, date: day(2, 10), businessLineId: L1 }),
  await entry({ kind: 'Expense', amount: 4_000_000, date: day(2, 12), businessLineId: L2 }),
  await entry({ kind: 'Income', amount: 7_000_000, date: day(1, 5) }),
  await entry({ kind: 'Transfer', amount: 50_000_000, date: day(1, 6), toAccountId: cash2 }),
  await entry({ kind: 'Expense', amount: 2_000_000, date: today, businessLineId: L1 }),
  await entry({ kind: 'Income', amount: 99_000_000, date: day(13, 15), businessLineId: L1 }),
];
const voided = await entry({ kind: 'Income', amount: 3_000_000, date: today, businessLineId: L1 });
ok('Ghi 7 dòng sổ (gồm chuyển quỹ, dòng 13 tháng trước)', [...seeded, voided].every((x) => x.status === 201), [...seeded, voided].map((x) => [x.status, x.body]));
ok('Huỷ 1 dòng thu 3tr', (await json(A.cookie, 'POST', `/api/finance/entries/${voided.body}/void`, { reason: 'nhập nhầm' })).status === 204);

const b1 = (await dash(V.cookie)).body;
const dm = (k: number) => ({ inc: b1.monthly[11 - k].income - b0.body.monthly[11 - k].income, exp: b1.monthly[11 - k].expense - b0.body.monthly[11 - k].expense,
  profit: b1.monthly[11 - k].profit - b0.body.monthly[11 - k].profit });
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
ok('Tháng −2: thu +10tr, chi +4tr, lãi +6tr', same(dm(2), { inc: 10_000_000, exp: 4_000_000, profit: 6_000_000 }), dm(2));
ok('Tháng −1: thu +7tr, chuyển quỹ 50tr không tính', same(dm(1), { inc: 7_000_000, exp: 0, profit: 7_000_000 }), dm(1));
ok('Tháng này: chi +2tr, dòng đã huỷ 3tr không tính', same(dm(0), { inc: 0, exp: 2_000_000, profit: -2_000_000 }), dm(0));
ok('Dòng 13 tháng trước ngoài 12 tháng: tổng thu +17tr, chi +6tr', b1.totals.income - b0.body.totals.income === 17_000_000
  && b1.totals.expense - b0.body.totals.expense === 6_000_000 && b1.totals.profit === b1.totals.income - b1.totals.expense, b1.totals);
ok('Mỗi tháng lãi = thu − chi; tổng = cộng các tháng', b1.monthly.every((m: any) => m.profit === m.income - m.expense)
  && b1.totals.income === b1.monthly.reduce((t: number, m: any) => t + m.income, 0) && b1.totals.expense === b1.monthly.reduce((t: number, m: any) => t + m.expense, 0));
const ln = (rows: any[], id: string | null) => rows.find((x) => x.businessLineId === id);
ok('Theo mảng (tổng): Web thu 10tr chi 2tr, MXH chi 4tr, có tên mảng', ln(b1.totals.byLine, L1)?.income === 10_000_000 && ln(b1.totals.byLine, L1)?.expense === 2_000_000
  && ln(b1.totals.byLine, L2)?.expense === 4_000_000 && ln(b1.totals.byLine, L1)?.name === `Web ${stamp}`, b1.totals.byLine);
ok('Theo mảng trong tháng −2: Web + MXH', ln(b1.monthly[9].byLine, L1)?.income === 10_000_000 && ln(b1.monthly[9].byLine, L2)?.expense === 4_000_000, b1.monthly[9]);
ok('Thu không gắn mảng → "Chưa gắn mảng"', ln(b1.monthly[10].byLine, null)?.name === 'Chưa gắn mảng'
  && ln(b1.monthly[10].byLine, null).income - (ln(b0.body.monthly[10].byLine, null)?.income ?? 0) === 7_000_000, b1.monthly[10]);
const b24b = (await dash(V.cookie, '?months=24')).body;
ok('months=24: 24 dòng, dòng 13 tháng trước được tính (+99tr)', b24b.monthly.length === 24
  && b24b.monthly[23 - 13].income - b24.monthly[23 - 13].income === 99_000_000 && b24b.totals.income - b24.totals.income === 116_000_000, b24b.monthly[10]);
const ov = (await json(V.cookie, 'GET', '/api/finance/overview')).body;
ok('/finance/overview giữ nguyên DTO', ov && 'monthIncome' in ov && 'byLine' in ov && !('monthly' in ov), ov);

// ---------- Công nợ + pipeline ----------
const cust = (await json(PM.cookie, 'POST', '/api/sales/customers', { name: `Khách TQ ${stamp}` })).body;
const k = await json(PM.cookie, 'POST', '/api/sales/contracts', { code: `HD-TQ-${stamp}`, customerId: cust, title: 'HĐ tổng quan', valueBeforeTax: 20_000_000, vatRate: 0,
  signedOn: addDays(-100), billing: 'Milestone', installments: [
    { title: 'Đợt >90', dueOn: addDays(-95), amount: 10_000_000 }, { title: 'Đợt 31-60', dueOn: addDays(-40), amount: 5_000_000 },
    { title: 'Đợt 1-30', dueOn: addDays(-5), amount: 3_000_000 }, { title: 'Đợt sau', dueOn: addDays(60), amount: 2_000_000 }] });
ok('Hợp đồng bán 4 đợt (3 quá hạn)', k.status === 201, k);
const kd = (await json(A.cookie, 'GET', `/api/sales/contracts/${k.body}`)).body;
const i130 = kd?.installments?.find((i: any) => i.title === 'Đợt 1-30');
ok('Kế toán thu 1tr đợt 1-30', !!i130 && (await json(A.cookie, 'POST', `/api/sales/installments/${i130.id}/collect`, { amount: 1_000_000, date: today, accountId: cash })).status === 201);
const r1 = (await json(V.cookie, 'GET', '/api/sales/receivables')).body;
const rv = (await dash(V.cookie)).body.receivables;
const rv0 = b0.body.receivables;
ok('Công nợ khớp /sales/receivables: còn phải thu, quá hạn, sắp đến hạn', rv.outstanding === r1.outstanding && rv.overdue === r1.overdue && rv.dueSoon === r1.dueSoon,
  { rv, r1: { ...r1, items: undefined } });
ok('Tuổi nợ khớp từng nhóm, đủ 4 nhóm theo thứ tự', same(rv.aging.map((x: any) => x.bucket), ['1-30', '31-60', '61-90', '>90'])
  && rv.aging.every((x: any) => x.amount === r1.buckets[x.bucket]), { aging: rv.aging, buckets: r1.buckets });
ok('Số đợt quá hạn = số dòng Overdue', rv.overdueCount === r1.items.filter((x: any) => x.state === 'Overdue').length, rv);
ok('Phần của hợp đồng này: quá hạn 17tr (3 đợt), >90 10tr, 31-60 5tr, 1-30 2tr, còn phải thu 19tr',
  rv.overdue - rv0.overdue === 17_000_000 && rv.overdueCount - rv0.overdueCount === 3 && rv.outstanding - rv0.outstanding === 19_000_000
  && rv.aging[3].amount - rv0.aging[3].amount === 10_000_000 && rv.aging[1].amount - rv0.aging[1].amount === 5_000_000 && rv.aging[0].amount - rv0.aging[0].amount === 2_000_000, rv);

const opp = (b: object) => json(PM.cookie, 'POST', '/api/sales/opportunities', { customerId: cust, title: `CH ${stamp}`, ...b });
const os = [await opp({ stage: 'Lead', value: 10_000_000 }), await opp({ stage: 'Negotiating', value: 20_000_000, probability: 70 }),
  await opp({ stage: 'Quoted', value: 8_000_000 }), await opp({ stage: 'Lost', value: 50_000_000, lostReason: 'Giá cao' })];
ok('Tạo 4 cơ hội (1 đã thua)', os.every((x) => x.status === 201), os);
const op = (await json(V.cookie, 'GET', '/api/sales/opportunities')).body as any[];
const pl = (await dash(V.cookie)).body.pipeline;
const open = op.filter((o) => o.stage !== 'Won' && o.stage !== 'Lost');
ok('Pipeline khớp /sales/opportunities: số cơ hội mở, tổng giá trị, tổng weighted (đã đóng = 0)', pl.openCount === open.length
  && pl.openValue === open.reduce((t, o) => t + o.value, 0) && pl.weighted === op.reduce((t, o) => t + o.weighted, 0), { pl, n: op.length });
ok('Phần cơ hội mới: weighted +1tr +14tr +3,2tr; giá trị mở +38tr; cơ hội thua không tính', pl.weighted - b0.body.pipeline.weighted === 18_200_000
  && pl.openValue - b0.body.pipeline.openValue === 38_000_000 && pl.openCount - b0.body.pipeline.openCount === 3, pl);
ok('Theo giai đoạn: đủ 4 giai đoạn mở, cộng lại = tổng', same(pl.byStage.map((s: any) => s.stage), ['Lead', 'Contacted', 'Quoted', 'Negotiating'])
  && pl.byStage.reduce((t: number, s: any) => t + s.weighted, 0) === pl.weighted && pl.byStage.reduce((t: number, s: any) => t + s.count, 0) === pl.openCount, pl.byStage);

// ---------- Dự án cần chú ý ----------
for (const x of [DevO, DevN, DevS]) await json(x.cookie, 'POST', '/api/attendance/check', { source: 'web' });
const mkProj = async (key: string, members: string[]) => {
  const base = { code: `TQ${key}-${stamp}`, name: `Dự án ${key} ${stamp}`, kind: 'Internal', startOn: monthStart(0), memberIds: members };
  const r = await json(PM.cookie, 'POST', '/api/projects', base);
  return { id: r.body as string, base, status: r.status };
};
const PL = await mkProj('L', []), PC = await mkProj('C', []), PO = await mkProj('O', [DevO.e.id]), PN = await mkProj('N', [DevN.e.id]), PS = await mkProj('S', [DevS.e.id]);
ok('Tạo 5 dự án nội bộ', [PL, PC, PO, PN, PS].every((p) => p.status === 201), [PL, PC, PO, PN, PS].map((p) => p.status));
ok('Chi gắn dự án L (3tr) + C (1tr)', (await entry({ kind: 'Expense', amount: 3_000_000, date: today, projectId: PL.id })).status === 201
  && (await entry({ kind: 'Expense', amount: 1_000_000, date: today, projectId: PC.id })).status === 201);
const manDays = async (p: string) => (await json(PM.cookie, 'GET', `/api/projects/${p}/effort`)).body?.totalManDays as number;
const mO = await manDays(PO.id), mN = await manDays(PN.id), mS = await manDays(PS.id);
ok('Dự án O / N / S có ngày công (đã chấm công hôm nay)', mO > 0 && mN > 0 && mS > 0, { mO, mN, mS });
const setBudget = async (p: { id: string; base: object }, budget: number | null, status = 'Active') =>
  (await json(PM.cookie, 'PUT', `/api/projects/${p.id}`, { ...p.base, budgetManDays: budget, status })).status;
const bs = [await setBudget(PO, Math.round(mO * 50) / 100), await setBudget(PN, Math.round((mN / 0.9) * 100) / 100), await setBudget(PS, mS * 10), await setBudget(PC, null, 'Closed')];
ok('Ngân sách: O = ½ công (vượt), N ≈ công / 0,9 (~90 %), S = 10 × công; đóng C', bs.every((s) => s === 204), bs);
const a1 = await alerts(V.cookie);
const rows = (a1.body ?? []) as any[];
const row = (p: { id: string }) => rows.find((x) => x.projectId === p.id);
ok('alerts 200', a1.status === 200, a1);
ok('Dự án L: lỗ (lãi −3tr), không cờ ngân sách', row(PL)?.loss === true && row(PL).profit === -3_000_000 && !row(PL).overBudget && !row(PL).nearBudget
  && row(PL).budgetManDays === null && row(PL).budgetUsedPercent === null, row(PL));
ok('Dự án O: vượt ngân sách ngày công, không "sắp vượt", không lỗ', row(PO)?.overBudget === true && !row(PO).nearBudget && !row(PO).loss && row(PO).budgetUsedPercent > 100, row(PO));
ok('Dự án N: sắp vượt (80–100 %, chưa vượt)', row(PN)?.nearBudget === true && !row(PN).overBudget && row(PN).budgetUsedPercent >= 80 && row(PN).budgetUsedPercent <= 100, row(PN));
ok('Dự án S (dùng 10 %) không ra; dự án đã đóng C (lỗ) không ra', !row(PS) && !row(PC), rows.map((x) => x.code));
ok('Mọi dòng có ít nhất một cờ, không có months / categories / people', rows.every((x) => x.loss || x.overBudget || x.nearBudget)
  && rows.every((x) => !('months' in x) && !('categories' in x) && !('people' in x)));
ok('Sắp theo lãi tăng dần (lỗ nặng trước)', rows.every((x, i, arr) => i === 0 || arr[i - 1].profit <= x.profit));
ok('Quản lý của chính các dự án này → 403', (await alerts(PM.cookie)).status === 403);

// ================= TEST-221: dự báo dòng tiền 13 tuần =================
const fc = (c: string) => json(c, 'GET', '/api/finance/forecast');
const setFc = (c: string, payrollPayDay: number, pipelineDelayDays: number) => json(c, 'PUT', '/api/finance/forecast/settings', { payrollPayDay, pipelineDelayDays });
for (const [name, c] of [['HR', H.cookie], ['admin seed', admin], ['quản lý dự án', PM.cookie], ['nhân viên thường', E.cookie]] as const) {
  ok(`${name}: /forecast, /recurring, PUT settings, POST recurring → 403`, (await fc(c)).status === 403 && (await json(c, 'GET', '/api/finance/recurring')).status === 403
    && (await setFc(c, 10, 30)).status === 403 && (await json(c, 'POST', '/api/finance/recurring', { name: 'x', kind: 'Expense', amount: 1, dayOfMonth: 1 })).status === 403);
}
ok('Xem tài chính (không Quản trị): đọc 200, sửa cấu hình / khoản định kỳ 403', (await fc(V.cookie)).status === 200 && (await json(V.cookie, 'GET', '/api/finance/recurring')).status === 200
  && (await setFc(V.cookie, 10, 30)).status === 403 && (await json(V.cookie, 'POST', '/api/finance/recurring', { name: 'x', kind: 'Expense', amount: 1, dayOfMonth: 1 })).status === 403);
ok('Token AI của người có Xem: /forecast, /recurring → 403', (await bearer(tokV, 'GET', '/api/finance/forecast')).status === 403
  && (await bearer(tokV, 'GET', '/api/finance/recurring')).status === 403);
ok('Cấu hình sai: ngày trả lương 0 / 29, trễ −1 / 181 → 400 theo field', !!(await setFc(D.cookie, 0, 30)).body?.errors?.payrollPayDay
  && (await setFc(D.cookie, 29, 30)).status === 400 && !!(await setFc(D.cookie, 10, -1)).body?.errors?.pipelineDelayDays && (await setFc(D.cookie, 10, 181)).status === 400);
ok('Quản trị tài chính đặt cấu hình mặc định 10 / 30 → 204', (await setFc(D.cookie, 10, 30)).status === 204);

// --- ngày theo cửa sổ (như CashForecastRules) ---
const dim = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();           // m 1-based
const ymd = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, Math.min(d, dim(y, m)))).toISOString().slice(0, 10);
const addMonths = (iso: string, k: number) => {
  const [y, m, d] = iso.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + k, 1));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, d);
};
const monthDay = (k: number, dd: number) => addMonths(monthStart(0).slice(0, 8) + String(dd).padStart(2, '0'), k);   // ngày dd của tháng này + k
const payDates = (to: string, pd: number) => [-1, 0, 1, 2, 3, 4].map((j) => monthDay(j + 1, pd)).filter((d) => d > today && d <= to);
const recDates = (to: string, dd: number) => [0, 1, 2, 3, 4].map((j) => monthDay(j, dd)).filter((d) => d > today && d <= to);
const weekOf = (f: any, d: string) => d < today ? 1 : f.weeks.find((w: any) => w.from <= d && d <= w.to)?.week ?? null;
const itemsOf = (f: any, refId: string) => f.items.filter((i: any) => i.refId === refId);
const dow = (d: string) => new Date(d + 'T00:00:00Z').getUTCDay();

const f0 = (await fc(V.cookie)).body;
ok('13 tuần: tuần 1 từ hôm nay tới Chủ nhật, các tuần sau Thứ Hai → Chủ nhật, liền nhau', f0.weeks.length === 13 && f0.weeks[0].from === today && f0.today === today
  && f0.weeks.every((w: any) => dow(w.to) === 0) && f0.weeks.slice(1).every((w: any) => dow(w.from) === 1)
  && f0.weeks.every((w: any, i: number) => i === 0 || Date.parse(w.from) - Date.parse(f0.weeks[i - 1].to) === 86400000) && f0.to === f0.weeks[12].to,
  f0.weeks.map((w: any) => [w.from, w.to]));
ok('Cấu hình đọc kèm /forecast: 10 / 30', f0.settings.payrollPayDay === 10 && f0.settings.pipelineDelayDays === 30, f0.settings);
const accs = (await json(V.cookie, 'GET', '/api/finance/accounts')).body as any[];
ok('Số dư đầu = tổng số dư quỹ đang dùng', f0.opening === accs.filter((a) => a.isActive).reduce((t, a) => t + a.balance, 0), { opening: f0.opening });

// --- Đợt thu (hợp đồng k ở trên): 3 đợt quá hạn → tuần 1 đường Kỳ vọng; đợt +60 ngày → tuần chứa hạn ---
const kItems = itemsOf(f0, k.body);
const kOver = kItems.filter((i: any) => i.line === 'Overdue'), kInst = kItems.filter((i: any) => i.line === 'Installment');
ok('Đợt quá hạn: 3 khoản ở tuần 1 (10tr, 5tr, phần còn lại 2tr), cờ Late, có mã HĐ + khách', kOver.length === 3 && kOver.every((i: any) => i.week === 1 && i.late
  && i.refCode === `HD-TQ-${stamp}` && i.customerId === cust) && same(kOver.map((i: any) => i.amount).sort((a: number, b: number) => a - b), [2_000_000, 5_000_000, 10_000_000]), kItems);
ok('Đợt chưa tới hạn (+60 ngày, 2tr) → đúng tuần, đường Thận trọng', kInst.length === 1 && kInst[0].amount === 2_000_000 && kInst[0].week === weekOf(f0, addDays(60))
  && kInst[0].date === addDays(60) && !kInst[0].late, kInst);

// --- Huỷ dòng thu ở sổ → đợt thu quay lại dự báo ---
const iLater = kd.installments.find((i: any) => i.title === 'Đợt sau');
const col = await json(A.cookie, 'POST', `/api/sales/installments/${iLater.id}/collect`, { amount: 500_000, date: today, accountId: cash });
const fCol = (await fc(V.cookie)).body;
ok('Thu 500k đợt sau → dự báo còn 1,5tr', col.status === 201 && itemsOf(fCol, k.body).find((i: any) => i.line === 'Installment')?.amount === 1_500_000, col);
const ent = ((await json(V.cookie, 'GET', '/api/finance/entries?page=1&pageSize=200')).body.items as any[]).find((e) => e.sourceId === col.body);
ok('Huỷ dòng thu ở sổ → đợt thu quay lại 2tr', !!ent && (await json(A.cookie, 'POST', `/api/finance/entries/${ent.id}/void`, { reason: 'e2e' })).status === 204
  && itemsOf((await fc(V.cookie)).body, k.body).find((i: any) => i.line === 'Installment')?.amount === 2_000_000, ent);

// --- Cơ hội × xác suất ---
const oPast = await opp({ stage: 'Negotiating', value: 10_000_000, probability: 50, expectedCloseOn: addDays(-40) });   // tiền về −10 → tuần 1
const oSoon = await opp({ stage: 'Quoted', value: 20_000_000, probability: 40, expectedCloseOn: addDays(10) });         // tiền về +40
const oFar = await opp({ stage: 'Lead', value: 30_000_000, probability: 10, expectedCloseOn: addDays(70) });            // tiền về +100 → ngoài
const oNone = await opp({ stage: 'Contacted', value: 4_000_000 });
ok('Tạo 4 cơ hội (3 có ngày dự kiến chốt)', [oPast, oSoon, oFar, oNone].every((x) => x.status === 201), [oPast, oSoon, oFar, oNone]);
const f1 = (await fc(V.cookie)).body;
const pPast = itemsOf(f1, oPast.body), pSoon = itemsOf(f1, oSoon.body);
ok('Cơ hội tiền về đã qua → tuần 1 (Late), 10tr × 50 %', pPast.length === 1 && pPast[0].week === 1 && pPast[0].late && pPast[0].amount === 5_000_000
  && pPast[0].line === 'Pipeline' && pPast[0].date === addDays(-10), pPast);
ok('Cơ hội chốt +10 → tiền về +40 (8tr)', pSoon.length === 1 && pSoon[0].week === weekOf(f1, addDays(40)) && pSoon[0].amount === 8_000_000, pSoon);
ok('Cơ hội tiền về +100 ngày → ngoài 13 tuần; cơ hội không ngày không vào', itemsOf(f1, oFar.body).length === 0 && itemsOf(f1, oNone.body).length === 0);
const opAll = (await json(V.cookie, 'GET', '/api/sales/opportunities')).body as any[];
const undated = opAll.filter((o) => o.stage !== 'Won' && o.stage !== 'Lost' && !o.expectedCloseOn);
ok('Cơ hội chưa có ngày: chỉ đếm + tổng (khớp /sales/opportunities)', f1.undatedOpportunities === undated.length && undated.length >= 4
  && f1.undatedValue === undated.reduce((t, o) => t + o.value, 0) && f1.undatedWeighted === undated.reduce((t, o) => t + o.weighted, 0), f1.undatedOpportunities);
ok('Đổi số ngày trễ 30 → 0 (204)', (await setFc(D.cookie, 10, 0)).status === 204);
const f2 = (await fc(V.cookie)).body;
ok('… cơ hội +70 vào dự báo đúng tuần (3tr); +10 dời về tuần chứa +10', itemsOf(f2, oFar.body)[0]?.week === weekOf(f2, addDays(70))
  && itemsOf(f2, oSoon.body)[0]?.week === weekOf(f2, addDays(10)) && itemsOf(f2, oFar.body)[0]?.amount === 3_000_000, [itemsOf(f2, oFar.body), itemsOf(f2, oSoon.body)]);

// --- Lương: hợp đồng lao động 20tr cho DevS → tổng chi phí > 0, lặp ở mỗi kỳ trả ---
const lc = await json(admin, 'POST', '/api/contracts', { employeeId: DevS.e.id, number: `E2E-TQ-${stamp}`, type: 'Indefinite', signedDate: null,
  startDate: '2025-01-05', endDate: null, jobTitle: 'Dev', salary: 20_000_000, allowance: null, note: null });
ok('Tạo hợp đồng lao động 20tr', [200, 201].includes(lc.status), lc);
const f3 = (await fc(V.cookie)).body;
const pays3 = f3.items.filter((i: any) => i.line === 'Payroll');
ok('Lương: tổng tháng này > 0, cờ ước tính, chỉ trả tổng (không theo người)', f3.payroll.monthlyCost > 0 && f3.payroll.estimated === true
  && Object.keys(f3.payroll).sort().join() === 'estimated,monthlyCost' && pays3.every((i: any) => i.refId === null && i.customerId === null), f3.payroll);
ok('Ngày 10: kỳ trả = ngày 10 tháng sau, > hôm nay, trong cửa sổ, mỗi kỳ = tổng tháng', same(pays3.map((i: any) => i.date), payDates(f3.to, 10))
  && pays3.every((i: any) => i.amount === f3.payroll.monthlyCost && i.week === weekOf(f3, i.date)), { got: pays3.map((i: any) => i.date), want: payDates(f3.to, 10) });
const pdToday = Number(today.slice(8)) <= 28 ? Number(today.slice(8)) : 5;
ok(`Đổi ngày trả lương → ${pdToday} (204)`, (await setFc(D.cookie, pdToday, 0)).status === 204);
const f4 = (await fc(V.cookie)).body;
const pays4 = f4.items.filter((i: any) => i.line === 'Payroll').map((i: any) => i.date);
ok('… kỳ trả dời theo ngày mới; kỳ trùng hôm nay không tính', same(pays4, payDates(f4.to, pdToday)) && !pays4.includes(today) && pays4.length > 0,
  { got: pays4, want: payDates(f4.to, pdToday) });
ok('Trả cấu hình 10 / 30', (await setFc(D.cookie, 10, 30)).status === 204);

// --- Gia hạn dịch vụ ---
const svc = (b: object) => json(admin, 'POST', '/api/assets/services', { vendor: 'E2E', plan: null, url: null, seatLimit: null, ownerDepartmentId: null, adminEmployeeId: null, note: null, ...b });
const sM = await svc({ name: `Figma TQ ${stamp}`, billingCycle: 'Monthly', cost: 1_000_000, renewalDate: addDays(5) });
const sY = await svc({ name: `Slack TQ ${stamp}`, billingCycle: 'Yearly', cost: 12_000_000, renewalDate: addDays(-3) });
const sN = await svc({ name: `Mua đứt TQ ${stamp}`, billingCycle: 'None', cost: 5_000_000, renewalDate: addDays(5) });
const svcId = (r: Res) => (typeof r.body === 'string' ? r.body : r.body?.id) as string;
ok('Tạo 3 dịch vụ (hằng tháng, hằng năm quá ngày gia hạn, không định kỳ)', [sM, sY, sN].every((x) => [200, 201].includes(x.status)), [sM, sY, sN]);
const f5 = (await fc(V.cookie)).body;
const rM = itemsOf(f5, svcId(sM)), rY = itemsOf(f5, svcId(sY));
const wantM = [0, 1, 2, 3].map((kk) => addMonths(addDays(5), kk)).filter((d) => d <= f5.to);
ok('Hằng tháng: lặp mỗi tháng từ ngày gia hạn, 1tr / kỳ, đúng tuần', same(rM.map((i: any) => i.date), wantM) && rM.every((i: any) => i.amount === 1_000_000
  && i.line === 'Renewal' && i.week === weekOf(f5, i.date) && !i.late), { got: rM.map((i: any) => i.date), wantM });
ok('Hằng năm quá ngày gia hạn → tuần 1, cờ quá ngày (Late), 12tr, một lần', rY.length === 1 && rY[0].week === 1 && rY[0].late && rY[0].amount === 12_000_000, rY);
ok('Dịch vụ không định kỳ không vào dự báo', itemsOf(f5, svcId(sN)).length === 0);

// --- Đề nghị chi đã duyệt chưa chi ---
const exp = async (amount: number, neededBy: string | null) => {
  const r = await json(E.cookie, 'POST', '/api/finance/expenses', { amount, reason: `Chi TQ ${amount} ${stamp}`, neededBy });
  const row = ((await json(E.cookie, 'GET', '/api/finance/expenses?page=1&pageSize=50')).body.items as any[]).find((x) => x.id === r.body);
  const s1 = (await json(PM.cookie, 'POST', `/api/approval/${row?.approvalRequestId}/approve`, {})).status;
  const s2 = (await json(D.cookie, 'POST', `/api/approval/${row?.approvalRequestId}/approve`, {})).status;
  return { id: r.body as string, code: row?.code as string, ok: r.status === 201 && s1 === 200 && s2 === 200, dbg: [r.status, s1, s2] };
};
const xPending = await json(E.cookie, 'POST', '/api/finance/expenses', { amount: 777_000, reason: `Chờ duyệt ${stamp}`, neededBy: addDays(3) });
const x14 = await exp(3_000_000, addDays(14)), xNone = await exp(1_000_000, null);
ok('2 đề nghị chi đã duyệt (+14 ngày, không ngày) + 1 chờ duyệt', x14.ok && xNone.ok && xPending.status === 201, [x14.dbg, xNone.dbg, xPending.status]);
const f6 = (await fc(V.cookie)).body;
ok('Đề nghị +14 ngày → tuần chứa ngày cần, có mã CP', itemsOf(f6, x14.id)[0]?.week === weekOf(f6, addDays(14)) && itemsOf(f6, x14.id)[0]?.refCode === x14.code
  && itemsOf(f6, x14.id)[0]?.line === 'Expense', itemsOf(f6, x14.id));
ok('Đề nghị không có ngày cần → tuần 1; đề nghị chờ duyệt không tính', itemsOf(f6, xNone.id)[0]?.week === 1 && itemsOf(f6, xPending.body).length === 0);
ok('Đề nghị "Đã chi" → rời dự báo', (await json(A.cookie, 'POST', `/api/finance/expenses/${xNone.id}/pay`, { accountId: cash, date: today })).status === 204
  && itemsOf((await fc(V.cookie)).body, xNone.id).length === 0);

// --- Khoản định kỳ dự kiến ---
const rec = (c: string, b: object) => json(c, 'POST', '/api/finance/recurring', { kind: 'Expense', amount: 1_000, dayOfMonth: 5, businessLineId: null, ...b });
const bad = await rec(D.cookie, { name: '', amount: 0, dayOfMonth: 29 });
ok('Khoản định kỳ sai: thiếu tên, số tiền 0, ngày 29 → 400 theo field', bad.status === 400 && Object.keys(bad.body?.errors ?? {}).sort().join() === 'amount,dayOfMonth,name', bad);
const dIn = 25, dOut = 15;
const rIn = await rec(D.cookie, { name: `Cho thuê lại ${stamp}`, kind: 'Income', amount: 2_500_000, dayOfMonth: dIn, businessLineId: L1 });
const rOut = await rec(D.cookie, { name: `Thuê văn phòng ${stamp}`, kind: 'Expense', amount: 15_000_000, dayOfMonth: dOut, note: 'HĐ thuê 2 năm' });
ok('Tạo 2 khoản định kỳ (thu / chi) → 201; tên trùng → 400', rIn.status === 201 && rOut.status === 201
  && !!(await rec(D.cookie, { name: `Thuê văn phòng ${stamp}` })).body?.errors?.name, [rIn, rOut]);
const lst = (await json(V.cookie, 'GET', '/api/finance/recurring')).body as any[];
ok('Danh sách khoản định kỳ: có tên mảng, ghi chú, đang dùng', lst.find((x) => x.id === rIn.body)?.businessLineName === `Web ${stamp}`
  && lst.find((x) => x.id === rOut.body)?.note === 'HĐ thuê 2 năm' && lst.find((x) => x.id === rOut.body)?.isActive === true, lst.slice(0, 3));
const f7 = (await fc(V.cookie)).body;
ok('Định kỳ thu: lặp ngày 25 hằng tháng (> hôm nay), đường RecurringIncome', same(itemsOf(f7, rIn.body).map((i: any) => i.date), recDates(f7.to, dIn))
  && itemsOf(f7, rIn.body).every((i: any) => i.line === 'RecurringIncome' && i.amount === 2_500_000), itemsOf(f7, rIn.body));
ok('Định kỳ chi: lặp ngày 15 hằng tháng, đường RecurringExpense', same(itemsOf(f7, rOut.body).map((i: any) => i.date), recDates(f7.to, dOut))
  && itemsOf(f7, rOut.body).every((i: any) => i.line === 'RecurringExpense'), itemsOf(f7, rOut.body));
ok('Ngừng khoản định kỳ → không tính', (await json(D.cookie, 'PUT', `/api/finance/recurring/${rOut.body}`, { name: `Thuê văn phòng ${stamp}`, kind: 'Expense', amount: 15_000_000,
  dayOfMonth: dOut, businessLineId: null, isActive: false, note: null })).status === 204 && itemsOf((await fc(V.cookie)).body, rOut.body).length === 0);

// --- Số tuần khớp danh sách khoản; Thận trọng không gồm quá hạn + cơ hội ---
const F = (await fc(V.cookie)).body;
const LINES: Record<string, string> = { Installment: 'installments', Overdue: 'overdue', Pipeline: 'pipeline', RecurringIncome: 'recurringIncome', Payroll: 'payroll',
  Renewal: 'renewals', Expense: 'expenses', RecurringExpense: 'recurringExpense' };
ok('Mỗi ô (tuần × dòng) = tổng các khoản tạo nên nó', F.weeks.every((w: any) => Object.entries(LINES).every(([line, field]) =>
  w[field] === F.items.filter((i: any) => i.week === w.week && i.line === line).reduce((t: number, i: any) => t + i.amount, 0))));
let cs = F.opening, ce = F.opening, okChain = true;
for (const w of F.weeks) {
  okChain &&= w.inConservative === w.installments + w.recurringIncome && w.inExpected === w.inConservative + w.overdue + w.pipeline
    && w.out === w.payroll + w.renewals + w.expenses + w.recurringExpense;
  cs += w.inConservative - w.out; ce += w.inExpected - w.out;
  okChain &&= w.closingConservative === cs && w.closingExpected === ce;
}
ok('Số dư cuối tuần cộng dồn đúng; Thận trọng = chưa quá hạn + định kỳ thu − chi; Kỳ vọng + quá hạn + cơ hội', okChain);
const firstNeg = (key: string) => F.weeks.find((w: any) => w[key] < 0)?.week ?? null;
ok('Tuần âm đầu tiên mỗi đường khớp số dư', F.firstNegativeConservative === firstNeg('closingConservative') && F.firstNegativeExpected === firstNeg('closingExpected'),
  [F.firstNegativeConservative, F.firstNegativeExpected]);
ok('Mọi khoản trong tuần 1–13; khoản Late chỉ ở tuần 1', F.items.every((i: any) => i.week >= 1 && i.week <= 13 && (!i.late || i.week === 1)));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
