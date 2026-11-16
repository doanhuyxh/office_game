// E2E TEST-132: nút gửi dữ liệu có vòng xoay (Button `loading`) khi mạng chậm — Chrome headless + CDP giả lập độ trễ mạng
// (Network.emulateNetworkConditions, như DevTools "Slow 4G"). Mỗi nút: `data-loading` + `aria-busy` + disabled trong lúc gửi,
// chữ đúng ("Đang đăng nhập…", "Đang lưu…"…, đọc bằng innerText — lớp giữ chỗ ẩn không tính), bề ngang không đổi, bấm lần hai
// không gửi thêm request; hộp xác nhận `confirmDialog({ onConfirm })` giữ mở + nút đồng ý xoay tới khi xong;
// nút trong danh sách chỉ dòng được bấm xoay, dòng khác vẫn khoá.
// Tạo chức vụ / ngày lễ thật → CHỈ chạy trên DB tạm (dựng Api / Realtime / Vite như đầu office-chat-full-e2e.ts):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5283 BASE_URL=http://localhost:5173 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/button-loading-e2e.ts
// Admin seed của Api tạm (Seed__AdminEmail / Seed__AdminPassword) — không đọc `.env`.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5283';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
if (!ADMIN_LOGIN || !ADMIN_PASSWORD) throw new Error('Thiếu ADMIN_LOGIN / ADMIN_PASSWORD');

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? '✓' : '✗'} ${name}${!cond && extra !== undefined ? ` — ${JSON.stringify(extra)}` : ''}`);
};

// ---- 2FA của admin (bắt buộc) — khoá lưu theo cổng Api như project-live-ui-e2e.ts
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
async function enroll() {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: ADMIN_LOGIN, password: ADMIN_PASSWORD }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') { if (!keys[ADMIN_LOGIN]) throw new Error(`Admin đã bật 2FA nhưng không có khoá trong ${KEYS_FILE}`); return; }
  let cookie = cookieOf(r, 'officehub.auth');
  if (!body?.mustSetupTwoFactor) return;
  const post = async (path: string, b: unknown) => {
    const x = await fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(b) });
    cookie = cookieOf(x, 'officehub.auth') || cookie;
    return { status: x.status, body: await x.json().catch(() => null) as any };
  };
  const s = await post('/api/auth/2fa/setup', {});
  const e = await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
  if (e.status !== 200) throw new Error(`Không bật được 2FA cho admin: ${s.status} ${e.status}`);
  keys[ADMIN_LOGIN] = s.body.sharedKey;
  writeFileSync(KEYS_FILE, JSON.stringify(keys));
}
await enroll();

const br = await launch(9341, `${tmpdir()}/officehub-e2e-t132-chrome-${Date.now()}`);
await br.send('Network.enable');
const slow = (latency: number) => br.send('Network.emulateNetworkConditions', { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
// Đếm request ghi (khác GET) qua fetch để kiểm tra "bấm lần hai không gửi thêm" — cài lại sau mỗi lần mở trang.
const hook = () => br.evalJs(`(() => { if (window.__writes !== undefined) return; const f = window.fetch;
  window.fetch = (i, o) => { const m = (o && o.method) || (i instanceof Request ? i.method : 'GET');
    if (m.toUpperCase() !== 'GET') window.__writes.push(String(i instanceof Request ? i.url : i)); return f(i, o); }; window.__writes = []; })()`);
/** Số request ghi tới URL chứa `path`. */
const writes = (path: string) => br.evalJs(`window.__writes.filter((u) => u.includes(${JSON.stringify(path)})).length`) as Promise<number>;
const go = async (url: string) => { await br.go(url, 2500); await hook(); };

const setInput = (sel: string, value: string) => br.evalJs(`(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false;
  const proto = t instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, ${JSON.stringify(value)}); t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const until = async (expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 100) { if (await br.evalJs(expr)) return true; await br.sleep(100); } return false; };

