// E2E TEST-178 cột "Đánh thức bot theo dõi" (wakeFollowers) + sự kiện column_entered (thay review_requested TEST-161 + task_done TEST-166):
// (a) bot A (token AI) chuyển việc vào cột có tick → bot theo dõi B, C nhận Telegram `column_entered` + webhook `task.column_entered`, A (cũng theo dõi) không nhận;
// (b) người thật chuyển vào cột có tick (POST /move và PUT /tasks) → MỌI bot theo dõi nhận; người theo dõi là người thật → không;
// (c) cột không tick → không có tin; (d) kéo lùi rồi vào lại → bắn lại; chuyển giữa hai cột có tick → bắn;
// + API cột: dự án mới "Chờ review" có wakeFollowers, thêm / sửa cột (bỏ trống = giữ nguyên), GET /tasks/{id} → columns[].wakeFollowers, không còn reviewer.
// TEST-184 wakeBotIds: (a) cột không chọn bot → mọi bot theo dõi; (b) chọn A → chỉ A; (c) chọn bot không theo dõi việc → không ai; (d) người thật / ngoài dự án → 400;
// (e) bỏ tick → xoá danh sách; bỏ trống khi sửa = giữ; trùng → một lần.
// (e) migration kiểm tra riêng bằng `dotnet ef database update` xuống / lên trên cùng DB tạm (xem .agent/business/projects-task-followers.md).
// MÁY CHỦ TELEGRAM GIẢ + MÁY NHẬN WEBHOOK GIẢ trong cùng tiến trình. CHỈ DB tạm. Api (backend/):
//   env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5291
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=15461;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Telegram__ApiUrl=http://localhost:5297 Firebase__CredentialsPath= Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5291 TG_PORT=5297 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-column-wake-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5291';
const TG_PORT = Number(process.env.TG_PORT ?? 5297);
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 5298);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

// ── Telegram giả + webhook giả ──
const GOOD = '123456789:AAH-e2e-good-token-abcdefghijklmnop';
const sent: string[] = [];
Bun.serve({
  port: TG_PORT,
  async fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/bot([^/]+)\/sendMessage$/);
    if (!m || decodeURIComponent(m[1]) !== GOOD) return new Response('not found', { status: 404 });
    sent.push(((await req.json()) as any).text);
    return Response.json({ ok: true, result: { message_id: sent.length } });
  },
});
const hits: { event: string; json: any }[] = [];
Bun.serve({
  port: HOOK_PORT,
  async fetch(req) {
    hits.push({ event: req.headers.get('x-officehub-event') ?? '', json: JSON.parse(await req.text()) });
    return new Response('ok');
  },
});

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
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const bearer = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};


// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV CW ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead CW ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wake ${stamp}`, code: `CW${stamp}` })).body;
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
const PM = await mkEmp(`WM${stamp}`, 'Quản Lý Wake', `e2e.cw.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Dev = await mkEmp(`WD${stamp}`, 'Bot Dev', `e2e.cw.dev.${stamp}`, ['employee']);
const Rev = await mkEmp(`WR${stamp}`, 'Bot Review', `e2e.cw.rev.${stamp}`, ['employee']);
const Ops = await mkEmp(`WO${stamp}`, 'Bot DevOps', `e2e.cw.ops.${stamp}`, ['employee']);
const Hum = await mkEmp(`WH${stamp}`, 'Người Theo Dõi', `e2e.cw.hum.${stamp}`, ['employee']);
ok('5 tài khoản + token', [PM, Dev, Rev, Ops, Hum].every((x) => x.cookie && x.token?.startsWith('ohk_')));
for (const b of [Dev, Rev, Ops]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('Bật Telegram (giả)', (await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } })).status === 200);
let hooksOk = true;
for (const x of [Dev, Rev, Ops, Hum]) hooksOk &&= (await json(x.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200;
ok('3 bot + người thật đặt webhook (localhost giả)', hooksOk);
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `cw-${stamp}`, name: 'Đánh thức theo cột', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Dev.e.id, Rev.e.id, Ops.e.id, Hum.e.id] })).body as string;

// ── API cột ──
let cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('dự án mới: chỉ "Chờ review" có wakeFollowers, không còn isReview',
  cols.filter((c) => c.wakeFollowers).map((c) => c.name).join() === 'Chờ review' && cols.every((c) => !('isReview' in c)), cols);
let r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Deploy', wakeFollowers: true });
ok('thêm cột "Deploy" có wakeFollowers → 201', r.status === 201, r);
const DEPLOY = r.body as string;
r = await json(PM.cookie, 'PUT', `/api/projects/columns/${DEPLOY}`, { name: 'Deploy', color: '#ef4444' });
cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('sửa cột bỏ trống wakeFollowers → giữ nguyên true', r.status === 204 && cols.find((c) => c.id === DEPLOY)?.wakeFollowers === true, { r, cols });
r = await bearer(Dev.token, 'PUT', `/api/projects/columns/${DEPLOY}`, { name: 'Deploy', wakeFollowers: false });
ok('token AI không sửa được cột (403)', r.status === 403, r);
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const [TODO, DOING, REVIEW, DONE] = [col('Cần làm'), col('Đang làm'), col('Chờ review'), col('Xong')];
const mkTask = async (title: string, followers: { e: { id: string } }[], columnId = DOING) => {
  const t = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, assigneeEmployeeId: Dev.e.id, columnId, reviewerId: Rev.e.id })).body as string;
  for (const f of followers) await json(PM.cookie, 'POST', `/api/projects/tasks/${t}/followers/${f.e.id}`);
  return t;
};

// Lọc theo việc của lần chạy này (tin thử lại của lần chạy trước có thể tới chen vào)
const wakes = (task: string) => sent.filter((s) => s.includes('"column_entered"')).map((s) => JSON.parse(s)).filter((x) => x.task_id === task);
const hooksFor = (task: string) => hits.filter((h) => h.event === 'task.column_entered' && h.json.data?.taskId === task);
const codes = (task: string) => wakes(task).map((w) => w.employee_code).sort().join();
const old = () => sent.filter((s) => /"(review_requested|task_done)"/.test(s)).length + hits.filter((h) => /review_requested|task\.done/.test(h.event)).length;

// ── Chi tiết việc ──
const T = await mkTask('Tính năng cần review', [Dev, Rev, Ops, Hum]);
const d = (await json(PM.cookie, 'GET', `/api/projects/tasks/${T}`)).body;
ok('GET /tasks/{id}: columns[].wakeFollowers, không còn reviewer / reviewerEmployeeId (reviewerId gửi lên bị bỏ qua)',
  d.columns.find((c: any) => c.id === REVIEW)?.wakeFollowers === true && d.columns.find((c: any) => c.id === DOING)?.wakeFollowers === false
  && !('reviewer' in d) && !('reviewerEmployeeId' in d.task) && d.followers.length === 4, d);

// ── (a) bot A chuyển vào cột có tick ──
r = await bearer(Dev.token, 'POST', `/api/projects/tasks/${T}/move`, { columnId: REVIEW });
ok('(a) bot Dev (token AI) Đang làm → Chờ review → 204', r.status === 204, r);
ok('(a) Telegram: đúng 1 tin column_entered cho Bot Review + Bot DevOps; Bot Dev (người chuyển) và người thật không',
  await until(() => wakes(T).length >= 2) && (await sleep(3500), codes(T) === [Rev.code, Ops.code].sort().join()), wakes(T));
const w = wakes(T).find((x) => x.employee_code === Rev.code);
ok('(a) tin column_entered: project_id, task_code, column_id, assignee_code, không có tên việc',
  w?.project_id === P && w?.column_id === REVIEW && w?.task_code?.toUpperCase().startsWith(`CW-${stamp}-`.toUpperCase())
  && w?.assignee_code === Dev.code && !JSON.stringify(w).includes('cần review'), w);
ok('(a) webhook task.column_entered: 2 lần, đủ trường (columnId, column, projectCode, assigneeCode, movedBy, movedByBot = true)',
  await until(() => hooksFor(T).length >= 2) && (await sleep(1500), hooksFor(T).length === 2)
  && hooksFor(T).every((h) => { const x = h.json.data; return x.title === 'Tính năng cần review' && x.columnId === REVIEW && x.column === 'Chờ review'
    && x.assigneeCode === Dev.code && x.assigneeName === Dev.name && x.movedBy === Dev.name && x.movedByBot === true && !!x.projectCode
    && x.projectName === 'Đánh thức theo cột' && !!x.taskCode && x.projectId === P && x.assigneeEmployeeId === Dev.e.id; }), hooksFor(T).map((h) => h.json.data));

// ── (b) người thật chuyển giữa hai cột có tick; (c) / (d) lùi rồi vào lại ──
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DEPLOY });
ok('(b) quản lý Chờ review → Deploy (hai cột có tick) → mọi bot theo dõi (Dev, Review, DevOps) nhận thêm 1 tin',
  r.status === 204 && await until(() => wakes(T).length >= 5) && (await sleep(3500), wakes(T).length === 5)
  && wakes(T).slice(2).map((x) => x.employee_code).sort().join() === [Dev.code, Rev.code, Ops.code].sort().join()
  && wakes(T).slice(2).every((x) => x.column_id === DEPLOY), { r, w: wakes(T) });
ok('(b) webhook movedByBot = false khi người thật chuyển', await until(() => hooksFor(T).length >= 5) && hooksFor(T).slice(2).every((h) => h.json.data.movedByBot === false),
  hooksFor(T).map((h) => h.json.data));
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DOING, note: 'Review chưa đạt' });
ok('(c) lùi Deploy → Đang làm (không tick) → không có tin mới', r.status === 204 && (await sleep(4000), wakes(T).length === 5), { r, n: wakes(T).length });
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: REVIEW });
ok('(d) vào lại Chờ review → bắn lại 3 tin', r.status === 204 && await until(() => wakes(T).length >= 8) && (await sleep(3500), wakes(T).length === 8),
  { r, n: wakes(T).length });
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/move`, { columnId: DONE });
ok('(c) vào Xong (dự án mới: không tick) → không có tin', r.status === 204 && (await sleep(4000), wakes(T).length === 8), { r, n: wakes(T).length });

