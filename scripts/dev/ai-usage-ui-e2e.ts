// E2E TEST-136: giao diện mức dùng AI — Kết nối AI → tab "Mức dùng AI" + thẻ "AI tháng này" ở Hồ sơ.
// Dữ liệu ghi thẳng qua đường nội bộ Api (/api/audit/internal/ai-usage, khoá X-Internal-Key — không cần Mcp): bot B có phiên hôm nay (opus có chi phí,
// sonnet KHÔNG chi phí), 5 ngày trước (2 model), 20 ngày trước (lỗi, họp), 2 tháng trước, năm 2025; người thật H một phiên hôm nay.
// Kiểm tra: Ngày / Tháng / Năm đúng tổng (số phiên, chi phí, số cột), "—" + "N phiên không có chi phí", lọc loại phiên, bộ lọc trên URL,
// admin có ô chọn người / bot (Tất cả / một người), người thường không có ô + API người khác / all → 403, biểu đồ (chú thích ẩn / hiện, Token ↔ Chi phí),
// bảng theo model, danh sách phiên (lỗi tô đỏ, link việc), Xuất Excel, thẻ Hồ sơ khớp tháng hiện tại (admin không có dữ liệu → không có thẻ),
// theme tối, điện thoại 390 px (thẻ 2 cột, không tràn ngang). Ảnh vào SHOTS_DIR.
// TEST-224: thẻ nổi tự vẽ thay `title` của trình duyệt (ChartHoverCard): nội dung Token / Chi phí, số rút gọn, %, dòng cảnh báo phiên thiếu chi phí,
// hiện ngay, nằm trên cột + lật trái ở mép phải, cột khác mờ, ẩn model ở chú thích, Tháng / Năm, bàn phím, điện thoại chạm hiện / chạm ngoài tắt,
// cuộn ngang không cắt thẻ, biểu đồ Báo cáo → Trợ lý AI; ảnh 6-card-* / 7-card-* / 8-phone-card / 9-report-card.
// TEST-195: lọc trạng thái phiên (?status=done|failed|skipped) — API (400, quyền, AND với kind), ô "Trạng thái" ngay sau "Loại phiên", về trang 1,
// số trang đúng, thẻ / bảng / Excel cùng bộ lọc, giá trị lạ trên URL = không lọc, tải lại giữ bộ lọc, theme sáng + tối (ảnh 5-status-*.png).
// CHỈ DB tạm. Api (backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5283
//   'ConnectionStrings__Default=Host=127.0.0.1;Port=55441;Database=e2e;Username=e2e;Password=e2e' Seed__AdminEmail=… Seed__AdminPassword=…
//   Chat__InternalKey=<khoá ≥ 32 ký tự> Telegram__ApiUrl=http://127.0.0.1:9 Smtp__Host=127.0.0.1 Smtp__Port=1 dotnet run --project src/OfficeHub.Api --no-launch-profile
// Vite (frontend/): VITE_API_TARGET=http://localhost:5283 bunx vite --port 5178 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 BASE_URL=http://localhost:5178 ADMIN_LOGIN=… ADMIN_PASSWORD=… INTERNAL_KEY=… bun scripts/dev/ai-usage-ui-e2e.ts
// Không bật Realtime → lỗi kết nối hub bị bỏ qua.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? '';
if (!INTERNAL_KEY) throw new Error('Thiếu INTERNAL_KEY (= Chat__InternalKey của Api tạm)');
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
const stamp = Date.now().toString(36).slice(-5);
const SHOTS = process.env.SHOTS_DIR;

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV AU ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Mức dùng AI ${stamp}`, code: `AU${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  return { e, cookie, user, userId: me?.id as string };
};
const H = await mkEmp(`AH${stamp}`, 'Người Thật AU', `e2e.au.h.${stamp}`);
const B = await mkEmp(`AB${stamp}`, 'Bot Dev AU', `e2e.au.b.${stamp}`);
await json(admin, 'PUT', `/api/org/employees/${B.e.id}/account/bot`, { isBot: true });
ok('2 tài khoản (người thật + bot)', !!H.userId && !!B.userId);

const vnDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const today = vnDate(new Date());
/** Thời điểm hh:mm giờ VN của ngày `daysAgo` trước hôm nay. */
const at = (daysAgo: number, hh = '10:00') => {
  const d = new Date(`${today}T${hh}:00+07:00`);
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d > new Date() ? new Date(Date.now() - 60_000) : d;
};
const daysTo = (iso: string) => Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${iso}T00:00:00Z`).getTime()) / 86_400_000);
const OPUS = 'claude-opus-5-5', SONNET = 'claude-sonnet-5-5';
const PID = crypto.randomUUID(), TID = crypto.randomUUID();
const sess = (id: string, fin: Date, kind: string, status: string, cost: number | null, models: any[], extra: object = {}) => ({
  sourceId: `${id}-${stamp}`, kind, executor: 'claude', status, startedAt: new Date(fin.getTime() - 754_000).toISOString(), finishedAt: fin.toISOString(),
  turns: 5, costUsd: cost, models, ...extra,
});
const m = (model: string, inT: number, outT: number, cr: number, cw: number, cost: number | null) =>
  ({ model, inputTokens: inT, outputTokens: outT, cacheReadTokens: cr, cacheWriteTokens: cw, costUsd: cost });
const thisMonth = today.slice(0, 7);
const d5 = at(5), d20 = at(20);
const botSessions = [
  sess('s1', at(0, '00:30'), 'task', 'done', 1.2, [m(OPUS, 1000, 2000, 1_000_000, 50_000, 1.2)], { taskCode: 'TEST-1' }),
  sess('s2', at(0, '00:40'), 'chat', 'done', null, [m(SONNET, 500, 700, 0, 0, null)]),
  sess('s3', d5, 'task', 'done', 0.75, [m(OPUS, 2000, 3000, 400_000, 0, 0.5), m(SONNET, 100, 200, 0, 0, 0.25)], { taskCode: 'TEST-9', projectId: PID, taskId: TID }),
  sess('s4', d20, 'meeting', 'failed', 0.3, [m(SONNET, 300, 400, 0, 0, 0.3)]),
  sess('s5', at(daysTo(`${Number(today.slice(0, 4))}-${String(Number(today.slice(5, 7)) - 2).padStart(2, '0')}-10`)), 'task', 'done', 2, [m(OPUS, 10, 20, 0, 0, 2)]),
  sess('s6', at(daysTo('2025-06-15')), 'task', 'done', 3, [m(OPUS, 10, 20, 0, 0, 3)]),
];
const ingest = async (userId: string, sessions: unknown[]) => fetch(`${API}/api/audit/internal/ai-usage`, {
  method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': INTERNAL_KEY }, body: JSON.stringify({ userId, sessions }) });
const r1 = await ingest(B.userId, botSessions), r2 = await ingest(H.userId, [sess('h1', at(0, '00:50'), 'task', 'done', 0.1, [m(SONNET, 100, 100, 0, 0, 0.1)])]);
ok('ghi 6 phiên bot + 1 phiên người thật (đường nội bộ)', r1.status === 200 && r2.status === 200, [r1.status, await r1.text()]);
// Kỳ vọng (ngày "hôm nay" theo giờ VN): Ngày 30 ngày = s1 s2 s3 s4 h1; Tháng 12 tháng = + s5; Năm = + s6
const inMonth = (d: Date) => vnDate(d).slice(0, 7) === thisMonth;
const botMonth = [true, true, inMonth(d5), inMonth(d20)].filter(Boolean).length;
const botMonthCost = 1.2 + (inMonth(d5) ? 0.75 : 0) + (inMonth(d20) ? 0.3 : 0);

// ── API: lọc loại (mới ở TEST-136) + quyền ──
const sumKind = (await json(admin, 'GET', '/api/ai-usage/summary?userId=all&kind=task')).body;
ok('API kind=task: chỉ phiên việc (s1, s3, h1)', sumKind?.total?.sessions === 3, sumKind?.total);
ok('API kind sai → 400', (await json(admin, 'GET', '/api/ai-usage/summary?kind=abc')).status === 400);
ok('API sessions + export nhận kind', (await json(admin, 'GET', '/api/ai-usage/sessions?userId=all&kind=meeting&page=1')).body?.total === 1
  && (await fetch(`${API}/api/ai-usage/export?userId=all&kind=chat`, { headers: { cookie: admin } })).status === 200);
// ── TEST-195: lọc trạng thái phiên ──
// 28 phiên của H vào tháng 3/2015 (ngoài mọi khoảng mặc định → không đổi các kiểm tra khác): 25 bỏ qua (việc), 1 lỗi (việc), 2 xong (chat)
const old = (i: number) => new Date(Date.UTC(2015, 2, 10, 3, i));
const r3 = await ingest(H.userId, [
  ...Array.from({ length: 25 }, (_, i) => sess(`k${i}`, old(i), 'task', 'skipped', 0.01, [m(SONNET, 10, 10, 0, 0, 0.01)])),
  sess('kf', old(30), 'task', 'failed', 0.02, [m(SONNET, 10, 10, 0, 0, 0.02)]),
  sess('kd1', old(31), 'chat', 'done', 0.03, [m(OPUS, 10, 10, 0, 0, 0.03)]),
  sess('kd2', old(32), 'chat', 'done', 0.03, [m(OPUS, 10, 10, 0, 0, 0.03)]),
]);
ok('[195] ghi 28 phiên cũ (2015) cho H', r3.status === 200, await r3.text());
const R2015 = `from=2015-03-01&to=2015-03-31&userId=${H.userId}`;
const sumSt = async (qs: string) => (await json(admin, 'GET', `/api/ai-usage/summary?${R2015}&${qs}`)).body?.total?.sessions;
ok('[195] API summary status=skipped / failed / done / trống → 25 / 1 / 2 / 28',
  await sumSt('status=skipped') === 25 && await sumSt('status=failed') === 1 && await sumSt('status=done') === 2 && await sumSt('status=') === 28,
  [await sumSt('status=skipped'), await sumSt('status=failed'), await sumSt('status=done'), await sumSt('status=')]);
ok('[195] API status hoa + khoảng trắng (" Failed ") vẫn nhận', await sumSt('status=%20Failed%20') === 1);
ok('[195] API AND với kind: kind=chat&status=done → 2, kind=chat&status=failed → 0', await sumSt('kind=chat&status=done') === 2 && await sumSt('kind=chat&status=failed') === 0);
const sesSt = (await json(admin, 'GET', `/api/ai-usage/sessions?${R2015}&status=skipped&page=2&pageSize=20`)).body;
ok('[195] API sessions status=skipped trang 2: tổng 25, 5 dòng, đều skipped', sesSt?.total === 25 && sesSt?.items?.length === 5 && sesSt.items.every((x: any) => x.status === 'skipped'),
  { total: sesSt?.total, n: sesSt?.items?.length });
ok('[195] API status sai → 400 (summary / sessions / export)', (await json(admin, 'GET', '/api/ai-usage/summary?status=abc')).status === 400
  && (await json(admin, 'GET', '/api/ai-usage/sessions?status=abc&page=1')).status === 400
  && (await fetch(`${API}/api/ai-usage/export?status=abc`, { headers: { cookie: admin } })).status === 400);
ok('[195] export nhận status hợp lệ → 200', (await fetch(`${API}/api/ai-usage/export?${R2015}&status=failed`, { headers: { cookie: admin } })).status === 200);
const hDone = (await json(H.cookie, 'GET', '/api/ai-usage/sessions?status=done&page=1')).body;
ok('[195] người thường lọc status: chỉ phiên của mình (h1)', hDone?.total === 1 && hDone.items[0].userId === H.userId, hDone?.total);
ok('[195] người thường status + userId=all / người khác → 403', (await json(H.cookie, 'GET', '/api/ai-usage/sessions?status=failed&userId=all&page=1')).status === 403
  && (await json(H.cookie, 'GET', `/api/ai-usage/summary?status=failed&userId=${B.userId}`)).status === 403);
ok('người thường xem all / người khác → 403', (await json(H.cookie, 'GET', '/api/ai-usage/summary?userId=all')).status === 403
  && (await json(H.cookie, 'GET', `/api/ai-usage/summary?userId=${B.userId}`)).status === 403);

// ── Giao diện ──
type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js).catch(() => false)) return true; await br.sleep(250); } return false; };
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\/|hub/i.test(e));
const text = (id: string) => `(document.querySelector('[data-testid="${id}"]')?.innerText ?? '')`;
const bars = `document.querySelectorAll('[data-testid="ai-usage-bar"]').length`;
const statCost = text('ai-usage-stat-cost'), statSessions = text('ai-usage-stat-sessions');
const loaded = (sessions: number) => `${statSessions}.includes('${sessions}')`;
// TEST-224: thẻ nổi
const CARD = `document.querySelector('[data-testid="chart-hover-card"]')`;
const cardText = `(${CARD}?.innerText ?? '')`;
const cardShown = `(!!${CARD} && getComputedStyle(${CARD}).visibility === 'visible')`;
const barSel = (bucket: string) => `document.querySelector('[data-testid="ai-usage-bar"][data-bucket="${bucket}"]')`;
const geom = (bar: string) => `(() => { const c = ${CARD}?.getBoundingClientRect(), b = ${bar}.getBoundingClientRect();
  return c ? { cl: c.left, cr: c.right, ct: c.top, cb: c.bottom, bt: b.top, mid: b.left + b.width / 2, vw: document.documentElement.clientWidth, vh: innerHeight } : null; })()`;
type Geom = { cl: number; cr: number; ct: number; cb: number; bt: number; mid: number; vw: number; vh: number } | null;
const inView = (g: Geom) => !!g && g.cl >= 0 && g.cr <= g.vw + 0.5 && g.ct >= 0;
const pointOf = (b: Br, expr: string) => b.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'nearest' });
  const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.bottom - 4 }; })()`) as Promise<{ x: number; y: number } | null>;
