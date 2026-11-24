// E2E: thao tác hàng loạt trên việc — API POST /api/projects/{id}/tasks/bulk: chuyển trạng thái / giao người / đổi hạn (đặt – xoá – dời) /
// thêm – bỏ người theo dõi / xoá (bắt chữ "delete"), THÀNH CÔNG TỪNG PHẦN (việc không đủ quyền / sai quy trình bị bỏ qua + lý do),
// quyền (thành viên / người ngoài / chỉ-người-tạo-xoá), đi lần lượt, token AI bị chặn, giới hạn 100 việc.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3). Dựng Api như đầu project-wiki-e2e.ts (đổi cổng / tên container), rồi:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5195 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-bulk-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5195';
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
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);

// ---------- Chuẩn bị: PM (quản lý dự án), M1 + M2 (thành viên), X (người ngoài) ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV bulk ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Bulk đội ${stamp}`, code: `BD${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`BM${stamp}`, 'Quản Lý Bulk', `e2e.bulk.pm.${stamp}`, ['employee', 'manager']);
const M1 = await mkEmp(`B1${stamp}`, 'Thành Viên Một', `e2e.bulk.m1.${stamp}`, ['employee']);
const M2 = await mkEmp(`B2${stamp}`, 'Thành Viên Hai', `e2e.bulk.m2.${stamp}`, ['employee']);
const X = await mkEmp(`BX${stamp}`, 'Người Ngoài', `e2e.bulk.x.${stamp}`, ['employee']);
ok('4 nhân viên đăng nhập', [PM, M1, M2, X].every((x) => !!x.cookie));

const created = await json(PM.cookie, 'POST', '/api/projects', { code: `BULK${stamp}`.toUpperCase(), name: `Hàng loạt ${stamp}`, kind: 'Internal', sequential: false, memberIds: [M1.e.id, M2.e.id] });
const P = created.body?.id ?? created.body;
ok('PM tạo dự án + 2 thành viên', created.status === 201 || created.status === 200, created);
const detail = await json(PM.cookie, 'GET', `/api/projects/${P}`);
const cols = detail.body.columns as { id: string; name: string; isDone: boolean }[];
const [todo, doing] = cols;
const B = `/api/projects/${P}/tasks/bulk`;
const mkTask = async (cookie: string, title: string, extra: object = {}) =>
  (await json(cookie, 'POST', `/api/projects/${P}/tasks`, { title, columnId: todo.id, ...extra })).body as { id: string };
const getTask = async (id: string) => (await json(PM.cookie, 'GET', `/api/projects/tasks/${id}`)).body;
const list = async () => (await json(PM.cookie, 'GET', `/api/projects/${P}/tasks`)).body as any[];

// 6 việc: t1..t3 do M1 tạo, t4..t6 do PM tạo
const t = [] as { id: string }[];
for (let i = 1; i <= 3; i++) t.push(await mkTask(M1.cookie, `Việc M1 ${i}`, { dueOn: '2030-06-10' }));
for (let i = 4; i <= 6; i++) t.push(await mkTask(PM.cookie, `Việc PM ${i}`));
ok('Tạo 6 việc', t.every((x) => !!x.id), t);
const ids = t.map((x) => x.id);

// ---------- Kiểm tra yêu cầu ----------
ok('Thao tác lạ → 400', (await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'archive' })).status === 400);
ok('Không chọn việc → 400', (await json(M1.cookie, 'POST', B, { taskIds: [], action: 'assign' })).status === 400);
ok('> 100 việc → 400', (await json(M1.cookie, 'POST', B, { taskIds: Array.from({ length: 101 }, () => crypto.randomUUID()), action: 'assign' })).status === 400);
ok('Chuyển không có cột → 400', (await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'move' })).status === 400);
ok('Xoá không gõ "delete" → 400, chưa xoá gì', (await json(PM.cookie, 'POST', B, { taskIds: ids, action: 'delete', confirm: 'xoá' })).status === 400 && (await list()).length === 6);
ok('Người ngoài → 404', (await json(X.cookie, 'POST', B, { taskIds: ids, action: 'assign', assigneeEmployeeId: null })).status === 404);

// ---------- Chuyển trạng thái ----------
const mv = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'move', columnId: doing.id });
ok('Chuyển 6 việc sang "Đang làm" → cả 6 áp dụng', mv.status === 200 && mv.body.applied.length === 6 && mv.body.skipped.length === 0, mv);
ok('Cột mới đã đổi', (await list()).every((x) => x.columnId === doing.id));
const mvSame = await json(M1.cookie, 'POST', B, { taskIds: ids.slice(0, 2), action: 'move', columnId: doing.id });
ok('Chuyển lại cùng cột → không lỗi', mvSame.status === 200 && mvSame.body.skipped.length === 0, mvSame);

