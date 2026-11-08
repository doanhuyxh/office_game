// E2E: module Projects — tạo (vai trò), thành viên + vai trò (còn ≥ 1 quản lý), quyền xem (thành viên / người ngoài / HR / quyền Xem tài chính),
// kho tài liệu dự án đọc qua module mới (spaces, đóng dự án → chỉ đọc, bàn giao thành viên), gắn hợp đồng bán + mốc nghiệm thu → đợt thu đến hạn,
// công việc kanban (số thứ tự, giao việc + chuông, kéo trạng thái, bình luận, việc của tôi, xoá), phân bổ % (tổng ≤ 100, mặc định chia đều), ngày công, token AI.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`; cách script khác ≥ 60 s).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/projects-e2e.ts
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

// ---------- Chuẩn bị ----------
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('PGĐ', 1, VIEW | APPROVE | ADMIN), pAcc = await mkPos('PKT', 3, RECORD), pPlain = await mkPos('PNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Dự án E2E ${stamp}`, code: `DA${stamp}` })).body;
const mkEmp = async (code: string, name: string, posId: string, managerId: string | null, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const D = await mkEmp(`PD${stamp}`, 'Giám Đốc DA', pDir, null, `e2e.prj.dir.${stamp}`, ['employee']);
const A = await mkEmp(`PA${stamp}`, 'Kế Toán DA', pAcc, null, `e2e.prj.acc.${stamp}`, ['employee']);
const PM = await mkEmp(`PM${stamp}`, 'Quản Lý DA', pPlain, null, `e2e.prj.pm.${stamp}`, ['employee', 'manager']);
const Dev1 = await mkEmp(`P1${stamp}`, 'Dev Một', pPlain, PM.e.id, `e2e.prj.d1.${stamp}`, ['employee']);
const Dev2 = await mkEmp(`P2${stamp}`, 'Dev Hai', pPlain, PM.e.id, `e2e.prj.d2.${stamp}`, ['employee']);
const O = await mkEmp(`PO${stamp}`, 'Người Ngoài DA', pPlain, null, `e2e.prj.out.${stamp}`, ['employee']);
ok('6 nhân viên đăng nhập', [D, A, PM, Dev1, Dev2, O].every((x) => !!x.cookie));
// Hợp đồng bán có 2 đợt (Sale = PM để có quyền tạo; kế toán thấy hết)
const cust = (await json(PM.cookie, 'POST', '/api/sales/customers', { name: `Khách DA ${stamp}` })).body;
const kcode = `HD-P-${stamp}`;
const kc = await json(PM.cookie, 'POST', '/api/sales/contracts', { code: kcode, customerId: cust, title: 'App đặt lịch', valueBeforeTax: 100_000_000, vatRate: 0, signedOn: today,
  billing: 'Milestone', installments: [{ title: 'Tạm ứng', dueOn: today, amount: 30_000_000 }, { title: 'Nghiệm thu MVP', dueOn: addDays(60), amount: 70_000_000 }] });
ok('Chuẩn bị hợp đồng bán 2 đợt', kc.status === 201, kc);
const K = kc.body;

// ---------- Tạo dự án ----------
const base = { code: `app-${stamp}`, name: 'App đặt lịch', kind: 'Client', salesContractId: K, startOn: addDays(-40), budgetManDays: 60, memberIds: [Dev1.e.id] };
ok('Nhân viên thường không tạo được dự án → 403', (await json(Dev1.cookie, 'POST', '/api/projects', base)).status === 403);
ok('Dự án cho khách mà không gắn hợp đồng → 400', (await json(PM.cookie, 'POST', '/api/projects', { ...base, salesContractId: null })).status === 400);
ok('Mã có dấu cách → 400', (await json(PM.cookie, 'POST', '/api/projects', { ...base, code: 'A B' })).status === 400);
const pr = await json(PM.cookie, 'POST', '/api/projects', base);
ok('Quản lý tạo dự án (201); mã viết hoa', pr.status === 201, pr);
const P1 = pr.body, CODE = `APP-${stamp}`.toUpperCase();
ok('Mã trùng (khác hoa thường) → 400', (await json(PM.cookie, 'POST', '/api/projects', { ...base, code: CODE.toLowerCase() })).status === 400);
const P2 = (await json(PM.cookie, 'POST', '/api/projects', { code: `NB-${stamp}`, name: 'Nội bộ', kind: 'Internal', startOn: addDays(-40), memberIds: [Dev1.e.id] })).body;
const get = async (c: string, id = P1) => json(c, 'GET', `/api/projects/${id}`);
let d = (await get(PM.cookie)).body;
ok('Chi tiết: người tạo là quản lý, Dev1 thành viên, có HĐ (không có số tiền)', d.project.code === CODE && d.members.length === 2
  && d.members.find((m: any) => m.employeeId === PM.e.id).role === 'Manager' && d.project.contract?.code === kcode && !('totalValue' in (d.project.contract ?? {})), d.project);
ok('Người ngoài xem → 404; danh sách không có', (await get(O.cookie)).status === 404 && !((await json(O.cookie, 'GET', '/api/projects')).body as any[]).some((p) => p.id === P1));
ok('Thành viên xem được, không quản lý', (await get(Dev1.cookie)).body.project.canManage === false && (await get(Dev1.cookie)).body.project.canWork === true);
ok('Kế toán (Xem tài chính) xem được (chỉ đọc)', (await get(A.cookie)).status === 200 && (await get(A.cookie)).body.project.canWork === false);
ok('Không đổi mã dự án → 400', (await json(PM.cookie, 'PUT', `/api/projects/${P1}`, { ...base, code: 'KHAC' })).status === 400);

// ---------- Thành viên ----------
ok('Thành viên không thêm người → 403', (await json(Dev1.cookie, 'POST', `/api/projects/${P1}/members`, { employeeIds: [Dev2.e.id] })).status === 403);
ok('Quản lý thêm Dev2', (await json(PM.cookie, 'POST', `/api/projects/${P1}/members`, { employeeIds: [Dev2.e.id], role: 'Member' })).status === 204);
ok('Dev2 nhận chuông được thêm vào dự án (link /projects)', ((await json(Dev2.cookie, 'GET', '/api/notifications?take=20')).body?.items ?? []).some((n: any) => n.category === 'project_member_added' && n.link === `/projects/${P1}`));
ok('Bỏ quản lý cuối cùng → 409', (await json(PM.cookie, 'DELETE', `/api/projects/${P1}/members/${PM.e.id}`)).status === 409
  && (await json(PM.cookie, 'PUT', `/api/projects/${P1}/members/${PM.e.id}`, { role: 'Member' })).status === 409);

// ---------- Kho tài liệu dự án (Documents đọc qua module Projects) ----------
const spaces = async (c: string) => (await json(c, 'GET', '/api/documents/spaces')).body as any[];
ok('Kho dự án hiện với thành viên, quản lý dự án quản lý kho; người ngoài không thấy', (await spaces(Dev2.cookie)).some((s) => s.kind === 'Project' && s.id === P1)
  && (await spaces(PM.cookie)).find((s) => s.id === P1)?.canManage === true && !(await spaces(O.cookie)).some((s) => s.id === P1));
ok('Thành viên tạo thư mục trong kho dự án', (await json(Dev1.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P1, parentId: null, name: `Thiết kế ${stamp}` })).status === 200);
ok('Người ngoài tạo thư mục kho dự án → 403', (await json(O.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P1, parentId: null, name: 'x' })).status === 403);
ok('API dự án cũ ở Documents đã bỏ', [404, 405].includes((await json(PM.cookie, 'GET', '/api/documents/projects')).status));

