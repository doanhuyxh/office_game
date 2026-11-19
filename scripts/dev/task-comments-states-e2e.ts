// E2E TEST-194 bình luận trong hộp thoại việc: tải riêng `GET /tasks/{tid}/comments`, chi tiết việc gọi `?comments=false` (API mặc định vẫn trả bình luận — MCP get_task);
// đang tải lần đầu (giữ request bằng CDP Fetch): "Bình luận (N)" đúng commentCount (không lúc nào "(0)"), vòng xoay "Đang tải…", ≤ 3 thẻ khung xương đủ đậm
// (nền sáng + tối), ô nhập vẫn gõ được; trống: "Chưa có bình luận nào", không nháy khung xương; lỗi: "Không tải được bình luận" + Thử lại;
// gửi / xoá bình luận + bình luận người khác (cập nhật trực tiếp) + lùi cột có lý do → danh sách cập nhật, không nháy khung xương; link &comment= cuộn + tô sáng.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Api như đầu task-column-guide-e2e.ts, Vite trỏ Api (không cần Mcp / Realtime):
//   docker run -d --name e2e194-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15494:5432 postgres:17-alpine
//   VITE_API_TARGET=http://localhost:5394 bunx vite --port 5194   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5394 BASE_URL=http://localhost:5194 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-comments-states-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5394';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/task-comments-states`;
mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
/** Đăng nhập API; admin / HR bắt buộc 2FA → tự bật (khoá lưu KEYS_FILE) hoặc nhập mã TOTP. */
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

// ── Dữ liệu: quản lý dự án + thành viên (người làm), việc nhiều bình luận + việc không bình luận ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV CM ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Bình luận ${stamp}`, code: `CM${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[]) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`CP${stamp}`, 'Quản Lý Dự Án', `e2e.cm.pm.${stamp}`, ['employee', 'manager']);
const Mem = await mkEmp(`CN${stamp}`, 'Đoàn Thành Viên', `e2e.cm.mem.${stamp}`, ['employee']);
const projBody = { code: `CM${stamp}`, name: 'Bình luận việc (UI)', kind: 'Internal', startOn: today, memberIds: [Mem.e.id] };
const P = (await json(PM.cookie, 'POST', '/api/projects', { ...projBody, sequential: false })).body as string;
const cols: any[] = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.columns;
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const mk = async (title: string, column: string) => (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, columnId: col(column), assigneeEmployeeId: Mem.e.id })).body as string;
const A = await mk('Việc có nhiều bình luận', 'Đang làm');
const B = await mk('Việc chưa có bình luận', 'Cần làm');
const cids: string[] = [];
for (const text of ['Đã xem đặc tả, bắt đầu làm.', 'Cần thêm ảnh thiết kế cho **màn hình chi tiết**.', 'Đã đính kèm link Figma.', 'OK, làm tiếp phần API.'])
  cids.push((await json(PM.cookie, 'POST', `/api/projects/tasks/${A}/comments`, { content: text })).body as string);
ok('dữ liệu: việc A có 4 bình luận', cids.every(Boolean) && cids.length === 4, cids);
await json(PM.cookie, 'PUT', `/api/projects/${P}`, { ...projBody, sequential: true });

// ── API: mặc định vẫn có bình luận (MCP get_task), ?comments=false bỏ bình luận ──
const full = (await json(PM.cookie, 'GET', `/api/projects/tasks/${A}`)).body;
const lite = (await json(PM.cookie, 'GET', `/api/projects/tasks/${A}?comments=false`)).body;
ok('API GET /tasks/{tid} mặc định trả 4 bình luận', full?.comments?.length === 4, full?.comments?.length);
ok('API ?comments=false → comments rỗng, phần khác giữ nguyên (lịch sử, cột, task.commentCount)', Array.isArray(lite?.comments) && lite.comments.length === 0
  && lite.activities.length === full.activities.length && lite.columns.length === full.columns.length && lite.task.commentCount === 4, lite?.comments);