/** Trạng thái nút: data-loading, aria-busy, disabled, chữ nhìn thấy, bề ngang, có vòng xoay. */
const state = (expr: string) => br.evalJs(`(() => { const b = ${expr}; if (!b) return null;
  return { loading: b.dataset.loading === 'true', busy: b.getAttribute('aria-busy') === 'true', disabled: b.disabled,
    text: b.innerText.replace(b.querySelector('[role=status]')?.innerText ?? '\\0', '').replace(/\\s+/g, ' ').trim(),
    width: Math.round(b.getBoundingClientRect().width),
    spin: [...b.querySelectorAll('svg.animate-spin')].some((s) => getComputedStyle(s).visibility === 'visible') }; })()`) as Promise<null | {
  loading: boolean; busy: boolean; disabled: boolean; text: string; width: number; spin: boolean }>;

/** Bấm nút (expr JS trả về phần tử) khi mạng chậm, bắt trạng thái lúc đang gửi, bấm lần hai, chờ xong. */
async function check(name: string, expr: string, path: string, { text, idle, latency = 1500, done }: { text?: string; idle?: string; latency?: number; done?: string }) {
  const before = await state(expr);
  ok(`${name}: nút có mặt, chưa xoay`, !!before && !before.loading && !before.spin, before);
  if (!before) return;
  if (idle) ok(`${name}: chữ lúc thường "${idle}"`, before.text === idle, before.text);
  await slow(latency);
  const n0 = await writes(path);
  await br.evalJs(`${expr}.click()`);
  const during = await until(`(${expr})?.dataset.loading === 'true'`, 1000) ? await state(expr) : await state(expr);
  ok(`${name}: đang gửi → data-loading + aria-busy + disabled + vòng xoay`, !!during && during.loading && during.busy && during.disabled && during.spin, during);
  if (text) ok(`${name}: chữ lúc gửi "${text}"`, during?.text === text, during?.text);
  ok(`${name}: bề ngang không đổi (${before.width}px)`, !!during && Math.abs(during.width - before.width) <= 1, { before: before.width, during: during?.width });
  await br.evalJs(`(${expr})?.click()`); // bấm lần hai khi đang xoay
  await slow(0);
  ok(`${name}: xong → hết xoay`, await until(done ?? `!(${expr}) || (${expr}).dataset.loading !== 'true'`, 10000));
  await br.sleep(300);
  const n = (await writes(path)) - n0;
  ok(`${name}: gửi đúng 1 request (bấm lần hai bị chặn)`, n === 1, n);
}

// ---- 1. Đăng nhập + 2FA (nút trang đăng nhập, không lộ thông tin: chỉ "Đang đăng nhập…")
await go(`${BASE}/login`);
await setInput('#login', ADMIN_LOGIN);
await setInput('#password', ADMIN_PASSWORD);
const loginBtn = `document.querySelector('form button[type=submit]')`;
await check('Đăng nhập', loginBtn, '/api/auth/login', { idle: 'Đăng nhập', text: 'Đang đăng nhập…', done: `!!document.querySelector('#totp-code')` });
ok('Đăng nhập: chuyển sang bước mã 2FA', await until(`!!document.querySelector('#totp-code')`));
await setInput('#totp-code', totp(keys[ADMIN_LOGIN]));
await check('Xác nhận 2FA', loginBtn, '/api/auth/login/2fa', { idle: 'Xác nhận', text: 'Đang kiểm tra…', done: `!location.pathname.startsWith('/login')` });
ok('2FA: vào ứng dụng', await until(`!location.pathname.startsWith('/login')`, 10000));

// ---- 2. Thêm chức vụ (form trong hộp thoại, nút Lưu → "Đang lưu…", hộp đóng khi xong)
const posName = `Chức vụ T132 ${Date.now().toString(36).slice(-4)}`;
await go(`${BASE}/employees?tab=positions`);
await br.evalJs(`[...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Thêm chức vụ')?.click()`);
ok('Chức vụ: mở hộp thoại', await until(`!!document.querySelector('#p-name')`));
await setInput('#p-name', posName);
await setInput('#p-level', '9');
const saveBtn = `[...document.querySelectorAll('[role=dialog] button[type=submit]')][0]`;
await check('Lưu chức vụ', saveBtn, '/positions', { idle: 'Lưu', text: 'Đang lưu…', done: `!document.querySelector('#p-name')` });
ok('Chức vụ: đã có trong bảng', await until(`document.body.innerText.includes(${JSON.stringify(posName)})`));

