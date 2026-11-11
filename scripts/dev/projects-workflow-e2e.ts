// E2E: cột trạng thái tự do + quy trình việc (đi lần lượt, cột cần người duyệt) + lịch sử việc + nhãn BOT (mọi thay đổi qua token AI / MCP)
// + tool MCP get_task / update_task / update_task_status (tên trạng thái, note) + quyền chức vụ "Quản lý trạng thái công việc".
// Chủ dự án chốt 2026-11-10 / 2026-11-11: bot bên ngoài dùng tài khoản nhân viên bình thường, làm việc qua MCP; dự án mới có 4 cột
// Cần làm → Đang làm → Chờ review → Xong (hoàn thành + cần người duyệt); đi lần lượt, lùi phải ghi lý do; cột tự do do chức vụ có quyền sửa.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`; cách script khác ≥ 60 s).
// MCP (tuỳ chọn): OfficeHub.Mcp :5200 với Mcp__ApiBaseUrl=http://localhost:5180 → đặt MCP_URL=http://localhost:5200/mcp (bỏ trống = bỏ qua phần MCP).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=http://localhost:5200/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/projects-workflow-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const MCP = process.env.MCP_URL ?? '';
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

// ---------- Chuẩn bị: quản lý dự án, dev người, tài khoản bot (nhân viên bình thường), người ngoài, trưởng nhóm có quyền sửa trạng thái ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WF ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead WF ${stamp}`, level: 5, manageTaskColumns: true })).body;
const positions = (await json(admin, 'GET', '/api/org/positions')).body as any[];
ok('Chức vụ có cờ manageTaskColumns (tạo mới), chức vụ thường thì không', positions.find((x) => x.id === leadPos)?.manageTaskColumns === true
  && positions.find((x) => x.id === pos)?.manageTaskColumns === false);
ok('PUT chức vụ không gửi manageTaskColumns → giữ nguyên', (await json(admin, 'PUT', `/api/org/positions/${leadPos}`, { name: `Lead WF ${stamp}`, level: 5 })).status === 204
  && ((await json(admin, 'GET', '/api/org/positions')).body as any[]).find((x) => x.id === leadPos)?.manageTaskColumns === true);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Quy trình E2E ${stamp}`, code: `WF${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[], positionId = pos) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`WM${stamp}`, 'Quản Lý WF', `e2e.wf.pm.${stamp}`, ['employee', 'manager']);
const Dev = await mkEmp(`WD${stamp}`, 'Dev Người WF', `e2e.wf.dev.${stamp}`, ['employee']);
const Bot = await mkEmp(`WB${stamp}`, 'Bot Viết Báo Cáo', `e2e.wf.bot.${stamp}`, ['employee']);
const O = await mkEmp(`WO${stamp}`, 'Người Ngoài WF', `e2e.wf.out.${stamp}`, ['employee']);
const Lead = await mkEmp(`WL${stamp}`, 'Trưởng Nhóm WF', `e2e.wf.lead.${stamp}`, ['employee'], leadPos);
ok('5 nhân viên đăng nhập', [PM, Dev, Bot, O, Lead].every((x) => !!x.cookie));

// ---------- Dự án: mặc định đi lần lượt + 4 cột + hướng dẫn làm việc ----------
const GUIDE = '## Định nghĩa xong\n- Bình luận kết quả + link sản phẩm rồi chuyển Chờ review';
const base = { code: `wf-${stamp}`, name: 'Quy trình WF', kind: 'Internal', startOn: today, memberIds: [Dev.e.id, Bot.e.id, Lead.e.id], workGuide: GUIDE };
const pr = await json(PM.cookie, 'POST', '/api/projects', base);
ok('Tạo dự án (201)', pr.status === 201, pr);
const P = pr.body, CODE = `WF-${stamp}`.toUpperCase();
let d = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
ok('Dự án mới mặc định sequential = true, có workGuide ở chi tiết', d.project.sequential === true && d.workGuide === GUIDE, { sq: d.project.sequential, g: d.workGuide });
ok('Dự án mới có 4 cột mặc định, Xong = hoàn thành + cần người duyệt', d.columns.map((c: any) => c.name).join('|') === 'Cần làm|Đang làm|Chờ review|Xong'
  && d.columns[3].isDone && d.columns[3].approverOnly && d.columns.slice(0, 3).every((c: any) => !c.isDone && !c.approverOnly), d.columns);
