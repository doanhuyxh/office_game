// E2E TEST-243 (Cache phía server — B1): đo SỐ CÂU TRUY VẤN DB / request trước khi cache.
// Pha seed: ~100 nhân viên, cây quản lý 3 cấp (giám đốc → 3 trưởng phòng → 9 trưởng nhóm → nhân viên), dự án 240 việc,
//   vài đơn nghỉ (inbox duyệt của trưởng nhóm), chấm công, thông báo → ghi STATE.
// Pha measure: mỗi request nóng gọi 1 lần làm nóng + RUNS lần; số câu lấy từ header Server-Timing (Development) — nguồn là
//   DbQueryCountInterceptor; đối chiếu dòng log request "· N db" và log EF (API_LOG) để chia nhóm câu theo bảng (schema.bảng).
//   Gọi bằng cookie và bằng token AI (Bearer ohk_…); MCP get_task mô phỏng đúng 3 request Api mà tool gọi (X-Mcp-Tool: get_task).
// CHỈ DB tạm:
//   docker run -d --name e2e243-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15443:5432 postgres:17-alpine
//   Api (từ backend/, ghi log ra file API_LOG): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5243
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15443;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        'Serilog__MinimumLevel__Override__Microsoft.EntityFrameworkCore.Database.Command=Information'
//        Smtp__Host=127.0.0.1 Smtp__Port=9 Sentry__Dsn= Seq__Url= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng>
//        Database__MigrateOnStartup=true Seed__AdminEmail=e2e243-admin@officehub-e2e.vn Seed__AdminPassword=E2e243-Admin-2026
//        dotnet run --project src/OfficeHub.Api --no-launch-profile > $API_LOG
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5243 API_LOG=… bun scripts/dev/db-query-count-e2e.ts seed|measure
//   Dọn: docker rm -f e2e243-pg
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5243';
const API_LOG = process.env.API_LOG ?? '';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e243-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e243-Admin-2026';
const STATE = `${tmpdir()}/officehub-e2e243-state-${new URL(API).port}.json`;
const N = Number(process.env.TASKS ?? 240);
const RUNS = Number(process.env.RUNS ?? 5);
const phase = process.argv[2] ?? 'measure';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- đăng nhập (admin tự bật 2FA như các script khác) ----
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const r = await post('/api/auth/login', { login: user, password });
    if (r.status === 429 && attempt < 5) { await sleep(15000); continue; }
    const body = await r.json().catch(() => null) as any;
    if (r.status === 403 && body?.title === '2fa_required') {
      const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
      return cookieOf(r2, 'officehub.auth');
    }
    let cookie = cookieOf(r, 'officehub.auth');
    if (r.ok && body?.mustSetupTwoFactor) {
      const p = async (path: string, b: unknown) => {
        const x = await post(path, b, cookie);
        cookie = cookieOf(x, 'officehub.auth') || cookie;
        return { status: x.status, body: await x.json().catch(() => null) as any };
      };
      const s = await p('/api/auth/2fa/setup', {});
      const e = await p('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
      if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${user}`);
      keys[user] = s.body.sharedKey;
      writeFileSync(KEYS_FILE, JSON.stringify(keys));
    }
    if (!cookie) throw new Error(`Đăng nhập ${user} lỗi ${r.status}`);
    return cookie;
  }
};
type Auth = { cookie?: string; token?: string; tool?: string };
const call = async (auth: Auth, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.cookie) headers.cookie = auth.cookie;
  if (auth.token) headers.authorization = `Bearer ${auth.token}`;
  if (auth.tool) headers['X-Mcp-Tool'] = auth.tool;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, timing: r.headers.get('server-timing') ?? '' };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

type State = { P: string; dirUser: string; leadUser: string; pmUser: string; aUser: string; staffUsers: string[]; taskCode: string; taskId: string };

if (phase === 'seed') {
  const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  const stamp = Date.now().toString(36).slice(-5);
  const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV 243 ${stamp}`, level: 7, financePermissions: 0 })).body;
  const depts: string[] = [];
  for (let i = 0; i < 4; i++) depts.push((await json(admin, 'POST', '/api/org/departments', { name: `Phòng 243 ${stamp} ${i}`, code: `P${i}${stamp}` })).body);
  let n = 0;
  const mkEmp = async (name: string, dept: string, managerId: string | null, user: string | null, roles: string[] = ['employee']) => {
    const code = `E${stamp}${n++}`;
    const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${code.toLowerCase()}@e2e.test`, phone: null, dateOfBirth: null,
      departmentId: dept, positionId: pos, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null });
    if (r.status >= 300) throw new Error(`Tạo nhân viên lỗi ${r.status} ${JSON.stringify(r.body)}`);
    const e = r.body.employee;
    if (!user) return { e, user: '' };
    const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
    const c = await login(user, acc.tempPassword);
    await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
    return { e, user };
  };
  // cây 3 cấp dưới giám đốc: 1 + 3 + 9 + 9×9 = 94 người, + PM + A = ~96 (cỡ prod ~100)
  const D = await mkEmp('Giám Đốc 243', depts[0], null, `e2e.t243.dir.${stamp}`, ['employee', 'manager']);
  const staffUsers: string[] = [];
  let lead0 = { e: null as any, user: '' };
  for (let h = 0; h < 3; h++) {
    const H = await mkEmp(`Trưởng phòng ${h}`, depts[h + 1], D.e.id, null);
    for (let l = 0; l < 3; l++) {
      const first = h === 0 && l === 0;
      const L = await mkEmp(`Trưởng nhóm ${h}.${l}`, depts[h + 1], H.e.id, first ? `e2e.t243.lead.${stamp}` : null, ['employee', 'manager']);
      if (first) lead0 = L;
      for (let s = 0; s < 9; s++) {
        const withAcc = first && s < 4; // 4 nhân viên của trưởng nhóm 0.0 có tài khoản: gửi đơn nghỉ, chấm công
        const S = await mkEmp(`Nhân viên ${h}.${l}.${s}`, depts[h + 1], L.e.id, withAcc ? `e2e.t243.s${s}.${stamp}` : null);
        if (withAcc) staffUsers.push(S.user);
      }
    }
  }
  const PM = await mkEmp('Quản Lý Dự Án 243', depts[1], lead0.e.id, `e2e.t243.pm.${stamp}`, ['employee', 'manager']);
  const A = await mkEmp('Thành Viên A 243', depts[1], lead0.e.id, `e2e.t243.a.${stamp}`);
  console.log(`Đã tạo ${n} nhân viên`);

  const pm = await login(PM.user, PW);
  const code = `t3-${stamp}`;
  const P = (await json(pm, 'POST', '/api/projects', { code, name: 'Dự án 243 (240 việc)', kind: 'Internal', startOn: today, memberIds: [A.e.id] })).body as string;
  let firstTask = '';
  for (let i = 1; i <= N; i++) {
    const r = await json(pm, 'POST', `/api/projects/${P}/tasks`, { title: `Việc ${i}`, description: `Mô tả việc ${i}. `.repeat(40), assigneeEmployeeId: i % 2 ? A.e.id : null, mediaLinks: [] });
    if (r.status >= 300) throw new Error(`Tạo việc ${i} lỗi ${r.status} ${JSON.stringify(r.body)}`);
    if (i === 1) firstTask = r.body as string;
    if (i % 7 === 0) await json(pm, 'POST', `/api/projects/tasks/${r.body}/comments`, { content: `Bình luận việc ${i}` });
    if (i % 4 === 0) await json(pm, 'POST', `/api/projects/tasks/${r.body}/followers/${A.e.id}`);
  }
  for (let k = 1; k <= 5; k++) await json(pm, 'POST', `/api/projects/tasks/${firstTask}/comments`, { content: `Trao đổi ${k}` });
  const taskCode = (await json(pm, 'GET', `/api/projects/tasks/${firstTask}`)).body.task.code as string;

  // đơn nghỉ (vào inbox trưởng nhóm 0.0) + chấm công của nhân viên có tài khoản
  let day = addDays(today, 20);
  for (const u of staffUsers) {
    const c = await login(u, PW);
    const types = (await json(c, 'GET', '/api/leave/types')).body as any[];
    const unpaid = types.find((t) => t.code === 'unpaid') ?? types[types.length - 1];
    do day = addDays(day, 1); while ([0, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()));
    const lr = await json(c, 'POST', '/api/leave/requests', { leaveTypeId: unpaid.id, startDate: day, endDate: day, period: 'FullDay', reason: 'E2E 243' });
    if (lr.status >= 300) console.log(`  (đơn nghỉ ${u} lỗi ${lr.status} — bỏ qua)`);
    await json(c, 'POST', '/api/attendance/check', { source: 'web' });
  }
  writeFileSync(STATE, JSON.stringify({ P, dirUser: D.user, leadUser: lead0.user, pmUser: PM.user, aUser: A.user, staffUsers, taskCode, taskId: firstTask } satisfies State));
  console.log(`Đã seed: dự án ${code} ${N} việc, ${staffUsers.length} đơn nghỉ → ${STATE}`);
  process.exit(0);
}

// ================= measure =================
const st = JSON.parse(readFileSync(STATE, 'utf8')) as State;
const [dir, lead, pm, a] = [await login(st.dirUser, PW), await login(st.leadUser, PW), await login(st.pmUser, PW), await login(st.aUser, PW)];
const tk = await json(a, 'POST', '/api/auth/access-tokens', { name: 'e2e-243', expiresInDays: 30 });
ok('tạo token AI cho thành viên A', tk.status < 300 && String(tk.body?.token).startsWith('ohk_'), tk);
if (tk.status >= 300) process.exit(1);
const token = tk.body.token as string;

const parseTiming = (h: string) => {
  const m = /db;dur=([\d.]+);desc="(\d+) queries"/.exec(h);
  return m ? { queries: Number(m[2]), dbMs: Number(m[1]) } : null;
};
// log Api: mỗi dòng log bắt đầu "[HH:mm:ss LVL]"; câu SQL của "Executed DbCommand" nằm ở các dòng tiếp theo
const logText = () => (API_LOG && existsSync(API_LOG) ? readFileSync(API_LOG, 'utf8') : '');
const tableOf = (b: string) => {
  const m = /(?:FROM|JOIN|INTO|UPDATE)\s+"?([a-z_]+)"?\."?([A-Za-z_]+)"?/.exec(b);
  return m ? `${m[1]}.${m[2]}` : /\bSELECT\b/.test(b) ? '(select khác)' : '(lệnh khác)';
};
// câu của request = các "Executed DbCommand" TRƯỚC dòng log request; ghi audit sau response (vd audit.ai_requests của token AI) tách riêng
const commandsIn = (chunk: string, path: string) => {
  const blocks = chunk.split(/\r?\n(?=\[\d\d:\d\d:\d\d )/);
  const at = blocks.findIndex((b) => b.includes(`HTTP GET ${path.split('?')[0]} `) && b.includes(' db / '));
  const cmd = (bs: string[]) => bs.filter((b) => b.includes('Executed DbCommand (')).map(tableOf);
  return { during: cmd(at < 0 ? blocks : blocks.slice(0, at)), after: at < 0 ? [] : cmd(blocks.slice(at + 1)).filter((t) => t.startsWith('audit.')), reqLine: at < 0 ? '' : blocks[at] };
};
// nhóm "lặp lại mỗi request / danh mục": xác thực + nhân sự + cấu hình + danh mục chấm công
const groupOf = (t: string) =>
  t.startsWith('identity.') ? 'xác thực'
  : t.startsWith('org.') ? 'nhân sự / phòng ban / chức vụ'
  : t.startsWith('settings.') ? 'cấu hình (RuntimeConfig)'
  : /^attendance\.(holidays|shifts|work_schedules|schedules)/i.test(t) ? 'danh mục chấm công'
  : 'nghiệp vụ';

type Row = { label: string; auth: string; status: number; queries: number; dbMs: number; groups: Record<string, number>; tables: Record<string, number>; logOk: boolean; after: number };
const rows: Row[] = [];
const measure = async (label: string, auth: Auth, path: string, authName = auth.token ? 'token' : 'cookie') => {
  await call(auth, 'GET', path); // làm nóng (JIT, cache EF)
  let best: Row | null = null;
  for (let i = 0; i < RUNS; i++) {
    await sleep(250);
    const before = logText().length;
    const r = await call(auth, 'GET', path);
    const t = parseTiming(r.timing);
    await sleep(400); // chờ Serilog xả log
    const chunk = logText().slice(before);
    const { during: cmds, after, reqLine } = commandsIn(chunk, path);
    const logQ = reqLine ? Number(/· (\d+) db/.exec(reqLine)?.[1]) : NaN;
    if (!t) { ok(`${label}: có header Server-Timing`, false, r.timing); return; }
    // job nền có thể chen câu vào log → giữ lần có ít câu nhất, bảng chỉ lấy khi số câu log = số câu đếm
    if (!best || t.queries < best.queries || (t.queries === best.queries && cmds.length === t.queries && Object.keys(best.tables).length === 0)) {
      const tables: Record<string, number> = {}, groups: Record<string, number> = {};
      if (cmds.length === t.queries) for (const c of cmds) { tables[c] = (tables[c] ?? 0) + 1; groups[groupOf(c)] = (groups[groupOf(c)] ?? 0) + 1; }
      best = { label, auth: authName, status: r.status, queries: t.queries, dbMs: t.dbMs, groups, tables, logOk: logQ === t.queries, after: after.length };
    }
  }
  rows.push(best!);
};

const P = st.P;
const from = addDays(today, -15), to = addDays(today, 45);
const NONE = '/api/khong-co-route-243'; // request đã đăng nhập "rỗng": chỉ chi phí xác thực + gate (404)
const cookieTargets: [string, Auth, string][] = [
  ['rỗng (404, chỉ xác thực)', { cookie: a }, NONE],
  ['GET /api/auth/me', { cookie: a }, '/api/auth/me'],
  ['GET /api/projects/{id}', { cookie: pm }, `/api/projects/${P}`],
  ['GET /api/projects/{id}/tasks?summary=true', { cookie: pm }, `/api/projects/${P}/tasks?summary=true`],
  ['GET /api/projects/tasks/{id}', { cookie: pm }, `/api/projects/tasks/${st.taskId}`],
  ['GET /api/attendance/today', { cookie: a }, '/api/attendance/today'],
  ['GET /api/attendance/board (giám đốc)', { cookie: dir }, '/api/attendance/board'],
  ['GET /api/approval/inbox/count (trưởng nhóm)', { cookie: lead }, '/api/approval/inbox/count'],
  ['GET /api/notifications/unread-count', { cookie: a }, '/api/notifications/unread-count'],
  ['GET /api/org/employees (giám đốc)', { cookie: dir }, '/api/org/employees'],
  ['GET /api/leave/requests (giám đốc)', { cookie: dir }, `/api/leave/requests?from=${from}&to=${to}`],
  ['GET /api/leave/requests (trưởng nhóm)', { cookie: lead }, `/api/leave/requests?from=${from}&to=${to}`],
];
for (const [label, auth, path] of cookieTargets) await measure(label, auth, path);
const T: Auth = { token };
for (const [label, path] of [
  ['rỗng (404, chỉ xác thực)', NONE],
  ['GET /api/auth/me', '/api/auth/me'],
  ['GET /api/attendance/today', '/api/attendance/today'],
  ['GET /api/projects/{id}', `/api/projects/${P}`],
] as const) await measure(label, T, path);
// MCP get_task "{MÃ}-1": ResolveProjectAsync (GET /api/projects) → ResolveTaskAsync (GET /api/projects/{id}/tasks, bản đầy đủ) → GET /api/projects/tasks/{id}
const M: Auth = { token, tool: 'get_task' };
await measure('MCP get_task ① GET /api/projects', M, '/api/projects', 'token');
await measure('MCP get_task ② GET /api/projects/{id}/tasks', M, `/api/projects/${P}/tasks`, 'token');
await measure('MCP get_task ③ GET /api/projects/tasks/{id}', M, `/api/projects/tasks/${st.taskId}`, 'token');

// ---- kiểm tra ----
for (const r of rows) ok(`${r.auth.padEnd(6)} ${r.label}: HTTP ${r.status}`, r.label.startsWith('rỗng') ? r.status === 404 : r.status === 200);
ok('dòng log request có "· N db" khớp Server-Timing (mọi request)', rows.every((r) => r.logOk), rows.filter((r) => !r.logOk).map((r) => r.label));
ok('request rỗng đã đăng nhập (cookie) có ≥ 1 câu (chi phí xác thực đo được)', (rows.find((r) => r.auth === 'cookie' && r.label.startsWith('rỗng'))?.queries ?? 0) >= 1);
const anon = await call({}, 'GET', NONE);
ok('request ẩn danh: 0 câu', parseTiming(anon.timing)?.queries === 0, anon.timing);
// N+1: cùng request ở dự án nhỏ hơn? → so số câu GET /tasks với số việc: bản gọn không tăng theo số dòng (TEST-240: 3 câu endpoint)
const sumRow = rows.find((r) => r.label.startsWith('GET /api/projects/{id}/tasks?summary'))!;
ok(`GET /tasks?summary=true (${N} việc) không N+1: ${sumRow.queries} câu < 20`, sumRow.queries < 20, sumRow);

// ---- bảng kết quả ----
const mcp = rows.filter((r) => r.label.startsWith('MCP'));
console.log(`\n### Số câu truy vấn / request (${N} việc, ~96 nhân viên, lần ít nhất trong ${RUNS} lần)\n`);
console.log('| Request | Xác thực | Câu | Ghi sau response | DB ms | Trong đó lặp lại (xác thực / nhân sự / cấu hình / danh mục) | Bảng |');
console.log('|---|---|---:|---:|---:|---|---|');
for (const r of rows) {
  const rep = Object.entries(r.groups).filter(([g]) => g !== 'nghiệp vụ').map(([g, c]) => `${g} ${c}`).join(', ') || (Object.keys(r.tables).length ? '0' : '?');
  const tbl = Object.entries(r.tables).sort((x, y) => y[1] - x[1]).map(([t, c]) => `${t}×${c}`).join(' ');
  console.log(`| ${r.label} | ${r.auth} | ${r.queries} | ${r.after ? '+' + r.after + ' audit' : ''} | ${r.dbMs} | ${rep} | ${tbl || '(log lẫn job nền)'} |`);
}
console.log(`| **MCP get_task (tổng 3 request)** | token | **${mcp.reduce((s, r) => s + r.queries, 0)}** | +${mcp.reduce((s, r) => s + r.after, 0)} audit | ${mcp.reduce((s, r) => s + r.dbMs, 0).toFixed(1)} | | |`);
await call({ cookie: a }, 'DELETE', `/api/auth/access-tokens/${tk.body.accessToken?.id}`);
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