const hoverEl = async (b: Br, expr: string) => {
  const r = await pointOf(b, expr);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x - 1, y: r.y });
  await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
};
const moveAway = async (b: Br) => { await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 3, y: 3 }); await until(b, `!${CARD}`, 2000); };
const setTheme = async (b: Br, dark: boolean) => {
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
  await b.evalJs(`document.documentElement.classList.${dark ? 'add' : 'remove'}('dark')`);
  await b.sleep(300);
};
const browserLogin = async (br: Br, user: string, password: string, key?: string) => {
  await br.go(`${BASE}/login`, 1500);
  const st = await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  if (st !== 403 || !key) return st;
  for (let i = 0; i < 2; i++) { // mã vừa dùng ở API có thể bị chặn dùng lại → chờ bước 30 giây kế tiếp
    const s2 = await br.evalJs(`fetch('/api/auth/login/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(totp(key))},isRecoveryCode:false,rememberMe:true})}).then(r=>r.status)`);
    if (s2 === 200) return 200;
    await br.sleep(31_000);
    await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  }
  return 0;
};

const br = await launch(9393, `${tmpdir()}/officehub-au-${Date.now()}`, 1440, 900);
try {
  ok('admin đăng nhập web (2FA)', (await browserLogin(br, ADMIN_LOGIN, ADMIN_PASSWORD, keys[ADMIN_LOGIN])) === 200);
  await br.go(`${BASE}/ai-access`, 2500);
  ok('trang Kết nối AI có tab "Mức dùng AI"', await until(br, `!!document.querySelector('[data-testid="ai-usage-tab-trigger"]')`));
  await br.evalJs(`(() => { const t = document.querySelector('[data-testid="ai-usage-tab-trigger"]'); t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 })); t.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })); t.click(); return true; })()`);
  ok('bấm tab → ?tab=usage, tab tải (chunk riêng)', await until(br, `location.search.includes('tab=usage') && !!document.querySelector('[data-testid="ai-usage-tab"]')`));
  ok('Ngày (30 ngày): admin mặc định Tất cả → 5 phiên', await until(br, loaded(5)), await br.evalJs(statSessions));
  ok('Chi phí $2,35 + "1 phiên không có chi phí"', await until(br, `${statCost}.includes('$2,35') && ${statCost}.includes('1 phiên không có chi phí')`), await br.evalJs(statCost));
  ok('biểu đồ 30 cột ngày', await br.evalJs(bars) === 30, await br.evalJs(bars));
  ok('thẻ token: cache rút gọn "… tr" + tooltip số đầy đủ (đọc 1.400.000)', await br.evalJs(`/1,[45] tr/.test(${text('ai-usage-stat-cache')}) && document.querySelector('[data-testid="ai-usage-stat-cache"] [title]').title.includes('1.400.000')`),
    await br.evalJs(text('ai-usage-stat-cache')));
  ok('admin có ô chọn người / bot, mặc định "Tất cả"', await br.evalJs(`${text('ai-usage-user')}.includes('Tất cả')`));
  const models = await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-model-row"]')].map(r => r.innerText.replace(/\\s+/g, ' '))`) as string[];
  ok('bảng theo model: opus + sonnet, % chi phí, sonnet có * (phiên thiếu chi phí)', models.length === 2 && models.some((r) => r.includes(OPUS) && r.includes('%'))
    && models.some((r) => r.includes(SONNET) && r.includes('*')), models);
  const rows = await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-session-row"]')].map(r => ({ t: r.innerText.replace(/\\s+/g, ' '), red: r.className.includes('destructive'), href: r.querySelector('a')?.getAttribute('href') ?? null }))`) as { t: string; red: boolean; href: string | null }[];
  ok('danh sách phiên: 5 dòng, có cột người / bot', rows.length === 5 && rows.some((r) => r.t.includes('Bot Dev AU')) && rows.some((r) => r.t.includes('Người Thật AU')), rows);
  ok('phiên không chi phí hiện "—" (không phải $0)', rows.some((r) => r.t.includes('Chat') && r.t.includes('—') && !r.t.includes('$0,00')), rows);
  ok('phiên lỗi tô đỏ + nhãn "Lỗi"', rows.some((r) => r.red && r.t.includes('Lỗi') && r.t.includes('Họp')), rows);
  ok('mã việc là link /projects/{pid}?task={tid}', rows.some((r) => r.href === `/projects/${PID}?task=${TID}`), rows.map((r) => r.href));
  ok('thời lượng "12 phút 34 giây"', rows.every((r) => r.t.includes('12 phút 34 giây')), rows[0]);
  if (SHOTS) await br.shot(`${SHOTS}/1-day-all.png`);

  // ── TEST-224: thẻ nổi (Token) — hôm nay: opus 1.053.000 token $1,20 + sonnet 1.400 token (s2 không chi phí, h1 $0,10) ──
  await setTheme(br, false);
  await hoverEl(br, barSel(today));
  ok('[224] trỏ cột hôm nay → thẻ hiện ngay (≤ 300 ms), không còn thuộc tính title', await until(br, cardShown, 300)
    && await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].every(b => !b.hasAttribute('title'))`));
  const tk = await br.evalJs(cardText) as string;
  ok('[224] Token: "Thứ …, dd/mm/yyyy" + tổng "1,1 tr token" + chỉ số phụ "· $1,30"', /^(Thứ (Hai|Ba|Tư|Năm|Sáu|Bảy)|Chủ nhật), \d\d\/\d\d\/\d{4}/.test(tk)
    && tk.includes('1,1 tr token') && tk.includes('· $1,30'), tk);
  ok('[224] Token: opus "1,1 tr" 99,9 % trước sonnet "1.400" 0,1 %, chữ "token" chỉ một lần, không số đầy đủ', tk.indexOf(OPUS) >= 0 && tk.indexOf(OPUS) < tk.indexOf(SONNET)
    && /1,1 tr\s+99,9 %/.test(tk) && /1\.400\s+0,1 %/.test(tk) && tk.split('token').length === 2 && !tk.includes('1.053.000'), tk);
  ok('[224] dòng cuối cảnh báo "⚠ 1 phiên không có chi phí" màu warning, không ghi sau từng model', tk.includes('⚠ 1 phiên không có chi phí') && !tk.includes('(1 phiên')
    && await br.evalJs(`(() => { const n = [...${CARD}.querySelectorAll('div')].find(d => d.innerText.startsWith('⚠')); return !!n && n.className.includes('text-warning'); })()`), tk);
  const aria = String(await br.evalJs(`${barSel(today)}.getAttribute('aria-label')`));
  ok('[224] aria-label của cột mang nội dung tương đương', aria.includes(`${OPUS} 1,1 tr (99,9 %)`) && aria.includes('1 phiên không có chi phí'), aria);
  await br.sleep(300);
  const gT = await br.evalJs(geom(barSel(today))) as Geom;
  ok('[224] thẻ nằm trên vùng cột (không che cột / nhãn trục X), cột cuối sát mép phải → lật sang trái, không tràn màn hình', !!gT && gT.cb <= gT.bt + 1 && gT.cr <= gT.mid + 1 && inView(gT), gT);
  ok('[224] cột đang trỏ giữ màu, cột khác mờ đi', await br.evalJs(`(() => { const bs = [...document.querySelectorAll('[data-testid="ai-usage-bar"]')];
    return getComputedStyle(${barSel(today)}).opacity === '1' && bs.filter(b => b.dataset.bucket !== '${today}').every(b => Number(getComputedStyle(b).opacity) < 0.5); })()`));
  if (SHOTS) await br.shot(`${SHOTS}/6-card-token-light.png`);
  await hoverEl(br, `document.querySelector('[data-testid="ai-usage-bar"]')`);
  await until(br, `${cardShown} && !${cardText}.includes('${OPUS}')`, 1000);
  const gF = await br.evalJs(geom(`document.querySelector('[data-testid="ai-usage-bar"]')`)) as Geom;
  ok('[224] cột đầu (trống): thẻ mở sang phải (mép trái ở giữa cột), "0 token", không có dòng model', !!gF && gF.cl >= gF.mid - 1 && inView(gF)
    && await br.evalJs(`${cardText}.includes('0 token') && !${cardText}.includes('%')`), [gF, await br.evalJs(cardText)]);
  await moveAway(br);
  ok('[224] rời chuột → thẻ tắt, các cột hết mờ', await br.evalJs(`!${CARD}`) && await until(br, `[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].every(b => getComputedStyle(b).opacity === '1')`, 1500));

  // Chú thích ẩn / hiện + Token ↔ Chi phí
  const segs = `[...document.querySelectorAll('[data-testid="ai-usage-bar"] > div > div')].length`;
  const before = await br.evalJs(segs) as number;
  await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).click()`);
  ok('bấm chú thích opus → ẩn phần opus (aria-pressed=false)', await until(br, `${segs} < ${before}`)
    && await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).getAttribute('aria-pressed') === 'false'`));
  await hoverEl(br, barSel(today));
  ok('[224] ẩn opus ở chú thích → thẻ không còn dòng opus, tổng chỉ tính sonnet (1.400 token · $0,10, 100 %)', await until(br, `${cardShown} && !${cardText}.includes('${OPUS}')`, 1500)
    && await br.evalJs(`${cardText}.includes('${SONNET}') && ${cardText}.includes('1.400 token') && ${cardText}.includes('$0,10') && ${cardText}.includes('100 %')`), await br.evalJs(cardText));
  await moveAway(br);
  await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).click()`);
  ok('bấm lại → hiện lại', await until(br, `${segs} === ${before}`));
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-metric-cost"]').click()`);
  ok('chuyển "Chi phí": aria-label cột theo $ ($1,20)', await until(br, `[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].some(b => (b.getAttribute('aria-label') ?? '').includes('$1,20'))`));
  await hoverEl(br, barSel(today));
  await until(br, `${cardShown} && ${cardText}.includes('92,3 %')`, 1500);
  const ck = await br.evalJs(cardText) as string;
  ok('[224] Chi phí: tổng "$1,30" + "· 1,1 tr token", opus $1,20 92,3 % trước sonnet $0,10 7,7 %', /\$1,30\s+· 1,1 tr token/.test(ck) && /\$1,20\s+92,3 %/.test(ck) && /\$0,10\s+7,7 %/.test(ck)
    && ck.indexOf(OPUS) < ck.indexOf(SONNET), ck);
  ok('chi phí: cột ngày có phiên thiếu chi phí → dòng cảnh báo trong thẻ', ck.includes('⚠ 1 phiên không có chi phí'), ck);
  if (SHOTS) await br.shot(`${SHOTS}/6-card-cost-light.png`);
  await setTheme(br, true);
  await hoverEl(br, barSel(today));
  const lum = `((c) => { const m = c.match(/oklch\\(([\\d.]+)/); if (m) return Number(m[1]); const n = c.match(/[\\d.]+/g).map(Number); return (n[0] + n[1] + n[2]) / 765; })`;
  ok('[224] theme tối: thẻ nền popover tối, chữ sáng', await until(br, cardShown, 1500)
    && await br.evalJs(`${lum}(getComputedStyle(${CARD}).backgroundColor) < 0.4 && ${lum}(getComputedStyle(${CARD}).color) > 0.7`),
    await br.evalJs(`[getComputedStyle(${CARD}).backgroundColor, getComputedStyle(${CARD}).color]`));
  if (SHOTS) await br.shot(`${SHOTS}/6-card-cost-dark.png`);
  await moveAway(br);
  await setTheme(br, false);
  await br.evalJs(`${barSel(today)}.focus()`);
  ok('[224] bàn phím: focus cột → thẻ hiện; blur → tắt', await until(br, `${cardShown} && ${cardText}.includes('$1,30')`, 1000)
    && await br.evalJs(`(${barSel(today)}.blur(), true)`) && await until(br, `!${CARD}`, 1000));

  // Tháng / Năm
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-group-month"]').click()`);
  ok('Tháng: URL ?usage=month, 12 cột, 6 phiên, $4,35', await until(br, `location.search.includes('usage=month') && ${loaded(6)} && ${bars} === 12 && ${statCost}.includes('$4,35')`),
    [await br.evalJs('location.search'), await br.evalJs(bars), await br.evalJs(statCost)]);
  await hoverEl(br, barSel(thisMonth));
  ok('[224] Tháng: thẻ dòng đầu "Tháng mm/yyyy"', await until(br, `${cardShown} && ${cardText}.startsWith('Tháng ${thisMonth.slice(5, 7)}/${thisMonth.slice(0, 4)}')`, 1500), await br.evalJs(cardText));
  if (SHOTS) await br.shot(`${SHOTS}/7-card-month.png`);
  await moveAway(br);
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-group-year"]').click()`);
  ok('Năm (tất cả): 7 phiên, $7,35, cột 2025 → nay', await until(br, `location.search.includes('usage=year') && ${loaded(7)} && ${statCost}.includes('$7,35')`)
    && await br.evalJs(`document.querySelector('[data-testid="ai-usage-bar"]').dataset.bucket === '2025'`), [await br.evalJs(statCost), await br.evalJs(bars)]);
  await hoverEl(br, barSel('2025'));
  ok('[224] Năm: thẻ "Năm 2025", $3,00, opus 100 %', await until(br, `${cardShown} && ${cardText}.startsWith('Năm 2025')`, 1500)
    && await br.evalJs(`${cardText}.includes('$3,00') && ${cardText}.includes('100 %')`), await br.evalJs(cardText));
  await moveAway(br);
  await br.go(`${BASE}/ai-access?tab=usage&usage=year`, 2500);
  ok('tải lại giữ bộ lọc Năm từ URL', await until(br, `${loaded(7)} && document.querySelector('[data-testid="ai-usage-group-year"]').getAttribute('aria-pressed') === 'true'`));

  // Lọc loại + chọn người (URL)
  await br.go(`${BASE}/ai-access?tab=usage&kind=task`, 2500);
  ok('lọc loại "Việc" (?kind=task) → 3 phiên', await until(br, loaded(3)), await br.evalJs(statSessions));
  await br.go(`${BASE}/ai-access?tab=usage&user=${B.userId}`, 2500);
  ok('chọn bot B → 4 phiên, $2,25, ô chọn hiện tên bot, không còn cột người', await until(br, `${loaded(4)} && ${statCost}.includes('$2,25') && ${text('ai-usage-user')}.includes('Bot Dev AU')`)
    && await br.evalJs(`![...document.querySelectorAll('th')].some(t => t.innerText === 'Người / bot')`), [await br.evalJs(statSessions), await br.evalJs(text('ai-usage-user'))]);
  await br.go(`${BASE}/ai-access?tab=usage&from=2020-01-01&to=2020-01-31`, 2500);
  ok('khoảng không có dữ liệu → trạng thái trống giải thích agent-runner', await until(br, `${text('ai-usage-empty')}.includes('agent-runner')`));

  // Excel (cùng bộ lọc)
  await br.go(`${BASE}/ai-access?tab=usage&usage=month`, 2500);
  await until(br, loaded(6));
  const xls = await br.evalJs(`(async () => { let url = ''; const orig = document.createElement; const a0 = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { url = this.href; }; document.querySelector('[data-testid="ai-usage-export"]').click(); HTMLAnchorElement.prototype.click = a0;
    const r = await fetch(url); const b = new Uint8Array(await r.arrayBuffer()); return { url, status: r.status, type: r.headers.get('content-type'), pk: b[0] === 0x50 && b[1] === 0x4b }; })()`) as any;
  ok('Xuất Excel: /api/ai-usage/export?group=month&userId=all → 200 xlsx', xls.status === 200 && xls.pk && xls.url.includes('group=month') && xls.url.includes('userId=all'), xls);

  // ── TEST-195: ô "Trạng thái" ──
  const clickAt = async (expr: string) => {
    const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`) as { x: number; y: number } | null;
    if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
      await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await br.sleep(350);
  };
  const pick = async (id: string, label: string) => {
    await clickAt(`document.getElementById('${id}')`);
    await clickAt(`[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === ${JSON.stringify(label)})`);
  };
  const sessRows = `document.querySelectorAll('[data-testid="ai-usage-session-row"]').length`;
  const pageLbl = `(document.querySelector('[data-testid="ai-usage-tab"] [aria-label^="Trang "][aria-label*=" trên "]')?.getAttribute('aria-label') ?? '')`;
  const selText = (id: string) => `(document.getElementById('${id}')?.innerText.trim() ?? '')`;
  await br.go(`${BASE}/ai-access?tab=usage&user=${H.userId}&from=2015-03-01&to=2015-03-31`, 2500);
  ok('[195] H tháng 3/2015: 28 phiên, 20 dòng, "Trang 1 trên 2", ô Trạng thái = "Mọi trạng thái"', await until(br, `${loaded(28)} && ${sessRows} === 20 && ${pageLbl} === 'Trang 1 trên 2'`)
    && await br.evalJs(`${selText('ai-usage-status')} === 'Mọi trạng thái'`), [await br.evalJs(statSessions), await br.evalJs(sessRows), await br.evalJs(pageLbl), await br.evalJs(selText('ai-usage-status'))]);
  ok('[195] ô "Trạng thái" nằm ngay sau ô "Loại phiên" (cùng hàng)', await br.evalJs(`(() => {
    const k = document.getElementById('ai-usage-kind').closest('.w-40'), s = document.getElementById('ai-usage-status').closest('.w-40');
    const a = k.getBoundingClientRect(), b = s.getBoundingClientRect(); return k.nextElementSibling === s && Math.abs(a.top - b.top) < 2 && b.left > a.right - 1; })()`));
  await clickAt(`document.querySelector('[data-testid="ai-usage-tab"] [aria-label="Trang sau"]')`);
  ok('[195] sang trang 2: 8 dòng', await until(br, `${pageLbl} === 'Trang 2 trên 2' && ${sessRows} === 8`), [await br.evalJs(pageLbl), await br.evalJs(sessRows)]);
  await clickAt(`document.getElementById('ai-usage-status')`);
  const opts = await br.evalJs(`[...document.querySelectorAll('[role="option"]')].map((o) => o.innerText.trim())`);
  ok('[195] lựa chọn: Mọi trạng thái · Xong · Lỗi · Bỏ qua', JSON.stringify(opts) === JSON.stringify(['Mọi trạng thái', 'Xong', 'Lỗi', 'Bỏ qua']), opts);
  await clickAt(`[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === 'Bỏ qua')`);
  ok('[195] chọn "Bỏ qua" → ?status=skipped, về trang 1, 25 phiên, 20 dòng đều "Bỏ qua"', await until(br, `location.search.includes('status=skipped') && ${loaded(25)} && ${pageLbl} === 'Trang 1 trên 2' && ${sessRows} === 20`)
    && await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-session-row"]')].every((r) => r.innerText.includes('Bỏ qua'))`),
    [await br.evalJs('location.search'), await br.evalJs(statSessions), await br.evalJs(pageLbl), await br.evalJs(sessRows)]);
  await clickAt(`document.querySelector('[data-testid="ai-usage-tab"] [aria-label="Trang sau"]')`);
  await until(br, `${pageLbl} === 'Trang 2 trên 2'`);
  await pick('ai-usage-status', 'Lỗi');
  ok('[195] từ trang 2 chọn "Lỗi" → 1 phiên, 1 dòng tô đỏ, về trang 1, chi phí $0,02', await until(br, `location.search.includes('status=failed') && ${loaded(1)} && ${sessRows} === 1 && ${statCost}.includes('$0,02')`)
    && await br.evalJs(`document.querySelector('[data-testid="ai-usage-session-row"]').className.includes('destructive') && !${pageLbl}.includes('Trang 2')`),
    [await br.evalJs(statSessions), await br.evalJs(sessRows), await br.evalJs(pageLbl), await br.evalJs(statCost)]);
  await pick('ai-usage-status', 'Xong');
  await pick('ai-usage-kind', 'Chat');
  ok('[195] Xong + Loại "Chat" → 2 phiên chat, chi phí $0,06', await until(br, `location.search.includes('status=done') && location.search.includes('kind=chat') && ${loaded(2)} && ${sessRows} === 2 && ${statCost}.includes('$0,06')`),
    [await br.evalJs('location.search'), await br.evalJs(statSessions), await br.evalJs(statCost)]);
  const xls2 = await br.evalJs(`(() => { let url = ''; const a0 = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { url = this.href; };
    document.querySelector('[data-testid="ai-usage-export"]').click(); HTMLAnchorElement.prototype.click = a0; return url; })()`) as string;
  ok('[195] Xuất Excel mang cùng bộ lọc (status=done&kind=chat)', xls2.includes('status=done') && xls2.includes('kind=chat'), xls2);
  await br.go(`${BASE}/ai-access?tab=usage&user=${H.userId}&from=2015-03-01&to=2015-03-31&status=failed`, 2500);
  ok('[195] tải lại / gửi link ?status=failed giữ bộ lọc (ô hiện "Lỗi", 1 phiên)', await until(br, `${loaded(1)} && ${selText('ai-usage-status')} === 'Lỗi'`), await br.evalJs(selText('ai-usage-status')));
  await pick('ai-usage-status', 'Mọi trạng thái');
  ok('[195] "Mọi trạng thái" → bỏ ?status, 28 phiên như cũ', await until(br, `!location.search.includes('status=') && ${loaded(28)}`), await br.evalJs('location.search'));
  await br.go(`${BASE}/ai-access?tab=usage&user=${H.userId}&from=2015-03-01&to=2015-03-31&status=xyz`, 2500);
  ok('[195] ?status=xyz (lạ) → coi như không lọc: 28 phiên, ô "Mọi trạng thái"', await until(br, `${loaded(28)} && ${selText('ai-usage-status')} === 'Mọi trạng thái'`), await br.evalJs(statSessions));
  await br.go(`${BASE}/ai-access?tab=usage&status=failed`, 2500);
  ok('[195] mặc định 30 ngày + Lỗi: 1 phiên (s4 Họp)', await until(br, `${loaded(1)} && ${sessRows} === 1`)
    && await br.evalJs(`document.querySelector('[data-testid="ai-usage-session-row"]').innerText.includes('Họp')`));
  if (SHOTS) {
    // Khung cao để thấy cả hàng bộ lọc + bảng phiên; ép sáng / tối bằng class (theme mặc định có thể theo hệ thống)
    await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1900, deviceScaleFactor: 1, mobile: false });
    await br.evalJs(`(() => { document.documentElement.classList.remove('dark'); document.querySelector('[data-testid="ai-usage-tab"]').scrollIntoView({ block: 'start' }); })()`);
    await br.sleep(500);
    await br.shot(`${SHOTS}/5-status-light.png`);
    await br.evalJs(`document.documentElement.classList.add('dark')`);
    await br.sleep(500);
    await br.shot(`${SHOTS}/5-status-dark.png`);
    await br.send('Emulation.clearDeviceMetricsOverride', {});
  }
  await br.go(`${BASE}/ai-access?tab=usage&usage=month`, 2500);
  await until(br, loaded(6));

  // Theme tối
  await br.evalJs(`document.documentElement.classList.add('dark')`);
  await br.sleep(300);
  ok('theme tối: nền thẻ tối', await br.evalJs(`(() => { const c = getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor.match(/[\\d.]+/g).map(Number); return c[0] + c[1] + c[2] < 200 || /oklch\\(0\\.[0-3]/.test(getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor); })()`),
    await br.evalJs(`getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor`));
  if (SHOTS) await br.shot(`${SHOTS}/2-month-dark.png`);
  await br.evalJs(`document.documentElement.classList.remove('dark')`);

  // TEST-224: biểu đồ Báo cáo → Trợ lý AI dùng cùng thẻ nổi
  await br.go(`${BASE}/reports?tab=ai`, 3000);
  const dayBars = `document.querySelectorAll('[data-testid="ai-usage-day-bar"]')`;
  ok('[224] Báo cáo → Trợ lý AI: biểu đồ có cột ngày', await until(br, `${dayBars}.length > 0`, 10000), await br.evalJs(`${dayBars}.length`));
  await hoverEl(br, `[...${dayBars}].at(-1)`);
  const shownR = await until(br, cardShown, 1000);
  const rk = await br.evalJs(cardText) as string;
  ok('[224] Báo cáo: trỏ cột → thẻ "Thứ …, dd/mm/yyyy" + "… request" + Thành công / Lỗi / Bị chặn kèm ô màu, không title', shownR
    && /^(Thứ|Chủ nhật).*\d{4}/.test(rk) && rk.includes('request') && ['Thành công', 'Lỗi', 'Bị chặn'].every((t) => rk.includes(t))
    && await br.evalJs(`${CARD}.querySelectorAll('.bg-primary, .bg-destructive, .bg-warning').length === 3 && ![...${dayBars}].some(b => b.hasAttribute('title'))`), rk);
  if (SHOTS) await br.shot(`${SHOTS}/9-report-card.png`);
  await moveAway(br);

  // Hồ sơ admin (không có phiên) → không có thẻ
  await br.go(`${BASE}/profile`, 3000);
  ok('Hồ sơ admin không có phiên → không có thẻ "AI tháng này"', await br.evalJs(`!document.querySelector('[data-testid="ai-month-card"]')`));
  ok('không lỗi JS (admin)', jsErr(br.errors).length === 0, jsErr(br.errors));
} finally { br.close(); }