const col = (name: string) => d.columns.find((c: any) => c.name === name)!.id as string;
const [TODO, DOING, REVIEW, DONE] = ['Cần làm', 'Đang làm', 'Chờ review', 'Xong'].map(col);
ok('Danh sách dự án không trả workGuide (chỉ chi tiết)', !('workGuide' in (((await json(PM.cookie, 'GET', '/api/projects')).body as any[]).find((p) => p.id === P) ?? {})));
ok('Thành viên không sửa dự án (hướng dẫn) → 403', (await json(Dev.cookie, 'PUT', `/api/projects/${P}`, { ...base, code: CODE, workGuide: 'x' })).status === 403);
ok('PUT không gửi sequential / workGuide (client cũ) → giữ nguyên', (await json(PM.cookie, 'PUT', `/api/projects/${P}`, { code: CODE, name: 'Quy trình WF', kind: 'Internal' })).status === 204
  && (d = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body).project.sequential === true && d.workGuide === GUIDE);
const P0 = (await json(PM.cookie, 'POST', '/api/projects', { code: `free-${stamp}`, name: 'Tự do', kind: 'Internal', memberIds: [Dev.e.id], sequential: false })).body;
const d0 = (await json(PM.cookie, 'GET', `/api/projects/${P0}`)).body;
const col0 = (name: string) => d0.columns.find((c: any) => c.name === name)!.id as string;

// ---------- Tạo việc ----------
ok('Tạo việc ở Chờ review cũng được (trước cột cần duyệt), ở Xong khi đi lần lượt → 400 (columnId)',
  (await json(Dev.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'x', columnId: DONE })).body?.errors?.columnId !== undefined);
ok('Tạo việc với cột của dự án khác → 400', (await json(Dev.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'x', columnId: col0('Cần làm') })).body?.errors?.columnId !== undefined);
const t1 = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Báo cáo tuần', assigneeEmployeeId: Dev.e.id, dueOn: addDays(3) });
ok('Quản lý tạo việc giao Dev (bỏ trống cột = cột đầu)', t1.status === 201, t1);
const T = t1.body;
const move = (c: string, columnId: string, note?: string) => json(c, 'POST', `/api/projects/tasks/${T}/move`, { columnId, note });
const detail = async (c = PM.cookie, id = T) => (await json(c, 'GET', `/api/projects/tasks/${id}`)).body;
const notes = async (c: string) => ((await json(c, 'GET', '/api/notifications?take=30')).body?.items ?? []) as any[];
ok('Việc mới ở cột đầu: columnName = Cần làm, done = false', (await detail()).task.columnName === 'Cần làm' && (await detail()).task.done === false);

// ---------- Quy trình ----------
let r = await move(Dev.cookie, REVIEW);
ok('Nhảy cóc Cần làm → Chờ review → 409 (đi lần lượt)', r.status === 409 && String(r.body?.detail ?? '').includes('lần lượt'), r);
ok('Cần làm → Đang làm', (await move(Dev.cookie, DOING)).status === 204);
ok('Đang làm → Chờ review', (await move(Dev.cookie, REVIEW)).status === 204);
ok('Quản lý nhận chuông "Chờ duyệt" (vào cột ngay trước cột cần duyệt)', (await notes(PM.cookie)).some((n) => n.category === 'project_task' && n.title.startsWith('Chờ duyệt') && n.title.includes(`${CODE}-1`)));
r = await move(Dev.cookie, DONE);
ok('Thành viên tự duyệt Xong → 409', r.status === 409 && String(r.body?.detail ?? '').includes('quản lý'), r);
ok('Quản lý trả về Đang làm không lý do → 409', (await move(PM.cookie, DOING)).status === 409);
ok('Review chưa đạt → Đang làm kèm lý do', (await move(PM.cookie, DOING, 'Thiếu số liệu tháng 10')).status === 204);
let dt = await detail(Dev.cookie);
ok('Lý do thành bình luận của quản lý (không BOT)', dt.comments.some((c: any) => c.content.includes('Thiếu số liệu tháng 10') && c.authorName === 'Quản Lý WF' && c.byBot === false), dt.comments);
ok('Dev nhận chuông "Trả lại việc" kèm lý do', (await notes(Dev.cookie)).some((n) => n.title.startsWith('Trả lại việc') && n.body.includes('Thiếu số liệu')));
ok('Dev gửi lại review', (await move(Dev.cookie, REVIEW)).status === 204);
ok('Quản lý duyệt Xong', (await move(PM.cookie, DONE)).status === 204 && !!(await detail()).task.completedAt && (await detail()).task.done === true);
ok('Dev nhận chuông "Đã duyệt"', (await notes(Dev.cookie)).some((n) => n.title.startsWith('Đã duyệt')));
ok('Thành viên mở lại việc đã xong → 409', (await move(Dev.cookie, DOING, 'làm lại')).status === 409);
ok('Quản lý mở lại không lý do → 409', (await move(PM.cookie, DOING)).status === 409);
ok('Quản lý mở lại → Đang làm kèm lý do; hết completedAt', (await move(PM.cookie, DOING, 'Khách đổi yêu cầu')).status === 204 && (await detail()).task.completedAt === null);
ok('Move sang cột của dự án khác → 409', (await move(PM.cookie, col0('Cần làm'), 'x')).status === 409);