// ---------- Mốc nghiệm thu ↔ đợt thu ----------
const insts = (await json(PM.cookie, 'GET', `/api/projects/sales-contracts/${K}/installments`)).body as any[];
ok('Quản lý dự án xem đợt thu của HĐ (không có số tiền)', insts.length === 2 && insts.every((i) => !('amount' in i)), insts);
ok('Người ngoài xem đợt thu → 403', (await json(O.cookie, 'GET', `/api/projects/sales-contracts/${K}/installments`)).status === 403);
const mvp = insts.find((i) => i.title === 'Nghiệm thu MVP');
const m1 = await json(PM.cookie, 'POST', `/api/projects/${P1}/milestones`, { title: 'MVP', dueOn: addDays(30), installmentId: mvp.id });
ok('Tạo mốc gắn đợt thu', m1.status === 201, m1);
ok('Gắn cùng đợt cho mốc khác → 400', (await json(PM.cookie, 'POST', `/api/projects/${P1}/milestones`, { title: 'X', installmentId: mvp.id })).status === 400);
ok('Dự án nội bộ (không HĐ) gắn đợt thu → 400', (await json(PM.cookie, 'POST', `/api/projects/${P2}/milestones`, { title: 'X', installmentId: mvp.id })).status === 400);
ok('Thành viên không nghiệm thu được → 403', (await json(Dev1.cookie, 'POST', `/api/projects/milestones/${m1.body}/accept`, { acceptedOn: today })).status === 403);
ok('Nghiệm thu ngày tương lai → 400', (await json(PM.cookie, 'POST', `/api/projects/milestones/${m1.body}/accept`, { acceptedOn: addDays(1) })).status === 400);
ok('Quản lý nghiệm thu hôm nay → 204', (await json(PM.cookie, 'POST', `/api/projects/milestones/${m1.body}/accept`, { acceptedOn: today, note: 'Khách ký biên bản' })).status === 204);
const kd = (await json(A.cookie, 'GET', `/api/sales/contracts/${K}`)).body;
ok('Đợt thu "Nghiệm thu MVP" kéo hạn về hôm nay → Sắp đến hạn', kd.installments.find((i: any) => i.title === 'Nghiệm thu MVP')?.dueOn === today
  && kd.installments.find((i: any) => i.title === 'Nghiệm thu MVP')?.state === 'DueSoon', kd.installments);
