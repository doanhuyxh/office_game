// E2E TEST-213: dự án ĐÃ ĐÓNG — thành viên thường chỉ bình luận (chữ + ảnh, xoá bình luận của mình), quản lý dự án + HR làm đầy đủ
// (tạo / sửa / chuyển / xoá việc, việc phải chờ, người theo dõi), token AI không ghi việc, link tải lên từ thiết bị khác vẫn chặn;
// kho tài liệu dự án: thành viên thường chỉ đọc (403), quản lý dự án + HR tải lên / thư mục / thay file / xoá; mở lại dự án → như cũ.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + S3 tạm (RustFS trong docker). Dựng như task-comment-files-e2e.ts:
//   docker run -d --name e2e213-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 15473:5432 postgres:17-alpine
//   docker run -d --name e2e213-s3 -p 19473:9000 -e RUSTFS_ACCESS_KEY=e2eaccess -e RUSTFS_SECRET_KEY=e2esecret123 rustfs/rustfs   (+ tạo bucket e2e-files bằng SigV4 PUT)
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5191
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15473;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        S3__Region=us-east-1 S3__ServiceUrl=http://127.0.0.1:19473 S3__ForcePathStyle=true S3__AccessKey=e2eaccess S3__SecretKey=e2esecret123
//        S3__BucketFiles=e2e-files S3__KeyPrefix=e2e/ Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ các Chat__*Key cùng giá trị)
//        Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Database__MigrateOnStartup=true   (.env nạp NoClobber — không để Telegram / FCM thật)
//        Seed__AdminEmail=e2e213-admin@officehub-e2e.vn Seed__AdminPassword=E2e213-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5191 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/closed-project-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5191';
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
const bearer = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
// S3 tạm (RustFS) phục vụ http nhưng SDK ký link https
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);

// ---------- Chuẩn bị: quản lý dự án PM, thành viên M + M2 ----------
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Đóng DA ${stamp}`, code: `DD${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`CM${stamp}`, 'Quản Lý Đóng', `e2e.cls.pm.${stamp}`, ['employee', 'manager']);
const M = await mkEmp(`C1${stamp}`, 'Thành Viên Một', `e2e.cls.m1.${stamp}`, ['employee']);
const M2 = await mkEmp(`C2${stamp}`, 'Thành Viên Hai', `e2e.cls.m2.${stamp}`, ['employee']);
ok('3 nhân viên đăng nhập', [PM, M, M2].every((x) => !!x.cookie));

const CODE = `CLS${stamp}`.toUpperCase();
const base = { code: CODE, name: `Dự án đóng ${stamp}`, kind: 'Internal', sequential: false };
const created = await json(PM.cookie, 'POST', '/api/projects', { ...base, memberIds: [M.e.id, M2.e.id] });
const P = created.body?.id ?? created.body;
ok('PM tạo dự án (không đi lần lượt) + 2 thành viên', created.status === 201 || created.status === 200, created);
const detail = async (c: string) => (await json(c, 'GET', `/api/projects/${P}`)).body;
const d0 = await detail(PM.cookie);
ok('PM là quản lý, M là thành viên', d0.members.find((m: any) => m.employeeId === PM.e.id)?.role === 'Manager'
  && d0.members.find((m: any) => m.employeeId === M.e.id)?.role === 'Member', d0.members);
const cols = d0.columns as any[];
const [c0, c1, c2] = cols;
const mkTask = async (c: string, title: string, extra: Record<string, unknown> = {}) => json(c, 'POST', `/api/projects/${P}/tasks`, { title, ...extra });
const idOf = (r: { body: any }) => (typeof r.body === 'string' ? r.body : r.body?.id) as string;
const tM = idOf(await mkTask(M.cookie, 'Việc của M (tạo khi đang chạy)'));
const tPM = idOf(await mkTask(PM.cookie, 'Việc của PM'));
ok('Dự án đang chạy: thành viên tạo việc được', !!tM && !!tPM);

