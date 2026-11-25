// E2E TEST-230: giao diện chia sẻ sổ tay theo phạm vi (Chrome headless, 2 phiên: quản lý dự án PM, khách ẩn danh).
// PM: nút "Chia sẻ" trên thanh công cụ tab Sổ tay → hộp thoại mọi link của dự án, mặc định "Toàn bộ sổ tay"; "Chọn trang" → cây có ô tích (tích cha = cả cây con,
// bỏ một con → gạch ngang), tìm theo tiêu đề, "Đã chọn N trang", chưa chọn → lỗi; danh sách có cột Phạm vi (rê chuột xem tên trang); nút trên từng trang mở sẵn
// "Chọn trang" + lọc link theo trang. Khách: trang rải rác hiện mục lục đúng cây; toàn bộ sổ tay hiện mọi trang; sổ tay trống → "Chưa có trang nào".
// Máy tính 1440 + điện thoại 390×844, sáng + tối. TẠO DỮ LIỆU THẬT → CHỈ DB tạm (không cần S3 / Realtime / Mcp). Api như đầu wiki-share-scope-e2e.ts, Vite trỏ Api:
//   VITE_API_TARGET=http://localhost:5230 bunx vite --port 5330 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5230 BASE_URL=http://localhost:5330 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/wiki-share-scope-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/wiki-share-scope-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5230';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/wiki-share-scope-ui`;
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

