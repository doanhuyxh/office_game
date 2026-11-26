// E2E TEST-241: trang chi tiết dự án — chi tiết dự án + danh sách việc tải SONG SONG (bỏ thác nước), staleTime 30 giây, prefetch khi rê chuột / focus
// thẻ dự án ở /projects, ProjectLiveUpdates chỉ làm mới khoá liên quan (không tải lại sổ tay / danh sách việc khi đang ở tab khác), khung kanban giả.
// Dùng lại dữ liệu seed của TEST-240 (dự án ~240 việc): chạy `task-list-summary-e2e.ts seed` trước (ghi STATE ở tmpdir).
// Pha timing: mở /projects/{id} (Chrome headless, throttle mạng "Fast 4G", tắt cache) N lần → mốc bắt đầu / xong của GET /projects/{id} và
//   GET /projects/{id}/tasks + thời gian tới khi thấy thẻ kanban. Chạy với FE bản CŨ rồi bản MỚI (vite build + vite preview, cùng Api / DB) để so.
// Pha check: các kịch bản chức năng trên FE MỚI.
// CHỈ DB tạm (môi trường như task-list-summary-e2e.ts):
//   docker run -d --name e2e241-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15441:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5250
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15441;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=9 Sentry__Dsn= Seq__Url= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng>
//        Database__MigrateOnStartup=true Seed__AdminEmail=e2e240-admin@officehub-e2e.vn Seed__AdminPassword=E2e240-Admin-2026
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5250 bun scripts/dev/task-list-summary-e2e.ts seed
//   FE mới (frontend/): bun run build && VITE_API_TARGET=http://localhost:5250 bunx vite preview --port 5251 --strictPort
//   FE cũ: git archive <commit trước TEST-241> frontend | tar -x -C <tmp>; nối node_modules (mklink /J) rồi build + preview cổng 5252, cùng env.
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5250 BASE_URL=http://localhost:5252 bun scripts/dev/project-detail-parallel-e2e.ts timing   (bản cũ)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5250 BASE_URL=http://localhost:5251 bun scripts/dev/project-detail-parallel-e2e.ts timing   (bản mới)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5250 BASE_URL=http://localhost:5251 SHOTS_DIR=… bun scripts/dev/project-detail-parallel-e2e.ts check
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5250';
const BASE = process.env.BASE_URL ?? 'http://localhost:5251';
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/t241`;
const RUNS = Number(process.env.RUNS ?? 5);
const STATE = `${tmpdir()}/officehub-e2e240-state.json`;
const phase = process.argv[2] ?? 'check';
const PW = 'E2e-Local-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type State = { P: string; pmUser: string; aUser: string; aId: string; bId: string; titles: Record<string, number> };
const st = JSON.parse(readFileSync(STATE, 'utf8')) as State;
const byNo = (n: number) => Object.entries(st.titles).find(([, i]) => i === n)![0];

const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const login = async (user: string): Promise<string> => {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: user, password: PW }) });
    if (r.status === 429 && attempt < 5) { await sleep(15000); continue; }
    const c = cookieOf(r, 'officehub.auth');
    if (!c) throw new Error(`Đăng nhập ${user} lỗi ${r.status}`);
    return c;
  }
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed };
};

// "Fast 4G" của Chrome DevTools: 9 Mbps xuống, 1.5 Mbps lên, độ trễ 60 ms × 2.75
const FAST_4G = { offline: false, latency: 165, downloadThroughput: (9000 * 1000) / 8, uploadThroughput: (1500 * 1000) / 8 };
// ghi mốc (performance.now) lần đầu thấy khung kanban giả / thẻ việc thật — chạy trước mọi script của trang
const MARKS = `(() => { window.__t = {}; const mark = () => {
  if (!window.__t.skeleton && document.querySelector('[data-testid="kanban-skeleton"]')) window.__t.skeleton = performance.now();
  if (!window.__t.spinner && document.querySelector('main .animate-spin')) window.__t.spinner = performance.now();
  if (!window.__t.card && document.querySelector('[data-testid="task-card"]')) window.__t.card = performance.now(); };
  new MutationObserver(mark).observe(document, { childList: true, subtree: true }); })()`;

type Req = { url: string; method: string; start: number; end?: number; type?: string };
const browser = async (port: number) => {
  const br = await launch(port, `${tmpdir()}/officehub-t241-${port}-${Date.now()}`, 1440, 900);
  const reqs = new Map<string, Req>();
  await br.send('Network.enable');
  br.on('Network.requestWillBeSent', (p: any) => { reqs.set(p.requestId, { url: p.request.url, method: p.request.method, start: p.timestamp * 1000, type: p.type }); });
  br.on('Network.loadingFinished', (p: any) => { const r = reqs.get(p.requestId); if (r) r.end = p.timestamp * 1000; });
  const api = (pred: (path: string) => boolean) => [...reqs.values()].filter((r) => { const u = new URL(r.url); return u.pathname.startsWith('/api/') && pred(u.pathname + u.search); });
  return { ...br, reqs, api };
};
const isDetail = (p: string) => p === `/api/projects/${st.P}`;
const isTasks = (p: string) => p.startsWith(`/api/projects/${st.P}/tasks`) && !p.includes('/tasks/');

if (phase === 'timing') {
  const br = await browser(9541);
  try {
    if ((await br.login(st.pmUser, PW)) !== 200) throw new Error('PM không đăng nhập được web');
    await br.send('Network.setCacheDisabled', { cacheDisabled: true });
    await br.send('Network.emulateNetworkConditions', FAST_4G);
    await br.send('Page.addScriptToEvaluateOnNewDocument', { source: MARKS });
    const rows: { gap: number; overlap: boolean; card: number; skeleton: number | null; detailMs: number; tasksMs: number }[] = [];
    for (let i = 0; i < RUNS; i++) {
      await br.go('about:blank', 300);
      br.reqs.clear();
      await br.go(`${BASE}/projects/${st.P}`, 300);
      for (let k = 0; k < 300 && !(await br.evalJs('window.__t?.card ?? 0')); k++) await br.sleep(100);
      await br.sleep(500);
      const t = await br.evalJs('window.__t') as { card?: number; skeleton?: number };
      const d = br.api(isDetail)[0], ts = br.api(isTasks)[0];
      if (!d || !ts || !t.card) { console.log('  lần', i + 1, 'thiếu dữ liệu', { d: !!d, ts: !!ts, t }); continue; }
      rows.push({ gap: Math.round(ts.start - d.start), overlap: ts.start < (d.end ?? Infinity), card: Math.round(t.card), skeleton: t.skeleton ? Math.round(t.skeleton) : null,
        detailMs: Math.round((d.end ?? 0) - d.start), tasksMs: Math.round((ts.end ?? 0) - ts.start) });
      console.log(`  lần ${i + 1}: tasks bắt đầu sau detail ${rows.at(-1)!.gap} ms (detail ${rows.at(-1)!.detailMs} ms, tasks ${rows.at(-1)!.tasksMs} ms`
        + `${rows.at(-1)!.overlap ? ', CHỒNG nhau' : ', NỐI TIẾP'}) · thấy kanban ${rows.at(-1)!.card} ms${t.skeleton ? ` · khung giả ${Math.round(t.skeleton)} ms` : ''}`);
    }
    const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    console.log(`\n${BASE} (${RUNS} lần, Fast 4G, không cache): trung vị tasks bắt đầu sau detail ${med(rows.map((r) => r.gap))} ms · thấy kanban ${med(rows.map((r) => r.card))} ms`);
  } finally { br.close(); }
  process.exit(0);
}

// ================= check =================
const a = await login(st.aUser);
const cols = (await json(a, 'GET', `/api/projects/${st.P}`)).body.columns as { id: string; name: string; isDone: boolean; approverOnly: boolean }[];
// chọn việc còn ở cột đầu → chạy lại script trên cùng dữ liệu vẫn được (mỗi lần dùng việc khác)
const list = (await json(a, 'GET', `/api/projects/${st.P}/tasks?summary=true`)).body as { id: string; columnId: string; waitingOn: number }[];
const inFirst = (n: number) => list.find((t) => t.id === byNo(n))?.columnId === cols[0].id;
const nums = Object.values(st.titles).sort((x, y) => x - y);
const nMove = nums.find((n) => n > 40 && n % 10 > 1 && n % 10 < 9 && inFirst(n))!;          // việc thường, không dính phụ thuộc
const nCmt = nums.find((n) => n > nMove && n % 10 > 1 && n % 10 < 9)!;
const nDep = nums.find((n) => n > 40 && n % 10 === 0 && inFirst(n) && list.find((t) => t.id === byNo(n + 1))?.waitingOn === 1)!; // việc nDep+1 chờ việc nDep
console.log(`  dùng Việc ${nMove} (kéo), Việc ${nCmt} (bình luận), Việc ${nDep} → ${nDep + 1} (phụ thuộc)`);
const br = await browser(9542);
const until = async (cond: () => Promise<boolean>, ms = 15000) => { for (let i = 0; i < ms / 300; i++) { try { if (await cond()) return true; } catch { /* đang chuyển trang */ } await br.sleep(300); } return false; };
const cardIn = (title: string, col: string) => br.evalJs(`!![...document.querySelectorAll('[data-testid="col-${col}"] [data-testid="task-card"]')].find(x => /${title}([^0-9]|$)/.test(x.textContent))`) as Promise<boolean>;
try {
  ok('PM đăng nhập web', (await br.login(st.pmUser, PW)) === 200);
  await br.send('Page.addScriptToEvaluateOnNewDocument', { source: MARKS });

  // 1) song song: GET /projects/{id} và /tasks bắt đầu cùng lúc (Fast 4G để thấy rõ thứ tự), tasks bắt đầu trước khi detail xong
  await br.send('Network.emulateNetworkConditions', FAST_4G);
  br.reqs.clear();
  await br.go(`${BASE}/projects/${st.P}`, 300);
  ok('kanban hiện thẻ việc', await until(async () => !!(await br.evalJs('window.__t?.card'))));
  const d = br.api(isDetail), ts = br.api(isTasks);
  const gap = ts[0] && d[0] ? Math.round(ts[0].start - d[0].start) : NaN;
  console.log(`  GET /projects/{id} bắt đầu ${d[0] && new Date(d[0].start).toISOString()} (${Math.round((d[0]?.end ?? 0) - (d[0]?.start ?? 0))} ms) · GET /tasks bắt đầu ${ts[0] && new Date(ts[0].start).toISOString()} (${Math.round((ts[0]?.end ?? 0) - (ts[0]?.start ?? 0))} ms) · lệch ${gap} ms`);
  ok(`detail + tasks bắt đầu cùng lúc (lệch ${gap} ms ≤ 50 ms, tasks bắt đầu trước khi detail xong)`, d.length === 1 && ts.length === 1 && Math.abs(gap) <= 50 && ts[0].start < (d[0].end ?? Infinity),
    { d: d.length, ts: ts.length, gap });
  ok('danh sách việc gọi bản gọn ?summary=true, chỉ 1 lần (TaskBoard dùng lại cache)', ts.length === 1 && ts[0].url.includes('summary=true'), ts.map((r) => r.url));
  const marks = await br.evalJs('window.__t') as { skeleton?: number; card?: number };
  // loader route tải dữ liệu song song với chunk trang → thường việc về trước khi trang dựng xong, khung giả không kịp hiện (bước 2 kiểm khung giả)
  console.log(`  thấy kanban ${Math.round(marks.card ?? 0)} ms${marks.skeleton ? ` · khung giả ${Math.round(marks.skeleton)} ms` : ' · (việc về trước khi trang dựng xong, không cần khung giả)'}`);
  await br.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });

  // 2) khung giả đúng cột (chặn danh sách việc bằng Fetch để chụp ảnh khung)
  await br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/${st.P}/tasks?summary=true*`, requestStage: 'Request' }] });
  const paused: string[] = [];
  br.on('Fetch.requestPaused', (p: any) => paused.push(p.requestId));
  await br.go(`${BASE}/projects/${st.P}`, 300);
  ok('tasks bị giữ → khung kanban giả theo đúng tên cột của dự án', await until(async () => {
    const names = await br.evalJs(`[...document.querySelectorAll('[data-testid="kanban-skeleton"] > div')].map(c => c.textContent.trim())`) as string[];
    return JSON.stringify(names) === JSON.stringify(cols.map((c) => c.name));
  }), await br.evalJs(`[...document.querySelectorAll('[data-testid="kanban-skeleton"] > div')].map(c => c.textContent.trim())`));
  await br.shot(`${SHOTS}/t241-skeleton.png`);
  for (const id of paused) await br.send('Fetch.continueRequest', { requestId: id });
  await br.send('Fetch.disable');
  ok('… thả request → thẻ việc thật thay khung giả', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-card"]').length`)) > 0
    && !(await br.evalJs(`!!document.querySelector('[data-testid="kanban-skeleton"]')`))));
  await br.sleep(1000);

  // 3) người khác kéo việc → bảng tự cập nhật (ProjectLiveUpdates hỏi 5 giây), chỉ gọi lại detail + tasks, không gọi khoá khác
  const t50 = byNo(nMove), V50 = `Việc ${nMove}`;
  const from = cols[0], to = cols[1];
  ok(`${V50} đang ở cột "${from.name}"`, await cardIn(V50, from.name));
  br.reqs.clear();
  const mv = await json(a, 'POST', `/api/projects/tasks/${t50}/move`, { columnId: to.id });
  ok(`A (API) chuyển ${V50} → "${to.name}"`, mv.status === 200 || mv.status === 204, mv);
  ok('… bảng của PM tự cập nhật (không tải lại trang)', await until(async () => cardIn(V50, to.name), 15000));
  await br.sleep(1500);
  const after = br.api((p) => p.startsWith('/api/projects') && !p.startsWith('/api/projects/activity')).map((r) => new URL(r.url).pathname + new URL(r.url).search);
  console.log('  request sau hoạt động:', JSON.stringify(after));
  ok('… chỉ gọi lại chi tiết dự án + danh sách việc (+ việc của tôi / danh sách dự án nếu đang dùng)',
    after.some((p) => isDetail(p)) && after.some((p) => isTasks(p)) && after.every((p) => isDetail(p) || isTasks(p) || p === '/api/projects/tasks/mine' || /^\/api\/projects(\?|$)/.test(p)), after);
  await br.shot(`${SHOTS}/t241-live-move.png`);

  // 4) tab Sổ tay: hoạt động mới KHÔNG tải lại danh sách việc / sổ tay (trước TEST-241 invalidate cả ['projects'])
  await br.go(`${BASE}/projects/${st.P}?tab=wiki`, 2500);
  const panel = () => br.evalJs(`document.querySelector('[role="tabpanel"][data-state="active"]')?.textContent ?? ''`) as Promise<string>;
  ok('tab Sổ tay hiện', await until(async () => (await panel()).includes('Sổ tay')));
  await br.sleep(6000); // qua một vòng hỏi activity để con trỏ ổn định
  br.reqs.clear();
  const cm = await json(a, 'POST', `/api/projects/tasks/${byNo(nCmt)}/comments`, { content: 'Bình luận của A khi PM ở tab Sổ tay' });
  ok(`A bình luận Việc ${nCmt}`, cm.status === 200 || cm.status === 201, cm);
  ok('… trang gọi lại chi tiết dự án (đếm / tiến độ)', await until(async () => br.api(isDetail).length > 0, 12000));
  await br.sleep(1500);
  const wikiReqs = br.api((p) => p.includes('/wiki') || isTasks(p)).map((r) => new URL(r.url).pathname);
  ok('… KHÔNG gọi lại danh sách việc / sổ tay khi đang ở tab Sổ tay', wikiReqs.length === 0, wikiReqs);
  // tab Mốc + Thành viên vẫn đúng
  await br.go(`${BASE}/projects/${st.P}?tab=members`, 2500);
  ok('tab Thành viên hiện thành viên', await until(async () => (await panel()).includes('Thành Viên A') && (await panel()).includes('Quản Lý 240')));
  await br.go(`${BASE}/projects/${st.P}?tab=milestones`, 2500);
  ok('tab Mốc hiện', await until(async () => (await panel()).includes('mốc')));

  // 5) link ?task= (từ chuông) → hộp thoại + mô tả; bình luận mới của A tự hiện trong hộp thoại đang mở
  const t70 = byNo(nDep), V70 = `Việc ${nDep}`, V71 = `Việc ${nDep + 1}`;
  await br.go(`${BASE}/projects/${st.P}?tab=wiki&task=${t70}`, 2500);
  const dialogText = () => br.evalJs(`document.querySelector('[role="dialog"]')?.textContent ?? ''`) as Promise<string>;
  ok(`link ?task= (kể cả kèm tab khác) → hộp thoại ${V70} + mô tả`, await until(async () => (await dialogText()).includes(V70) && (await dialogText()).includes(`Mô tả chi tiết việc ${nDep}`)));
  await br.sleep(6000);
  await json(a, 'POST', `/api/projects/tasks/${t70}/comments`, { content: 'Bình luận mới TEST-241 tự hiện' });
  ok('… bình luận mới của A tự hiện trong hộp thoại đang mở', await until(async () => (await dialogText()).includes('Bình luận mới TEST-241 tự hiện'), 15000));
  await br.shot(`${SHOTS}/t241-dialog-comment.png`);
  // việc phụ thuộc: hộp thoại Việc 71 (chờ Việc 70) đang mở, A đưa Việc 70 tới cột hoàn thành → hộp thoại tự cập nhật "phải chờ" (khoá task của việc KHÁC)
  const t71 = byNo(nDep + 1);
  await br.go(`${BASE}/projects/${st.P}?task=${t71}`, 3000);
  ok(`mở ${V71} (đang chờ ${V70})`, await until(async () => (await dialogText()).includes(V71)));
  await br.sleep(6000);
  br.reqs.clear();
  for (const c of cols.slice(1)) { if (c.approverOnly) break; await json(a, 'POST', `/api/projects/tasks/${t70}/move`, { columnId: c.id }); }
  ok(`… hộp thoại ${V71} (việc khác cùng dự án) được tải lại sau khi ${V70} đổi cột`, await until(async () => br.api((p) => p.startsWith(`/api/projects/tasks/${t71}`)).length > 0, 15000),
    br.api(() => true).map((r) => r.url));

  // 6) staleTime + prefetch: /projects mới tải → focus thẻ dự án → tải trước detail + tasks; bấm vào → không gọi lại, kanban hiện ngay
  await br.go(`${BASE}/projects`, 3000);
  ok('trang /projects hiện thẻ dự án', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="project-card"]').length`)) > 0));
  br.reqs.clear();
  const card = `[...document.querySelectorAll('[data-testid="project-card"]')].find(x => x.textContent.includes('Dự án 240 việc'))`;
  // rê chuột thật (CDP Input) lên thẻ — headless không phát sự kiện focus khi gọi element.focus() (cùng handler onMouseEnter / onFocus)
  const box = await br.evalJs(`(() => { const r = ${card}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number };
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  ok('rê chuột lên thẻ dự án → tải trước GET /projects/{id} + /tasks?summary=true', await until(async () => br.api(isDetail).length === 1 && br.api(isTasks).length === 1, 8000),
    br.api(() => true).map((r) => r.url));
  await br.sleep(1500);
  br.reqs.clear();
  await br.evalJs(`${card}?.click()`);
  ok('bấm thẻ → kanban hiện ngay từ cache', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-card"]').length`)) > 0, 3000));
  await br.sleep(1500);
  ok('… không gọi lại detail / tasks (còn mới < 30 giây)', br.api(isDetail).length === 0 && br.api(isTasks).length === 0, br.api(() => true).map((r) => r.url));
  // quay về /projects rồi vào lại trong 30 giây → vẫn không gọi
  await br.evalJs(`history.back()`);
  await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="project-card"]').length`)) > 0, 5000);
  br.reqs.clear();
  await br.evalJs(`${card}?.click()`);
  await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-card"]').length`)) > 0, 3000);
  await br.sleep(1000);
  ok('quay lại dự án trong 30 giây → hiện cache, không gọi lại', br.api(isDetail).length === 0 && br.api(isTasks).length === 0, br.api(() => true).map((r) => r.url));
  // quá 30 giây → hiện cache + làm mới nền
  await br.evalJs(`history.back()`);
  await br.sleep(31000);
  br.reqs.clear();
  await br.evalJs(`${card}?.click()`);
  ok('quá 30 giây → làm mới nền detail + tasks', await until(async () => br.api(isDetail).length === 1 && br.api(isTasks).length === 1, 8000), br.api(() => true).map((r) => r.url));
  await br.shot(`${SHOTS}/t241-kanban.png`);

  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection|404|Not Found|status of 4|WebSocket/.test(e));
  ok('không lỗi JS trên trang (ngoài Realtime không bật)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