// Kho tài liệu: tạo sẵn tài liệu của M + PM khi dự án còn chạy
const upload = async (cookie: string, name: string, content: string) => {
  const t = await json(cookie, 'POST', '/api/documents/uploads', { fileName: name, contentType: 'text/plain', size: new Blob([content]).size });
  if (t.status !== 200) return { ticket: t, put: 0 };
  const put = await fetch(s3url(t.body.url), { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: content });
  return { ticket: t, put: put.status };
};
const createAsset = async (cookie: string, name: string, folderId: string | null = null) => {
  const u = await upload(cookie, name, `nội dung ${name}`);
  if (u.ticket.status !== 200) return u.ticket;
  return json(cookie, 'POST', '/api/documents/assets', { ticketId: u.ticket.body.ticketId, spaceKind: 'Project', spaceId: P, folderId,
    docTypeId: null, title: null, description: null, tags: [] });
};
const aM = await createAsset(M.cookie, 'cua-m.txt');
const aPM = await createAsset(PM.cookie, 'cua-pm.txt');
ok('Dự án đang chạy: thành viên + PM tải tài liệu lên kho dự án', aM.status === 200 && aPM.status === 200, [aM, aPM]);
const fOld = await json(PM.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P, parentId: null, name: 'Trước khi đóng' });

// ---------- Đóng dự án ----------
const close = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Closed' });
ok('Đóng dự án', close.status === 204, close);

// ---------- DTO ----------
const dM = (await detail(M.cookie)).project, dPM = (await detail(PM.cookie)).project, dHr = (await detail(admin)).project;
ok('Thành viên: canWork = false, canComment = true', dM.status === 'Closed' && dM.canWork === false && dM.canComment === true, dM);
ok('Quản lý dự án: canWork = true, canComment = true', dPM.canWork === true && dPM.canComment === true, dPM);
ok('HR: canWork = true', dHr.canWork === true, dHr);

// ---------- Thành viên thường: chỉ bình luận ----------
const cr = await mkTask(M.cookie, 'Việc mới sau khi đóng');
ok('Thành viên tạo việc → 409 "chỉ bình luận"', cr.status === 409 && String(cr.body?.detail).includes('chỉ bình luận'), cr);
ok('Thành viên sửa việc → 409', (await json(M.cookie, 'PUT', `/api/projects/tasks/${tM}`, { title: 'Sửa', columnId: c0.id })).status === 409);
ok('Thành viên chuyển việc → 409', (await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/move`, { columnId: c1.id })).status === 409);
ok('Thành viên sửa việc phải chờ → 409', (await json(M.cookie, 'PUT', `/api/projects/tasks/${tM}/dependencies`, { dependsOn: [tPM] })).status === 409);
ok('Thành viên thêm người theo dõi → 409', (await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/followers/${M2.e.id}`)).status === 409);
ok('Thành viên xoá việc mình tạo → 409', (await json(M.cookie, 'DELETE', `/api/projects/tasks/${tM}`)).status === 409);
const cText = await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/comments`, { content: 'Bình luận sau khi đóng' });
ok('Thành viên bình luận chữ → 201', cText.status === 201, cText);
const ticket = await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/uploads`, { fileName: 'anh.png', contentType: 'image/png', size: PNG.length });
ok('Thành viên xin vé tải ảnh → 200', ticket.status === 200, ticket);
const put = await fetch(s3url(ticket.body?.url ?? 'http://127.0.0.1:9'), { method: 'PUT', headers: { 'content-type': ticket.body?.contentType ?? 'image/png' }, body: PNG });
ok('PUT ảnh lên S3 tạm', put.status === 200, put.status);
const cImg = await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/comments`, { content: 'Kèm ảnh', uploadIds: [ticket.body?.id] });
ok('Thành viên bình luận kèm ảnh → 201', cImg.status === 201, cImg);
const comments = (await json(M.cookie, 'GET', `/api/projects/tasks/${tM}/comments`)).body as any[];
const mine = comments.filter((c) => c.content === 'Bình luận sau khi đóng' || c.content === 'Kèm ảnh');
ok('Bình luận của mình: canDelete = true, ảnh đính kèm có', mine.length === 2 && mine.every((c) => c.canDelete) && mine.some((c) => c.attachments?.length === 1), comments);
ok('Thành viên xoá bình luận của mình → 204', (await json(M.cookie, 'DELETE', `/api/projects/comments/${idOf(cText)}`)).status === 204);
ok('Link tải lên từ thiết bị khác vẫn chặn → 409', (await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/upload-links`, {})).status === 409);

