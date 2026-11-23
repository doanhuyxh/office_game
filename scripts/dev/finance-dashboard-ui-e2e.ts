// E2E TEST-223: giao diện Tổng quan giám đốc 3/3 (Chrome headless) — tab Tổng quan ở /finance (thẻ số, biểu đồ + bảng 12 tháng, theo mảng đổi tháng,
// công nợ quá hạn + tuổi nợ, pipeline, dự án cần chú ý, link sang /sales + tab Tài chính dự án), tab Dự báo (?tab=forecast mở thẳng, 13 cột, 2 đường số dư,
// tuần âm tô đỏ + dòng cảnh báo, bấm ô → sheet đúng khoản), Quản trị: đổi ngày trả lương → dòng lương dời tuần, thêm / ngừng khoản định kỳ → bảng đổi;
// người chỉ có Xem không thấy nút cấu hình; nhân viên không có quyền tài chính chỉ thấy "Đề nghị chi" và không gọi API mới; dữ liệu rỗng (DB mới) không lỗi;
// máy tính + 375px (không cuộn ngang trang, bảng dự báo cuộn trong khung), sáng + tối. So số trên màn với API gọi từ chính phiên trình duyệt.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3 / Realtime / Mcp). Api như đầu finance-dashboard-e2e.ts (cổng ví dụ 5223, DB 15423), Vite trỏ Api:
//   docker run -d --name e2e223-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15423:5432 postgres:17-alpine
//   VITE_API_TARGET=http://localhost:5223 bunx vite --port 5323 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5223 BASE_URL=http://localhost:5323 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/finance-dashboard-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/finance-dashboard-ui). Kiểm "dữ liệu rỗng" chỉ chạy khi DB chưa có quỹ nào (lần chạy đầu).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5223';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/finance-dashboard-ui`;
mkdirSync(SHOTS, { recursive: true });
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
const VIEW = 1, RECORD = 2, APPROVE = 4, ADMIN = 8;
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const addDays = (d: number) => new Date(Date.parse(today) + d * 86400000).toISOString().slice(0, 10);
const monthStart = (k: number) => { const [y, m] = today.split('-').map(Number); return new Date(Date.UTC(y, m - 1 - k, 1)).toISOString().slice(0, 10); };
const fmtMonth = (d: string) => { const [y, m] = d.split('-'); return `T${Number(m)}/${y}`; };
const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const mkPos = async (name: string, level: number, fin: number) => (await json(admin, 'POST', '/api/org/positions', { name: `${name} ${stamp}`, level, financePermissions: fin })).body;
const pDir = await mkPos('UGĐ', 1, VIEW | RECORD | APPROVE | ADMIN), pView = await mkPos('UXem', 3, VIEW), pPlain = await mkPos('UNV', 7, 0);
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `TQ UI ${stamp}`, code: `TU${stamp}` })).body;
const mkEmp = async (key: string, posId: string, roles: string[], managerId: string | null = null) => {
  const user = `e2e.dui.${key}.${stamp}`;
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `U${key.toUpperCase()}${stamp}`, fullName: `TQ UI ${key} ${stamp}`, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dept, positionId: posId, managerId, status: 'Active', joinedAt: '2025-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, user, cookie: await login(user, PW) };
};
// S = người ghi dữ liệu qua API (không đăng nhập trình duyệt — đăng nhập UI làm cookie API cũ hết hạn); D / V / E chỉ dùng trình duyệt.
const S = await mkEmp('seed', pDir, ['employee']);
const D = await mkEmp('dir', pDir, ['employee']);
const V = await mkEmp('view', pView, ['employee']);
const PM = await mkEmp('pm', pPlain, ['employee', 'manager']);
const E = await mkEmp('emp', pPlain, ['employee'], PM.e.id);
ok('dữ liệu: 5 nhân viên đăng nhập', [S, D, V, PM, E].every((x) => !!x.cookie));
const emptyDb = ((await json(S.cookie, 'GET', '/api/finance/accounts')).body as any[] ?? []).length === 0;

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const brD = await launch(9423, `${tmpdir()}/fin-ui-d-${stamp}`);
const brV = await launch(9424, `${tmpdir()}/fin-ui-v-${stamp}`);
const brE = await launch(9425, `${tmpdir()}/fin-ui-e-${stamp}`);
type Br = typeof brD;
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(500);
};
const click = (br: Br, expr: string, wait = 800) => br.evalJs(`(() => { const e = ${expr}; if (!e) throw new Error('không thấy ' + ${JSON.stringify(expr)}); e.click(); })()`).then(() => br.sleep(wait));
const setVal = (br: Br, selector: string, v: string) => br.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(selector)});
  const proto = i instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const text = (br: Br, expr: string) => br.evalJs(`${expr}?.innerText ?? null`) as Promise<string | null>;