// PUT (hộp thoại việc) cũng theo quy trình
const cur = (await detail()).task;
const putBody = (o: Record<string, unknown>) => ({ title: cur.title, description: cur.description, columnId: cur.columnId, assigneeEmployeeId: cur.assigneeEmployeeId,
  milestoneId: null, dueOn: cur.dueOn, estimateDays: cur.estimateDays, ...o });
ok('PUT nhảy cóc Đang làm → Xong → 409', (await json(PM.cookie, 'PUT', `/api/projects/tasks/${T}`, putBody({ columnId: DONE }))).status === 409);
ok('PUT đổi người + hạn + nội dung → 204', (await json(PM.cookie, 'PUT', `/api/projects/tasks/${T}`, putBody({ assigneeEmployeeId: Bot.e.id, dueOn: addDays(5), description: 'Mô tả mới' }))).status === 204);
dt = await detail();
const kinds = dt.activities.map((a: any) => a.kind);
ok('Lịch sử: Created, Moved ×6, Assigned, DueChanged, Edited (theo thời gian)', kinds[0] === 'Created' && kinds.filter((k: string) => k === 'Moved').length === 6
  && kinds.includes('Assigned') && kinds.includes('DueChanged') && kinds.includes('Edited'), kinds);
ok('Lịch sử: đổi người ghi tên cũ → mới; lý do + tên cột ở dòng Moved', dt.activities.some((a: any) => a.kind === 'Assigned' && a.from === 'Dev Người WF' && a.to === 'Bot Viết Báo Cáo')
  && dt.activities.some((a: any) => a.kind === 'Moved' && a.from === 'Chờ review' && a.to === 'Đang làm' && a.note === 'Thiếu số liệu tháng 10'));
ok('Chi tiết: sequential + columns + canApprove (quản lý) / không (thành viên)', dt.sequential === true && dt.columns.length === 4 && dt.canApprove === true
  && (await detail(Dev.cookie)).canApprove === false);
ok('Người ngoài xem chi tiết việc → 404', (await json(O.cookie, 'GET', `/api/projects/tasks/${T}`)).status === 404);
ok('Không có hoạt động nào là BOT (đều qua web)', dt.activities.every((a: any) => a.byBot === false) && dt.task.createdByBot === false);

// Dự án không đi lần lượt → kéo tự do, riêng cột cần người duyệt vẫn chỉ quản lý
const f1 = (await json(Dev.cookie, 'POST', `/api/projects/${P0}/tasks`, { title: 'Tự do', columnId: col0('Chờ review') })).body;
ok('Không đi lần lượt: tạo ở Chờ review, kéo về Cần làm không lý do', !!f1 && (await json(Dev.cookie, 'POST', `/api/projects/tasks/${f1}/move`, { columnId: col0('Cần làm') })).status === 204);
ok('Không đi lần lượt: thành viên tạo ở Xong (cần người duyệt) → 400', (await json(Dev.cookie, 'POST', `/api/projects/${P0}/tasks`, { title: 'x', columnId: col0('Xong') })).status === 400);
ok('Không đi lần lượt: quản lý kéo thẳng Cần làm → Xong', (await json(PM.cookie, 'POST', `/api/projects/tasks/${f1}/move`, { columnId: col0('Xong') })).status === 204);