// Bot B: thẻ Hồ sơ khớp tháng hiện tại
const bb = await launch(9394, `${tmpdir()}/officehub-au-b-${Date.now()}`, 1440, 900);
try {
  ok('bot B đăng nhập web', (await browserLogin(bb, B.user, PW)) === 200);
  await bb.go(`${BASE}/profile`, 3000);
  ok(`Hồ sơ bot: thẻ "AI tháng này" ${botMonth} phiên`, await until(bb, `${text('ai-month-sessions')} === '${botMonth}'`), await bb.evalJs(text('ai-month-card')));
  const card = await bb.evalJs(text('ai-month-card')) as string;
  ok('thẻ: chi phí, ghi chú phiên thiếu chi phí, model nhiều nhất = opus', card.includes(`$${botMonthCost.toFixed(2).replace('.', ',')}`) && card.includes('1 phiên không có chi phí') && card.includes(OPUS), card);
  await bb.evalJs(`[...document.querySelectorAll('[data-testid="ai-month-card"] a')].find(a => a.innerText.includes('Xem chi tiết')).click()`);
  ok('"Xem chi tiết" → /ai-access?tab=usage&usage=month', await until(bb, `location.pathname === '/ai-access' && location.search.includes('tab=usage') && location.search.includes('usage=month')`),
    await bb.evalJs('location.href'));
  ok('bot (không phải admin / HR): không có ô chọn người', await until(bb, `!!document.querySelector('[data-testid="ai-usage-tab"]')`) && await bb.evalJs(`!document.querySelector('[data-testid="ai-usage-user"]')`));
  if (SHOTS) await bb.shot(`${SHOTS}/3-bot-month.png`);
} finally { bb.close(); }