ok('API GET /tasks/{tid}/comments → 4 bình luận', (await json(PM.cookie, 'GET', `/api/projects/tasks/${A}/comments`)).body?.length === 4);

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const br = await launch(9394, `${tmpdir()}/task-comments-states-${stamp}`);
const urls: string[] = [];
br.on('Network.requestWillBeSent', (p: any) => { if (p.request.url.includes('/api/projects/tasks/')) urls.push(p.request.url.replace(/^https?:\/\/[^/]+/, '')); });
await br.send('Network.enable');
/** Theo dõi trong trang: khung xương / "Bình luận (0)" có lúc nào xuất hiện không (MutationObserver, cả nháy rất ngắn). */
const watch = () => br.evalJs(`(() => { window.__seen = { skeleton: false, zero: false };
  const check = () => { if (document.querySelector('[data-testid="task-comment-skeleton"]')) window.__seen.skeleton = true;
    if ([...document.querySelectorAll('[role="dialog"] div')].some((d) => d.childElementCount <= 2 && /^Bình luận \\(0\\)/.test(d.innerText ?? ''))) window.__seen.zero = true; };
  window.__obs?.disconnect(); window.__obs = new MutationObserver(check); window.__obs.observe(document.body, { subtree: true, childList: true, characterData: true }); check(); })()`);