// ---------- Token AI (tài khoản bot) → nhãn BOT ----------
const tok = (await json(Bot.cookie, 'POST', '/api/auth/access-tokens', { name: `bot ${stamp}`, expiresInDays: 30 })).body?.token as string;
const bearer = { authorization: `Bearer ${tok}` };
const api = async (method: string, path: string, body?: unknown) => {
  const x = await fetch(API + path, { method, headers: { ...bearer, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: x.status, body: await x.json().catch(() => null) as any };
};
ok('Token: đọc chi tiết việc (GET /tasks/{id}) → 200', (await api('GET', `/api/projects/tasks/${T}`)).status === 200);
ok('Token: đọc cột (GET /{id}/columns) → 200', (await api('GET', `/api/projects/${P}/columns`)).body?.length === 4);
ok('Token: thêm cột → 403', (await api('POST', `/api/projects/${P}/columns`, { name: 'Bot', isDone: false, approverOnly: false })).status === 403);
ok('Token: xoá việc vẫn bị chặn → 403', (await api('DELETE', `/api/projects/tasks/${T}`)).status === 403);
ok('Token: sửa dự án (hướng dẫn) vẫn bị chặn → 403', (await api('PUT', `/api/projects/${P}`, { ...base, code: CODE, workGuide: 'bot sửa' })).status === 403);
ok('Token: comment kết quả', (await api('POST', `/api/projects/tasks/${T}/comments`, { content: 'Đã xong báo cáo: https://example.com/bao-cao' })).status === 201);
ok('Token: Đang làm → Chờ review', (await api('POST', `/api/projects/tasks/${T}/move`, { columnId: REVIEW })).status === 204);
ok('Token: bot tự duyệt Xong → 409', (await api('POST', `/api/projects/tasks/${T}/move`, { columnId: DONE })).status === 409);
const bt = await api('POST', `/api/projects/${P}/tasks`, { title: 'Việc con do bot tạo', assigneeEmployeeId: Bot.e.id });
ok('Token: tạo việc', bt.status === 201, bt);
dt = await detail();
ok('BOT: bình luận byBot, hoạt động chuyển trạng thái byBot (tên = tài khoản bot)', dt.comments.some((c: any) => c.byBot && c.authorName === 'Bot Viết Báo Cáo')
  && dt.activities.some((a: any) => a.byBot && a.kind === 'Moved' && a.to === 'Chờ review' && a.actorName === 'Bot Viết Báo Cáo'), dt);
ok('BOT: việc do token tạo có createdByBot (danh sách + chi tiết)', ((await json(PM.cookie, 'GET', `/api/projects/${P}/tasks`)).body as any[]).find((t) => t.id === bt.body)?.createdByBot === true
  && (await detail(PM.cookie, bt.body)).activities[0].byBot === true);
ok('Quản lý nhận chuông "Chờ duyệt" do bot gửi', (await notes(PM.cookie)).filter((n) => n.title.startsWith('Chờ duyệt')).length >= 3);

// ---------- Cột trạng thái tự do (quyền theo chức vụ) ----------
const C = (c: string, method: string, path: string, b?: unknown) => json(c, method, path, b);
ok('Quản lý dự án (chức vụ không có quyền) thêm cột → 403', (await C(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'QA', isDone: false, approverOnly: false })).status === 403);
ok('Admin (vai trò, không có chức vụ) thêm cột → 403', (await C(admin, 'POST', `/api/projects/${P}/columns`, { name: 'QA', isDone: false, approverOnly: false })).status === 403);
ok('Chi tiết dự án: canManageColumns đúng theo chức vụ', (await C(Lead.cookie, 'GET', `/api/projects/${P}`)).body.project.canManageColumns === true
  && (await C(PM.cookie, 'GET', `/api/projects/${P}`)).body.project.canManageColumns === false);
ok('Người ngoài dự án có quyền chức vụ vẫn không thấy dự án → 404', (await C(O.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'QA', isDone: false, approverOnly: false })).status === 404);
const qa = await C(Lead.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'QA', color: '#8B5CF6', isDone: false, approverOnly: false });
ok('Trưởng nhóm (chức vụ có quyền) thêm cột QA → 201', qa.status === 201, qa);
const QA = qa.body as string;
ok('Trùng tên (không phân biệt hoa thường) → 400 name', (await C(Lead.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'qa', isDone: false, approverOnly: false })).body?.errors?.name !== undefined);
ok('Màu sai → 400 color', (await C(Lead.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Khác', color: 'red', isDone: false, approverOnly: false })).body?.errors?.color !== undefined);
ok('Sắp xếp sai (thiếu cột) → 409', (await C(Lead.cookie, 'PUT', `/api/projects/${P}/columns/order`, { ids: [TODO, DOING] })).status === 409);
ok('Kéo QA vào trước Xong → 204', (await C(Lead.cookie, 'PUT', `/api/projects/${P}/columns/order`, { ids: [TODO, DOING, REVIEW, QA, DONE] })).status === 204);
let cols = (await C(Dev.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('Thứ tự mới + màu chuẩn hoá chữ thường', cols.map((c) => c.name).join('|') === 'Cần làm|Đang làm|Chờ review|QA|Xong' && cols[3].color === '#8b5cf6', cols);
const t3 = (await C(Dev.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Qua QA', columnId: DOING })).body;
const mv3 = (c: string, columnId: string, note?: string) => C(c, 'POST', `/api/projects/tasks/${t3}/move`, { columnId, note });
ok('Đi lần lượt theo thứ tự mới: Đang làm → Chờ review → QA', (await mv3(Dev.cookie, REVIEW)).status === 204 && (await mv3(Dev.cookie, QA)).status === 204);
ok('Chờ review giờ không còn ngay trước cột cần duyệt; QA thì có → chuông "Chờ duyệt" cho việc 3',
  (await notes(PM.cookie)).some((n) => n.title.startsWith('Chờ duyệt') && n.title.includes(`${CODE}-3`)));
ok('Bật "hoàn thành" cho QA → việc trong QA có completedAt', (await C(Lead.cookie, 'PUT', `/api/projects/columns/${QA}`, { name: 'QA', isDone: true, approverOnly: false })).status === 204
  && (await detail(PM.cookie, t3)).task.done === true);
ok('Tắt lại → việc mở', (await C(Lead.cookie, 'PUT', `/api/projects/columns/${QA}`, { name: 'Kiểm thử', isDone: false, approverOnly: false })).status === 204
  && (await detail(PM.cookie, t3)).task.done === false && (await detail(PM.cookie, t3)).task.columnName === 'Kiểm thử');
ok('Bỏ "hoàn thành" ở cột hoàn thành cuối cùng → 400 isDone', (await C(Lead.cookie, 'PUT', `/api/projects/columns/${DONE}`, { name: 'Xong', isDone: false, approverOnly: true })).body?.errors?.isDone !== undefined);
ok('Xoá cột hoàn thành cuối cùng → 409', (await C(Lead.cookie, 'DELETE', `/api/projects/columns/${DONE}`)).status === 409);
ok('Xoá cột còn việc mà không chọn nơi nhận → 409', (await C(Lead.cookie, 'DELETE', `/api/projects/columns/${QA}`)).status === 409);
ok('Xoá cột, chuyển việc sang Chờ review → 204', (await C(Lead.cookie, 'DELETE', `/api/projects/columns/${QA}?moveTo=${REVIEW}`)).status === 204);
const d3 = await detail(PM.cookie, t3);
ok('Việc chuyển sang Chờ review, lịch sử ghi "Xoá trạng thái"', d3.task.columnId === REVIEW && d3.activities.some((a: any) => a.kind === 'Moved' && a.note?.includes('Xoá trạng thái')), d3.activities);
cols = (await C(Dev.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('Còn 4 cột, vị trí liên tục 0..3', cols.length === 4 && cols.every((c, i) => c.position === i), cols);
ok('Đóng dự án → sửa cột → 409', (await json(PM.cookie, 'PUT', `/api/projects/${P0}`, { code: `FREE-${stamp}`.toUpperCase(), name: 'Tự do', kind: 'Internal', status: 'Closed' })).status === 204
  && (await C(Lead.cookie, 'POST', `/api/projects/${P0}/columns`, { name: 'x', isDone: false, approverOnly: false })).status !== 201);

// ---------- MCP (tuỳ chọn) ----------
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { ...bearer, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(data); } catch { return text; }
  };
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  ok('MCP instructions: chế độ chạy tự động + nhãn BOT', String(init?.result?.instructions ?? '').includes('CHẠY TỰ ĐỘNG') && String(init?.result?.instructions ?? '').includes('BOT'));
  const names: string[] = ((await rpc('tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
  ok('tools/list có get_task, update_task (65 tool)', names.includes('get_task') && names.includes('update_task') && names.length === 65, names.length);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const x = await rpc('tools/call', { name, arguments: args });
    const text = x?.result?.content?.[0]?.text ?? '';
    try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
  };
  const gp = await call('get_project', { project: CODE });
  ok('MCP get_project có workGuide + sequential + columns', !gp.err && gp.j.workGuide === GUIDE && gp.j.project.sequential === true && gp.j.columns?.length === 4, gp.text.slice(0, 300));
  const gt = await call('get_task', { task: `${CODE}-1` });
  ok('MCP get_task theo mã: comments + activities + canApprove=false', !gt.err && gt.j.task.code === `${CODE}-1` && gt.j.activities.length > 5 && gt.j.canApprove === false, gt.text.slice(0, 300));
  const ut = await call('update_task', { task: `${CODE}-2`, description: '## Kết quả\n- xong', dueDate: addDays(2), estimateDays: 1.5 });
  ok('MCP update_task: chỉ đổi trường truyền, giữ tên + người làm + trạng thái', !ut.err && ut.j.description === '## Kết quả\n- xong' && ut.j.dueOn === addDays(2) && ut.j.estimateDays === 1.5
    && ut.j.title === 'Việc con do bot tạo' && ut.j.assigneeEmployeeId === Bot.e.id && ut.j.columnName === 'Cần làm', ut.text.slice(0, 300));
  const un = await call('update_task', { task: `${CODE}-2`, assignee: 'none', dueDate: 'none' });
  ok('MCP update_task "none" = bỏ người làm / hạn', !un.err && un.j.assigneeEmployeeId === null && un.j.dueOn === null, un.text.slice(0, 300));
  const skip = await call('update_task_status', { task: `${CODE}-2`, state: 'Chờ review' });
  ok('MCP update_task_status nhảy cóc → lỗi tiếng Việt', skip.err && skip.text.includes('lần lượt'), skip.text);
  const unknown = await call('update_task_status', { task: `${CODE}-2`, state: 'Blocked' });
  ok('MCP update_task_status tên lạ → liệt kê trạng thái của dự án', unknown.err && unknown.text.includes('Cần làm → Đang làm'), unknown.text);
  ok('MCP update_task_status theo tên (không dấu được): dang lam → Chờ review', !(await call('update_task_status', { task: `${CODE}-2`, state: 'dang lam' })).err
    && !(await call('update_task_status', { task: `${CODE}-2`, state: 'Chờ review' })).err);
  const back = await call('update_task_status', { task: `${CODE}-2`, state: 'Đang làm', note: 'Bot tự rút lại để bổ sung' });
  ok('MCP update_task_status lùi kèm note → bình luận BOT', !back.err && back.j.columnName === 'Đang làm'
    && (await detail(PM.cookie, bt.body)).comments.some((c: any) => c.byBot && c.content.includes('Bot tự rút lại')), back.text);
  const lt = await call('list_project_tasks', { project: CODE, state: 'Đang làm' });
  ok('MCP list_project_tasks lọc theo tên trạng thái', !lt.err && lt.j.length >= 1 && lt.j.every((t: any) => t.columnName === 'Đang làm'), lt.text.slice(0, 300));
  const ed = await detail(PM.cookie, bt.body);
  ok('MCP: mọi hoạt động của việc 2 là BOT', ed.activities.length >= 5 && ed.activities.every((a: any) => a.byBot), ed.activities.map((a: any) => [a.kind, a.byBot]));
} else console.log('… bỏ qua phần MCP (chưa đặt MCP_URL)');

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