// Người thường H, điện thoại 390 px
const ph = await launch(9395, `${tmpdir()}/officehub-au-h-${Date.now()}`, 390, 844);
try {
  await ph.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  ok('người thường đăng nhập web', (await browserLogin(ph, H.user, PW)) === 200);
  await ph.go(`${BASE}/ai-access?tab=usage&user=${B.userId}`, 3000);
  ok('người thường: chỉ thấy phần của mình dù URL có user= (1 phiên, $0,10), không có ô chọn', await until(ph, `${loaded(1)} && ${statCost}.includes('$0,10')`)
    && await ph.evalJs(`!document.querySelector('[data-testid="ai-usage-user"]')`), [await ph.evalJs(statSessions), await ph.evalJs(statCost)]);
  ok('điện thoại: thẻ tổng 2 cột', await ph.evalJs(`(() => { const a = document.querySelector('[data-testid="ai-usage-stat-input"]').getBoundingClientRect(), b = document.querySelector('[data-testid="ai-usage-stat-output"]').getBoundingClientRect(), c = document.querySelector('[data-testid="ai-usage-stat-cache"]').getBoundingClientRect(); return Math.abs(a.top - b.top) < 2 && c.top > a.bottom - 1; })()`));
  ok('điện thoại: trang không tràn ngang', await ph.evalJs(`document.documentElement.scrollWidth <= 391`), await ph.evalJs('document.documentElement.scrollWidth'));
  ok('điện thoại: biểu đồ 30 cột, mỗi cột ≥ 13 px (cuộn ngang trong khung)', await ph.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].every(b => b.getBoundingClientRect().width >= 12.5)
    && (() => { const s = document.querySelector('[data-testid="ai-session-usage-chart"] > div'); return s.scrollWidth > s.clientWidth; })()`));
  // TEST-224: chạm cột hiện thẻ, cuộn ngang không cắt thẻ, chạm ngoài tắt
  await ph.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  const tap = async (x: number, y: number) => {
    await ph.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await ph.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await ph.sleep(400);
  };
  const scroller = `document.querySelector('[data-testid="ai-session-usage-chart"] > div')`;
  await ph.evalJs(`(${scroller}.scrollLeft = ${scroller}.scrollWidth, true)`);
  await ph.sleep(200);
  const pt = await pointOf(ph, barSel(today));
  if (pt) await tap(pt.x, pt.y);
  ok('[224] điện thoại: chạm cột hôm nay → thẻ hiện (200 token · $0,10, sonnet 100 %)', await until(ph, `${cardShown} && ${cardText}.includes('200 token') && ${cardText}.includes('$0,10')`, 2000), await ph.evalJs(cardText));
  const gP = await ph.evalJs(geom(barSel(today))) as Geom;
  ok('[224] điện thoại: thẻ trong màn hình 390 px, phía trên cột', inView(gP) && !!gP && gP.cb <= gP.bt + 1, gP);
  if (SHOTS) await ph.shot(`${SHOTS}/8-phone-card.png`);
  await ph.evalJs(`(${scroller}.scrollLeft -= 120, true)`);
  await ph.sleep(300);
  const gS = await ph.evalJs(geom(barSel(today))) as Geom;
  ok('[224] điện thoại: cuộn ngang biểu đồ → thẻ đi theo cột, không bị cắt / tràn', inView(gS) && !!gP && !!gS && gS.mid !== gP.mid, [gP, gS]);
  const out = await pointOf(ph, `document.querySelector('[data-testid="ai-usage-stat-input"]')`);
  if (out) await tap(out.x, out.y - 10);
  ok('[224] điện thoại: chạm ra ngoài biểu đồ → thẻ tắt', await until(ph, `!${CARD}`, 2000));
  ok('điện thoại: bảng phiên có nút "Cột"', await ph.evalJs(`!!document.querySelector('[data-testid="ai-usage-tab"] [data-testid="columns-menu"]')`));
  if (SHOTS) await ph.shot(`${SHOTS}/4-phone.png`);
  await ph.go(`${BASE}/profile`, 3000);
  ok('Hồ sơ người thường: thẻ "AI tháng này" 1 phiên', await until(ph, `${text('ai-month-sessions')} === '1'`));
  ok('không lỗi JS (người thường)', jsErr(ph.errors).length === 0, jsErr(ph.errors));
} finally { ph.close(); }

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
