// E2E: dự án giai đoạn 2b — nhiều hợp đồng / dự án (một hợp đồng chỉ một dự án), đợt thu của mọi hợp đồng, gắn dự án vào sổ thu chi + đề nghị chi,
// lãi / lỗ dự án (doanh thu sau thuế, VAT là chi phí, nhân công = chi phí lương × % phân bổ, chi trực tiếp, thu khác), quyền xem tiền
// (quản lý dự án / thành viên 403, Xem tài chính không có chi tiết theo người, Quản trị tài chính có), token AI.
// Pha b (sau khi khởi động lại Api, đợi ≥ 80 s): job chốt phân bổ tháng trước → % mặc định thành dòng cố định, quản lý dự án không sửa được tháng đã chốt,
// Quản trị tài chính sửa được, bỏ thành viên không làm mất ngày công tháng đã chốt.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`; cách script khác ≥ 60 s).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/projects-cost-e2e.ts a
//   (khởi động lại Api, đợi ≥ 80 s)  … bun scripts/dev/projects-cost-e2e.ts b
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
const phase = process.argv[2] ?? 'a';
const STATE = `${tmpdir()}/officehub-e2e-projects-cost-${new URL(API).port}.json`;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);
const month = today.slice(0, 8) + '01';
const prevMonth = new Date(Date.UTC(+today.slice(0, 4), +today.slice(5, 7) - 2, 1)).toISOString().slice(0, 10);
const VIEW = 1, RECORD = 2, APPROVE = 4, ADMIN = 8;