// ── PUT /tasks (UpdateAsync) cũng bắn ──
const T2 = await mkTask('Sửa việc sang review', [Ops]);
r = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T2}`, { title: 'Sửa việc sang review', assigneeEmployeeId: Dev.e.id, columnId: REVIEW });
ok('(b) PUT đổi cột sang Chờ review → 204, 1 tin + 1 webhook cho Bot DevOps',
  r.status === 204 && await until(() => wakes(T2).length >= 1) && await until(() => hooksFor(T2).length >= 1)
  && (await sleep(3500), codes(T2) === Ops.code && hooksFor(T2).length === 1), { r, w: wakes(T2), h: hooksFor(T2).length });
r = await json(PM.cookie, 'PUT', `/api/projects/tasks/${T2}`, { title: 'Sửa việc sang review (sửa tên)', assigneeEmployeeId: Dev.e.id, columnId: REVIEW });
ok('PUT không đổi cột (vẫn ở Chờ review) → không bắn lại', r.status === 204 && (await sleep(3500), wakes(T2).length === 1), { r, n: wakes(T2).length });

// ── Tạo việc thẳng vào cột có tick / đổi cờ cột → không bắn ──
const T3 = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Tạo thẳng vào Deploy', assigneeEmployeeId: Dev.e.id, columnId: DEPLOY })).body as string;
await json(PM.cookie, 'POST', `/api/projects/tasks/${T3}/followers/${Ops.e.id}`);
r = await json(PM.cookie, 'PUT', `/api/projects/columns/${DONE}`, { name: 'Xong', isDone: true, approverOnly: true, wakeFollowers: true });
ok('tạo việc thẳng vào cột có tick + bật tick cột đang chứa việc → không có tin', r.status === 204 && (await sleep(4000), wakes(T3).length === 0 && wakes(T).length === 8),
  { r, w: wakes(T3) });
cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
ok('PUT cột wakeFollowers: true → lưu', cols.find((c) => c.id === DONE)?.wakeFollowers === true, cols);

// ── Việc chỉ có người thật theo dõi / cột không tick ──
const T4 = await mkTask('Chỉ người theo dõi', [Hum]);
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T4}/move`, { columnId: REVIEW });
ok('việc chỉ có người thật theo dõi → không có tin / webhook', r.status === 204 && (await sleep(4000), wakes(T4).length === 0 && hooksFor(T4).length === 0), r);
const T5 = await mkTask('Cột không tick', [Ops], TODO);
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T5}/move`, { columnId: DOING });
ok('(c) Cần làm → Đang làm (không tick) → không có tin', r.status === 204 && (await sleep(3500), wakes(T5).length === 0 && hooksFor(T5).length === 0), r);

// ── TEST-184: chọn bot được đánh thức ở cột (wakeBotIds) ──
const colOf = async (id: string) => ((await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[]).find((c) => c.id === id);
const putReview = (b: Record<string, unknown>) => json(PM.cookie, 'PUT', `/api/projects/columns/${REVIEW}`, { name: 'Chờ review', wakeFollowers: true, ...b });
ok('(184) cột cũ: wakeBotIds rỗng', (await colOf(REVIEW))?.wakeBotIds?.length === 0, await colOf(REVIEW));
r = await putReview({ wakeBotIds: [Hum.e.id] });
ok('(184d) chọn người thật → 400 wakeBotIds', r.status === 400 && !!r.body?.errors?.wakeBotIds, r);
r = await putReview({ wakeBotIds: [crypto.randomUUID()] });
ok('(184d) chọn người ngoài dự án → 400 wakeBotIds', r.status === 400 && !!r.body?.errors?.wakeBotIds, r);
r = await putReview({ wakeBotIds: [Rev.e.id, Rev.e.id] });
ok('(184) chọn Bot Review (gửi trùng) → 204, lưu một lần', r.status === 204 && JSON.stringify((await colOf(REVIEW))?.wakeBotIds) === JSON.stringify([Rev.e.id]), r);
r = await putReview({});
ok('(184) sửa cột bỏ trống wakeBotIds → giữ nguyên', r.status === 204 && JSON.stringify((await colOf(REVIEW))?.wakeBotIds) === JSON.stringify([Rev.e.id]), r);
const T6 = await mkTask('Chọn bot đánh thức', [Rev, Ops]);
ok('(184) GET /tasks/{id} → columns[].wakeBotIds',
  JSON.stringify((await json(PM.cookie, 'GET', `/api/projects/tasks/${T6}`)).body.columns.find((c: any) => c.id === REVIEW)?.wakeBotIds) === JSON.stringify([Rev.e.id]));
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T6}/move`, { columnId: REVIEW });
ok('(184b) cột chọn Bot Review → chỉ Bot Review nhận (Bot DevOps cũng theo dõi nhưng không)',
  r.status === 204 && await until(() => wakes(T6).length >= 1) && (await sleep(3500), codes(T6) === Rev.code && hooksFor(T6).length === 1), { r, w: wakes(T6) });