ok('Kế toán nhận chuông "Đã nghiệm thu"', ((await json(A.cookie, 'GET', '/api/notifications?take=20')).body?.items ?? []).some((n: any) => n.category === 'receivable_due' && n.title.includes('Đã nghiệm thu')));
ok('Nghiệm thu lần hai → 409; xoá mốc đã nghiệm thu → 409', (await json(PM.cookie, 'POST', `/api/projects/milestones/${m1.body}/accept`, { acceptedOn: today })).status === 409
  && (await json(PM.cookie, 'DELETE', `/api/projects/milestones/${m1.body}`)).status === 409);
d = (await get(PM.cookie)).body;
ok('Mốc hiện trạng thái Đã nghiệm thu + tên đợt thu', d.milestones[0].status === 'Accepted' && d.milestones[0].installmentTitle === 'Nghiệm thu MVP' && d.milestones[0].acceptedByName === 'Quản Lý DA');

// ---------- Công việc ----------
const t1 = await json(PM.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'Màn đăng nhập', assigneeEmployeeId: Dev1.e.id, dueOn: addDays(-1), estimateDays: 2, milestoneId: m1.body });
const t2 = await json(Dev1.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'API đặt lịch', assigneeEmployeeId: Dev2.e.id });
ok('Tạo việc (quản lý + thành viên)', t1.status === 201 && t2.status === 201, [t1, t2]);
ok('Giao cho người ngoài dự án → 400', (await json(PM.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'x', assigneeEmployeeId: O.e.id })).status === 400);
ok('Người ngoài tạo việc → 404', (await json(O.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'x' })).status === 404);
ok('Kế toán (chỉ xem) tạo việc → 403', (await json(A.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'x' })).status === 403);
const tasks = async (c: string) => (await json(c, 'GET', `/api/projects/${P1}/tasks`)).body as any[];
let ts = await tasks(Dev1.cookie);
ok('Mã việc theo dự án (CODE-1, CODE-2); việc 1 quá hạn', ts.find((t) => t.id === t1.body)?.code === `${CODE}-1` && ts.find((t) => t.id === t2.body)?.code === `${CODE}-2`
  && ts.find((t) => t.id === t1.body)?.overdue === true, ts);
ok('Dev1 nhận chuông được giao việc', ((await json(Dev1.cookie, 'GET', '/api/notifications?take=20')).body?.items ?? []).some((n: any) => n.category === 'project_task' && n.title.includes(`${CODE}-1`)));
ok('Việc của tôi (Dev1) có việc 1 kèm tên dự án', ((await json(Dev1.cookie, 'GET', '/api/projects/tasks/mine')).body as any[]).some((t) => t.id === t1.body && t.projectName === 'App đặt lịch'));
ok('Kéo sang Xong → hết quá hạn, có thời điểm xong', (await json(Dev1.cookie, 'POST', `/api/projects/tasks/${t1.body}/move`, { state: 'Done' })).status === 204
  && (await tasks(Dev1.cookie)).find((t) => t.id === t1.body).overdue === false && !!(await tasks(Dev1.cookie)).find((t) => t.id === t1.body).completedAt);
ok('Việc của tôi bỏ việc đã xong', !((await json(Dev1.cookie, 'GET', '/api/projects/tasks/mine')).body as any[]).some((t) => t.id === t1.body));
ok('Bình luận (thành viên) → người được giao nhận chuông', (await json(PM.cookie, 'POST', `/api/projects/tasks/${t2.body}/comments`, { content: 'Ưu tiên tuần này' })).status === 201
  && ((await json(Dev2.cookie, 'GET', `/api/projects/tasks/${t2.body}/comments`)).body as any[]).length === 1
  && ((await json(Dev2.cookie, 'GET', '/api/notifications?take=20')).body?.items ?? []).some((n: any) => n.title.includes('bình luận')));
