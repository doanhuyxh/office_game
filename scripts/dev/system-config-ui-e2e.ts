// E2E TEST-234: Hệ thống → Cấu hình chia mục (Chrome headless, admin seed): menu trái có nhóm Hạ tầng / Thông báo / Chấm công / Trợ lý AI / Tài liệu,
// mặc định mục S3, bấm mục → URL `?tab=config&section=…` (S3 không ghi), reload vẫn đúng mục, `section` lạ → S3, đổi tab ngang xoá `section`,
// chỉ tải API của mục đang mở, tab Kênh thông báo → "Cấu hình" mở đúng mục, IP văn phòng Lưu + Kiểm tra vẫn chạy, 375px: menu thành Select (chọn được),
// không cuộn ngang trang; sáng + tối; không lỗi console (bỏ lỗi SignalR khi không chạy Realtime).
// GHI CẤU HÌNH IP VĂN PHÒNG → CHỈ DB tạm (không cần S3 / Realtime). Dựng như finance-dashboard-e2e.ts (Api + DB tạm) + Vite trỏ Api:
//   docker run -d --name e2e234-pg -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:15434:5432 postgres:17-alpine
//   Api cổng 5234 (biến như đầu finance-dashboard-e2e.ts) · VITE_API_TARGET=http://localhost:5234 bunx vite --port 5334 --strictPort   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5234 BASE_URL=http://localhost:5334 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/system-config-ui-e2e.ts
// Ảnh chụp vào SHOTS_DIR (mặc định %TEMP%/system-config-ui).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5234';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/system-config-ui`;
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

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const URL_CFG = `${BASE}/system?tab=config`;
const SECTIONS = ['s3', 'smtp', 'fcm', 'telegram', 'office-ips', 'ai-limits', 'ai-alerts', 'ai-meetings', 'documents'];
/** Thẻ phải hiện khi mở mục. */
const CARD: Record<string, string> = {
  s3: 'settings-s3', smtp: 'settings-smtp', fcm: 'settings-fcm', telegram: 'settings-telegram', 'office-ips': 'settings-office_ips',
  'ai-limits': 'agent-limits', 'ai-alerts': 'ai-alert-settings', 'ai-meetings': 'agent-meeting-limits', documents: 'document-settings',
};

const br = await launch(9434, `${tmpdir()}/sys-cfg-ui-${Date.now()}`);
type Br = typeof br;
const q = (id: string) => `document.querySelector('[data-testid="${id}"]')`;
const waitJs = async (b: Br, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (await b.evalJs(expr).catch(() => false)) return true; await b.sleep(200); } return false; };
const has = (b: Br, id: string) => waitJs(b, `!!${q(id)}`);
const search = (b: Br) => b.evalJs(`location.search`) as Promise<string>;
const click = (b: Br, expr: string, wait = 700) => b.evalJs(`(() => { const e = ${expr}; if (!e) throw new Error('không thấy ' + ${JSON.stringify(expr)}); e.click(); })()`).then(() => b.sleep(wait));
const noHScroll = (b: Br) => b.evalJs(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
/** Đường dẫn API trình duyệt đã gọi (CDP Network — bộ đệm resource timing đầy ở Vite dev). `apiCalls.length = 0` để đếm lại. */
const apiCalls: string[] = [];
br.on('Network.requestWillBeSent', (p) => { const u = new URL(p.request.url); if (u.pathname.startsWith('/api/')) apiCalls.push(u.pathname); });
await br.send('Network.enable');
const resources = async (_b: Br) => [...apiCalls];
const theme = async (b: Br, t: 'light' | 'dark', url: string) => {
  await b.evalJs(`localStorage.setItem('officehub:theme', '${t}')`);
  await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: t }] });
  await b.go(url, 3500);
};
const cookieName = admin.split('=')[0];