// ── Dữ liệu: PM; dự án P (cây 3 nhánh) + dự án E (sổ tay trống, link toàn bộ tạo qua API) ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WSS ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki scope UI ${stamp}`, code: `WC${stamp}` })).body;
const user = `e2e.wss.pm.${stamp}`;
const emp = (await json(admin, 'POST', '/api/org/employees', { code: `WP${stamp}`.toUpperCase(), fullName: 'Quản Lý Sổ Tay', email: `${user}@e2e.test`, phone: null,
  dateOfBirth: null, departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${emp.id}/account`, { mode: 'password', roles: ['employee', 'manager'], userName: user })).body;
await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const pm = await login(user, PW);
const mkProject = async (code: string, name: string) => {
  const r = await json(pm, 'POST', '/api/projects', { code: code.toUpperCase(), name, kind: 'Internal', startOn: today, sequential: false, memberIds: [] });
  return (r.body?.id ?? r.body) as string;
};
const P = await mkProject(`WS${stamp}`, 'Dự án Khách ABC');
const E = await mkProject(`WE${stamp}`, 'Dự án Sổ Tay Trống');
const W = `/api/projects/${P}/wiki`;
const mk = async (title: string, parentId?: string, content = '') => (await json(pm, 'POST', `${W}/pages`, { title, parentId, content: content || `Nội dung trang **${title}**.` })).body.id as string;
const R1 = await mk('Tổng quan');
const R1a = await mk('Kiến trúc', R1);
const R1a1 = await mk('Cơ sở dữ liệu', R1a, '## Bảng\n\n- users\n- projects\n\n## Chỉ mục\n\nMỗi bảng một khoá chính.');
const R2 = await mk('Đặc tả');
const R2a = await mk('Đăng nhập', R2);
const R2b = await mk('Báo cáo', R2);
const R3 = await mk('Phụ lục');
const le = await json(pm, 'POST', `/api/projects/${E}/wiki/shares`, { scope: 'all', days: 7, recipientName: 'Khách Sổ Trống' });
ok('dữ liệu: 2 dự án, 7 trang, link toàn bộ của sổ tay trống', !!P && !!E && [R1, R1a, R1a1, R2, R2a, R2b, R3].every(Boolean) && le.status === 200, le);

const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const brA = await launch(9530, `${tmpdir()}/wiki-scope-a-${stamp}`);
const brC = await launch(9531, `${tmpdir()}/wiki-scope-c-${stamp}`);
type Br = typeof brA;
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(500);
  return r as { x: number; y: number };
};
const click = (br: Br, expr: string, wait = 700) => br.evalJs(`(() => { const e = ${expr}; if (!e) throw new Error('không thấy ' + ${JSON.stringify(expr)}); e.click(); })()`).then(() => br.sleep(wait));
const btnIn = (text: string, scope = 'document') => `[...${scope}.querySelectorAll('button')].find((b) => b.innerText.trim() === ${JSON.stringify(text)})`;
const setVal = (br: Br, selector: string, v: string) => br.evalJs(`(() => { const i = document.querySelector(${JSON.stringify(selector)});
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const text = (br: Br, id: string) => br.evalJs(`${q(id)}?.innerText ?? null`) as Promise<string | null>;
const has = (br: Br, id: string) => br.evalJs(`!!${q(id)}`) as Promise<boolean>;
const noHScroll = (br: Br) => br.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
const theme = async (br: Br, t: 'light' | 'dark', url: string) => {
  await br.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await br.go(url, 3000);
};
const errorsOf = (br: Br) => br.errors.filter((e) => !/negotiation|hub\/|SignalR|WebSocket|status of 4/i.test(e ?? ''));
const waitFor = async (br: Br, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await br.evalJs(`!!(${expr})`)) return true; await br.sleep(250); } return false; };
const mobile = (br: Br) => br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
const desktop = (br: Br) => br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
const pickRow = (title: string) => `[...document.querySelectorAll('[data-testid="wiki-share-pick"]')].find((e) => e.querySelector('span.truncate')?.innerText.trim() === ${JSON.stringify(title)})`;
const pickState = (br: Br, title: string) => br.evalJs(`${pickRow(title)}?.dataset.state ?? null`) as Promise<string | null>;
const items = (br: Br) => br.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-item"]')].map((e) => e.innerText)`) as Promise<string[]>;
const treeItems = (br: Br) => br.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].map((e) => e.innerText.trim())`) as Promise<string[]>;
const URL_WIKI = `${BASE}/projects/${P}?tab=wiki&page=${R1}`;

try {
  ok('PM đăng nhập UI', (await brA.login(user, PW)) === 200);
  await brA.go(URL_WIKI, 1000);
  await theme(brA, 'light', URL_WIKI);
  ok('thanh công cụ sổ tay: nút "Chia sẻ" (quản lý dự án)', await waitFor(brA, q('wiki-share-all')));
  await clickAt(brA, q('wiki-share-all'));
  ok('mở từ thanh công cụ: mặc định "Toàn bộ sổ tay", không có cây chọn trang', await has(brA, 'wiki-share-form')
    && await brA.evalJs(`${q('wiki-share-scope-all')}?.getAttribute('aria-checked') === 'true'`) && !(await has(brA, 'wiki-share-picker')));
  ok('danh sách: "Mọi link của dự án", chưa có link', (await text(brA, 'wiki-share-list-title'))?.startsWith('Mọi link của dự án') === true
    && await waitFor(brA, `${q('wiki-share-dialog')}.innerText.includes('Chưa có link nào')`));
  await setVal(brA, '#wiki-share-recipient', 'Khách Toàn Bộ');
  await click(brA, q('wiki-share-create'), 1800);
  const urlAll = await brA.evalJs(`${q('wiki-share-url')}?.value ?? ''`) as string;
  ok('tạo link toàn bộ: URL /s/{token} + "Toàn bộ sổ tay"', /\/s\/[A-Za-z0-9_-]{43}$/.test(urlAll) && (await text(brA, 'wiki-share-created'))?.includes('Toàn bộ sổ tay') === true, urlAll);

  await click(brA, btnIn('Tạo link khác', q('wiki-share-dialog')));
  await click(brA, q('wiki-share-scope-pages'));
  ok('"Chọn trang" → cây 7 trang có ô tích, "Đã chọn 0 trang"', await waitFor(brA, q('wiki-share-picker'))
    && (await brA.evalJs(`document.querySelectorAll('[data-testid="wiki-share-pick"]').length`)) === 7 && (await text(brA, 'wiki-share-pick-count')) === 'Đã chọn 0 trang');
  await click(brA, q('wiki-share-create'), 800);
  ok('chưa chọn trang → báo "Chọn ít nhất một trang", không tạo', (await text(brA, 'wiki-share-pages-error'))?.includes('Chọn ít nhất một trang') === true && await has(brA, 'wiki-share-form'));
  await clickAt(brA, `${pickRow('Đặc tả')}.querySelector('button')`);
  ok('tích "Đặc tả" → tích cả 2 trang con, "kèm trang con", đếm 3', (await pickState(brA, 'Đặc tả')) === 'checked' && (await pickState(brA, 'Đăng nhập')) === 'checked'
    && (await pickState(brA, 'Báo cáo')) === 'checked' && (await text(brA, 'wiki-share-pick-count')) === 'Đã chọn 3 trang'
    && (await brA.evalJs(`${pickRow('Đặc tả')}.innerText`) as string).includes('kèm trang con'));
  await clickAt(brA, `${pickRow('Báo cáo')}.querySelector('button')`);
  ok('bỏ tích "Báo cáo" → "Đặc tả" gạch ngang (tích một phần), đếm 2', (await pickState(brA, 'Đặc tả')) === 'indeterminate' && (await pickState(brA, 'Báo cáo')) === 'unchecked'
    && (await text(brA, 'wiki-share-pick-count')) === 'Đã chọn 2 trang');
  await setVal(brA, '[data-testid="wiki-share-pick-search"]', 'co so');
  await brA.sleep(400);
  ok('tìm "co so" (không dấu) → "Cơ sở dữ liệu" + các trang cha', JSON.stringify(await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-pick"] span.truncate')].map((e) => e.innerText)`))
    === JSON.stringify(['Tổng quan', 'Kiến trúc', 'Cơ sở dữ liệu']));
  await clickAt(brA, `${pickRow('Cơ sở dữ liệu')}.querySelector('button')`);
  ok('tích "Cơ sở dữ liệu" (trang cháu) → "Tổng quan" gạch ngang, đếm 3', (await pickState(brA, 'Cơ sở dữ liệu')) === 'checked' && (await pickState(brA, 'Tổng quan')) === 'indeterminate'
    && (await text(brA, 'wiki-share-pick-count')) === 'Đã chọn 3 trang');
  await setVal(brA, '[data-testid="wiki-share-pick-search"]', '');
  await brA.sleep(300);
  await setVal(brA, '#wiki-share-recipient', 'Khách Chọn Trang');
  await brA.shot(`${SHOTS}/1-dialog-pick-pages-light.png`);
  await click(brA, q('wiki-share-create'), 1800);
  const urlPages = await brA.evalJs(`${q('wiki-share-url')}?.value ?? ''`) as string;
  ok('tạo link chọn trang: "3 trang"', /\/s\/[A-Za-z0-9_-]{43}$/.test(urlPages) && (await text(brA, 'wiki-share-created'))?.includes('3 trang') === true, await text(brA, 'wiki-share-created'));
  const its = await items(brA);
  ok('danh sách: 2 link, cột phạm vi "3 trang" + "Toàn bộ sổ tay"', its.length === 2 && its[0].includes('Khách Chọn Trang') && its[0].includes('3 trang')
    && its[1].includes('Toàn bộ sổ tay'), its);
  const scopeBtn = `document.querySelector('[data-testid="wiki-share-item"] [data-testid="wiki-share-scope"]').closest('button')`;
  // Chỉ rê chuột (bấm vào nút sẽ đóng tooltip của Radix)
  const at = await brA.evalJs(`(() => { const e = ${scopeBtn}; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`) as { x: number; y: number };
  for (let i = 0; i < 4; i++) { await brA.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: at.x + i, y: at.y, pointerType: 'mouse' }); await brA.sleep(100); }
  await brA.sleep(700);
  const tip = await brA.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-scope-pages"]')].map((e) => e.innerText).join('|')`) as string;
  ok('rê chuột cột phạm vi → tên trang theo thứ tự sổ tay', tip.includes('Cơ sở dữ liệu') && tip.includes('Đặc tả') && tip.includes('Đăng nhập') && !tip.includes('Báo cáo')
    && tip.indexOf('Cơ sở dữ liệu') < tip.indexOf('Đặc tả'), tip);
  await brA.shot(`${SHOTS}/2-dialog-list-scope-tooltip-light.png`);
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brA.sleep(300);
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await brA.sleep(500);

  // ── Nút trên một trang: mở sẵn "Chọn trang" với trang đó + lọc danh sách ──
  await brA.go(`${BASE}/projects/${P}?tab=wiki&page=${R2b}`, 3000);
  await clickAt(brA, q('wiki-share-open'));
  ok('nút trên trang "Báo cáo": "Chọn trang" với trang đó đã tích', await brA.evalJs(`${q('wiki-share-scope-pages')}?.getAttribute('aria-checked') === 'true'`)
    && (await pickState(brA, 'Báo cáo')) === 'checked' && (await text(brA, 'wiki-share-pick-count')) === 'Đã chọn 1 trang');
  ok('danh sách lọc theo trang "Báo cáo": chỉ link toàn bộ', await waitFor(brA, `${q('wiki-share-list-title')}?.innerText.includes('Báo cáo')`)
    && JSON.stringify((await items(brA)).map((t) => t.includes('Toàn bộ sổ tay'))) === '[true]', await items(brA));
  await click(brA, q('wiki-share-list-filter'), 1200);
  ok('"Xem mọi link" → 2 link', (await items(brA)).length === 2 && (await text(brA, 'wiki-share-list-title'))?.startsWith('Mọi link') === true);
  await theme(brA, 'dark', `${BASE}/projects/${P}?tab=wiki&page=${R2}`);
  await clickAt(brA, q('wiki-share-open'));
  await brA.sleep(800);
  await brA.shot(`${SHOTS}/3-dialog-page-button-dark.png`);
  await brA.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await mobile(brA);
  await theme(brA, 'light', URL_WIKI);
  await clickAt(brA, q('wiki-tree-toggle'));
  ok('điện thoại: nút "Chia sẻ" của sổ tay hiện', await waitFor(brA, `${q('wiki-share-all')}?.offsetParent`));
  await clickAt(brA, q('wiki-share-all'));
  await click(brA, q('wiki-share-scope-pages'));
  ok('điện thoại: hộp thoại + cây chọn trang không tràn ngang', await has(brA, 'wiki-share-picker') && await noHScroll(brA));
  await brA.shot(`${SHOTS}/4-dialog-mobile-light.png`);
  await desktop(brA);

  // ── Khách: link chọn trang (rải rác), link toàn bộ, sổ tay trống ──
  await brC.go(urlPages, 1000);
  await theme(brC, 'light', urlPages);
  ok('khách: link chọn trang → trang đầu "Cơ sở dữ liệu"', (await text(brC, 'wiki-share-title')) === 'Cơ sở dữ liệu', await brC.evalJs(`document.body.innerText.slice(0, 300)`));
  ok('khách: mục lục đúng 3 trang theo cây (Đăng nhập dưới Đặc tả)', JSON.stringify(await treeItems(brC)) === JSON.stringify(['Cơ sở dữ liệu', 'Đặc tả', 'Đăng nhập'])
    && await brC.evalJs(`[...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].find((e) => e.innerText.trim() === 'Đăng nhập').style.paddingLeft !== [...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].find((e) => e.innerText.trim() === 'Đặc tả').style.paddingLeft`),
    await treeItems(brC));
  await brC.shot(`${SHOTS}/5-public-pages-desktop-light.png`);
  await click(brC, `[...document.querySelectorAll('[data-testid="wiki-share-tree"] [data-testid="wiki-share-tree-item"]')].find((e) => e.innerText.trim() === 'Đăng nhập')`, 1500);
  ok('khách: chọn "Đăng nhập" → đường dẫn cha "Đặc tả"', (await text(brC, 'wiki-share-title')) === 'Đăng nhập'
    && ((await brC.evalJs(`document.querySelector('nav[aria-label="Trang cha"]')?.innerText ?? ''`)) as string).includes('Đặc tả'));
  await mobile(brC);
  await theme(brC, 'dark', urlPages);
  await clickAt(brC, q('wiki-share-menu'));
  ok('khách điện thoại (tối): ngăn kéo mục lục 3 trang, không tràn ngang', await waitFor(brC, q('wiki-share-drawer'))
    && (await brC.evalJs(`${q('wiki-share-drawer')}.querySelectorAll('[data-testid="wiki-share-tree-item"]').length`)) === 3 && await noHScroll(brC));
  await brC.shot(`${SHOTS}/6-public-pages-mobile-dark.png`);
  await desktop(brC);
  await theme(brC, 'light', urlAll);
  ok('khách: link toàn bộ → mục lục 7 trang, trang đầu "Tổng quan"', (await treeItems(brC)).length === 7 && (await text(brC, 'wiki-share-title')) === 'Tổng quan', await treeItems(brC));
  const urlEmpty = `${BASE}/s/${le.body.token}`;
  await mobile(brC);
  await theme(brC, 'dark', urlEmpty);
  ok('khách: toàn bộ sổ tay trống → "Chưa có trang nào" (không báo hết hạn)', (await text(brC, 'wiki-share-empty'))?.includes('Chưa có trang nào') === true
    && !(await has(brC, 'wiki-share-gone')) && (await text(brC, 'wiki-share-project')) === 'Dự án Sổ Tay Trống');
  await brC.shot(`${SHOTS}/7-public-empty-mobile-dark.png`);
  await theme(brC, 'light', urlEmpty);
  await brC.shot(`${SHOTS}/8-public-empty-mobile-light.png`);

  ok('không có lỗi JS (PM)', errorsOf(brA).length === 0, errorsOf(brA));
  ok('không có lỗi JS (khách)', errorsOf(brC).length === 0, errorsOf(brC));
} catch (e) {
  ok('lỗi bất ngờ', false, String(e));
  await brA.shot(`${SHOTS}/error-a.png`).catch(() => {});
  await brC.shot(`${SHOTS}/error-c.png`).catch(() => {});
} finally {
  brA.close(); brC.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
