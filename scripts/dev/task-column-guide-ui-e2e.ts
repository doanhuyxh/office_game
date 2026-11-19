// E2E TEST-186 giao diện hướng dẫn riêng của cột (Chrome headless 1440×900):
// hộp thoại cột: tick "Đánh thức bot theo dõi" → ô "Hướng dẫn cho bot ở cột này" (Viết / Xem trước, đếm ký tự); có hướng dẫn mà chưa chọn bot → cảnh báo
// "Chưa chọn bot: …"; chọn bot → hết cảnh báo; lưu (kiểm API), mở lại ở Xem trước; tab Hướng dẫn: dưới hướng dẫn chung là từng cột có hướng dẫn
// (nhãn màu + bot được chọn / "mọi bot theo dõi việc"), có trong mục lục, bấm cuộn tới; bỏ tick → ẩn ô, nội dung giữ (API hasGuide = false), tick lại hiện lại.
// TEST-189 bố cục mới: bật đánh thức → hai cột Cài đặt | Hướng dẫn cho bot, ~1.500 ký tự → chỉ một thanh cuộn (ô soạn), nút Lưu luôn trong khung nhìn;
// tắt → một cột hẹp, bật lại nội dung còn; Phóng to; điện thoại 390×844 → hai tab, thanh đáy cố định; theme tối; biểu tượng bot trên tiêu đề cột
// (aria-label / tooltip: bot được gọi + có / chưa có hướng dẫn riêng), bấm → mở hộp thoại sửa cột.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Api như đầu task-column-guide-e2e.ts, Vite trỏ Api (không cần Mcp / Realtime):
//   VITE_API_TARGET=http://localhost:5386 bunx vite --port 5188   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5386 BASE_URL=http://localhost:5188 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-column-guide-ui-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5386';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/task-column-guide-ui`;
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
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: quản lý dự án (được sửa cột), 2 bot ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV GU ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead GU ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Guide UI ${stamp}`, code: `GU${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`UM${stamp}`, 'Quản Lý Cột', `e2e.gu.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Rev = await mkEmp(`UR${stamp}`, 'Bot Review', `e2e.gu.rev.${stamp}`, ['employee']);
const Ops = await mkEmp(`UO${stamp}`, 'Bot DevOps', `e2e.gu.ops.${stamp}`, ['employee']);
for (const b of [Rev, Ops]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `GU${stamp}`, name: 'Hướng dẫn theo cột (UI)', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Rev.e.id, Ops.e.id], workGuide: '## Mục đích\nHướng dẫn chung của dự án.\n\n## Quy trình\nCần làm → Đang làm → Chờ review → Deploy → Xong.' })).body as string;
const DEPLOY = (await json(PM.cookie, 'POST', `/api/projects/${P}/columns`, { name: 'Deploy', color: '#ef4444', wakeFollowers: true,
  guide: '## Deploy\n1. `ssh officehub-prod status`\n2. `ssh officehub-prod deploy`\n3. Bình luận **DEPLOY: XONG** hoặc **DEPLOY: LỖI**.' })).body as string;
// Kiểm API bằng cookie bot Review (đăng nhập UI của PM huỷ cookie API của PM)
const colOf = async (name: string) => ((await json(Rev.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[]).find((c) => c.name === name);
ok('dữ liệu: dự án + cột Deploy có hướng dẫn', (await colOf('Deploy'))?.hasGuide === true, DEPLOY);
const GUIDE = '## Review\n1. Đọc bình luận kết quả, lấy commit.\n2. Chạy `dotnet build -warnaserror`, `dotnet test`, `bun run build`.\n3. Bình luận **REVIEW: ĐẠT** hoặc **REVIEW: CẦN SỬA**.';

const br = await launch(9342, `${tmpdir()}/task-column-guide-ui-${stamp}`);
try {
  ok('đăng nhập UI quản lý dự án', (await br.login(PM.user, PW)) === 200);
  const openEdit = async (name: string) => { await br.evalJs(`document.querySelector('[aria-label="Sửa trạng thái ${name}"]').click()`); await br.sleep(700); };
  const save = async () => { await br.evalJs(`document.querySelector('[data-testid="column-dialog"] button[type="submit"]').click()`); await br.sleep(1500); };
  const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
  const scrollDialog = () => br.evalJs(`${q('column-dialog')}.scrollTop = 9999`);
  const setGuide = (text: string) => br.evalJs(`(() => { const t = document.getElementById('col-guide'); const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  // Đo bố cục hộp thoại: kiểu bố cục, hai cột cạnh nhau, phần tử đang cuộn được (overflow auto / scroll và nội dung dài hơn khung), nút Lưu trong khung nhìn.
  const layout = () => br.evalJs(`(() => { const d = ${q('column-dialog')}; const r = (e) => e?.getBoundingClientRect(); const s = r(${q('col-settings')}), g = r(${q('col-guide')});
    const vis = (e) => !!e && e.offsetParent !== null;
    const scrollers = [d, ...d.querySelectorAll('*')].filter((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 1)
      .map((e) => e.id || e.dataset.testid || e.tagName);
    const b = r(d.querySelector('button[type="submit"]'));
    return { layout: d.dataset.layout, w: r(d).width, vw: innerWidth, side: !!(s && g && vis(${q('col-settings')}) && vis(${q('col-guide')}) && g.left >= s.right - 1),
      settings: vis(${q('col-settings')}), guide: vis(${q('col-guide')}), tabs: vis(${q('col-tab-guide')}), scrollers, save: b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth && b.width > 0 } })()`);
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  ok('cột có tick: hiện ô "Hướng dẫn cho bot ở cột này" + bộ đếm / 10.000',
    await br.evalJs(`!!${q('col-guide')} && ${q('col-guide')}.innerText.includes('Hướng dẫn cho bot ở cột này') && ${q('col-guide-count')}.innerText.includes('10.000')`));
  // ── TEST-189: bố cục hai cột, một thanh cuộn, nút Lưu luôn thấy ──
  const LONG = Array.from({ length: 30 }, (_, i) => `${i + 1}. Bước kiểm tra số ${i + 1}: đọc bình luận, chạy lệnh, ghi kết quả.`).join('\n').slice(0, 1500);
  await setGuide(LONG);
  await br.sleep(300);
  let L = await layout();
  ok('[189] bật đánh thức: hai cột Cài đặt | Hướng dẫn cạnh nhau, không có tab', L.layout === 'two-column' && L.side && !L.tabs, L);
  ok('[189] ~1.500 ký tự: không quá một thanh cuộn, nút Lưu trong khung nhìn', L.scrollers.length <= 1 && L.save, L);
  await br.shot(`${SHOTS}/189-1-wide-two-columns-light.png`);
  await setGuide(LONG.repeat(3));
  await br.sleep(300);
  L = await layout();
  ok('[189] 4.500 ký tự: đúng một thanh cuộn (ô soạn), hộp thoại không cuộn, nút Lưu trong khung nhìn', JSON.stringify(L.scrollers) === '["col-guide"]' && L.save, L);
  await setGuide(LONG);
  await br.sleep(300);
  await br.evalJs(`${q('col-wake')}.click()`);
  await br.sleep(300);
  L = await layout();
  ok('[189] tắt đánh thức → một cột hẹp (≤ 480px), không ô hướng dẫn', L.layout === 'single' && L.w <= 480 && !L.guide && L.save, L);
  await br.shot(`${SHOTS}/189-2-wide-single-column.png`);
  await br.evalJs(`${q('col-wake')}.click()`);
  await br.sleep(300);
  ok('[189] bật lại → nội dung hướng dẫn còn nguyên', await br.evalJs(`document.getElementById('col-guide')?.value === ${JSON.stringify(LONG)}`));
  await br.evalJs(`${q('col-guide-max')}.click()`);
  await br.sleep(300);
  L = await layout();
  ok('[189] Phóng to → hộp thoại gần hết màn hình, ẩn cột Cài đặt, Lưu vẫn thấy', L.w >= L.vw - 20 && !L.settings && L.guide && L.save, L);
  await br.evalJs(`${q('col-guide-max')}.click()`);
  await br.sleep(300);
  ok('[189] Thu nhỏ → về hai cột', (await layout()).side);
  // Điện thoại: hai tab, thanh đáy cố định
  await br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await br.sleep(600);
  L = await layout();
  ok('[189] điện thoại: tab "Cài đặt" đang mở, ô hướng dẫn ẩn, nút Lưu thấy', L.tabs && L.settings && !L.guide && L.save, L);
  await br.shot(`${SHOTS}/189-3-phone-tab-settings.png`);
  await br.evalJs(`${q('col-tab-guide')}.click()`);
  await br.sleep(300);
  L = await layout();
  ok('[189] điện thoại: bấm tab "Hướng dẫn cho bot" → ô hướng dẫn, ẩn Cài đặt, nút Lưu thấy', !L.settings && L.guide && L.save, L);
  await br.shot(`${SHOTS}/189-4-phone-tab-guide.png`);
  await br.evalJs(`${q('col-tab-settings')}.click()`);
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await br.sleep(600);
  await setGuide(GUIDE);
  await br.sleep(300);
  ok('có hướng dẫn + chưa chọn bot → cảnh báo "Chưa chọn bot: mọi bot theo dõi việc sẽ được gọi…"',
    await br.evalJs(`${q('col-guide-all-bots')}?.innerText.includes('Chưa chọn bot: mọi bot theo dõi việc sẽ được gọi và đọc hướng dẫn này.') === true`));
  ok('bộ đếm ký tự cập nhật', await br.evalJs(`${q('col-guide-count')}.innerText.startsWith('${GUIDE.length}')`));
  await scrollDialog();
  await br.shot(`${SHOTS}/1-column-dialog-guide-warning.png`);
  ok('[189] chưa chọn bot → dòng "Mọi bot theo dõi việc sẽ được gọi"', await br.evalJs(`!!${q('col-wake-all')}`));
  await br.evalJs(`${q('col-wake-add')}.click()`);
  await br.sleep(200);
  await br.evalJs(`${q(`col-wake-bot-${Rev.code}`)}.click()`);
  await br.sleep(300);
  ok('[189] chọn Bot Review → thẻ tên', await br.evalJs(`!!${q(`col-wake-chip-${Rev.code}`)} && !${q('col-wake-all')}`));
  ok('chọn Bot Review → hết cảnh báo', await br.evalJs(`!${q('col-guide-all-bots')}`));
  await save();
  let c = await colOf('Chờ review');
  // TEST-189: biểu tượng bot trên tiêu đề cột
  const icon = (col: string) => br.evalJs(`document.querySelector('[data-testid="col-${col}"] [data-testid="col-wake-icon"]')?.getAttribute('aria-label') ?? null`);
  const iRev = await icon('Chờ review'), iDep = await icon('Deploy'), iDoing = await icon('Đang làm');
  ok('[189] tiêu đề "Chờ review": biểu tượng bot — gọi Bot Review, có hướng dẫn riêng', !!iRev?.includes('Bot Review') && iRev.includes('Có hướng dẫn riêng'), iRev);
  ok('[189] tiêu đề "Deploy": mọi bot theo dõi việc, có hướng dẫn riêng; "Đang làm" không có biểu tượng',
    !!iDep?.includes('mọi bot theo dõi việc') && iDep.includes('Có hướng dẫn riêng') && iDoing === null, { iDep, iDoing });
  const ic = await br.evalJs(`(() => { const r = document.querySelector('[data-testid="col-Chờ review"] [data-testid="col-wake-icon"]').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 } })()`);
  for (const d of [-6, -2, 0]) await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: ic.x + d, y: ic.y + d });
  await br.sleep(700);
  ok('[189] tooltip biểu tượng bot hiện tên bot + hướng dẫn', await br.evalJs(`[...document.querySelectorAll('[data-testid="col-wake-tip"]')].some((t) => t.innerText.includes('Bot Review') && t.innerText.includes('Có hướng dẫn riêng'))`));
  await br.shot(`${SHOTS}/189-5-board-bot-icon-tooltip.png`);
  await br.evalJs(`document.querySelector('[data-testid="col-Chờ review"] [data-testid="col-wake-icon"]').click()`);
  await br.sleep(700);
  ok('[189] bấm biểu tượng bot → mở hộp thoại sửa cột', await br.evalJs(`${q('column-dialog')}?.innerText.includes('Sửa trạng thái "Chờ review"') === true`));
  await br.evalJs(`[...document.querySelectorAll('[data-testid="column-dialog"] button')].find((b) => b.innerText.trim() === 'Huỷ').click()`);
  await br.sleep(500);
  ok('lưu → API guide + hasGuide + wakeBotIds', c?.guide === GUIDE && c?.hasGuide === true && JSON.stringify(c?.wakeBotIds) === JSON.stringify([Rev.e.id]), c);
  await openEdit('Chờ review');
  ok('mở lại: ô hướng dẫn ở chế độ Xem trước, hiện nội dung đã lưu',
    await br.evalJs(`${q('col-guide')}.innerText.includes('REVIEW: ĐẠT') && !document.getElementById('col-guide')`));
  await scrollDialog();
  await br.sleep(200);
  await br.shot(`${SHOTS}/2-column-dialog-guide-preview.png`);
  // Theme tối
  await br.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  ok('[189] theme tối: hộp thoại hai cột', await br.evalJs(`document.documentElement.classList.contains('dark')`) && (await layout()).side);
  await br.shot(`${SHOTS}/189-6-wide-two-columns-dark.png`);
  await br.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  await br.evalJs(`[...document.querySelectorAll('[data-testid="column-dialog"] button')].find((b) => b.innerText.trim() === 'Huỷ').click()`);
  await br.sleep(500);
  await br.go(`${BASE}/projects/${P}?tab=guide`, 4000);
  const g = await br.evalJs(`(() => { const s = ${q('column-guides')}; const toc = [...document.querySelectorAll('[data-testid="work-guide-toc"]')].map((x) => x.innerText).join('|');
    return s ? { text: s.innerText, n: s.querySelectorAll('article').length, toc, all: document.querySelector('[data-testid="work-guide"]').innerText } : null })()`);
  ok('tab Hướng dẫn: hướng dẫn chung + 2 phần theo cột (Chờ review → Bot Review; Deploy → mọi bot theo dõi việc)',
    g?.n === 2 && g.text.includes('Chờ review') && g.text.includes('Bot Review') && g.text.includes('Deploy') && g.text.includes('mọi bot theo dõi việc')
    && g.text.indexOf('Chờ review') < g.text.indexOf('Deploy') && g.all.includes('Hướng dẫn chung của dự án'), g);
  ok('mục lục có "Trạng thái: Chờ review" + "Trạng thái: Deploy"', !!g && g.toc.includes('Trạng thái: Chờ review') && g.toc.includes('Trạng thái: Deploy'), g?.toc);
  await br.evalJs(`[...document.querySelectorAll('[data-testid="work-guide-toc"] a')].find((a) => a.offsetParent && a.innerText.includes('Trạng thái: Deploy')).click()`);
  await br.sleep(1200);
  // Trang ngắn (Deploy là phần cuối) có thể không cuộn được tới sát đầu → kiểm phần Deploy nằm trọn trong khung nhìn + hash URL đúng
  const pos = await br.evalJs(`(() => { const r = document.querySelector('[data-testid="column-guide-Deploy"]').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, h: innerHeight, hash: location.hash } })()`);
  ok('bấm mục lục "Trạng thái: Deploy" → cuộn tới phần Deploy (trong khung nhìn, #guide-col-…)',
    pos.top >= 0 && pos.bottom <= pos.h && pos.hash.startsWith('#guide-col-'), pos);
  await br.evalJs(`document.querySelector('[data-testid="column-guides"]').scrollIntoView({ block: 'start' })`);
  await br.sleep(600);
  await br.shot(`${SHOTS}/3-guide-tab-columns.png`);
  // Bỏ tick đánh thức → giữ nội dung, không còn ở tab Hướng dẫn
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  await br.evalJs(`${q('col-wake')}.click()`);
  await br.sleep(300);
  ok('bỏ tick đánh thức → ẩn ô hướng dẫn', await br.evalJs(`!${q('col-guide')}`));
  await save();
  c = await colOf('Chờ review');
  ok('lưu → nội dung giữ nguyên, hasGuide = false', c?.guide === GUIDE && c?.hasGuide === false && c?.wakeFollowers === false, c);
  await openEdit('Chờ review');
  await br.evalJs(`${q('col-wake')}.click()`);
  await br.sleep(300);
  ok('tick lại → ô hướng dẫn hiện lại nội dung cũ', await br.evalJs(`${q('col-guide')}.innerText.includes('REVIEW: ĐẠT')`));
  const errs = br.errors.filter((e) => !/negotiat|signalr|hub|502|WebSocket/i.test(e ?? ''));
  ok('không lỗi console (bỏ SignalR)', errs.length === 0, errs);
} finally {
  br.close();
}
console.log(`\nẢnh: ${SHOTS}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
