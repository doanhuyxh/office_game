// E2E TEST-220: Tổng quan giám đốc 1/3 — GET /api/finance/dashboard (thu / chi / lãi theo tháng × mảng, không tính chuyển quỹ / dòng huỷ,
// công nợ quá hạn + tuổi nợ khớp /api/sales/receivables, pipeline khớp /api/sales/opportunities) + GET /api/projects/financials/alerts
// (dự án đang chạy lỗ / vượt / sắp vượt ngân sách ngày công; dự án đã đóng không ra) + quyền (Xem tài chính 200; HR, admin seed, quản lý dự án,
// nhân viên thường 403; token AI kể cả của người có Xem → 403). So sánh theo phần chênh trước / sau khi seed → chạy lại được trên cùng DB.
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

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