r = await json(PM.cookie, 'POST', `/api/projects/tasks/${T6}/move`, { columnId: DEPLOY });
ok('(184a) cột không chọn bot (Deploy) → cả Bot Review và Bot DevOps nhận',
  r.status === 204 && await until(() => wakes(T6).length >= 3) && (await sleep(3500), wakes(T6).slice(1).map((x) => x.employee_code).sort().join() === [Rev.code, Ops.code].sort().join()),
  { r, w: wakes(T6) });
r = await putReview({ wakeBotIds: [Dev.e.id] });
await json(PM.cookie, 'POST', `/api/projects/tasks/${T6}/move`, { columnId: DOING, note: 'Thử lại' });
const r2 = await json(PM.cookie, 'POST', `/api/projects/tasks/${T6}/move`, { columnId: REVIEW });
ok('(184c) cột chọn Bot Dev (không theo dõi việc) → không ai nhận', r.status === 204 && r2.status === 204 && (await sleep(4000), wakes(T6).length === 3), { r, r2, w: wakes(T6) });
r = await putReview({ wakeFollowers: false, wakeBotIds: [Rev.e.id] });
const rc = await colOf(REVIEW);
ok('(184e) bỏ tick đánh thức → danh sách bị xoá', r.status === 204 && rc?.wakeFollowers === false && rc?.wakeBotIds?.length === 0, { r, rc });
r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: `QA ${stamp}`, wakeFollowers: true, wakeBotIds: [Ops.e.id] });
ok('(184) thêm cột kèm wakeBotIds → lưu', r.status === 201 && JSON.stringify((await colOf(r.body))?.wakeBotIds) === JSON.stringify([Ops.e.id]), r);
r = await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: `QB ${stamp}`, wakeBotIds: [Ops.e.id] });
ok('(184) thêm cột không tick + wakeBotIds → danh sách rỗng', r.status === 201 && (await colOf(r.body))?.wakeBotIds?.length === 0, r);

ok('không còn tin review_requested / task_done / webhook cũ', old() === 0, old());
console.log(`\nPROJECT=${P} TASK=${T5} REVIEWER=${Rev.e.id}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
