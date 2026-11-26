// E2E TEST-240: danh sách việc dự án bản gọn cho web (`GET /api/projects/{id}/tasks?summary=true`) + giảm số truy vấn.
// Pha seed: tạo PM + 2 thành viên + dự án ~240 việc (mô tả ~2 KB, việc chia 5 có 2 link media, bình luận, người theo dõi, việc phụ thuộc) → ghi STATE.
// Pha measure: đếm truy vấn SQL (log EF "Executed DbCommand" của Api, API_LOG) + thời gian + dung lượng của list summary / đầy đủ / mine / chi tiết.
//   Chạy measure với Api bản CŨ (trước TEST-240) rồi bản MỚI trên CÙNG DB → so trước / sau.
// Pha check: bản gọn không có mô tả / media nhưng có mediaCount + đếm bình luận / theo dõi / chờ đúng như bản đầy đủ; bản đầy đủ (MCP list_project_tasks
//   đọc endpoint này) vẫn có mô tả; /tasks/mine + chi tiết có mô tả; bulk + chuyển cột vẫn đúng; UI (Chrome headless): mở việc từ kanban / danh sách /
//   link ?task= → mô tả hiện đúng; sửa tên rồi Lưu → mô tả + media KHÔNG mất. Ảnh vào SHOTS_DIR.
// CHỈ DB tạm:
//   docker run -d --name e2e240-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15440:5432 postgres:17-alpine
//   Api (từ backend/, ghi log ra file API_LOG): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5240
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15440;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        'Serilog__MinimumLevel__Override__Microsoft.EntityFrameworkCore.Database.Command=Information'
//        Smtp__Host=127.0.0.1 Smtp__Port=9 Sentry__Dsn= Seq__Url= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng>
//        Database__MigrateOnStartup=true Seed__AdminEmail=e2e240-admin@officehub-e2e.vn Seed__AdminPassword=E2e240-Admin-2026
//        dotnet run --project src/OfficeHub.Api --no-launch-profile > $API_LOG
//   Bản cũ để so: git archive <commit trước TEST-240> backend | tar -x -C <thư mục tạm> rồi chạy Api từ đó, cùng env.
//   Vite (frontend/): VITE_API_TARGET=http://localhost:5240 bunx vite --port 5241 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5240 BASE_URL=http://localhost:5241 API_LOG=… SHOTS_DIR=… bun scripts/dev/task-list-summary-e2e.ts seed|measure|check
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5240';
const BASE = process.env.BASE_URL ?? 'http://localhost:5241';
const API_LOG = process.env.API_LOG ?? '';
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/t240`;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e240-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e240-Admin-2026';
const STATE = `${tmpdir()}/officehub-e2e240-state.json`;
const N = Number(process.env.TASKS ?? 240);
const phase = process.argv[2] ?? 'check';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- đăng nhập (2FA tự bật cho admin / HR như các script khác) ----
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
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, bytes: text.length };
};
const PW = 'E2e-Local-2026';
const desc = (i: number) => `## Việc số ${i}\n\n${`Mô tả chi tiết việc ${i} — nội dung tiếng Việt có dấu để đo dung lượng. `.repeat(28)}`.slice(0, 2000).trimEnd(); // server cắt khoảng trắng cuối
const media = (i: number) => (i % 5 === 0 ? [`https://example.com/anh-${i}-a.png`, `https://example.com/anh-${i}-b.png`] : []);

type State = { P: string; pmUser: string; aUser: string; aId: string; bId: string; titles: Record<string, number> };