if (phase === 'a') {
  const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  if (!admin) throw new Error('Không đăng nhập được admin seed');
  const stamp = Date.now().toString(36).slice(-5);
  const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
  const pDir = await mkPos('CGĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('CKT', 3, RECORD), pPlain = await mkPos('CNV', 7, 0);
  const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Chi phí DA ${stamp}`, code: `CP${stamp}` })).body;
  const users: Record<string, string> = {};
  const mkEmp = async (key: string, code: string, name: string, posId: string, managerId: string | null, roles: string[]) => {
    const user = `e2e.cost.${key}.${stamp}`;
    const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
      departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
    const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
    const c = await login(user, acc.tempPassword);
    await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
    users[key] = user;
    return { e, cookie: await login(user, PW) };
  };
  const D = await mkEmp('dir', `CD${stamp}`, 'Giám Đốc CP', pDir, null, ['employee']);
  const A = await mkEmp('acc', `CA${stamp}`, 'Kế Toán CP', pAcc, null, ['employee']);
  const PM = await mkEmp('pm', `CM${stamp}`, 'Quản Lý CP', pPlain, null, ['employee', 'manager']);
  const Dev1 = await mkEmp('d1', `C1${stamp}`, 'Dev Một CP', pPlain, PM.e.id, ['employee']);
  const Dev2 = await mkEmp('d2', `C2${stamp}`, 'Dev Hai CP', pPlain, PM.e.id, ['employee']);
  const O = await mkEmp('out', `CO${stamp}`, 'Người Ngoài CP', pPlain, null, ['employee']);
  ok('6 nhân viên đăng nhập', [D, A, PM, Dev1, Dev2, O].every((x) => !!x.cookie));

  // Hợp đồng lao động (lương) + chấm công hôm nay → có ngày công + chi phí ước tính
  for (const [x, salary] of [[Dev1, 20_000_000], [Dev2, 30_000_000]] as const) {
    const c = await json(admin, 'POST', '/api/contracts', { employeeId: x.e.id, number: `LD-${x.e.code}`, type: 'Indefinite', signedDate: null,
      startDate: '2026-01-05', endDate: null, jobTitle: 'Lập trình viên', salary, allowance: null, note: null });
    ok(`Hợp đồng lao động ${x.e.fullName}`, c.status === 200 || c.status === 201, c);
  }
  for (const x of [Dev1, Dev2, PM]) await json(x.cookie, 'POST', '/api/attendance/check', { source: 'web' });

  // Hai hợp đồng bán: K1 100tr VAT 10 % (2 đợt), K2 50tr VAT 8 % (1 đợt)
  const cust = (await json(PM.cookie, 'POST', '/api/sales/customers', { name: `Khách CP ${stamp}` })).body;
  const mkK = async (code: string, before: number, vat: number, installments: object[]) =>
    json(PM.cookie, 'POST', '/api/sales/contracts', { code, customerId: cust, title: code, valueBeforeTax: before, vatRate: vat, signedOn: today, billing: 'Milestone', installments });
  const k1 = await mkK(`HD-C1-${stamp}`, 100_000_000, 10, [{ title: 'Đợt 1', dueOn: today, amount: 40_000_000 }, { title: 'Đợt 2', dueOn: addDays(60), amount: 70_000_000 }]);
  const k2 = await mkK(`HD-C2-${stamp}`, 50_000_000, 8, [{ title: 'Trọn gói', dueOn: addDays(30), amount: 54_000_000 }]);
  ok('Chuẩn bị 2 hợp đồng bán', k1.status === 201 && k2.status === 201, [k1, k2]);
  const K1 = k1.body, K2 = k2.body;

  // ---------- Nhiều hợp đồng / dự án ----------
  const base = { code: `CP-${stamp}`, name: 'Dự án chi phí', kind: 'Client', salesContractIds: [K1, K2], startOn: prevMonth, budgetManDays: 40, memberIds: [Dev1.e.id, Dev2.e.id] };
  const pr = await json(PM.cookie, 'POST', '/api/projects', base);
  ok('Tạo dự án gắn 2 hợp đồng (201)', pr.status === 201, pr);
  const P = pr.body;
  const other = await json(PM.cookie, 'POST', '/api/projects', { ...base, code: `CP2-${stamp}`, salesContractIds: [K1], memberIds: [] });
  ok('Hợp đồng đã thuộc dự án khác → 400 (một hợp đồng chỉ một dự án)', other.status === 400 && !!other.body?.errors?.salesContractIds, other.body);
  let d = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
  ok('Chi tiết có 2 hợp đồng, không có số tiền', d.project.contracts.length === 2 && d.project.contracts.every((c: any) => !('totalValue' in c)), d.project.contracts);
  const insts = (await json(PM.cookie, 'GET', `/api/projects/${P}/installments`)).body as any[];
  ok('Đợt thu của cả 2 hợp đồng (3 đợt, không tiền)', insts.length === 3 && insts.every((i) => !('amount' in i)) && new Set(insts.map((i) => i.contractId)).size === 2, insts);
  ok('Người ngoài xem đợt thu dự án → 404', (await json(O.cookie, 'GET', `/api/projects/${P}/installments`)).status === 404);
  const k2inst = insts.find((i) => i.contractId === K2);
  ok('Mốc gắn đợt thu của hợp đồng thứ hai', (await json(PM.cookie, 'POST', `/api/projects/${P}/milestones`, { title: 'Bàn giao', installmentId: k2inst.id })).status === 201);
  const put = (ids: string[]) => json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, salesContractIds: ids, status: 'Active' });
  const rm = await put([K1]);
  ok('Bỏ hợp đồng đang gắn mốc → 400', rm.status === 400 && !!rm.body?.errors?.salesContractIds, rm.body);
  ok('Bỏ hợp đồng không gắn mốc → 204, thêm lại → 204', (await put([K2])).status === 204 && (await put([K1, K2])).status === 204
    && (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.project.contracts.length === 2);
  ok('Đổi sang nội bộ khi mốc còn gắn đợt thu → 400', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, kind: 'Internal', status: 'Active' })).status === 400);

  // ---------- Gắn dự án vào sổ / đề nghị chi ----------
  const cash = (await json(D.cookie, 'POST', '/api/finance/accounts', { name: `Quỹ CP ${stamp}`, kind: 'Cash', bankName: null, last4: null, openingBalance: 100_000_000, openingDate: '2026-01-01' })).body;
  const projOpts = async (c: string) => ((await json(c, 'GET', '/api/finance/projects')).body as any[]).map((x) => x.id);
  ok('Danh sách dự án để gắn: thành viên + kế toán thấy, người ngoài không', (await projOpts(Dev1.cookie)).includes(P) && (await projOpts(A.cookie)).includes(P) && !(await projOpts(O.cookie)).includes(P));
  const entry = (c: string, b: object) => json(c, 'POST', '/api/finance/entries', { date: today, accountId: cash, ...b });
  ok('Ghi chi 5tr gắn dự án', (await entry(A.cookie, { kind: 'Expense', amount: 5_000_000, projectId: P, description: 'Thuê server' })).status === 201);
  ok('Ghi thu khác 1tr gắn dự án', (await entry(A.cookie, { kind: 'Income', amount: 1_000_000, projectId: P, description: 'Phí phát sinh' })).status === 201);
  ok('Chuyển quỹ gắn dự án → 400', (await entry(A.cookie, { kind: 'Transfer', amount: 1, toAccountId: cash, projectId: P })).status === 400);
  ok('Dự án không tồn tại → 400', (await entry(A.cookie, { kind: 'Expense', amount: 1, projectId: crypto.randomUUID() })).status === 400);
  const ent = (await json(A.cookie, 'GET', `/api/finance/entries?projectId=${P}&page=1`)).body;
  ok('Sổ lọc theo dự án: 2 dòng, có tên dự án', ent.total === 2 && ent.items.every((e: any) => e.projectName?.startsWith(`CP-${stamp}`.toUpperCase())), ent);
  const ex = await json(Dev1.cookie, 'POST', '/api/finance/expenses', { amount: 2_000_000, reason: 'Mua plugin', projectId: P });
  ok('Thành viên gửi đề nghị chi cho dự án (201)', ex.status === 201, ex);
  ok('Người ngoài gửi đề nghị chi cho dự án → 400', (await json(O.cookie, 'POST', '/api/finance/expenses', { amount: 1, reason: 'x', projectId: P })).status === 400);
  const mine = (await json(Dev1.cookie, 'GET', '/api/finance/expenses?scope=mine&page=1')).body.items as any[];
  ok('Đề nghị chi hiện tên dự án', mine.some((x) => x.id === ex.body && x.projectId === P && !!x.projectName));

  // Thu 40tr đợt 1 của K1
  const k1d = (await json(A.cookie, 'GET', `/api/sales/contracts/${K1}`)).body;
  const col = await json(A.cookie, 'POST', `/api/sales/installments/${k1d.installments[0].id}/collect`, { amount: 40_000_000, date: today, accountId: cash });
  ok('Kế toán thu 40tr của K1', col.status === 201, col);

  // ---------- Lãi / lỗ ----------
  const fin = (c: string) => json(c, 'GET', `/api/projects/${P}/financials`);
  ok('Quản lý dự án / thành viên xem lãi lỗ → 403; người ngoài → 404', (await fin(PM.cookie)).status === 403 && (await fin(Dev1.cookie)).status === 403 && (await fin(O.cookie)).status === 404);
  const fa = await fin(A.cookie);
  const f = fa.body;
  ok('Kế toán (Xem tài chính) xem được, không có chi tiết theo người', fa.status === 200 && f.people === null, fa);
  ok('Doanh thu = sau thuế (110tr + 54tr), VAT = 10tr + 4tr', f.revenue === 164_000_000 && f.vat === 14_000_000, f);
  ok('Chi trực tiếp 5tr, thu khác 1tr, đã thu 40tr, còn nợ 124tr', f.directExpense === 5_000_000 && f.otherIncome === 1_000_000 && f.collected === 40_000_000 && f.outstanding === 124_000_000, f);
  ok('Nhân công > 0 (ước tính — kỳ lương chưa chốt), có ngày công tháng này', f.labor > 0 && f.hasEstimate === true && f.manDays > 0
    && f.months.some((m: any) => m.month === month && m.labor > 0 && m.laborEstimated && m.collected === 40_000_000 && m.directExpense === 5_000_000), f.months);
  ok('Lãi = doanh thu − VAT + thu khác − nhân công − chi trực tiếp', f.profit === 164_000_000 - 14_000_000 + 1_000_000 - f.labor - 5_000_000 && f.marginPercent !== null, f);
  ok('Danh mục chi / thu trực tiếp', f.categories.length === 2, f.categories);
  const fd = (await fin(D.cookie)).body;
  ok('Giám đốc (Quản trị tài chính) thấy nhân công theo người; Dev2 (lương cao hơn) tốn hơn Dev1', Array.isArray(fd.people)
    && fd.people.find((x: any) => x.employeeId === Dev2.e.id)?.labor > fd.people.find((x: any) => x.employeeId === Dev1.e.id)?.labor
    && fd.people.reduce((t: number, x: any) => t + x.labor, 0) === fd.labor, fd.people);
  // 50 % → nhân công Dev1 giảm một nửa
  const before = fd.people.find((x: any) => x.employeeId === Dev1.e.id).labor;
  ok('Đặt Dev1 50 % tháng này', (await json(PM.cookie, 'PUT', `/api/projects/${P}/allocations`, { month, items: [{ employeeId: Dev1.e.id, percent: 50 }] })).status === 204);
  const after = (await fin(D.cookie)).body.people.find((x: any) => x.employeeId === Dev1.e.id).labor;
  ok('Nhân công Dev1 giảm còn ~một nửa', Math.abs(after - Math.round(before / 2)) <= 1, { before, after });
  const all = await json(A.cookie, 'GET', '/api/projects/financials');
  ok('Bảng lãi / lỗ mọi dự án (kế toán) có dự án, không chi tiết tháng / người', all.status === 200 && (all.body as any[]).some((r) => r.projectId === P && r.months.length === 0 && r.people === null));
  ok('Quản lý dự án xem bảng lãi / lỗ → 403', (await json(PM.cookie, 'GET', '/api/projects/financials')).status === 403);
  const tok = (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e cost ${stamp}`, expiresInDays: 30 })).body?.token as string;
  ok('Token AI không gọi được lãi / lỗ → 403', (await fetch(`${API}/api/projects/${P}/financials`, { headers: { authorization: `Bearer ${tok}` } })).status === 403);
  // Tháng trước (dự án bắt đầu từ tháng trước) — trước khi chốt: mặc định, chưa đặt tay
  const ef = (await json(PM.cookie, 'GET', `/api/projects/${P}/effort`)).body;
  ok('Ngày công có tháng trước, chưa chốt', ef.months.includes(prevMonth) && !ef.frozenMonths.includes(prevMonth), ef.months);
  writeFileSync(STATE, JSON.stringify({ P, users, ids: { Dev1: Dev1.e.id, Dev2: Dev2.e.id }, base }));
  console.log('\n→ Khởi động lại Api, đợi ≥ 80 giây rồi chạy pha b');
} else {
  const st = JSON.parse(readFileSync(STATE, 'utf8'));
  const PM = await login(st.users.pm, PW), D = await login(st.users.dir, PW);
  const ef = (await json(PM, 'GET', `/api/projects/${st.P}/effort`)).body;
  // Dự án tạo trong pha a TRƯỚC lúc job chốt (sau khi khởi động lại) → tháng trước của nó đã chốt
  ok('Tháng trước đã chốt; mọi ô tháng trước là dòng cố định', ef.frozenMonths.includes(prevMonth)
    && ef.cells.filter((c: any) => c.month === prevMonth).length >= 2 && ef.cells.filter((c: any) => c.month === prevMonth).every((c: any) => c.explicit), ef);
  ok('Quản lý dự án không sửa % tháng đã chốt → 403', (await json(PM, 'PUT', `/api/projects/${st.P}/allocations`, { month: prevMonth, items: [{ employeeId: st.ids.Dev1, percent: 30 }] })).status === 403);
  ok('Quản trị tài chính sửa được tháng đã chốt', (await json(D, 'PUT', `/api/projects/${st.P}/allocations`, { month: prevMonth, items: [{ employeeId: st.ids.Dev1, percent: 30 }] })).status === 204);
  ok('Quản lý dự án vẫn sửa được tháng này', (await json(PM, 'PUT', `/api/projects/${st.P}/allocations`, { month, items: [{ employeeId: st.ids.Dev1, percent: 80 }] })).status === 204);
  ok('Bỏ Dev2 khỏi dự án', (await json(PM, 'DELETE', `/api/projects/${st.P}/members/${st.ids.Dev2}`)).status === 204);
  const ef2 = (await json(PM, 'GET', `/api/projects/${st.P}/effort`)).body;
  const c = (eid: string, m: string) => ef2.cells.find((x: any) => x.employeeId === eid && x.month === m);
  ok('Dev2 rời dự án: vẫn còn ở tháng đã chốt, ra khỏi tháng chưa chốt; Dev1 tháng trước 30 %', !!c(st.ids.Dev2, prevMonth) && !c(st.ids.Dev2, month)
    && c(st.ids.Dev1, prevMonth)?.percent === 30 && ef2.members.some((m: any) => m.employeeId === st.ids.Dev2 && m.fullName.includes('đã rời')), ef2);
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