try {
  await br.go(`${BASE}/login`, 1500);
  await br.send('Network.setCookie', { name: cookieName, value: admin.slice(cookieName.length + 1), url: BASE });
  await theme(br, 'light', URL_CFG);
  await br.sleep(1500);

  ok('Mặc định mục S3 (thẻ S3 + mục S3 được tô)', await has(br, 'config-section-s3') && await has(br, 'settings-s3')
    && await br.evalJs(`${q('config-nav-s3')}?.getAttribute('aria-current') === 'page'`));
  ok('Menu trái đủ 5 nhóm theo thứ tự', JSON.stringify(await br.evalJs(`[...${q('config-nav')}.querySelectorAll('p')].map((p) => p.textContent.trim())`))
    === JSON.stringify(['Hạ tầng', 'Thông báo', 'Chấm công', 'Trợ lý AI', 'Tài liệu']));
  ok('Menu trái đủ 9 mục đúng thứ tự', JSON.stringify(await br.evalJs(`[...${q('config-nav')}.querySelectorAll('button')].map((b) => b.dataset.testid.slice(11))`)) === JSON.stringify(SECTIONS));
  const r0 = await resources(br);
  ok('Mục S3: chưa tải API của mục khác (agent-settings, ai-alert-settings)', !r0.some((p) => p.startsWith('/api/') && p.includes('/agent-settings') || p.startsWith('/api/') && p.includes('/ai-alert-settings')), r0.filter((p) => p.startsWith('/api')));
  ok('Màn rộng: không có Select, không cuộn ngang', await br.evalJs(`getComputedStyle(${q('config-nav-select')}.parentElement).display === 'none'`) && await noHScroll(br));
  await br.shot(`${SHOTS}/1-s3-light.png`);

  for (const s of SECTIONS) {
    await click(br, q(`config-nav-${s}`));
    const sr = await search(br);
    const urlOk = s === 's3' ? !sr.includes('section=') : sr.includes(`section=${s}`);
    ok(`Mục ${s}: URL + chỉ render mục đang mở + thẻ hiện`, urlOk && await has(br, CARD[s])
      && await br.evalJs(`document.querySelectorAll('[data-testid^="config-section-"]').length === 1 && !!${q(`config-section-${s}`)}`), { sr });
  }
  apiCalls.length = 0;
  await click(br, q('config-nav-ai-alerts'), 1500);
  ok('Mở mục Ngưỡng cảnh báo mới gọi /ai-alert-settings', (await resources(br)).some((p) => p.startsWith('/api/') && p.includes('/ai-alert-settings')));
  await br.shot(`${SHOTS}/2-ai-alerts-light.png`);

  await br.go(`${URL_CFG}&section=smtp`, 3000);
  ok('Reload ?section=smtp → mục SMTP', await has(br, 'settings-smtp') && await br.evalJs(`${q('config-nav-smtp')}?.getAttribute('aria-current') === 'page'`));
  await br.go(`${URL_CFG}&section=khong-co`, 3000);
  ok('section lạ → về mục S3', await has(br, 'settings-s3'));

  await br.go(`${URL_CFG}&section=documents`, 3000);
  // Radix Tabs kích hoạt ở mousedown (click() không đủ)
  await br.evalJs(`[...document.querySelectorAll('[role="tab"]')].find((t) => t.textContent.trim() === 'Vận hành').dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);
  await br.sleep(1200);
  const s1 = await search(br);
  ok('Đổi tab ngang → xoá section', s1.includes('tab=ops') && !s1.includes('section='), s1);

  await br.go(`${BASE}/system?tab=channels`, 3500);
  const cfgBtn = await br.evalJs(`[...document.querySelectorAll('[data-testid^="channel-"][data-testid$="-config"]')].map((b) => b.dataset.testid)`) as string[];
  const tgBtn = cfgBtn.find((x) => x.includes('telegram'));
  if (tgBtn) {
    await click(br, q(tgBtn), 2000);
    ok('Kênh thông báo → Cấu hình Telegram mở đúng mục', (await search(br)).includes('section=telegram') && await has(br, 'settings-telegram'), await search(br));
  } else ok('Kênh thông báo có nút Cấu hình Telegram', false, cfgBtn);

  // IP văn phòng: Lưu + Kiểm tra vẫn chạy như trước
  await br.go(`${URL_CFG}&section=office-ips`, 3000);
  await click(br, `[...${q('settings-office_ips')}.querySelectorAll('button')].find((b) => b.textContent.includes('Thêm IP'))`, 400);
  await br.evalJs(`(() => { const i = ${q('office-ip-0')}; const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, '127.0.0.1'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(300);
  await click(br, `${q('settings-office_ips')}.querySelector('button[type="submit"]')`, 2000);
  const saved = await br.evalJs(`fetch('/api/system/settings').then((r) => r.json()).then((x) => x.find((g) => g.group === 'office_ips'))`) as any;
  ok('IP văn phòng: Lưu ghi vào DB', saved?.source === 'db' && /^127\.0\.0\.1(\/32)?$/.test(saved?.values?.ranges?.[0]?.cidr ?? ''), saved);
  await click(br, q('settings-office_ips-test'), 2000);
  ok('IP văn phòng: Kiểm tra trả kết quả', await has(br, 'settings-office_ips-result'));
  await br.shot(`${SHOTS}/3-office-ips-light.png`);

  await theme(br, 'dark', `${URL_CFG}&section=ai-limits`);
  ok('Tối: mục Giới hạn bot hiện', await has(br, 'agent-limits'));
  await br.shot(`${SHOTS}/4-ai-limits-dark.png`);

  await br.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 2, mobile: true });
  await br.go(`${URL_CFG}&section=smtp`, 3000);
  ok('375px: Select hiện, menu trái ẩn, không cuộn ngang', await br.evalJs(`!!${q('config-nav-select')}?.offsetParent && getComputedStyle(${q('config-nav')}).display === 'none'`)
    && await noHScroll(br));
  await br.evalJs(`(() => { const t = ${q('config-nav-select')}; t.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); t.click(); })()`);
  await br.sleep(600);
  const groups = await br.evalJs(`[...document.querySelectorAll('[role="listbox"] [role="group"]')].length`);
  await br.shot(`${SHOTS}/5-mobile-select-dark.png`);
  await click(br, `[...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes('Telegram'))`, 1200);
  ok('375px: Select có 5 nhóm, chọn Telegram → mục Telegram', groups === 5 && (await search(br)).includes('section=telegram') && await has(br, 'settings-telegram'), { groups });
  ok('375px: mục Telegram không cuộn ngang', await noHScroll(br));
  await br.shot(`${SHOTS}/6-mobile-telegram-dark.png`);

  const errs = br.errors.filter((e) => !/favicon|WebGL|GPU|negotiation|Failed to start the connection|502/i.test(e));
  ok('Không lỗi console', errs.length === 0, errs);
} finally {
  br.close();
}

console.log(`\n${pass} đạt, ${fail} lỗi — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