const seen = () => br.evalJs(`window.__seen`) as Promise<{ skeleton: boolean; zero: boolean }>;
const header = () => br.evalJs(`[...document.querySelectorAll('[role="dialog"] span')].find((s) => /^Bình luận \\(\\d+\\)$/.test(s.innerText))?.innerText`) as Promise<string | undefined>;
const count = () => br.evalJs(`document.querySelectorAll('[data-testid="task-comment"]').length`) as Promise<number>;
const until = async (fn: () => Promise<boolean>, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await fn()) return true; await br.sleep(250); } return false; };
const clickAt = async (expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(350);
};
/** Giữ / làm hỏng request bình luận của việc A bằng CDP Fetch. */
let mode: 'hold' | 'fail' = 'hold';
const held: string[] = [];
br.on('Fetch.requestPaused', (p: any) => {
  if (mode === 'hold') held.push(p.requestId);
  else void br.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: 'content-type', value: 'application/json' }],
    body: Buffer.from(JSON.stringify({ title: 'Lỗi thử' })).toString('base64') });
});
const holdComments = (tid: string) => br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/tasks/${tid}/comments`, requestStage: 'Request' }] });
const release = async () => { for (const id of held.splice(0)) await br.send('Fetch.continueRequest', { requestId: id }); await br.send('Fetch.disable'); };
const URL_A = `${BASE}/projects/${P}?tab=tasks&task=${A}`;
/** Khung xương đủ đậm: thanh bên trong khác nền thẻ, thẻ có viền. */
const skeletonVisible = () => br.evalJs(`(() => { const card = document.querySelector('[data-testid="task-comment-skeleton"]'); if (!card) return false;
  const bar = card.firstElementChild; const cs = getComputedStyle(card), bs = getComputedStyle(bar);
  return cs.borderTopWidth === '1px' && bs.backgroundColor !== cs.backgroundColor && bs.backgroundColor !== 'rgba(0, 0, 0, 0)'; })()`);

try {
  ok('đăng nhập UI thành viên', (await br.login(Mem.user, PW)) === 200);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);

  // ── Đang tải lần đầu (giữ /comments) ──
  for (const theme of ['light', 'dark'] as const) {
    await br.evalJs(`localStorage.setItem('officehub:theme', '${theme}')`);
    await holdComments(A);
    urls.length = 0;
    await br.send('Page.navigate', { url: URL_A });
    await until(async () => !!(await br.evalJs(`!!document.querySelector('[role="dialog"]')`)));
    await watch();
    await br.sleep(1500);
    ok(`[${theme}] đang tải: tiêu đề "Bình luận (4)" theo commentCount`, (await header()) === 'Bình luận (4)', await header());
    ok(`[${theme}] đang tải: vòng xoay + "Đang tải…" role=status`, await br.evalJs(`${q('task-comments-loading')}?.getAttribute('role') === 'status' && ${q('task-comments-loading')}.innerText.includes('Đang tải')`));
    ok(`[${theme}] đang tải: 3 thẻ khung xương (min(4, 3)), đủ đậm (viền + thanh khác nền)`,
      await br.evalJs(`document.querySelectorAll('[data-testid="task-comment-skeleton"]').length`) === 3 && await skeletonVisible());
    ok(`[${theme}] đang tải: không trạng thái trống / lỗi, ô nhập bình luận vẫn hiện`, await br.evalJs(`!${q('task-comments-empty')} && !${q('task-comments-error')} && !!${q('task-comment-box')}?.querySelector('textarea')`));
    if (theme === 'light') {
      await br.evalJs(`(() => { const t = ${q('task-comment-box')}.querySelector('textarea'); t.focus(); })()`);
      await br.send('Input.insertText', { text: 'gõ trong lúc tải' });
      ok('đang tải: gõ được vào ô bình luận', await br.evalJs(`${q('task-comment-box')}.querySelector('textarea').value === 'gõ trong lúc tải'`));
    }
    await br.evalJs(`[...document.querySelectorAll('[role="dialog"] .lg\\\\:overflow-y-auto')][0]?.querySelector('[data-testid="task-comment-skeleton"]')?.scrollIntoView({ block: 'center' })`);
    await br.sleep(300);
    await br.shot(`${SHOTS}/${theme === 'light' ? '1-dang-tai-sang' : '2-dang-tai-toi'}.png`);
    await release();
    ok(`[${theme}] tải xong → 4 bình luận, hết khung xương / vòng xoay`, await until(async () => (await count()) === 4)
      && await br.evalJs(`!${q('task-comments-loading')} && !document.querySelector('[data-testid="task-comment-skeleton"]')`));
    ok(`[${theme}] không lúc nào hiện "Bình luận (0)"`, !(await seen()).zero);
    if (theme === 'light') {
      ok('Network: chi tiết việc gọi ?comments=false + /comments, không gọi chi tiết đầy đủ',
        urls.some((u) => u.endsWith(`/tasks/${A}?comments=false`)) && urls.some((u) => u.endsWith(`/tasks/${A}/comments`)) && !urls.some((u) => u.endsWith(`/tasks/${A}`)), urls);
      await br.shot(`${SHOTS}/3-da-tai-sang.png`);
    }
  }
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);

  // ── Trống: việc B không bình luận → trạng thái trống ngay, không khung xương ──
  for (const theme of ['light', 'dark'] as const) {
    await br.evalJs(`localStorage.setItem('officehub:theme', '${theme}')`);
    await holdComments(B);
    await br.send('Page.navigate', { url: `${BASE}/projects/${P}?tab=tasks&task=${B}` });
    await until(async () => !!(await br.evalJs(`!!document.querySelector('[role="dialog"]')`)));
    await watch();
    await br.sleep(800);
    ok(`[${theme}] trống (commentCount = 0, đang tải): "Chưa có bình luận nào" ngay, không khung xương`, await br.evalJs(`${q('task-comments-empty')}?.innerText.includes('Chưa có bình luận nào')
      && ${q('task-comments-empty')}.className.includes('border-dashed')`) && !(await seen()).skeleton);
    await release();
    await br.sleep(1500);
    ok(`[${theme}] trống: tải xong vẫn trạng thái trống, không nháy khung xương`, await br.evalJs(`!!${q('task-comments-empty')}`) && !(await seen()).skeleton && (await header()) === 'Bình luận (0)');
    await br.shot(`${SHOTS}/${theme === 'light' ? '4-trong-sang' : '5-trong-toi'}.png`);
  }
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);

  // ── Lỗi tải + Thử lại ──
  mode = 'fail';
  await holdComments(A);
  await br.go(URL_A, 1500);
  ok('lỗi: "Không tải được bình luận" + nút Thử lại (role=alert), không danh sách', await until(async () => !!(await br.evalJs(`${q('task-comments-error')}?.innerText.includes('Không tải được bình luận')
    && ${q('task-comments-error')}.getAttribute('role') === 'alert' && ${q('task-comments-error')}.querySelector('button')?.innerText.includes('Thử lại')`)), 12000) && (await count()) === 0);
  ok('lỗi: tiêu đề vẫn "Bình luận (4)", ô nhập vẫn có', (await header()) === 'Bình luận (4)' && await br.evalJs(`!!${q('task-comment-box')}`));
  await br.evalJs(`${q('task-comments-error')}.scrollIntoView({ block: 'center' })`);
  await br.shot(`${SHOTS}/6-loi-tai.png`);
  await br.send('Fetch.disable');
  mode = 'hold';
  await clickAt(`${q('task-comments-error')}.querySelector('button')`);
  ok('Thử lại → 4 bình luận, hết lỗi', await until(async () => (await count()) === 4 && !(await br.evalJs(`!!${q('task-comments-error')}`))));

  // ── Gửi / xoá: cập nhật danh sách, không nháy khung xương ──
  await watch();
  await br.evalJs(`${q('task-comment-box')}.querySelector('textarea').focus()`);
  await br.send('Input.insertText', { text: 'Bình luận mới từ thành viên' });
  await clickAt(`[...${q('task-comment-box')}.querySelectorAll('button')].find((b) => /Gửi/.test(b.innerText + (b.getAttribute('aria-label') ?? '')))`);
  ok('gửi bình luận → 5, tiêu đề (5)', await until(async () => (await count()) === 5 && (await header()) === 'Bình luận (5)'));
  await clickAt(`[...document.querySelectorAll('[data-testid="task-comment"]')].at(-1).querySelector('[aria-label="Xoá bình luận"]')`);
  await clickAt(q('confirm-dialog-ok'));
  ok('xoá bình luận của mình → 4', await until(async () => (await count()) === 4));
  ok('gửi / xoá không nháy khung xương', !(await seen()).skeleton);

  // ── Người khác bình luận / lùi cột có lý do → tự hiện (cập nhật trực tiếp) ──
  await json(PM.cookie, 'POST', `/api/projects/tasks/${A}/comments`, { content: 'Quản lý nhắc: nhớ chạy e2e.' });
  ok('người khác bình luận → tự hiện (≤ 12 giây)', await until(async () => (await count()) === 5, 12000));
  const mv = await json(PM.cookie, 'POST', `/api/projects/tasks/${A}/move`, { columnId: col('Cần làm'), note: 'Thiếu phần kiểm thử' });
  ok('lùi cột có lý do (quản lý) → lý do thành bình luận tự hiện', mv.status < 300 && await until(async () => (await count()) === 6
    && !!(await br.evalJs(`[...document.querySelectorAll('[data-testid="task-comment"]')].some((c) => c.innerText.includes('Thiếu phần kiểm thử'))`)), 12000), mv);
  ok('cập nhật trực tiếp không nháy khung xương', !(await seen()).skeleton);
  await br.shot(`${SHOTS}/7-cap-nhat-truc-tiep.png`);

  // ── Link chuông: &comment= cuộn tới + tô sáng (bình luận về sau khi giữ request) ──
  await holdComments(A);
  await br.go(`${BASE}/projects/${P}?tab=tasks&task=${A}&comment=${cids[1]}`, 1500);
  await release();
  ok('link &comment= → bình luận được tô sáng + nằm trong khung nhìn', await until(async () => !!(await br.evalJs(`(() => { const e = document.getElementById('task-comment-${cids[1]}');
    if (!e || !e.className.includes('ring-2')) return false; const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight; })()`))));
  await br.shot(`${SHOTS}/8-link-binh-luan.png`);

  const errs = br.errors.filter((e) => !/negotiat|signalr|hub|502|WebSocket|500|Lỗi thử|Failed to load resource/i.test(e ?? ''));
  ok('không lỗi console (bỏ SignalR, lỗi 500 cố ý)', errs.length === 0, errs);
} finally {
  br.close();
}
console.log(`\nẢnh: ${SHOTS}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
