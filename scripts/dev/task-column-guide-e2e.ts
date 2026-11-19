// E2E TEST-186 hướng dẫn riêng cho từng cột (bot được đánh thức ở cột chỉ đọc hướng dẫn của cột đó):
//   API cột: lưu / sửa / xoá guide (CRLF → LF, trim), bỏ trống khi sửa = giữ, > 10.000 ký tự → 400, có nội dung mà cột không bật wakeFollowers → 400,
//   token AI sửa hướng dẫn cột → 403; tắt wakeFollowers → nội dung giữ nhưng hasGuide = false / không có columnGuide, bật lại → dùng lại.
//   GET /{id}/columns + chi tiết dự án: hasGuide + guide; GET /tasks/{id}: columnGuide = hướng dẫn cột hiện tại của việc (cột khác → null).
//   MCP (token AI): get_task có columnGuide ở cột có hướng dẫn, không có trường ở cột khác; columns[] chỉ hasGuide, không guide;
//   get_project không chứa nội dung hướng dẫn cột.
// CHỈ DB tạm. Dựng (Git Bash, từ gốc repo):
//   docker run -d --name e2e186-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15486:5432 postgres:17-alpine
//   Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5386
//     'ConnectionStrings__Default=Host=127.0.0.1;Port=15486;Database=e2e;Username=e2e;Password=e2e' Database__MigrateOnStartup=true
//     Seed__AdminEmail=… Seed__AdminPassword=… Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1
//     Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Mcp: env Mcp__ApiBaseUrl=http://localhost:5386 Mcp__RealtimeBaseUrl=http://127.0.0.1:9 ASPNETCORE_URLS=http://localhost:5387 Chat__InternalKey=<cùng giá trị>
//     dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5386 MCP_URL=http://localhost:5387/mcp ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-column-guide-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5386';
const MCP = process.env.MCP_URL ?? 'http://localhost:5387/mcp';
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
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
let rid = 0;
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method: 'tools/call', params: { name, arguments: args } }) });
  const raw = await res.text();
  const data = raw.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? raw;
  let x: any = null;
  try { x = JSON.parse(data); } catch { /* không phải JSON-RPC */ }
  const text: string = x?.result?.content?.[0]?.text ?? x?.error?.message ?? raw;
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* lỗi dạng chữ */ }
  return { err: !!x?.result?.isError || !!x?.error, j, text };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV CG ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead CG ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Guide ${stamp}`, code: `CG${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, code, name, cookie, token, user };
};
const PM = await mkEmp(`GM${stamp}`, 'Quản Lý Guide', `e2e.cg.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Rev = await mkEmp(`GR${stamp}`, 'Bot Review', `e2e.cg.rev.${stamp}`, ['employee']);
ok('2 tài khoản + token', [PM, Rev].every((x) => x.cookie && x.token?.startsWith('ohk_')));
await json(admin, 'PUT', `/api/org/employees/${Rev.e.id}/account/bot`, { isBot: true });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `cg-${stamp}`, name: 'Hướng dẫn theo cột', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Rev.e.id], workGuide: '## Chung\nHướng dẫn chung của dự án.' })).body as string;
let cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const [DOING, REVIEW] = [col('Đang làm'), col('Chờ review')];
const colOf = async (id: string) => ((await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[]).find((c) => c.id === id);
const putReview = (b: Record<string, unknown>) => json(PM.cookie, 'PUT', `/api/projects/columns/${REVIEW}`, { name: 'Chờ review', wakeFollowers: true, ...b });
const GUIDE = '## Review\n1. Đọc bình luận kết quả, lấy commit.\n2. Bình luận "REVIEW: ĐẠT" hoặc "REVIEW: CẦN SỬA".';

// ── API cột ──
ok('cột mới: hasGuide = false, không có guide', cols.every((c) => c.hasGuide === false && c.guide == null), cols);
let r = await putReview({ guide: '  ' + GUIDE.replaceAll('\n', '\r\n') + '\r\n ' });
let c = await colOf(REVIEW);
ok('lưu hướng dẫn cột "Chờ review" → 204, CRLF → LF + trim, hasGuide = true', r.status === 204 && c?.guide === GUIDE && c?.hasGuide === true, { r, c });
r = await putReview({ color: '#f59e0b' });
ok('sửa cột bỏ trống guide → giữ nguyên', r.status === 204 && (await colOf(REVIEW))?.guide === GUIDE, r);
r = await putReview({ guide: 'x'.repeat(10_001) });
ok('quá 10.000 ký tự → 400 guide', r.status === 400 && !!r.body?.errors?.guide, r);
r = await putReview({ guide: 'x'.repeat(10_000) });
ok('đúng 10.000 ký tự → 204', r.status === 204 && (await colOf(REVIEW))?.guide?.length === 10_000, r);
await putReview({ guide: GUIDE });
r = await json(PM.cookie, 'PUT', `/api/projects/columns/${DOING}`, { name: 'Đang làm', guide: 'Làm theo mô tả' });
ok('cột không bật đánh thức + có hướng dẫn → 400 guide', r.status === 400 && !!r.body?.errors?.guide, r);
r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: `QA ${stamp}`, guide: 'QA theo checklist' });
ok('thêm cột không tick + hướng dẫn → 400 guide', r.status === 400 && !!r.body?.errors?.guide, r);
r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: `QA ${stamp}`, wakeFollowers: true, guide: '## QA\nChạy kịch bản kiểm thử.' });
const QA = r.body as string;
ok('thêm cột có tick + hướng dẫn → 201, lưu', r.status === 201 && (await colOf(QA))?.guide === '## QA\nChạy kịch bản kiểm thử.', r);
r = await bearer(Rev.token, 'PUT', `/api/projects/columns/${REVIEW}`, { name: 'Chờ review', wakeFollowers: true, guide: 'Bot tự sửa' });
ok('token AI sửa hướng dẫn cột → 403, nội dung không đổi', r.status === 403 && (await colOf(REVIEW))?.guide === GUIDE, r);
const detail = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
ok('chi tiết dự án: columns[] có hasGuide + guide', detail.columns.find((x: any) => x.id === REVIEW)?.guide === GUIDE
  && detail.columns.find((x: any) => x.id === REVIEW)?.hasGuide === true && detail.columns.find((x: any) => x.id === DOING)?.hasGuide === false, detail.columns);

// ── Chi tiết việc ──
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc thử hướng dẫn cột', assigneeEmployeeId: Rev.e.id, columnId: DOING })).body as string;
let d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('việc ở "Đang làm" (không hướng dẫn) → columnGuide null', d.columnGuide == null, d.columnGuide);
await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: REVIEW });
d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('việc ở "Chờ review" → columnGuide = hướng dẫn của cột', d.columnGuide === GUIDE, d.columnGuide);

// ── MCP ──
let m = await call(Rev.token, 'get_task', { task: T });
ok('MCP get_task (cột có hướng dẫn): columnGuide đúng', !m.err && m.j?.columnGuide === GUIDE, m.text.slice(0, 300));
ok('MCP get_task: columns[] có hasGuide, KHÔNG có guide (kể cả cột QA)', !m.err && m.j.columns.every((x: any) => !('guide' in x))
  && m.j.columns.find((x: any) => x.id === QA)?.hasGuide === true && !m.text.includes('Chạy kịch bản kiểm thử'), m.j?.columns);
const p = await call(Rev.token, 'get_project', { project: P });
ok('MCP get_project: không chứa nội dung hướng dẫn cột, có hasGuide + workGuide', !p.err && !p.text.includes('REVIEW: ĐẠT') && !p.text.includes('Chạy kịch bản kiểm thử')
  && p.j.columns.every((x: any) => !('guide' in x)) && p.j.columns.find((x: any) => x.id === REVIEW)?.hasGuide === true && p.j.workGuide?.includes('Hướng dẫn chung'),
  p.text.slice(0, 400));
await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DOING, note: 'Thử' });
m = await call(Rev.token, 'get_task', { task: T });
ok('MCP get_task (cột không hướng dẫn): không có trường columnGuide', !m.err && !('columnGuide' in m.j), m.text.slice(0, 300));
await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: REVIEW });

// ── Tắt / bật đánh thức, xoá ──
r = await putReview({ wakeFollowers: false });
c = await colOf(REVIEW);
d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('tắt đánh thức → nội dung giữ, hasGuide = false, columnGuide null', r.status === 204 && c?.guide === GUIDE && c?.hasGuide === false && d.columnGuide == null, { r, c, g: d.columnGuide });
r = await putReview({});
d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('bật lại đánh thức → hướng dẫn dùng lại', r.status === 204 && d.columnGuide === GUIDE, d.columnGuide);
r = await putReview({ guide: '' });
c = await colOf(REVIEW);
d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('guide "" → xoá (hasGuide = false, columnGuide null)', r.status === 204 && c?.guide == null && c?.hasGuide === false && d.columnGuide == null, { r, c });
await putReview({ guide: GUIDE }); // để lại cho chụp ảnh giao diện

console.log(`\nPROJECT=${P} REVIEW=${REVIEW} PM=${PM.user}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