// ---------- Quản lý dự án: đầy đủ ----------
const t3 = await mkTask(PM.cookie, 'PM tạo sau khi đóng', { columnId: c0.id, assigneeEmployeeId: M.e.id });
ok('PM tạo việc → 201', t3.status === 201, t3);
const T3 = idOf(t3);
const up = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T3}`, { title: 'PM sửa sau khi đóng', columnId: c0.id, assigneeEmployeeId: M.e.id, mediaLinks: [] });
ok('PM sửa việc → 204', up.status === 204, up);
const mv = await json(PM.cookie, 'POST', `/api/projects/tasks/${T3}/move`, { columnId: c1.id });
ok('PM chuyển trạng thái → 204', mv.status === 204, mv);
ok('PM sửa việc phải chờ → 204', (await json(PM.cookie, 'PUT', `/api/projects/tasks/${T3}/dependencies`, { dependsOn: [tPM] })).status === 204);
ok('PM thêm người theo dõi → 204', (await json(PM.cookie, 'POST', `/api/projects/tasks/${T3}/followers/${M2.e.id}`)).status === 204);
ok('PM bỏ người theo dõi → 204', (await json(PM.cookie, 'DELETE', `/api/projects/tasks/${T3}/followers/${M2.e.id}`)).status === 204);
const t3d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T3}`)).body;
ok('Việc của PM đúng tên / cột / việc phải chờ', t3d.task.title === 'PM sửa sau khi đóng' && t3d.task.columnId === c1.id && t3d.dependsOn?.length === 1, t3d.task);
ok('PM bình luận → 201', (await json(PM.cookie, 'POST', `/api/projects/tasks/${T3}/comments`, { content: 'PM bình luận' })).status === 201);
ok('PM xoá việc → 204', (await json(PM.cookie, 'DELETE', `/api/projects/tasks/${T3}`)).status === 204);
ok('PM chuyển việc của M (xong) → 204', (await json(PM.cookie, 'POST', `/api/projects/tasks/${tM}/move`, { columnId: c2.id })).status === 204);

// ---------- HR ----------
const tHr = await mkTask(admin, 'HR tạo sau khi đóng');
ok('HR tạo việc → 201', tHr.status === 201, tHr);
ok('HR chuyển việc → 204', (await json(admin, 'POST', `/api/projects/tasks/${idOf(tHr)}/move`, { columnId: c1.id })).status === 204);
ok('HR sửa việc → 204', (await json(admin, 'PUT', `/api/projects/tasks/${idOf(tHr)}`, { title: 'HR sửa', columnId: c1.id, mediaLinks: [] })).status === 204);
ok('HR xoá việc → 204', (await json(admin, 'DELETE', `/api/projects/tasks/${idOf(tHr)}`)).status === 204);

// ---------- Token AI của quản lý dự án: không ghi việc ----------
const tokRes = await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `e2e cls ${stamp}`, expiresInDays: 30 });
const tok = tokRes.body?.token as string;
if (tok) {
  const byTok = await bearer(tok, 'POST', `/api/projects/${P}/tasks`, { title: 'Bot tạo' });
  ok('Token AI (quản lý) tạo việc ở dự án đóng → 409', byTok.status === 409, byTok);
  const mvTok = await bearer(tok, 'POST', `/api/projects/tasks/${tPM}/move`, { columnId: c1.id });
  ok('Token AI (quản lý) chuyển việc → 409', mvTok.status === 409, mvTok);
  const dTok = await bearer(tok, 'GET', `/api/projects/${P}`);
  ok('Token AI: canWork = false, canComment = true', dTok.body?.project?.canWork === false && dTok.body?.project?.canComment === true, dTok.body?.project);
} else ok('Tạo token AI cho PM', false, tokRes);