// ---- 3. Xoá chức vụ qua confirmDialog({ onConfirm }) — hộp giữ mở + "Đang xử lý…" tới khi xong
const rowDel = `[...document.querySelectorAll('tr')].find((r) => r.innerText.includes(${JSON.stringify(posName)}))?.querySelector('button[aria-label="Xoá"]')`;
await br.evalJs(`${rowDel}.click()`);
ok('Xoá chức vụ: hộp xác nhận mở', await until(`!!document.querySelector('[data-testid=confirm-dialog-ok]')`));
const okBtn = `document.querySelector('[data-testid=confirm-dialog-ok]')`;
await slow(1500);
await br.evalJs(`${okBtn}.click()`);
await br.sleep(400);
const mid = await state(okBtn);
ok('Xoá chức vụ: hộp vẫn mở, nút đồng ý xoay "Đang xử lý…"', !!mid && mid.loading && mid.spin && mid.text === 'Đang xử lý…', mid);
ok('Xoá chức vụ: nút Huỷ bị khoá khi đang xử lý', !!(await br.evalJs(`[...document.querySelectorAll('[data-testid=confirm-dialog] button')].find((b) => b.innerText.trim() === 'Huỷ')?.disabled`)));
await slow(0);
ok('Xoá chức vụ: xong → hộp đóng', await until(`!document.querySelector('[data-testid=confirm-dialog]')`, 10000));
ok('Xoá chức vụ: dòng biến mất', await until(`!document.body.innerText.includes(${JSON.stringify(posName)})`));

// ---- 4. Ngày lễ: nút "Thêm" + nút xoá theo dòng (chỉ dòng được bấm xoay, dòng khác khoá)
await go(`${BASE}/attendance?tab=settings`);
const year = await br.evalJs(`(document.body.innerText.match(/Ngày lễ (\\d{4})/) || [])[1]`) as string;
ok('Ngày lễ: thấy bảng ngày lễ', !!year, year);
for (const [d, n] of [['15', 'Lễ T132 A'], ['16', 'Lễ T132 B']]) {
  // Bộ chọn ngày tiếng Việt (popover): mở → bấm ngày `d` của tháng hiện tại (15 / 16 chỉ có một ô trong lưới 6 tuần)
  await br.evalJs(`document.querySelector('form:has(input[placeholder^="Tên ngày lễ"]) button[aria-label="Ngày"]').click()`);
  await until(`!!document.querySelector('[data-radix-popper-content-wrapper]')`, 3000);
  await br.evalJs(`[...document.querySelectorAll('[data-radix-popper-content-wrapper] button')].find((b) => b.innerText.trim() === '${d}').click()`);
  await br.sleep(200);
  await setInput('input[placeholder^="Tên ngày lễ"]', n);
  const addBtn = `document.querySelector('form:has(input[placeholder^="Tên ngày lễ"]) button[type=submit]')`;
  await check(`Thêm ngày lễ ${n}`, addBtn, '/holidays', { idle: 'Thêm', text: 'Thêm' });
  ok(`Ngày lễ ${n}: có trong danh sách`, await until(`document.body.innerText.includes(${JSON.stringify(n)})`));
}
const delOf = (n: string) => `[...document.querySelectorAll('li')].find((r) => r.innerText.includes(${JSON.stringify(n)}))?.querySelector('button[aria-label="Xoá"]')`;
await slow(1500);
await br.evalJs(`${delOf('Lễ T132 A')}.click()`);
await br.sleep(400);
const a = await state(delOf('Lễ T132 A')), b = await state(delOf('Lễ T132 B'));
ok('Xoá ngày lễ: dòng được bấm xoay', !!a && a.loading && a.spin, a);
ok('Xoá ngày lễ: dòng khác không xoay nhưng khoá', !!b && !b.loading && !b.spin && b.disabled, b);
await slow(0);
ok('Xoá ngày lễ: xong → dòng biến mất', await until(`!document.body.innerText.includes('Lễ T132 A')`, 10000));
await br.evalJs(`${delOf('Lễ T132 B')}?.click()`);
await until(`!document.body.innerText.includes('Lễ T132 B')`, 10000);

const errs = br.errors.filter((e) => !/Failed to load resource|favicon|WebSocket|negotiat/i.test(e));
ok('Không lỗi JS trên console', errs.length === 0, errs.slice(0, 3));
br.close();
console.log(`\n${pass}/${pass + fail} pass`);
process.exit(fail ? 1 : 0);