const has = (br: Br, id: string) => br.evalJs(`!!${q(id)}`) as Promise<boolean>;
const apiIn = (br: Br, path: string) => br.evalJs(`fetch(${JSON.stringify(path)}).then((r) => r.json())`);
const noHScroll = (br: Br) => br.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const theme = async (br: Br, t: 'light' | 'dark', url: string) => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await br.go(url, 3500);
};
const tabs = (br: Br) => br.evalJs(`[...document.querySelectorAll('[role="tab"]')].map((t) => t.innerText.trim())`) as Promise<string[]>;
const rowCells = (br: Br, line: string) => br.evalJs(`[...document.querySelectorAll('[data-testid="forecast-row-${line}"] td')].slice(1).map((td) => td.innerText.trim())`) as Promise<string[]>;
const errorsOf = (br: Br) => br.errors.filter((e) => !/negotiation|hub\/|SignalR|WebSocket|status of 4/i.test(e ?? ''));
const URL_FIN = `${BASE}/finance`;
/** SVG biểu đồ nằm gọn trong thẻ (không tràn ra ngoài khi màn hẹp). */
const chartFits = (br: Br, card: string) => br.evalJs(`(() => { const c = ${q(card)}; const s = c?.querySelector('svg'); return !!s && s.getBoundingClientRect().right <= c.getBoundingClientRect().right + 1; })()`);
const NEW_APIS = ['/api/finance/dashboard', '/api/finance/forecast', '/api/projects/financials/alerts', '/api/finance/recurring'];