if (phase === 'seed') {
  const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  const stamp = Date.now().toString(36).slice(-5);
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
  const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV 240 ${stamp}`, level: 7, financePermissions: 0 })).body;
  const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Task 240 ${stamp}`, code: `T4${stamp}` })).body;
  // thêm nhân viên "nhiễu" để thấy bản cũ tải MỌI nhân viên
  const mkEmp = async (code: string, name: string, user: string | null, roles: string[] = ['employee']) => {
    const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${code.toLowerCase()}@e2e.test`, phone: null, dateOfBirth: null,
      departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
    if (!user) return { e, user: '' };
    const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
    const c = await login(user, acc.tempPassword);
    await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
    return { e, user };
  };
  const PM = await mkEmp(`PM${stamp}`, 'Quản Lý 240', `e2e.t240.pm.${stamp}`, ['employee', 'manager']);
  const A = await mkEmp(`TA${stamp}`, 'Thành Viên A', `e2e.t240.a.${stamp}`);
  const B = await mkEmp(`TB${stamp}`, 'Thành Viên B', `e2e.t240.b.${stamp}`);
  for (let i = 0; i < 40; i++) await mkEmp(`NZ${stamp}${i}`, `Nhân viên khác ${i}`, null);
  const pm = await login(PM.user, PW);
  const P = (await json(pm, 'POST', '/api/projects', { code: `t4-${stamp}`, name: 'Dự án 240 việc', kind: 'Internal', startOn: today, memberIds: [A.e.id, B.e.id] })).body as string;
  const titles: Record<string, number> = {};
  const ids: string[] = [];
  for (let i = 1; i <= N; i++) {
    const assignee = i % 3 === 0 ? A.e.id : i % 3 === 1 ? B.e.id : null;
    const r = await json(pm, 'POST', `/api/projects/${P}/tasks`, { title: `Việc ${i}`, description: desc(i), assigneeEmployeeId: assignee, mediaLinks: media(i) });
    if (r.status !== 200 && r.status !== 201) throw new Error(`Tạo việc ${i} lỗi ${r.status} ${JSON.stringify(r.body)}`);
    ids.push(r.body as string);
    titles[r.body as string] = i;
  }
  // bình luận (i % 7), người theo dõi (i % 4), phụ thuộc: việc 10k+1 chờ việc 10k (chưa xong)
  for (let i = 1; i <= N; i++) {
    const id = ids[i - 1];
    if (i % 7 === 0) for (let k = 0; k < i % 3 + 1; k++) await json(pm, 'POST', `/api/projects/tasks/${id}/comments`, { content: `Bình luận ${k} của việc ${i}` });
    if (i % 4 === 0) await json(pm, 'POST', `/api/projects/tasks/${id}/followers/${A.e.id}`);
    if (i % 8 === 0) await json(pm, 'POST', `/api/projects/tasks/${id}/followers/${B.e.id}`);
    if (i % 10 === 1 && i > 1) await json(pm, 'PUT', `/api/projects/tasks/${id}/dependencies`, { dependsOn: [ids[i - 2]] });
  }
  writeFileSync(STATE, JSON.stringify({ P, pmUser: PM.user, aUser: A.user, aId: A.e.id, bId: B.e.id, titles } satisfies State));
  console.log(`Đã seed dự án ${P}: ${N} việc → ${STATE}`);
  process.exit(0);
}

const st = JSON.parse(readFileSync(STATE, 'utf8')) as State;
const pm = await login(st.pmUser, PW);

// ---- đếm truy vấn qua log EF của Api ----
const logLines = () => (API_LOG && existsSync(API_LOG) ? readFileSync(API_LOG, 'utf8').split('\n') : []);
const measure = async (label: string, path: string, runs = 5) => {
  const out: { queries: number; dbMs: number; ms: number; bytes: number }[] = [];
  await json(pm, 'GET', path); // làm nóng (cache EF / JIT)
  for (let i = 0; i < runs; i++) {
    await sleep(300);
    const before = logLines().length;
    const t0 = performance.now();
    const r = await json(pm, 'GET', path);
    const ms = performance.now() - t0;
    await sleep(500); // chờ Serilog xả log
    const lines = logLines().slice(before - 1).filter((l) => l.includes('Executed DbCommand ('));
    const dbMs = lines.reduce((s, l) => s + Number(/Executed DbCommand \((\d+)ms\)/.exec(l)?.[1] ?? 0), 0);
    out.push({ queries: lines.length, dbMs, ms: Math.round(ms), bytes: r.bytes });
  }
  const med = (k: keyof (typeof out)[0]) => [...out.map((x) => x[k])].sort((a, b) => a - b)[Math.floor(out.length / 2)];
  // job nền (outbox, nhắc…) cũng ghi "Executed DbCommand" xen vào → số truy vấn lấy lần ÍT nhất (job chỉ cộng thêm), thời gian lấy trung vị
  const min = (k: keyof (typeof out)[0]) => Math.min(...out.map((x) => x[k]));
  console.log(`  ${label.padEnd(34)} truy vấn ${min('queries')} · DB ${min('dbMs')} ms · tổng ${med('ms')} ms · ${(med('bytes') / 1024).toFixed(1)} KB`);
  return { queries: min('queries'), ms: med('ms'), bytes: med('bytes') };
};
const anyId = Object.keys(st.titles)[0];

if (phase === 'measure') {
  if (!API_LOG) throw new Error('Cần API_LOG (file log Api có EF Database.Command=Information)');
  console.log(`Đo trên ${API} (${N} việc, 5 lần: số truy vấn / DB ms = lần ít nhất, tổng ms = trung vị):`);
  await measure('GET /tasks?summary=true', `/api/projects/${st.P}/tasks?summary=true`);
  await measure('GET /tasks (đầy đủ, MCP)', `/api/projects/${st.P}/tasks`);
  await measure('GET /tasks/mine (PM: 0 việc)', `/api/projects/tasks/mine`);
  await measure('GET /tasks/{tid}?comments=false', `/api/projects/tasks/${anyId}?comments=false`);
  await measure('GET /projects/me (đối chiếu: quyền)', `/api/auth/me`);
  process.exit(0);
}

// ================= check =================
const S = await json(pm, 'GET', `/api/projects/${st.P}/tasks?summary=true`);
const F = await json(pm, 'GET', `/api/projects/${st.P}/tasks`);
const sum = S.body as any[], full = F.body as any[];
ok(`summary + đầy đủ đều 200, ${N} việc`, S.status === 200 && F.status === 200 && sum.length === N && full.length === N, [S.status, F.status, sum?.length, full?.length]);
ok('cùng thứ tự (rank, number)', sum.every((t, i) => t.id === full[i].id));
ok('summary: description = null, mediaLinks rỗng ở mọi việc', sum.every((t) => t.description === null && Array.isArray(t.mediaLinks) && t.mediaLinks.length === 0));
ok('summary: mediaCount đúng (việc chia 5 → 2)', sum.every((t) => t.mediaCount === media(st.titles[t.id]).length), sum.find((t) => t.mediaCount !== media(st.titles[t.id]).length));
ok('đầy đủ (MCP list_project_tasks đọc endpoint này): mô tả + media đúng, có mediaCount',
  full.every((t) => t.description === desc(st.titles[t.id]) && JSON.stringify(t.mediaLinks) === JSON.stringify(media(st.titles[t.id])) && t.mediaCount === t.mediaLinks.length));
const same = ['code', 'title', 'columnId', 'columnName', 'columnColor', 'done', 'rank', 'assigneeEmployeeId', 'assigneeName', 'commentCount', 'followerCount', 'waitingOn', 'overdue', 'createdByName', 'createdByBot'];
const diff = sum.flatMap((t, i) => same.filter((k) => JSON.stringify(t[k]) !== JSON.stringify(full[i][k])).map((k) => `${t.code}.${k}`));
ok('summary khớp bản đầy đủ ở mọi trường còn lại', diff.length === 0, diff.slice(0, 5));
const byNo = (n: number) => sum.find((t) => st.titles[t.id] === n);
ok('đếm bình luận đúng (việc 7: 2, việc 14: 3, việc 1: 0)', byNo(7)?.commentCount === 2 && byNo(14)?.commentCount === 3 && byNo(1)?.commentCount === 0,
  [byNo(7)?.commentCount, byNo(14)?.commentCount]);
ok('đếm người theo dõi đúng (việc 8: 2, việc 4: 1, việc 3: 0)', byNo(8)?.followerCount === 2 && byNo(4)?.followerCount === 1 && byNo(3)?.followerCount === 0);
ok('waitingOn đúng (việc 11 chờ việc 10 → 1, việc 10 → 0)', byNo(11)?.waitingOn === 1 && byNo(10)?.waitingOn === 0, [byNo(11)?.waitingOn, byNo(10)?.waitingOn]);
ok('tên người làm đúng (việc 3: Thành Viên A, việc 2: không ai)', byNo(3)?.assigneeName === 'Thành Viên A' && byNo(2)?.assigneeName === null);
ok(`summary nhẹ hơn nhiều (${(S.bytes / 1024).toFixed(0)} KB < ${(F.bytes / 1024).toFixed(0)} KB / 3)`, S.bytes * 3 < F.bytes);
const cols = (await json(pm, 'GET', `/api/projects/${st.P}`)).body.columns as any[];
// việc 10 sang cột kế tiếp; dự án mặc định không bật "việc sau bắt đầu từ cột này" → việc 11 vẫn chờ tới khi việc 10 xong
const t10 = byNo(10)!.id, t11 = byNo(11)!.id;
for (const c of cols.slice(1)) { await json(pm, 'POST', `/api/projects/tasks/${t10}/move`, { columnId: c.id }); if (c.isDone) break; }
const after = (await json(pm, 'GET', `/api/projects/${st.P}/tasks?summary=true`)).body as any[];
ok('chuyển việc 10 tới cột hoàn thành → summary: done + việc 11 hết chờ', after.find((t) => t.id === t10)?.done === true && after.find((t) => t.id === t11)?.waitingOn === 0,
  [after.find((t) => t.id === t10)?.columnName, after.find((t) => t.id === t11)?.waitingOn]);
const bulkIds = [byNo(20)!.id, byNo(21)!.id, byNo(22)!.id];
const bk = await json(pm, 'POST', `/api/projects/${st.P}/tasks/bulk`, { taskIds: bulkIds, action: 'assign', assigneeEmployeeId: st.aId });
const afterBulk = (await json(pm, 'GET', `/api/projects/${st.P}/tasks?summary=true`)).body as any[];
ok('bulk giao 3 việc cho A → summary có assigneeName mới', bk.status === 200 && bulkIds.every((id) => afterBulk.find((t) => t.id === id)?.assigneeName === 'Thành Viên A'), bk.body);
const bulkFull = await Promise.all(bulkIds.map(async (id) => (await json(pm, 'GET', `/api/projects/tasks/${id}`)).body.task));
ok('… bulk không làm mất mô tả', bulkFull.every((t) => t.description === desc(st.titles[t.id])));
const detail = (await json(pm, 'GET', `/api/projects/tasks/${byNo(15)!.id}?comments=false`)).body;
ok('chi tiết việc: mô tả + 2 media + mediaCount 2', detail.task.description === desc(15) && detail.task.mediaLinks.length === 2 && detail.task.mediaCount === 2);
const a = await login(st.aUser, PW);
const mine = (await json(a, 'GET', '/api/projects/tasks/mine')).body as any[];
ok(`/tasks/mine (A): việc chưa xong của A, có mô tả + projectName (${mine.length} việc)`,
  mine.length > 0 && mine.every((t) => t.assigneeEmployeeId === st.aId && !t.done && t.description === desc(st.titles[t.id]) && t.projectName === 'Dự án 240 việc'));
ok('dự án không tồn tại → 404 (cả khi không có việc)', (await json(pm, 'GET', `/api/projects/00000000-0000-0000-0000-000000000001/tasks?summary=true`)).status === 404);

// ---------- UI ---------- (đăng nhập web của PM làm cookie API của PM hết hiệu lực → kiểm API sau đó bằng cookie A)
const t15 = byNo(15)!.id, t30 = byNo(30)!.id, t45 = byNo(45)!.id;
const br = await launch(9440, `${tmpdir()}/officehub-t240-${Date.now()}`, 1440, 900);
try {
  ok('PM đăng nhập web', (await br.login(st.pmUser, PW)) === 200);
  const until = async (cond: () => Promise<boolean>, ms = 12000) => { for (let i = 0; i < ms / 300; i++) { try { if (await cond()) return true; } catch { /* đang chuyển trang */ } await br.sleep(300); } return false; };
  const dialogTitle = () => br.evalJs(`document.querySelector('[role="dialog"] h2')?.textContent ?? ''`) as Promise<string>;
  const dialogText = () => br.evalJs(`document.querySelector('[role="dialog"]')?.textContent ?? ''`) as Promise<string>;
  const closeDialog = async () => { await br.evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Đóng')?.click()`); await until(async () => (await dialogTitle()) === ''); };
  const reqs: string[] = [];
  await br.send('Network.enable');
  br.on('Network.requestWillBeSent', (p: any) => { if (p?.request?.url?.includes('/api/projects/')) reqs.push(p.request.url); });

  await br.go(`${BASE}/projects/${st.P}`, 4000);
  ok('kanban hiện thẻ việc', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-card"]').length`)) > 0));
  ok('trang gọi danh sách việc bản gọn ?summary=true', reqs.some((u) => u.includes(`/${st.P}/tasks?summary=true`)), reqs.filter((u) => u.includes('/tasks')).slice(0, 4));
  const card15 = `[...document.querySelectorAll('[data-testid="task-card"]')].find(x => /Việc 15([^0-9]|$)/.test(x.textContent))`;
  ok('thẻ việc có media hiện số ảnh 2 (mediaCount)', await br.evalJs(`!!${card15}?.querySelector('[title="Ảnh / video"]') && ${card15}.querySelector('[title="Ảnh / video"]').textContent.trim() === '2'`));
  await br.evalJs(`${card15}?.scrollIntoView({block:'center'})`);
  await br.sleep(400);
  await br.shot(`${SHOTS}/t240-kanban.png`);

  // 1) mở từ kanban → mô tả hiện (từ chi tiết)
  await br.evalJs(`${card15}?.click()`);
  ok('mở việc 15 từ kanban → hộp thoại', await until(async () => (await dialogTitle()).includes('Việc 15')), await dialogTitle());
  ok('… mô tả hiện đúng (tải từ chi tiết)', await until(async () => (await dialogText()).includes('Mô tả chi tiết việc 15')));
  ok('… 2 link media hiện trong hộp thoại', await until(async () => (await br.evalJs(`document.querySelectorAll('[role="dialog"] img[src*="example.com/anh-15"]').length + document.querySelectorAll('[role="dialog"] a[href*="example.com/anh-15"]').length`)) >= 2));
  await br.shot(`${SHOTS}/t240-dialog.png`);
  // 2) sửa tên rồi Lưu → mô tả + media không mất
  await br.evalJs(`(() => { const i = document.getElementById('tk-title'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Việc 15 (đã sửa tên)'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.evalJs(`[...document.querySelectorAll('[role="dialog"] button[type="submit"]')].find(b => b.textContent.includes('Lưu'))?.click()`);
  ok('Lưu → đóng hộp thoại', await until(async () => (await dialogTitle()) === ''));
  const d15 = (await json(a, 'GET', `/api/projects/tasks/${t15}`)).body.task;
  ok('… tên đổi, mô tả + 2 media GIỮ NGUYÊN', d15.title === 'Việc 15 (đã sửa tên)' && d15.description === desc(15) && d15.mediaLinks.length === 2, { title: d15.title, len: d15.description?.length, m: d15.mediaLinks });

  // 3) link ?task= (vào thẳng, chi tiết + danh sách tải song song)
  await br.go(`${BASE}/projects/${st.P}?task=${t30}`, 4000);
  ok('link ?task= → hộp thoại việc 30 + mô tả + nút Lưu bật', await until(async () => (await dialogTitle()).includes('Việc 30') && (await dialogText()).includes('Mô tả chi tiết việc 30')
    && await br.evalJs(`!([...document.querySelectorAll('[role="dialog"] button[type="submit"]')].find(b => b.textContent.includes('Lưu'))?.disabled)`)));
  await br.evalJs(`(() => { const i = document.getElementById('tk-title'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Việc 30 (sửa qua link)'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.evalJs(`[...document.querySelectorAll('[role="dialog"] button[type="submit"]')].find(b => b.textContent.includes('Lưu'))?.click()`);
  await until(async () => (await dialogTitle()) === '');
  const d30 = (await json(a, 'GET', `/api/projects/tasks/${t30}`)).body.task;
  ok('… Lưu qua link: mô tả + media giữ nguyên', d30.title === 'Việc 30 (sửa qua link)' && d30.description === desc(30) && d30.mediaLinks.length === 2);

  // 4) chế độ Danh sách → mở việc 45
  await br.go(`${BASE}/projects/${st.P}`, 3500);
  await br.evalJs(`document.querySelector('[data-testid="view-list"]')?.click()`);
  ok('chế độ Danh sách hiện hàng việc', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-row"]').length`)) > 0));
  await br.evalJs(`(() => { const i = document.querySelector('[data-testid="task-search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Việc 45'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(800);
  await br.evalJs(`[...document.querySelectorAll('[data-testid="task-row"]')].find(x => /Việc 45([^0-9]|$)/.test(x.textContent))?.click()`);
  ok('mở việc 45 từ Danh sách → mô tả hiện', await until(async () => (await dialogTitle()).includes('Việc 45') && (await dialogText()).includes('Mô tả chi tiết việc 45')));
  await br.evalJs(`(() => { const i = document.getElementById('tk-title'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, 'Việc 45 (sửa từ danh sách)'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.evalJs(`[...document.querySelectorAll('[role="dialog"] button[type="submit"]')].find(b => b.textContent.includes('Lưu'))?.click()`);
  await until(async () => (await dialogTitle()) === '');
  const d45 = (await json(a, 'GET', `/api/projects/tasks/${t45}`)).body.task;
  ok('… Lưu từ Danh sách: mô tả + media giữ nguyên', d45.title === 'Việc 45 (sửa từ danh sách)' && d45.description === desc(45) && d45.mediaLinks.length === 2);
  await br.shot(`${SHOTS}/t240-list.png`);
  // 5) thêm việc mới vẫn được (không chờ chi tiết)
  await br.evalJs(`document.querySelector('[data-testid="list-create-task"]')?.click()`);
  ok('nút Tạo công việc → hộp thoại "Thêm việc", nút Lưu bật', await until(async () => (await dialogTitle()) === 'Thêm việc'
    && await br.evalJs(`!([...document.querySelectorAll('[role="dialog"] button[type="submit"]')].find(b => b.textContent.includes('Lưu'))?.disabled)`)));
  await closeDialog();
  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection|404|Not Found|status of 4|WebSocket/.test(e));
  ok('không lỗi JS trên trang (ngoài Realtime không bật)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