ok('Người ngoài đọc bình luận → 404', (await json(O.cookie, 'GET', `/api/projects/tasks/${t2.body}/comments`)).status === 404);
ok('Dev2 (không tạo, không quản lý) xoá việc → 403', (await json(Dev2.cookie, 'DELETE', `/api/projects/tasks/${t2.body}`)).status === 403);
d = (await get(PM.cookie)).body;
ok('Đếm việc + mốc trên dự án', d.project.tasks.open === 1 && d.project.tasks.done === 1 && d.milestones[0].tasksDone === 1, d.project.tasks);

// ---------- Phân bổ + ngày công ----------
const month = today.slice(0, 8) + '01';
ok('Thành viên không phân bổ → 403', (await json(Dev1.cookie, 'PUT', `/api/projects/${P1}/allocations`, { month, items: [{ employeeId: Dev1.e.id, percent: 50 }] })).status === 403);
ok('Phân bổ Dev1 70% ở dự án 1', (await json(PM.cookie, 'PUT', `/api/projects/${P1}/allocations`, { month, items: [{ employeeId: Dev1.e.id, percent: 70 }] })).status === 204);
ok('Dự án 2 đặt Dev1 40% → tổng 110% → 400', (await json(PM.cookie, 'PUT', `/api/projects/${P2}/allocations`, { month, items: [{ employeeId: Dev1.e.id, percent: 40 }] })).status === 400);
ok('Phân bổ người ngoài dự án → 400', (await json(PM.cookie, 'PUT', `/api/projects/${P1}/allocations`, { month, items: [{ employeeId: O.e.id, percent: 10 }] })).status === 400);
const ef = (await json(PM.cookie, 'GET', `/api/projects/${P1}/effort`)).body;
const cell = (eid: string) => ef.cells.find((c: any) => c.employeeId === eid && c.month === month);
ok('Ngày công: tháng này Dev1 70% (đặt tay), Dev2 100% (chỉ 1 dự án), PM 50% (2 dự án), có ngân sách 60', cell(Dev1.e.id)?.percent === 70 && cell(Dev1.e.id)?.explicit === true
  && cell(Dev2.e.id)?.percent === 100 && cell(PM.e.id)?.percent === 50 && ef.budgetManDays === 60 && ef.months.length >= 2, ef);
ok('Thành viên xem ngày công → 403; giám đốc (Xem tài chính) xem được', (await json(Dev1.cookie, 'GET', `/api/projects/${P1}/effort`)).status === 403
  && (await json(D.cookie, 'GET', `/api/projects/${P1}/effort`)).status === 200);
ok('Bỏ đặt tay (null) → về mặc định', (await json(PM.cookie, 'PUT', `/api/projects/${P1}/allocations`, { month, items: [{ employeeId: Dev1.e.id, percent: null }] })).status === 204
  && ((await json(PM.cookie, 'GET', `/api/projects/${P1}/effort`)).body.cells as any[]).find((c) => c.employeeId === Dev1.e.id && c.month === month).percent === 50);

// ---------- Bàn giao (HR, kho tài liệu) → thành viên dự án ----------
const hrLogin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const ho = await json(hrLogin, 'POST', '/api/documents/admin/handover', { fromEmployeeId: Dev2.e.id, toEmployeeId: O.e.id });
ok('Bàn giao Dev2 → người ngoài: được thêm vào dự án (module Projects)', ho.status === 200 && (await get(O.cookie)).status === 200
  && (await get(PM.cookie)).body.members.find((m: any) => m.employeeId === O.e.id)?.role === 'Member', ho);

// ---------- Đóng dự án ----------
ok('Đóng dự án', (await json(PM.cookie, 'PUT', `/api/projects/${P1}`, { ...base, code: CODE, status: 'Closed' })).status === 204);
ok('Dự án đóng: kho tài liệu chỉ đọc (tạo thư mục → 403), không tạo việc (409)', (await json(Dev1.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P1, parentId: null, name: 'Sau đóng' })).status === 403
  && (await json(Dev1.cookie, 'POST', `/api/projects/${P1}/tasks`, { title: 'x' })).status === 409 && (await spaces(Dev1.cookie)).find((s) => s.id === P1)?.closed === true);

// ---------- Token AI ----------
const tok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e prj ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI không gọi được /api/projects → 403', (await fetch(`${API}/api/projects`, { headers: { authorization: `Bearer ${tok}` } })).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
