// E2E TEST-39: chỉ chính người viết xoá được bình luận của mình (DELETE /api/projects/comments/{id}); quản lý dự án / HR / admin / người khác 403,
// token AI 403, dự án đóng 409; xoá xong giảm số bình luận + lịch sử "CommentDeleted" (không chép nội dung); canDelete do back-end tính.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`).
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-comment-delete-e2e.ts
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
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    if (!keys[user]) throw new Error(`${user} đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`);
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    const en = await post('/api/auth/2fa/enable', { code }, cookie);
    if (!en.ok) throw new Error(`Không bật được 2FA cho ${user}: ${en.status}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000); // mã đã dùng không dùng lại được
    return login(user, password);
  }
  return cookie;
};
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV BL ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Bình luận E2E ${stamp}`, code: `BL${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`CM${stamp}`, 'Quản Lý BL', `e2e.bl.pm.${stamp}`, ['employee', 'manager']);
const A = await mkEmp(`CA${stamp}`, 'Thành Viên A', `e2e.bl.a.${stamp}`, ['employee']);
const B = await mkEmp(`CB${stamp}`, 'Thành Viên B', `e2e.bl.b.${stamp}`, ['employee']);
ok('3 nhân viên đăng nhập', [PM, A, B].every((x) => !!x.cookie));
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `bl-${stamp}`, name: 'Bình luận BL', kind: 'Internal', startOn: today, memberIds: [A.e.id, B.e.id], sequential: false })).body;
const T = (await json(A.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc có bình luận' })).body;
const comment = async (c: string, text: string) => (await json(c, 'POST', `/api/projects/tasks/${T}/comments`, { content: text })).body as string;
const cA = await comment(A.cookie, 'Bình luận của A');
const cB = await comment(B.cookie, 'Bình luận của B');
const cPM = await comment(PM.cookie, 'Bình luận của PM');
const detail = async (c: string) => (await json(c, 'GET', `/api/projects/tasks/${T}`)).body;
const canDel = (d: any) => Object.fromEntries(d.comments.map((x: any) => [x.content, x.canDelete]));
ok('canDelete chỉ đúng bình luận của mình (A)', JSON.stringify(canDel(await detail(A.cookie))) === JSON.stringify({ 'Bình luận của A': true, 'Bình luận của B': false, 'Bình luận của PM': false }));
ok('canDelete cũng có ở GET /comments', (await json(B.cookie, 'GET', `/api/projects/tasks/${T}/comments`)).body.find((x: any) => x.id === cB)?.canDelete === true);
ok('admin (HR) xem: không có canDelete nào', Object.values(canDel(await detail(admin))).every((x) => x === false));

ok('B xoá bình luận của A → 403', (await json(B.cookie, 'DELETE', `/api/projects/comments/${cA}`)).status === 403);
ok('Quản lý dự án xoá bình luận của A → 403', (await json(PM.cookie, 'DELETE', `/api/projects/comments/${cA}`)).status === 403);
ok('Admin / HR xoá bình luận của A → 403', (await json(admin, 'DELETE', `/api/projects/comments/${cA}`)).status === 403);
const O = await mkEmp(`CO${stamp}`, 'Người Ngoài BL', `e2e.bl.out.${stamp}`, ['employee']);
ok('Người ngoài dự án → 404', (await json(O.cookie, 'DELETE', `/api/projects/comments/${cA}`)).status === 404);
ok('Id không tồn tại → 404', (await json(A.cookie, 'DELETE', `/api/projects/comments/00000000-0000-7000-8000-000000000000`)).status === 404);
const before = (await json(A.cookie, 'GET', `/api/projects/${P}/tasks`)).body.find((t: any) => t.id === T).commentCount;
ok('A xoá bình luận của mình → 204', (await json(A.cookie, 'DELETE', `/api/projects/comments/${cA}`)).status === 204);
const after = (await json(A.cookie, 'GET', `/api/projects/${P}/tasks`)).body.find((t: any) => t.id === T).commentCount;
const d = await detail(PM.cookie);
ok('Số bình luận giảm 3 → 2, bình luận đã mất', before === 3 && after === 2 && !d.comments.some((x: any) => x.id === cA), { before, after });
const del = d.activities.find((a: any) => a.kind === 'CommentDeleted');
ok('Lịch sử: "CommentDeleted" của A, không chép nội dung', del?.actorName === 'Thành Viên A' && !JSON.stringify(del).includes('Bình luận của A'), del);
ok('Xoá lần nữa → 404', (await json(A.cookie, 'DELETE', `/api/projects/comments/${cA}`)).status === 404);

// Bình luận viết qua token AI của chính mình: token không xoá được, chủ token xoá trên web được
const tok = (await json(B.cookie, 'POST', '/api/auth/access-tokens', { name: `b ${stamp}`, expiresInDays: 30 })).body?.token as string;
const bearer = { authorization: `Bearer ${tok}` };
const cBot = (await call(bearer, 'POST', `/api/projects/tasks/${T}/comments`, { content: 'Bot của B viết' })).body as string;
ok('Token AI gọi DELETE → 403 (ngoài allowlist)', (await call(bearer, 'DELETE', `/api/projects/comments/${cBot}`)).status === 403);
ok('Token AI xem: canDelete = false', (await call(bearer, 'GET', `/api/projects/tasks/${T}/comments`)).body.every((x: any) => x.canDelete === false));
ok('B (chủ token) xoá trên web bình luận BOT của mình → 204', (await json(B.cookie, 'DELETE', `/api/projects/comments/${cBot}`)).status === 204);

// Lý do chuyển lùi (thành bình luận) xoá được như bình luận thường
const p2 = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
const [c0, c1] = p2.columns;
await json(A.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: c1.id });
await json(A.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: c0.id, note: 'Thiếu thông tin' });
const noteC = (await detail(A.cookie)).comments.find((x: any) => x.content.includes('Thiếu thông tin'));
ok('Bình luận lý do chuyển lùi: người chuyển xoá được', noteC?.canDelete === true && (await json(A.cookie, 'DELETE', `/api/projects/comments/${noteC.id}`)).status === 204, noteC);

// Dự án đóng → 409, canDelete = false
const pj = p2.project;
await json(PM.cookie, 'PUT', `/api/projects/${P}`, { code: pj.code, name: pj.name, kind: pj.kind, startOn: pj.startOn, status: 'Closed', sequential: pj.sequential });
ok('Dự án đóng: canDelete = false, DELETE → 409', (await detail(B.cookie)).comments.every((x: any) => !x.canDelete)
  && (await json(B.cookie, 'DELETE', `/api/projects/comments/${cB}`)).status === 409);

console.log(`\n${pass} đạt / ${fail} lỗi`);
process.exit(fail ? 1 : 0);
