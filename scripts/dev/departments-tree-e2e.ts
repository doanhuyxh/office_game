// E2E TEST-177: tab Nhân viên → Phòng ban dạng bảng cây thu gọn được — mặc định chỉ cấp 1, (số phòng con), thu / mở từng khối,
// Mở hết / Thu hết, tải lại nhớ khối đang mở (localStorage), tìm theo tên / mã không dấu → tự mở khối cha, xoá từ khoá → về trạng thái cũ,
// lọc "Chỉ phòng có nhân viên" (tính cả phòng con), số nhân viên cả khối + tooltip "N trực thuộc · M cả khối", bỏ cột "Thuộc",
// menu ⋯ (HR: Hướng dẫn · Sửa · Thêm phòng con · Xoá — Xoá hỏi xác nhận; nhân viên thường: chỉ Hướng dẫn), "Thêm phòng con" chọn sẵn cha.
// Chrome máy tính 1440×900 (sáng + tối) + điện thoại 390×844. Ảnh vào SHOTS_DIR.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (dựng Api + Vite như đầu `office-chat-float-e2e.ts`, không cần Realtime):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 BASE_URL=http://localhost:5179 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/departments-tree-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/departments-tree`;
mkdirSync(SHOTS, { recursive: true });
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
/** Đăng nhập API; admin bắt buộc 2FA → tự bật và lưu khoá theo cổng Api (dùng lại cho Chrome). */
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
const stamp = Date.now().toString(36).slice(-4);