// ---------- Giao người ----------
const as = await json(M1.cookie, 'POST', B, { taskIds: ids.slice(0, 3), action: 'assign', assigneeEmployeeId: M2.e.id });
ok('Giao 3 việc cho M2', as.status === 200 && as.body.applied.length === 3, as);
ok('Người làm đã đổi, hạn giữ nguyên', (await getTask(ids[0])).task.assigneeEmployeeId === M2.e.id && (await getTask(ids[0])).task.dueOn === '2030-06-10');
const asBad = await json(M1.cookie, 'POST', B, { taskIds: [ids[3]], action: 'assign', assigneeEmployeeId: X.e.id });
ok('Giao cho người không phải thành viên → bỏ qua có lý do', asBad.status === 200 && asBad.body.applied.length === 0 && asBad.body.skipped.length === 1 && !!asBad.body.skipped[0].reason, asBad);
const un = await json(M1.cookie, 'POST', B, { taskIds: ids.slice(0, 3), action: 'assign', assigneeEmployeeId: null });
ok('Bỏ giao (null)', un.status === 200 && un.body.applied.length === 3 && (await getTask(ids[0])).task.assigneeEmployeeId === null, un);

// ---------- Đổi hạn ----------
const sh = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'due', dueMode: 'shift', shiftDays: 7 });
ok('Dời +7 ngày: 3 việc có hạn đổi, 3 việc chưa có hạn bị bỏ qua', sh.status === 200 && sh.body.applied.length === 3 && sh.body.skipped.length === 3, sh);
ok('Hạn mới 2030-06-17', (await getTask(ids[0])).task.dueOn === '2030-06-17');
const st = await json(M1.cookie, 'POST', B, { taskIds: ids.slice(3), action: 'due', dueMode: 'set', dueOn: '2031-01-15' });
ok('Đặt hạn cho 3 việc chưa có hạn', st.status === 200 && st.body.applied.length === 3 && (await getTask(ids[4])).task.dueOn === '2031-01-15', st);
const cl = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'due', dueMode: 'clear' });
ok('Xoá hạn cả 6', cl.status === 200 && cl.body.applied.length === 6 && (await list()).every((x) => x.dueOn === null), cl);
ok('Dời hạn 0 ngày → 400', (await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'due', dueMode: 'shift', shiftDays: 0 })).status === 400);

// ---------- Người theo dõi ----------
const fo = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'follow', followerEmployeeId: M2.e.id });
ok('Thêm M2 theo dõi 6 việc', fo.status === 200 && fo.body.applied.length === 6 && (await list()).every((x) => x.followerCount === 1), fo);
const fo2 = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'follow', followerEmployeeId: M2.e.id });
ok('Thêm lại → không lỗi', fo2.status === 200 && fo2.body.skipped.length === 0, fo2);
const foBad = await json(M1.cookie, 'POST', B, { taskIds: ids.slice(0, 2), action: 'follow', followerEmployeeId: X.e.id });
ok('Người ngoài dự án làm người theo dõi → bỏ qua cả 2', foBad.status === 200 && foBad.body.skipped.length === 2, foBad);
const unf = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'unfollow', followerEmployeeId: M2.e.id });
ok('Bỏ theo dõi', unf.status === 200 && unf.body.applied.length === 6 && (await list()).every((x) => (x.followerCount ?? 0) === 0), unf);

// ---------- Xoá: từng phần theo quyền (thành viên chỉ xoá việc do mình tạo) ----------
const del1 = await json(M1.cookie, 'POST', B, { taskIds: ids, action: 'delete', confirm: 'DELETE' });
ok('M1 xoá 6 việc: 3 việc do M1 tạo xoá được, 3 việc do PM tạo bị bỏ qua (có lý do)', del1.status === 200 && del1.body.applied.length === 3 && del1.body.skipped.length === 3
  && del1.body.skipped.every((s: any) => !!s.reason && !!s.code), del1);
ok('Còn 3 việc của PM', (await list()).length === 3);
const del2 = await json(PM.cookie, 'POST', B, { taskIds: [...ids, crypto.randomUUID()], action: 'delete', confirm: ' delete ' });
ok('PM xoá: 3 việc còn lại xoá được; việc đã xoá + id lạ → bỏ qua', del2.status === 200 && del2.body.applied.length === 3 && del2.body.skipped.length === 4, del2);
ok('Không còn việc nào', (await list()).length === 0);

// ---------- Việc thuộc dự án khác ----------
const other = await json(PM.cookie, 'POST', '/api/projects', { code: `BULO${stamp}`.toUpperCase(), name: `Dự án khác ${stamp}`, kind: 'Internal', sequential: false });
const P2 = other.body?.id ?? other.body;
const od = await json(PM.cookie, 'GET', `/api/projects/${P2}`);
const ot = (await json(PM.cookie, 'POST', `/api/projects/${P2}/tasks`, { title: 'Việc dự án khác', columnId: od.body.columns[0].id })).body;
const cross = await json(PM.cookie, 'POST', B, { taskIds: [ot.id], action: 'delete', confirm: 'delete' });
ok('Id việc của dự án khác → bỏ qua, không xoá', cross.status === 200 && cross.body.applied.length === 0 && cross.body.skipped.length === 1
  && (await json(PM.cookie, 'GET', `/api/projects/${P2}/tasks`)).body.length === 1, cross);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
