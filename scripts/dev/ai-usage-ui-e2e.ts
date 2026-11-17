// E2E TEST-136: giao diện mức dùng AI — Kết nối AI → tab "Mức dùng AI" + thẻ "AI tháng này" ở Hồ sơ.
// Dữ liệu ghi thẳng qua đường nội bộ Api (/api/audit/internal/ai-usage, khoá X-Internal-Key — không cần Mcp): bot B có phiên hôm nay (opus có chi phí,
// sonnet KHÔNG chi phí), 5 ngày trước (2 model), 20 ngày trước (lỗi, họp), 2 tháng trước, năm 2025; người thật H một phiên hôm nay.
// Kiểm tra: Ngày / Tháng / Năm đúng tổng (số phiên, chi phí, số cột), "—" + "N phiên không có chi phí", lọc loại phiên, bộ lọc trên URL,
// admin có ô chọn người / bot (Tất cả / một người), người thường không có ô + API người khác / all → 403, biểu đồ (chú thích ẩn / hiện, Token ↔ Chi phí),
// bảng theo model, danh sách phiên (lỗi tô đỏ, link việc), Xuất Excel, thẻ Hồ sơ khớp tháng hiện tại (admin không có dữ liệu → không có thẻ),
// theme tối, điện thoại 390 px (thẻ 2 cột, không tràn ngang). Ảnh vào SHOTS_DIR.
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

  // Chú thích ẩn / hiện + Token ↔ Chi phí
  const segs = `[...document.querySelectorAll('[data-testid="ai-usage-bar"] > div > div')].length`;
  const before = await br.evalJs(segs) as number;
  await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).click()`);
  ok('bấm chú thích opus → ẩn phần opus (aria-pressed=false)', await until(br, `${segs} < ${before}`)
    && await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).getAttribute('aria-pressed') === 'false'`));
  await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-legend"]')].find(b => b.innerText.includes('${OPUS}')).click()`);
  ok('bấm lại → hiện lại', await until(br, `${segs} === ${before}`));
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-metric-cost"]').click()`);
  ok('chuyển "Chi phí": tooltip cột theo $', await until(br, `[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].some(b => b.title.includes('$1,20'))`));
  ok('chi phí: cột ngày có phiên thiếu chi phí ghi chú trong tooltip', await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-bar"]')].some(b => b.title.includes('phiên không có chi phí'))`));

  // Tháng / Năm
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-group-month"]').click()`);
  ok('Tháng: URL ?usage=month, 12 cột, 6 phiên, $4,35', await until(br, `location.search.includes('usage=month') && ${loaded(6)} && ${bars} === 12 && ${statCost}.includes('$4,35')`),
    [await br.evalJs('location.search'), await br.evalJs(bars), await br.evalJs(statCost)]);
  await br.evalJs(`document.querySelector('[data-testid="ai-usage-group-year"]').click()`);
  ok('Năm (tất cả): 7 phiên, $7,35, cột 2025 → nay', await until(br, `location.search.includes('usage=year') && ${loaded(7)} && ${statCost}.includes('$7,35')`)
    && await br.evalJs(`document.querySelector('[data-testid="ai-usage-bar"]').dataset.bucket === '2025'`), [await br.evalJs(statCost), await br.evalJs(bars)]);
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

  // Theme tối
  await br.evalJs(`document.documentElement.classList.add('dark')`);
  await br.sleep(300);
  ok('theme tối: nền thẻ tối', await br.evalJs(`(() => { const c = getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor.match(/[\\d.]+/g).map(Number); return c[0] + c[1] + c[2] < 200 || /oklch\\(0\\.[0-3]/.test(getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor); })()`),
    await br.evalJs(`getComputedStyle(document.querySelector('[data-testid="ai-usage-stat-cost"]')).backgroundColor`));
  if (SHOTS) await br.shot(`${SHOTS}/2-month-dark.png`);
  await br.evalJs(`document.documentElement.classList.remove('dark')`);

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
  ok('điện thoại: bảng phiên có nút "Cột"', await ph.evalJs(`!!document.querySelector('[data-testid="ai-usage-tab"] [data-testid="columns-menu"]')`));
  if (SHOTS) await ph.shot(`${SHOTS}/4-phone.png`);
  await ph.go(`${BASE}/profile`, 3000);
  ok('Hồ sơ người thường: thẻ "AI tháng này" 1 phiên', await until(ph, `${text('ai-month-sessions')} === '1'`));
  ok('không lỗi JS (người thường)', jsErr(ph.errors).length === 0, jsErr(ph.errors));
} finally { ph.close(); }

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