// ---------- Dữ liệu: khối "Công nghệ" 3 cấp + khối không người ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const mkDept = async (name: string, code: string, parentId: string | null = null) => {
  const r = await json(admin, 'POST', '/api/org/departments', { name, code, parentId });
  if (r.status >= 300) throw new Error(`Tạo phòng ${name}: ${r.status} ${JSON.stringify(r.body)}`);
  return typeof r.body === 'string' ? r.body : r.body.id;
};
const tech = await mkDept(`Công nghệ ${stamp}`, `CN${stamp}`);
const uiux = await mkDept(`Thiết kế UI/UX ${stamp}`, `UX${stamp}`, tech);
const dev = await mkDept(`Lập trình ${stamp}`, `DV${stamp}`, tech);
const mobile = await mkDept(`Di động ${stamp}`, `MB${stamp}`, dev);
const qa = await mkDept(`Kiểm thử ${stamp}`, `QA${stamp}`, tech);
const empty = await mkDept(`Kho vận ${stamp}`, `KV${stamp}`);
const emptyChild = await mkDept(`Kho lạnh ${stamp}`, `KL${stamp}`, empty);
let n = 0;
const mkEmp = async (departmentId: string, fullName: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code: `T7${stamp}${n++}`, fullName, email: `e2e.t177.${stamp}.${n}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null });
  if (r.status >= 300) throw new Error(`Tạo nhân viên: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.employee;
};
await mkEmp(tech, 'Nguyễn Trực Thuộc');
await mkEmp(uiux, 'Trần Thiết Kế');
await mkEmp(uiux, 'Lê Giao Diện');
await mkEmp(mobile, 'Phạm Di Động');
const staff = await mkEmp(dev, 'Võ Nhân Viên');
const user = `e2e.t177.${stamp}`;
{
  const acc = (await json(admin, 'POST', `/api/org/employees/${staff.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
}
await json(admin, 'PUT', `/api/org/departments/${uiux}/guide`, { description: 'Thiết kế giao diện, trải nghiệm người dùng cho mọi sản phẩm phần mềm của công ty — mô tả dài để kiểm tra cắt bằng dấu ba chấm khi quá rộng.', guide: '## Trách nhiệm\n- Thiết kế' });

// ---------- Trình duyệt ----------
type Page = Awaited<ReturnType<typeof launch>>;
const URL_TAB = `${BASE}/employees?tab=departments`;
const ROW = (id: string) => `[data-testid="dept-row-${id}"]`;
const has = (p: Page, id: string): Promise<boolean> => p.evalJs(`!!document.querySelector('${ROW(id)}')`);
const rowText = (p: Page, id: string): Promise<string> => p.evalJs(`document.querySelector('${ROW(id)}')?.innerText ?? ''`);
const clickSel = async (p: Page, sel: string) => { await p.evalJs(`document.querySelector(${JSON.stringify(sel)}).click()`); await p.sleep(300); };
const clickText = async (p: Page, text: string, scope = 'button') => {
  const done = await p.evalJs(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find((b) => b.textContent.trim() === ${JSON.stringify(text)}); el?.click(); return !!el; })()`);
  await p.sleep(300);
  return done;
};
const toggle = (p: Page, id: string) => clickSel(p, `${ROW(id)} button[aria-expanded]`);
const typeSearch = async (p: Page, v: string) => {
  await p.evalJs(`(() => { const i = document.querySelector('input[aria-label="Tìm phòng ban"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(v)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await p.sleep(300);
};
/** Mở menu ⋯ của một dòng (Radix mở bằng pointerdown) → tên các mục. */
const menuItems = async (p: Page, id: string): Promise<string[]> => {
  await p.evalJs(`(() => { const b = document.querySelector('${ROW(id)} button[aria-label^="Thao tác"]');
    b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); })()`);
  await p.sleep(400);
  return p.evalJs(`[...document.querySelectorAll('[role=menuitem]')].map((x) => x.textContent.trim())`);
};
/** Lỗi console trừ SignalR không kết nối được (script không dựng Realtime). */
const realErrors = (p: Page) => p.errors.filter((e) => !/negotiation|start the connection/.test(e));
const closeMenu = async (p: Page) => { await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await p.sleep(300); };
const open = async (label: string, port: number, width: number, height: number, mobile: boolean, who: [string, string]) => {
  const p = await launch(port, `${tmpdir()}/t177-${label}-${stamp}`, width, height);
  if (mobile) await p.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 2, mobile: true });
  const st = await p.login(who[0], who[1]);
  if (st === 403 && keys[who[0]]) {
    await p.evalJs(`fetch('/api/auth/login/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(totp(keys[who[0]]))},isRecoveryCode:false,rememberMe:true})}).then(r=>r.status)`);
  }
  await p.go(URL_TAB, 3500);
  return p;
};

// ---------- HR / admin, máy tính ----------
{
  const p = await open('hr', 9677, 1440, 900, false, [ADMIN_LOGIN, ADMIN_PASSWORD]);
  await p.evalJs(`localStorage.removeItem('officehub.departments.expanded'); localStorage.setItem('officehub:theme', 'light')`);
  await p.go(URL_TAB, 3000);
  const head = await p.evalJs(`[...document.querySelectorAll('thead th')].map((t) => t.textContent.trim())`);
  ok('không còn cột "Thuộc"', !head.includes('Thuộc') && head.includes('Phòng ban'), head);
  ok('mặc định chỉ hiện cấp 1', await has(p, tech) && await has(p, empty) && !(await has(p, uiux)) && !(await has(p, mobile)));
  const techText = await rowText(p, tech);
  ok('cạnh tên ghi số phòng con "(3)"', techText.includes('(3)'), techText);
  const sum = await p.evalJs(`(() => { const s = document.querySelector('${ROW(tech)} td:nth-child(4) span'); return { t: s?.textContent, title: s?.title }; })()`);
  ok('số nhân viên khối Công nghệ = 5 (cả phòng con)', sum.t === '5', sum);
  ok('tooltip "1 trực thuộc · 5 cả khối"', sum.title === '1 trực thuộc · 5 cả khối', sum);
  await p.shot(`${SHOTS}/1-desktop-mac-dinh.png`);

  await toggle(p, tech);
  ok('mở khối Công nghệ → thấy phòng con cấp 2, chưa thấy cấp 3', await has(p, uiux) && await has(p, dev) && !(await has(p, mobile)));
  await toggle(p, dev);
  ok('mở tiếp khối Lập trình → thấy cấp 3', await has(p, mobile));
  const devSum = await p.evalJs(`document.querySelector('${ROW(dev)} td:nth-child(4) span')?.title`);
  ok('Lập trình: 1 trực thuộc · 2 cả khối', devSum === '1 trực thuộc · 2 cả khối', devSum);
  ok('phòng đã có hướng dẫn có icon nhỏ cạnh tên', await p.evalJs(`!!document.querySelector('${ROW(uiux)} [title="Đã có hướng dẫn"]')`));
  const desc = await p.evalJs(`(() => { const d = document.querySelector('${ROW(uiux)} .line-clamp-1'); return d ? { title: d.title, clip: d.scrollWidth >= d.clientWidth } : null; })()`);
  ok('mô tả hiện dưới tên, xem đủ bằng tooltip', !!desc && desc.title.startsWith('Thiết kế giao diện'), desc);
  await p.shot(`${SHOTS}/2-desktop-mo-khoi.png`);

  await toggle(p, tech);
  ok('thu khối Công nghệ → ẩn cả cấp 2, 3', !(await has(p, uiux)) && !(await has(p, mobile)));
  await toggle(p, tech);
  ok('mở lại → khối Lập trình vẫn nhớ đang mở', await has(p, mobile));
  await p.go(URL_TAB, 3000);
  ok('tải lại trang vẫn nhớ khối đang mở', await has(p, uiux) && await has(p, mobile));

  ok('nút "Thu hết"', await clickText(p, 'Thu hết'));
  ok('Thu hết → chỉ cấp 1', !(await has(p, uiux)) && !(await has(p, emptyChild)));
  ok('nút "Mở hết"', await clickText(p, 'Mở hết'));
  ok('Mở hết → thấy mọi cấp', await has(p, mobile) && await has(p, emptyChild));
  await clickText(p, 'Thu hết');

  // Tìm: không dấu, theo mã; tự mở khối cha; xoá từ khoá → về trạng thái cũ
  await typeSearch(p, `thiet ke ui/ux ${stamp}`);
  ok('tìm "thiet ke ui/ux" (không dấu) → thấy phòng con + khối cha tự mở', await has(p, tech) && await has(p, uiux));
  ok('tìm → phòng không khớp bị ẩn', !(await has(p, dev)) && !(await has(p, empty)));
  await p.shot(`${SHOTS}/3-desktop-tim-ui.png`);
  await typeSearch(p, `mb${stamp}`);
  ok('tìm theo mã (không phân biệt hoa thường) → mở 2 cấp cha', await has(p, tech) && await has(p, dev) && await has(p, mobile));
  await typeSearch(p, '');
  ok('xoá từ khoá → trở lại trạng thái thu như trước', await has(p, tech) && !(await has(p, uiux)) && !(await has(p, mobile)));
  const saved = await p.evalJs(`localStorage.getItem('officehub.departments.expanded')`);
  ok('tìm không ghi đè khối đã lưu', saved === '[]', saved);
  await typeSearch(p, 'khong-co-phong-nao-zzz');
  ok('không khớp → dòng "Không có phòng ban phù hợp"', (await p.evalJs(`document.querySelector('tbody').innerText`)).includes('Không có phòng ban phù hợp'));
  await typeSearch(p, '');

  // Lọc phòng có nhân viên
  await clickText(p, 'Mở hết');
  await clickSel(p, 'button[role=checkbox]');
  ok('lọc "Chỉ phòng có nhân viên" → ẩn khối 0 người (cả phòng con)', !(await has(p, empty)) && !(await has(p, emptyChild)), null);
  ok('lọc → ẩn phòng con 0 người (Kiểm thử), giữ khối cha có người', !(await has(p, qa)) && await has(p, tech) && await has(p, dev) && await has(p, mobile));
  await p.shot(`${SHOTS}/4-desktop-loc-co-nhan-vien.png`);
  await clickSel(p, 'button[role=checkbox]');

  // Menu ⋯ của HR
  const items = await menuItems(p, dev);
  ok('menu ⋯ (HR): Mô tả & hướng dẫn · Sửa · Thêm phòng con · Xoá', JSON.stringify(items) === JSON.stringify(['Mô tả & hướng dẫn', 'Sửa', 'Thêm phòng con', 'Xoá']), items);
  ok('Xoá có màu cảnh báo', await p.evalJs(`[...document.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim() === 'Xoá')?.dataset.variant === 'destructive'`));
  await p.shot(`${SHOTS}/5-desktop-menu.png`);
  await clickText(p, 'Thêm phòng con', '[role=menuitem]');
  await p.sleep(500);
  const dlg = await p.evalJs(`(() => { const d = document.querySelector('[role=dialog]'); return d ? { title: d.querySelector('h2')?.textContent, parent: d.querySelector('#d-parent')?.textContent } : null; })()`);
  ok('Thêm phòng con → form Thêm phòng ban, cha chọn sẵn', dlg?.title === 'Thêm phòng ban' && (dlg?.parent ?? '').includes(`Lập trình ${stamp}`), dlg);
  await closeMenu(p);
  await menuItems(p, qa);
  await clickText(p, 'Xoá', '[role=menuitem]');
  await p.sleep(400);
  const confirm = await p.evalJs(`document.querySelector('[role=alertdialog]')?.textContent ?? ''`);
  ok('Xoá vẫn hỏi xác nhận', confirm.includes(`Xoá phòng ban "Kiểm thử ${stamp}"?`), confirm);
  await closeMenu(p);
  ok('huỷ xác nhận → phòng còn nguyên', await has(p, qa));

  // Theme tối
  await p.evalJs(`localStorage.setItem('officehub:theme', 'dark')`);
  await p.go(URL_TAB, 3000);
  ok('theme tối áp dụng', await p.evalJs(`document.documentElement.classList.contains('dark')`));
  await p.shot(`${SHOTS}/6-desktop-toi.png`);
  await p.evalJs(`localStorage.setItem('officehub:theme', 'light')`);
  ok('không lỗi console (HR)', realErrors(p).length === 0, realErrors(p));
  p.close();
}

// ---------- Nhân viên thường, điện thoại ----------
{
  const p = await open('staff-mobile', 9678, 390, 844, true, [user, PW]);
  await clickText(p, 'Mở hết');
  ok('điện thoại: bảng cây hiện, mở được', await has(p, tech) && await has(p, mobile));
  ok('nhân viên thường: không có nút "Thêm phòng ban"', !(await p.evalJs(`[...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Thêm phòng ban')`)));
  const overflow = await p.evalJs(`document.documentElement.scrollWidth - innerWidth`);
  ok("điện thoại: trang không tràn ngang", overflow <= 1, overflow);
  const menuBtn = await p.evalJs(`(() => { const r = document.querySelector('${ROW(tech)} button[aria-label^="Thao tác"]').getBoundingClientRect(); return r.right; })()`);
  ok("điện thoại: nút ⋯ và cột Nhân viên nằm trong màn hình, không cần cuộn ngang", menuBtn <= 390, menuBtn);
  await p.shot(`${SHOTS}/7-mobile-nhan-vien.png`);
  const items = await menuItems(p, uiux);
  ok('menu ⋯ (nhân viên thường): chỉ Mô tả & hướng dẫn', JSON.stringify(items) === JSON.stringify(['Mô tả & hướng dẫn']), items);
  await clickText(p, 'Mô tả & hướng dẫn', '[role=menuitem]');
  await p.sleep(1200);
  const g = await p.evalJs(`document.querySelector('[role=dialog]')?.textContent ?? ''`);
  ok('mở hộp hướng dẫn (chỉ xem)', g.includes(`Thiết kế UI/UX ${stamp}`) && !g.includes('Soạn'), g.slice(0, 200));
  ok('không lỗi console (nhân viên)', realErrors(p).length === 0, realErrors(p));
  p.close();
}

console.log(`\n${pass}/${pass + fail} đạt · ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