// ---------- Kho tài liệu dự án đã đóng ----------
const spaces = async (c: string) => ((await json(c, 'GET', '/api/documents/spaces')).body as any[]).find((s) => s.id === P);
const sM = await spaces(M.cookie), sPM = await spaces(PM.cookie), sHr = await spaces(admin);
ok('Kho: thành viên canWrite = false (closed), PM + HR canWrite = true', sM?.closed === true && sM?.canWrite === false && sPM?.canWrite === true && sHr?.canWrite === true, [sM, sPM, sHr]);
ok('Thành viên tải lên kho dự án đóng → 403', (await createAsset(M.cookie, 'sau-dong.txt')).status === 403);
ok('Thành viên tạo thư mục → 403', (await json(M.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P, parentId: null, name: 'M sau đóng' })).status === 403);
const assetM = aM.body?.asset;
const updM = await json(M.cookie, 'PUT', `/api/documents/assets/${assetM?.id}`, { title: 'M sửa', description: null, tags: [], docTypeId: assetM?.docTypeId, folderId: null });
ok('Thành viên sửa tài liệu của chính mình → 403', updM.status === 403, updM);
ok('Thành viên vẫn xem danh sách tài liệu kho', (await json(M.cookie, 'GET', `/api/documents/assets?spaceKind=Project&spaceId=${P}`)).status === 200);
const aPM2 = await createAsset(PM.cookie, 'pm-sau-dong.txt');
ok('PM tải lên kho dự án đóng → 200', aPM2.status === 200, aPM2);
const fNew = await json(PM.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P, parentId: null, name: 'PM sau đóng' });
ok('PM tạo thư mục → 200', fNew.status === 200, fNew);
ok('PM đổi tên thư mục → 200', [200, 204].includes((await json(PM.cookie, 'PUT', `/api/documents/folders/${fNew.body?.id}`, { name: 'PM đổi tên' })).status));
ok('PM xoá thư mục trống → 204', [200, 204].includes((await json(PM.cookie, 'DELETE', `/api/documents/folders/${fOld.body?.id}`)).status));
const v2 = await upload(PM.cookie, 'cua-m-v2.txt', 'bản 2');
const ver = await json(PM.cookie, 'POST', `/api/documents/assets/${assetM?.id}/versions`, { ticketId: v2.ticket.body?.ticketId, note: 'PM thay file' });
ok('PM thay file tài liệu của thành viên → 200', ver.status === 200, ver);
const updPM = await json(PM.cookie, 'PUT', `/api/documents/assets/${assetM?.id}`, { title: 'PM sửa', description: null, tags: [], docTypeId: assetM?.docTypeId, folderId: null });
ok('PM sửa thông tin tài liệu → 200', updPM.status === 200, updPM);
ok('PM xoá tài liệu → 204', [200, 204].includes((await json(PM.cookie, 'DELETE', `/api/documents/assets/${aPM.body?.asset?.id}`)).status));
const aHr = await createAsset(admin, 'hr-sau-dong.txt');
ok('HR tải lên kho dự án đóng → 200', aHr.status === 200, aHr);
const fHr = await json(admin, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P, parentId: null, name: 'HR sau đóng' });
ok('HR tạo thư mục → 200', fHr.status === 200, fHr);

// ---------- Mở lại dự án ----------
const reopen = await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...base, status: 'Active' });
ok('Mở lại dự án (status Active) → 204', reopen.status === 204, reopen);
ok('Mở lại: thành viên canWork = true', (await detail(M.cookie)).project.canWork === true);
ok('Mở lại: thành viên tạo việc → 201', (await mkTask(M.cookie, 'Sau khi mở lại')).status === 201);
ok('Mở lại: thành viên chuyển việc → 204', (await json(M.cookie, 'POST', `/api/projects/tasks/${tM}/move`, { columnId: c1.id })).status === 204);
ok('Mở lại: thành viên tải lên kho → 200', (await createAsset(M.cookie, 'mo-lai.txt')).status === 200);
ok('Mở lại: thành viên tạo thư mục → 200', (await json(M.cookie, 'POST', '/api/documents/folders', { spaceKind: 'Project', spaceId: P, parentId: null, name: 'M mở lại' })).status === 200);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