try {
  // ── Nhân viên không có quyền tài chính: chỉ "Đề nghị chi", không gọi API mới ──
  const reqE: string[] = [];
  brE.on('Network.requestWillBeSent', (p) => reqE.push(p.request.url));
  await brE.send('Network.enable');
  ok('E đăng nhập UI', (await brE.login(E.user, PW)) === 200);
  await brE.go(URL_FIN, 3000);
  await brE.go(`${URL_FIN}?tab=forecast`, 3000);
  ok('Không quyền tài chính: chỉ tab "Đề nghị chi" (cả khi mở ?tab=forecast)', JSON.stringify(await tabs(brE)) === JSON.stringify(['Đề nghị chi']), await tabs(brE));
  ok('Không quyền tài chính: không gọi /dashboard, /forecast, /financials/alerts, /recurring', !reqE.some((u) => NEW_APIS.some((a) => u.includes(a))), reqE.filter((u) => u.includes('/api/')));

  // ── Dữ liệu rỗng (DB mới: chưa có quỹ / giao dịch) ──
  ok('D đăng nhập UI', (await brD.login(D.user, PW)) === 200);
  if (emptyDb) {
    await theme(brD, 'light', URL_FIN);
    const t = await text(brD, 'document.body');
    ok('Rỗng: Tổng quan hiện đủ khối, không "Không tải được", "Không có dự án cần chú ý", 12 dòng tháng = 0', !t?.includes('Không tải được') && !!t?.includes('Không có dự án cần chú ý')
      && (await brD.evalJs(`document.querySelectorAll('[data-testid="month-row"]').length`)) === 12 && !!t?.includes('Chưa có quỹ'));
    await brD.go(`${URL_FIN}?tab=forecast`, 3000);
    ok('Rỗng: Dự báo hiện bảng 13 tuần, không lỗi', (await brD.evalJs(`document.querySelectorAll('[data-testid="forecast-week-head"]').length`)) === 13
      && !(await text(brD, 'document.body'))?.includes('Không tải được'));
    await brD.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
    await brD.go(URL_FIN, 3000);
    ok('Rỗng 375px: không cuộn ngang trang', await noHScroll(brD));
    await brD.shot(`${SHOTS}/0-rong-375.png`);
    await brD.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  } else console.log('… bỏ qua kiểm "dữ liệu rỗng" (DB đã có dữ liệu tài chính từ lần chạy trước)');

  // ── Seed qua API (S, PM, admin) ──
  const mkLine = (name: string) => json(S.cookie, 'POST', '/api/finance/lines', { code: `${name}${stamp}`.slice(0, 20), name: `${name} ${stamp}` });
  const L1 = (await mkLine('Web')).body, L2 = (await mkLine('MXH')).body;
  const cash = (await json(S.cookie, 'POST', '/api/finance/accounts', { name: `Quỹ UI ${stamp}`, kind: 'Bank', bankName: 'VCB', last4: '1234', openingBalance: 1_000_000_000, openingDate: '2025-01-01' })).body;
  const entry = (b: object) => json(S.cookie, 'POST', '/api/finance/entries', { accountId: cash, ...b });
  const es = [await entry({ kind: 'Income', amount: 30_000_000, date: today, businessLineId: L1 }), await entry({ kind: 'Expense', amount: 12_000_000, date: today, businessLineId: L2 }),
    await entry({ kind: 'Income', amount: 20_000_000, date: `${monthStart(2).slice(0, 8)}10`, businessLineId: L1 }), await entry({ kind: 'Expense', amount: 5_000_000, date: `${monthStart(1).slice(0, 8)}12` })];
  ok('dữ liệu: 2 mảng, quỹ 1 tỷ, 4 dòng sổ (3 tháng)', !!L1 && !!L2 && !!cash && es.every((x) => x.status === 201), es);
  const cust = (await json(PM.cookie, 'POST', '/api/sales/customers', { name: `Khách UI ${stamp}` })).body;
  const k = await json(PM.cookie, 'POST', '/api/sales/contracts', { code: `HD-UI-${stamp}`, customerId: cust, title: 'HĐ giao diện', valueBeforeTax: 33_000_000, vatRate: 0,
    signedOn: addDays(-100), billing: 'Milestone', installments: [{ title: 'Đợt quá hạn 40', dueOn: addDays(-40), amount: 15_000_000 },
      { title: 'Đợt quá hạn 5', dueOn: addDays(-5), amount: 6_000_000 }, { title: 'Đợt sắp tới', dueOn: addDays(10), amount: 12_000_000 }] });
  const opp = (b: object) => json(PM.cookie, 'POST', '/api/sales/opportunities', { customerId: cust, title: `CH UI ${stamp}`, ...b });
  const os = [await opp({ stage: 'Negotiating', value: 40_000_000, probability: 50, expectedCloseOn: addDays(5) }), await opp({ stage: 'Lead', value: 9_000_000 })];
  ok('dữ liệu: hợp đồng bán 3 đợt (2 quá hạn) + 2 cơ hội (1 chưa có ngày chốt)', k.status === 201 && os.every((x) => x.status === 201), [k, os]);
  const proj = await json(PM.cookie, 'POST', '/api/projects', { code: `TU-${stamp}`, name: `Dự án lỗ UI ${stamp}`, kind: 'Internal', startOn: monthStart(0), memberIds: [] });
  const projId = (proj.body?.id ?? proj.body) as string;
  ok('dữ liệu: dự án nội bộ + chi 7tr gắn dự án (→ lỗ)', proj.status === 201 && (await entry({ kind: 'Expense', amount: 7_000_000, date: today, projectId: projId })).status === 201);
  const lc = await json(admin, 'POST', '/api/contracts', { employeeId: S.e.id, number: `E2E-UI-${stamp}`, type: 'Indefinite', signedDate: null,
    startDate: '2025-01-05', endDate: null, jobTitle: 'Dev', salary: 20_000_000, allowance: null, note: null });
  ok('dữ liệu: hợp đồng lao động 20tr (lương dự kiến > 0)', [200, 201].includes(lc.status), lc);
  ok('dữ liệu: ngày trả lương = 10', (await json(S.cookie, 'PUT', '/api/finance/forecast/settings', { payrollPayDay: 10, pipelineDelayDays: 30 })).status === 204);

  // ── Tổng quan (D, Quản trị) ──
  await theme(brD, 'light', URL_FIN);
  const dash = await apiIn(brD, '/api/finance/dashboard?months=12');
  const ov = await apiIn(brD, '/api/finance/overview');
  ok('Tổng quan: đủ khối (biểu đồ, theo mảng, công nợ, pipeline, dự án, quỹ)', (await Promise.all(['month-flow-card', 'line-month-card', 'receivables-card', 'pipeline-card', 'project-alerts-card', 'accounts-card']
    .map((id) => has(brD, id)))).every(Boolean));
  const stat = (id: string) => text(brD, q(`${id}-value`)).then(digits);
  ok('Thẻ số khớp API: số dư, thu / chi / lãi tháng này, công nợ quá hạn, pipeline có trọng số',
    await stat('stat-balance') === String(ov.totalBalance) && await stat('stat-income') === String(ov.monthIncome) && await stat('stat-expense') === String(ov.monthExpense)
    && await stat('stat-profit') === String(Math.abs(ov.monthIncome - ov.monthExpense)) && await stat('stat-overdue') === String(dash.receivables.overdue)
    && await stat('stat-pipeline') === String(dash.pipeline.weighted),
    { ui: [await stat('stat-balance'), await stat('stat-overdue'), await stat('stat-pipeline')], ov: ov.totalBalance, rv: dash.receivables.overdue, pl: dash.pipeline.weighted });
  const rows = await brD.evalJs(`[...document.querySelectorAll('[data-testid="month-row"]')].map((r) => [...r.cells].map((c) => c.innerText))`) as string[][];
  ok('Bảng 12 tháng: mới → cũ, thu / chi / lãi khớp API từng tháng', rows.length === 12 && rows.every((r, i) => {
    const m = dash.monthly[11 - i];
    return r[0] === fmtMonth(m.month) && digits(r[1]) === String(m.income) && digits(r[2]) === String(m.expense) && digits(r[3]) === String(Math.abs(m.profit));
  }), rows.slice(0, 3));
  ok('Biểu đồ: SVG có 12 nhóm tháng + đường lãi; dòng giá trị = tháng này', (await brD.evalJs(`document.querySelectorAll('[data-testid="month-flow-card"] svg g[role="group"]').length`)) === 12
    && (await text(brD, q('month-chart-readout')))?.startsWith(fmtMonth(monthStart(0))) === true);
  const g9 = await brD.evalJs(`(() => { const r = document.querySelectorAll('[data-testid="month-flow-card"] svg g[role="group"]')[9].querySelector('rect').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  await brD.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g9.x - 2, y: g9.y });
  await brD.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: g9.x, y: g9.y });
  await brD.sleep(300);
  const readout = await text(brD, q('month-chart-readout'));
  ok('Biểu đồ: rê chuột vào tháng −2 → dòng giá trị hiện số tháng −2 (khớp API)', readout?.startsWith(fmtMonth(monthStart(2))) === true
    && digits(readout).includes(String(dash.monthly[9].income)), readout);
  const lineRows = async () => brD.evalJs(`[...document.querySelectorAll('[data-testid="line-month-card"] tbody tr')].map((r) => r.innerText.replace(/\\s+/g, ' '))`) as Promise<string[]>;
  ok('Theo mảng (mặc định tháng này): Web thu 30tr, MXH chi 12tr', (await lineRows()).some((r) => r.includes(`Web ${stamp}`) && r.includes('30.000.000'))
    && (await lineRows()).some((r) => r.includes(`MXH ${stamp}`)), await lineRows());
  await clickAt(brD, q('line-month-select'));
  await clickAt(brD, `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === ${JSON.stringify(fmtMonth(monthStart(2)))})`);
  ok('Theo mảng: đổi sang tháng −2 → Web thu 20tr, không còn MXH', (await text(brD, q('line-month-select')))?.includes(fmtMonth(monthStart(2))) === true
    && (await lineRows()).some((r) => r.includes(`Web ${stamp}`) && r.includes('20.000.000')) && !(await lineRows()).some((r) => r.includes(`MXH ${stamp}`)), await lineRows());
  const aging = await brD.evalJs(`[...document.querySelectorAll('[data-testid="receivables-card"] li')].map((l) => l.innerText.replace(/\\s+/g, ' '))`) as string[];
  ok('Công nợ: tổng quá hạn + 4 nhóm tuổi nợ khớp API', digits(await text(brD, q('receivables-overdue'))) === String(dash.receivables.overdue) && aging.length === 4
    && dash.receivables.aging.every((a: any, i: number) => digits(aging[i]).startsWith(digits(a.bucket) + String(a.amount))), { aging, api: dash.receivables.aging });
  ok('Pipeline: có trọng số khớp API (cơ hội chưa có ngày vẫn tính ở đây)', digits(await text(brD, q('pipeline-weighted'))) === String(dash.pipeline.weighted));
  await brD.sleep(1500);
  const alerts = await apiIn(brD, '/api/projects/financials/alerts') as any[];
  const alertLinks = await brD.evalJs(`[...document.querySelectorAll('[data-testid="project-alert-link"]')].map((a) => ({ href: a.getAttribute('href'), t: a.innerText }))`) as { href: string; t: string }[];
  const mine = alertLinks.find((a) => a.t.toLowerCase().includes(`tu-${stamp}`));
  ok('Dự án cần chú ý: đủ số dòng API, dự án lỗ có nhãn "Lỗ", link → tab Tài chính dự án', alertLinks.length === alerts.length && !!mine?.t.includes('Lỗ')
    && mine?.href === `/projects/${projId}?tab=finance`, { alertLinks, n: alerts.length });
  ok('Link công nợ / pipeline: /sales?tab=receivables, /sales?tab=opportunities', (await brD.evalJs(`${q('receivables-link')}.getAttribute('href')`)) === '/sales?tab=receivables'
    && (await brD.evalJs(`${q('pipeline-link')}.getAttribute('href')`)) === '/sales?tab=opportunities');
  await brD.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await brD.evalJs(`window.scrollTo(0, 0)`);
  await brD.sleep(300);
  await brD.shot(`${SHOTS}/1-tong-quan-sang.png`);
  await click(brD, q('receivables-link'), 2500);
  ok('Bấm "Xem công nợ" → /sales tab Công nợ', (await brD.evalJs(`location.pathname + location.search`)) === '/sales?tab=receivables'
    && (await brD.evalJs(`document.querySelector('[role="tab"][data-state="active"]')?.innerText`)) === 'Công nợ');
  await theme(brD, 'dark', URL_FIN);
  ok('Theme tối: Tổng quan', await brD.evalJs(`document.documentElement.classList.contains('dark')`) && await has(brD, 'month-flow-card'));
  await brD.shot(`${SHOTS}/2-tong-quan-toi.png`);
  await click(brD, `${q('project-alert-link')}`, 3000);
  ok('Bấm dự án cần chú ý → trang dự án ?tab=finance', (await brD.evalJs(`location.search`)) === '?tab=finance' && (await brD.evalJs(`location.pathname`)).startsWith('/projects/'));

  // ── Dự báo (D, Quản trị) ──
  await theme(brD, 'light', `${URL_FIN}?tab=forecast`);
  let fc = await apiIn(brD, '/api/finance/forecast');
  ok('Mở thẳng ?tab=forecast: tab "Dự báo" đang chọn, 13 cột tuần, tiêu đề = khoảng ngày', (await brD.evalJs(`document.querySelector('[role="tab"][data-state="active"]')?.innerText`)) === 'Dự báo'
    && (await brD.evalJs(`[...document.querySelectorAll('[data-testid="forecast-week-head"]')].map((h) => h.innerText)`) as string[]).every((h, i) => h.includes(`Tuần ${i + 1}`) && /\d{2}\/\d{2}–\d{2}\/\d{2}/.test(h))
    && (await brD.evalJs(`document.querySelectorAll('[data-testid="forecast-week-head"]').length`)) === 13);
  ok('Biểu đồ dự báo: 2 đường (Thận trọng, Kỳ vọng) + vạch 0', (await brD.evalJs(`document.querySelectorAll('[data-testid="forecast-chart-card"] svg path').length`)) === 2
    && /Thận trọng.*Kỳ vọng/s.test((await text(brD, q('forecast-chart-readout'))) ?? ''));
  const closing = await rowCells(brD, 'closingExpected');
  ok('Bảng: số dư cuối Kỳ vọng từng tuần khớp API; dòng Kỳ vọng có nhãn', closing.every((c, i) => digits(c) === String(Math.abs(fc.weeks[i].closingExpected)))
    && (await text(brD, q('forecast-row-Overdue')))?.includes('Kỳ vọng') === true, closing);
  const inst = fc.items.find((i: any) => i.line === 'Installment' && i.refId === k.body);
  ok('Đợt thu sắp tới (12tr) nằm đúng ô tuần trong bảng', !!inst && digits((await rowCells(brD, 'Installment'))[inst.week - 1]) === String(fc.weeks[inst.week - 1].installments), inst);
  await clickAt(brD, q(`forecast-cell-Installment-${inst.week}`));
  const sheet = await text(brD, q('forecast-cell-sheet'));
  ok('Bấm ô → sheet liệt kê đúng khoản (tên, ngày, tiền, link khách)', !!sheet?.includes('Đợt thu sắp đến hạn') && digits(sheet).includes('12000000') && !!sheet?.includes(inst.name)
    && (await brD.evalJs(`[...document.querySelectorAll('[data-testid="forecast-item-customer"]')].some((a) => a.getAttribute('href') === '/sales?customer=${cust}')`)), sheet);
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(500);
  await clickAt(brD, q('forecast-cell-Overdue-1'));
  ok('Ô công nợ quá hạn tuần 1 → 2 đợt quá hạn, nhãn "Quá hạn"', ((await text(brD, q('forecast-cell-sheet')))?.match(/Quá hạn/g)?.length ?? 0) >= 2);
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(500);
  ok('Ghi chú: ngày trả lương 10, trễ 30 ngày, 1+ cơ hội chưa có ngày', /trả ngày 10/.test((await text(brD, q('forecast-notes'))) ?? '') && /30 ngày/.test((await text(brD, q('forecast-notes'))) ?? '')
    && await has(brD, 'forecast-undated'));
  ok('Quản trị: thấy nút Cấu hình dự báo + Khoản định kỳ', await has(brD, 'forecast-settings-open') && await has(brD, 'recurring-open'));

  // Đổi ngày trả lương 10 → 25: dòng lương dời tuần
  const payWeeks = (cells: string[]) => cells.map((c, i) => (digits(c) ? i + 1 : 0)).filter(Boolean);
  const pay10 = payWeeks(await rowCells(brD, 'Payroll'));
  await click(brD, q('forecast-settings-open'));
  await setVal(brD, '#fc-payday', '25');
  await click(brD, q('forecast-settings-save'), 2000);
  const pay25 = payWeeks(await rowCells(brD, 'Payroll'));
  fc = await apiIn(brD, '/api/finance/forecast');
  ok('Đổi ngày trả lương 10 → 25: hộp thoại đóng, dòng lương dời tuần, khớp API', !(await has(brD, 'forecast-settings-dialog')) && pay10.length > 0 && pay25.length > 0
    && JSON.stringify(pay10) !== JSON.stringify(pay25) && fc.settings.payrollPayDay === 25
    && JSON.stringify(pay25) === JSON.stringify(fc.weeks.filter((w: any) => w.payroll > 0).map((w: any) => w.week)), { pay10, pay25 });
  await click(brD, q('forecast-settings-open'));
  await setVal(brD, '#fc-payday', '29');
  await click(brD, q('forecast-settings-save'), 1500);
  ok('Ngày trả lương 29 → lỗi server hiện dưới ô, hộp thoại vẫn mở', await has(brD, 'forecast-settings-dialog')
    && !!(await brD.evalJs(`document.querySelector('#fc-payday')?.closest('div')?.parentElement?.innerText`))?.match(/28|ngày/i));
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(500);

  // Thêm khoản định kỳ chi 2 tỷ → tuần âm + dòng cảnh báo; ngừng → bảng đổi lại
  const recBefore = (await rowCells(brD, 'RecurringExpense')).map(digits).join();
  await click(brD, q('recurring-open'));
  await click(brD, q('recurring-add'));
  const recName = `Thuê văn phòng UI ${stamp}`;
  await setVal(brD, '#ri-name', recName);
  await setVal(brD, '#ri-amount', '2000000000');
  await setVal(brD, '#ri-day', '15');
  await click(brD, q('recurring-item-save'), 2000);
  ok('Thêm khoản định kỳ: hộp thoại con đóng, danh sách có dòng mới', !(await has(brD, 'recurring-item-dialog'))
    && (await brD.evalJs(`[...document.querySelectorAll('[data-testid="recurring-row"]')].some((r) => r.innerText.includes(${JSON.stringify(recName)}))`)));
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(800);
  fc = await apiIn(brD, '/api/finance/forecast');
  const recAfter = await rowCells(brD, 'RecurringExpense');
  const recItems = fc.items.filter((i: any) => i.line === 'RecurringExpense' && i.name === recName);
  ok('Bảng tự làm mới: dòng "Khoản định kỳ chi" có −2 tỷ đúng tuần', recItems.length > 0 && recItems.every((i: any) => recAfter[i.week - 1].includes('−') && digits(recAfter[i.week - 1]).length >= 10)
    && recAfter.map(digits).join() !== recBefore, { recAfter, recItems });
  const negW = fc.firstNegativeConservative;
  const alertTxt = await text(brD, q('forecast-negative-alert'));
  ok('Tuần âm: dòng cảnh báo "Thận trọng: âm tiền từ tuần N (…)" + ô số dư âm tô destructive', negW != null && !!alertTxt?.includes(`Thận trọng: âm tiền từ tuần ${negW}`)
    && (await brD.evalJs(`[...document.querySelectorAll('[data-testid="forecast-row-closingConservative"] td[data-negative]')].length`)) === fc.weeks.filter((w: any) => w.closingConservative < 0).length
    && (await brD.evalJs(`[...document.querySelectorAll('[data-testid="forecast-row-closingConservative"] td[data-negative]')].every((td) => td.className.includes('text-destructive'))`)),
    { negW, alertTxt });
  await brD.evalJs(`window.scrollTo(0, 0)`);
  await brD.shot(`${SHOTS}/3-du-bao-sang.png`);
  await theme(brD, 'dark', `${URL_FIN}?tab=forecast`);
  const w1 = fc.items.find((i: any) => i.line === 'RecurringExpense' && i.name === recName)!.week;
  await clickAt(brD, q(`forecast-cell-RecurringExpense-${w1}`));
  ok('Tối: bấm ô khoản định kỳ → sheet có khoản vừa thêm', !!(await text(brD, q('forecast-cell-sheet')))?.includes(recName));
  await brD.shot(`${SHOTS}/4-du-bao-toi-sheet.png`);
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(500);
  // Ngừng khoản
  await click(brD, q('recurring-open'));
  await click(brD, `[...document.querySelectorAll('[data-testid="recurring-row"]')].find((r) => r.innerText.includes(${JSON.stringify(recName)})).querySelector('button')`);
  await click(brD, `document.querySelector('[data-testid="recurring-item-dialog"] button[role="checkbox"]')`, 300);
  await click(brD, q('recurring-item-save'), 2000);
  ok('Ngừng khoản: danh sách hiện "Ngừng"', (await brD.evalJs(`[...document.querySelectorAll('[data-testid="recurring-row"]')].find((r) => r.innerText.includes(${JSON.stringify(recName)}))?.innerText`))?.includes('Ngừng') === true);
  await brD.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brD.sleep(800);
  ok('Ngừng khoản → bảng quay lại như trước, hết cảnh báo âm của khoản này', (await rowCells(brD, 'RecurringExpense')).map(digits).join() === recBefore
    && !(await apiIn(brD, '/api/finance/forecast')).items.some((i: any) => i.name === recName));

  // ── Người chỉ có Xem ──
  ok('V đăng nhập UI', (await brV.login(V.user, PW)) === 200);
  await theme(brV, 'light', `${URL_FIN}?tab=forecast`);
  ok('Chỉ Xem: tab Tổng quan + Dự báo, không có nút cấu hình / khoản định kỳ', (await tabs(brV)).includes('Dự báo') && (await tabs(brV)).includes('Tổng quan')
    && !(await has(brV, 'forecast-settings-open')) && !(await has(brV, 'recurring-open')) && await has(brV, 'forecast-table'));

  // ── 375px ──
  await brV.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await theme(brV, 'light', `${URL_FIN}?tab=forecast`);
  ok('375px Dự báo: trang không cuộn ngang, biểu đồ gọn trong thẻ, bảng cuộn ngang trong khung, cột tên dính', await noHScroll(brV) && await chartFits(brV, 'forecast-chart-card')
    && (await brV.evalJs(`(() => { const c = ${q('forecast-table')}.parentElement; return c.scrollWidth > c.clientWidth; })()`))
    && (await brV.evalJs(`(() => { const c = ${q('forecast-table')}.parentElement; c.scrollLeft = 400; const td = document.querySelector('[data-testid="forecast-row-Installment"] td'); return getComputedStyle(td).position === 'sticky' && Math.abs(td.getBoundingClientRect().left - c.getBoundingClientRect().left) < 2; })()`)));
  await brV.shot(`${SHOTS}/5-du-bao-375-sang.png`);
  await theme(brV, 'dark', URL_FIN);
  ok('375px Tổng quan tối: không cuộn ngang trang, biểu đồ gọn trong thẻ', await noHScroll(brV) && await chartFits(brV, 'month-flow-card'));
  await brV.shot(`${SHOTS}/6-tong-quan-375-toi.png`);

  ok('không lỗi console (bỏ SignalR / 4xx mong đợi)', [brD, brV, brE].every((b) => errorsOf(b).length === 0), [brD, brV, brE].map(errorsOf));
} catch (e) {
  fail++;
  console.log('✘ lỗi:', e);
} finally {
  brD.close(); brV.close(); brE.close();
  await json(S.cookie, 'PUT', '/api/finance/forecast/settings', { payrollPayDay: 10, pipelineDelayDays: 30 }); // trả cấu hình mặc định → chạy lại được
}
console.log(`\n${pass}/${pass + fail} pass — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
