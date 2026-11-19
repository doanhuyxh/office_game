// E2E TEST-145: giao diện tra soát transcript phiên agent — Kết nối AI → tab "Transcript agent" (chỉ admin / HR).
// Dữ liệu ghi thẳng qua đường nội bộ Api (/api/audit/internal/agent-transcripts, khoá X-Internal-Key — không cần Mcp): bot B1 23 bản việc + 1 chat,
// bot B2 1 họp (bản bàn giao dài, Markdown) + 1 việc không có bản bàn giao → 26 bản.
// Kiểm tra: admin thấy tab, ?tab=transcripts, 20 dòng / "Trang 1 trên 2", cột + nút "Cột", bản bàn giao rút gọn → hộp thoại xem đủ, lọc loại + bot
// (URL ?tkind= / ?bot=, đổi bộ lọc về trang 1, tải lại giữ), tải về (nút loading, đúng tên .jsonl.gz, giải nén = đúng nội dung gốc), bản hết hạn → toast,
// "Làm mới" tải lại danh sách, lỗi + Thử lại, trống theo bộ lọc, theme sáng / tối (ảnh), người thường không có tab (kể cả vào thẳng ?tab=transcripts) + API 403.
// CHỈ DB tạm + S3 tạm (RustFS, như đầu task-comment-files-e2e.ts — nội dung transcript mã hoá lên S3). Api (backend/):
//   env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5245 'ConnectionStrings__Default=Host=127.0.0.1;Port=15445;Database=e2e;Username=e2e;Password=e2e'
//   Encryption__Key=<base64 32 byte> Encryption__PreviousKeys= S3__Region=us-east-1 S3__ServiceUrl=http://127.0.0.1:19445 S3__ForcePathStyle=true S3__AccessKey=… S3__SecretKey=…
//   S3__BucketFiles=e2e-files S3__KeyPrefix=e2e/ Smtp__Host=127.0.0.1 Smtp__Port=1 Sentry__Dsn= Seq__Url= Chat__InternalKey=<≥32> (+ Chat__McpToApiKey cùng giá trị)
//   Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath= Seed__AdminEmail=… Seed__AdminPassword=… dotnet run --project src/OfficeHub.Api --no-launch-profile
// Vite (frontend/): VITE_API_TARGET=http://localhost:5245 bunx vite --port 5185 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5245 BASE_URL=http://localhost:5185 ADMIN_LOGIN=… ADMIN_PASSWORD=… INTERNAL_KEY=… PG_CONTAINER=… SHOTS_DIR=…
//     bun scripts/dev/agent-transcripts-ui-e2e.ts
// Không bật Realtime → lỗi kết nối hub bị bỏ qua.
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5245';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? '';
if (!INTERNAL_KEY) throw new Error('Thiếu INTERNAL_KEY (= Chat__InternalKey của Api tạm)');
const PG = process.env.PG_CONTAINER ?? 'e2e145-pg', PG_USER = process.env.PG_USER ?? 'e2e', PG_DB = process.env.PG_DB ?? 'e2e';
const SHOTS = process.env.SHOTS_DIR;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const psql = async (sql: string) => {
  const p = Bun.spawn(['docker', 'exec', PG, 'psql', '-U', PG_USER, '-d', PG_DB, '-tAc', sql], { stdout: 'pipe', stderr: 'pipe' });
  return (await new Response(p.stdout).text()).trim();
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

// ── Dữ liệu ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV TR ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Transcript ${stamp}`, code: `TR${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, bot = false) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  if (bot) await json(admin, 'PUT', `/api/org/employees/${e.id}/account/bot`, { isBot: true });
  return { e, cookie, user, code, userId: me?.id as string };
};
const H = await mkEmp(`TH${stamp}`.toUpperCase(), 'Người Thường TR', `e2e.tr.h.${stamp}`);
const B1 = await mkEmp(`TB1${stamp}`.toUpperCase(), 'Bot Dev TR', `e2e.tr.b1.${stamp}`, true);
const B2 = await mkEmp(`TB2${stamp}`.toUpperCase(), 'Bot Họp TR', `e2e.tr.b2.${stamp}`, true);
ok('3 tài khoản (người thường + 2 bot)', !!H.userId && !!B1.userId && !!B2.userId);

const jsonl = (key: string) => [
  { type: 'user', message: { role: 'user', content: `Làm việc ${key}` } },
  { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Xong ${key} — tiếng Việt có dấu ✓` }] } },
].map((x) => JSON.stringify(x)).join('\n') + '\n';
const contents = new Map<string, string>();
const ingest = async (userId: string, key: string, kind: string, summary: string | null, branch: string | null) => {
  const text = jsonl(key);
  contents.set(key, text);
  const upload = { key, kind, sessionId: crypto.randomUUID(), cwd: '/srv/work', branch, summary, contentBase64: gzipSync(Buffer.from(text)).toString('base64') };
  const r = await fetch(`${API}/api/audit/internal/agent-transcripts`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': INTERNAL_KEY }, body: JSON.stringify({ userId, upload }) });
  return r.status;
};
const LONG = `## Bàn giao TEST-900\n- Đã làm: thêm tab **Transcript agent**, lọc theo bot + loại, tải về.\n- Đang dở: không.\n- Bước tiếp theo: chờ review.\n\n`
  + 'Chi tiết kiểm tra: build pass, e2e pass, chụp ảnh sáng / tối. '.repeat(6) + 'CUỐI-BẢN-BÀN-GIAO';
// DB tạm: bắt đầu từ bảng trống để số đếm cố định (chạy lại được)
await psql('DELETE FROM audit.agent_transcripts');
const statuses: number[] = [];
for (let i = 0; i < 23; i++) statuses.push(await ingest(B1.userId, `TEST-${100 + i}`, 'task', `Đã xong việc TEST-${100 + i}, commit abc${i}.`, `task/test-${100 + i}`));
statuses.push(await ingest(B1.userId, `${B1.code}:conv-${stamp}`, 'chat', 'Đã trả lời tin nhắn.', null));
statuses.push(await ingest(B2.userId, `TEST-900`, 'task', null, 'main'));
statuses.push(await ingest(B2.userId, `${B2.code}:meet-${stamp}`, 'meeting', LONG, null));
ok('ghi 26 transcript qua đường nội bộ (200)', statuses.every((s) => s === 200), statuses);

// ── API (đã có từ TEST-144 — kiểm lại phạm vi) ──
const all = (await json(admin, 'GET', '/api/agent-transcripts?page=1&pageSize=50')).body;
ok('API admin: 26 bản, mới nhất trước (họp của B2)', all?.total === 26 && all.items[0].kind === 'meeting', { total: all?.total, first: all?.items?.[0]?.kind });
ok('API người thường → 403', (await json(H.cookie, 'GET', '/api/agent-transcripts')).status === 403);

// ── Giao diện ──
type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js).catch(() => false)) return true; await br.sleep(250); } return false; };
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\/|hub|status of 500|status of 404/i.test(e));
const browserLogin = async (br: Br, user: string, password: string, key?: string) => {
  await br.go(`${BASE}/login`, 1500);
  const st = await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  if (st !== 403 || !key) return st;
  for (let i = 0; i < 2; i++) {
    const s2 = await br.evalJs(`fetch('/api/auth/login/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(totp(key))},isRecoveryCode:false,rememberMe:true})}).then(r=>r.status)`);
    if (s2 === 200) return 200;
    await br.sleep(31_000);
    await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  }
  return 0;
};
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`) as { x: number; y: number } | null;
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(350);
};
const rows = `document.querySelectorAll('[data-testid="agent-transcript-row"]').length`;
const rowTexts = `[...document.querySelectorAll('[data-testid="agent-transcript-row"]')].map((r) => r.innerText.replace(/\\s+/g, ' '))`;
const pageLbl = `(document.querySelector('[data-testid="agent-transcript-tab"] [aria-label^="Trang "][aria-label*=" trên "]')?.getAttribute('aria-label') ?? '')`;
const selText = (id: string) => `(document.getElementById('${id}')?.innerText.trim() ?? '')`;
const toasts = `[...document.querySelectorAll('[data-sonner-toast]')].map((t) => t.innerText).join(' | ')`;
/** Bắt link tải (blob) khi bấm nút: trả tên file + nội dung đã giải nén (DecompressionStream gzip). */
const hookDownload = `(() => { window.__dl = null; const a0 = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.href.startsWith('blob:')) { const name = this.download, href = this.href;
    window.__dl = fetch(href).then((r) => r.blob()).then(async (b) => { const head = new Uint8Array(await b.slice(0, 2).arrayBuffer());
      const text = await new Response(b.stream().pipeThrough(new DecompressionStream('gzip'))).text(); return { name, gz: head[0] === 0x1f && head[1] === 0x8b, text }; });
    return; } return a0.call(this); }; return true; })()`;
/** Làm chậm (ms) hoặc làm hỏng (status) request khớp `pattern` trong trang. */
const patchFetch = (pattern: string, mode: { delay?: number; status?: number }) => `(() => { window.__f0 = window.__f0 ?? window.fetch;
  window.fetch = async (u, i) => { const url = typeof u === 'string' ? u : u.url; if (url.includes(${JSON.stringify(pattern)})) {
    ${mode.status ? `return new Response(JSON.stringify({ title: 'Lỗi giả lập' }), { status: ${mode.status}, headers: { 'content-type': 'application/problem+json' } });` : ''}
    await new Promise((r) => setTimeout(r, ${mode.delay ?? 0})); } return window.__f0(u, i); }; return true; })()`;
const unpatchFetch = `(() => { if (window.__f0) window.fetch = window.__f0; return true; })()`;

const br = await launch(9445, `${tmpdir()}/officehub-tr-${Date.now()}`, 1440, 900);
try {
  ok('admin đăng nhập web (2FA)', (await browserLogin(br, ADMIN_LOGIN, ADMIN_PASSWORD, keys[ADMIN_LOGIN])) === 200);
  await br.go(`${BASE}/ai-access`, 2500);
  ok('admin thấy tab "Transcript agent" (sau "Toàn công ty")', await until(br, `(() => { const t = document.querySelector('[data-testid="agent-transcript-tab-trigger"]');
    return !!t && t.innerText.trim() === 'Transcript agent' && t.previousElementSibling?.innerText.trim() === 'Toàn công ty'; })()`));
  await clickAt(br, `document.querySelector('[data-testid="agent-transcript-tab-trigger"]')`);
  ok('bấm tab → ?tab=transcripts, tab tải (chunk riêng)', await until(br, `location.search.includes('tab=transcripts') && !!document.querySelector('[data-testid="agent-transcript-tab"]')`));
  ok('20 dòng, "Trang 1 trên 2", tổng 26', await until(br, `${rows} === 20 && ${pageLbl} === 'Trang 1 trên 2'`)
    && await br.evalJs(`document.querySelector('[data-testid="agent-transcript-tab"]').innerText.includes('26')`), [await br.evalJs(rows), await br.evalJs(pageLbl)]);
  ok('nút "Tạo token" ẩn ở tab này, "Làm mới" vẫn có', await br.evalJs(`![...document.querySelectorAll('button')].some((b) => b.innerText.includes('Tạo token')) && !!document.querySelector('[data-testid="ai-access-reload"]')`));
  const heads = await br.evalJs(`[...document.querySelectorAll('[data-testid="agent-transcript-tab"] thead th')].map((h) => h.innerText.trim()).filter(Boolean)`) as string[];
  ok('cột: Cập nhật · Bot · Loại · Khoá · Nhánh · Bản bàn giao · Kích thước · Hạn xoá', JSON.stringify(heads) === JSON.stringify(['Cập nhật', 'Bot', 'Loại', 'Khoá', 'Nhánh', 'Bản bàn giao', 'Kích thước', 'Hạn xoá']), heads);
  const t0 = await br.evalJs(rowTexts) as string[];
  ok('dòng đầu = họp của B2 (Bot Họp TR, "Họp", khoá, kích thước B, nút Tải về)', /Bot Họp TR/.test(t0[0]) && t0[0].includes('Họp') && t0[0].includes(`meet-${stamp}`) && / B /.test(t0[0] + ' ') && t0[0].includes('Tải về'), t0[0]);
  ok('việc không có bản bàn giao → "—"; dòng việc có nhánh task/test-…', t0[1].includes('TEST-900') && t0[1].includes('—') && t0.some((t) => t.includes('task/test-122')), t0.slice(0, 3));
  const exp = new Date(Date.now() + 90 * 86_400_000).toLocaleDateString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric' });
  ok(`hạn xoá = hôm nay + 90 ngày (${exp})`, t0[0].includes(exp), t0[0]);
  ok('bản bàn giao dài bị rút gọn (line-clamp, không hiện đuôi)', await br.evalJs(`(() => { const b = document.querySelector('[data-testid="agent-transcript-summary"]'); return b.scrollHeight > b.clientHeight + 4; })()`));

  // Xem đủ bản bàn giao
  await clickAt(br, `document.querySelector('[data-testid="agent-transcript-summary"]')`);
  ok('bấm bản bàn giao → hộp thoại: tiêu đề "Bản bàn giao — Họp …", Markdown (tiêu đề + danh sách), đủ tới "CUỐI-BẢN-BÀN-GIAO"', await until(br, `(() => {
    const d = document.querySelector('[data-testid="agent-transcript-summary-dialog"]'); if (!d) return false;
    return d.innerText.includes('Bản bàn giao — Họp') && d.innerText.includes('CUỐI-BẢN-BÀN-GIAO') && !!d.querySelector('h2, h3') && !!d.querySelector('li') && d.innerText.includes('Bot Họp TR'); })()`));
  if (SHOTS) await br.shot(`${SHOTS}/3-summary-dialog.png`);
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  ok('Esc đóng hộp thoại', await until(br, `!document.querySelector('[data-testid="agent-transcript-summary-dialog"]')`));

  // Tải về: loading + đúng file
  await br.evalJs(hookDownload);
  await br.evalJs(patchFetch('/download', { delay: 1500 }));
  const firstTaskIdx = await br.evalJs(`${rowTexts}.findIndex((t) => t.includes('TEST-122'))`) as number;
  await clickAt(br, `document.querySelectorAll('[data-testid="agent-transcript-row"]')[${firstTaskIdx}].querySelector('[data-testid="agent-transcript-download"]')`);
  ok('đang tải: nút dòng đó xoay (aria-busy) + "Đang tải…", nút dòng khác bị khoá', await br.evalJs(`(() => {
    const bs = [...document.querySelectorAll('[data-testid="agent-transcript-download"]')]; const me = bs[${firstTaskIdx}];
    return me.getAttribute('aria-busy') === 'true' && me.innerText.includes('Đang tải') && bs.filter((b) => b !== me).every((b) => b.disabled && b.getAttribute('aria-busy') !== 'true'); })()`));
  ok('tải xong: nút trở lại "Tải về"', await until(br, `document.querySelectorAll('[data-testid="agent-transcript-download"]')[${firstTaskIdx}].getAttribute('aria-busy') !== 'true' && !!window.__dl`, 6000));
  const dl = await br.evalJs(`window.__dl`) as { name: string; gz: boolean; text: string } | null;
  ok('file transcript-task-TEST-122.jsonl.gz, gzip, giải nén = đúng nội dung gốc (có dấu tiếng Việt)', dl?.name === 'transcript-task-TEST-122.jsonl.gz' && dl.gz && dl.text === contents.get('TEST-122'), dl);
  await br.evalJs(unpatchFetch);

  // Bản hết hạn → toast
  await psql(`UPDATE audit.agent_transcripts SET "ExpiresAt" = now() - interval '1 hour' WHERE "Key" = 'TEST-121'`);
  const expIdx = await br.evalJs(`${rowTexts}.findIndex((t) => t.includes('TEST-121'))`) as number;
  await clickAt(br, `document.querySelectorAll('[data-testid="agent-transcript-row"]')[${expIdx}].querySelector('[data-testid="agent-transcript-download"]')`);
  ok('bản đã hết hạn → 404 → toast "đã hết hạn"', await until(br, `${toasts}.includes('hết hạn')`), await br.evalJs(toasts));
  await clickAt(br, `document.querySelector('[data-testid="ai-access-reload"]')`);
  ok('"Làm mới" tải lại đúng tab: còn 25 bản, TEST-121 biến mất', await until(br, `!${rowTexts}.some((t) => t.includes('TEST-121')) && document.querySelector('[data-testid="agent-transcript-tab"]').innerText.includes('25')`));

  // Phân trang
  await clickAt(br, `document.querySelector('[data-testid="agent-transcript-tab"] [aria-label="Trang sau"]')`);
  ok('trang 2: 5 dòng', await until(br, `${pageLbl} === 'Trang 2 trên 2' && ${rows} === 5`), [await br.evalJs(pageLbl), await br.evalJs(rows)]);

  // Lọc loại
  await clickAt(br, `document.getElementById('agent-transcript-kind')`);
  const opts = await br.evalJs(`[...document.querySelectorAll('[role="option"]')].map((o) => o.innerText.trim())`);
  ok('ô Loại: Mọi loại · Việc · Chat · Họp', JSON.stringify(opts) === JSON.stringify(['Mọi loại', 'Việc', 'Chat', 'Họp']), opts);
  await clickAt(br, `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === 'Việc')`);
  ok('từ trang 2 chọn "Việc" → ?tkind=task, về trang 1, 23 bản (20 dòng đều "Việc")', await until(br, `location.search.includes('tkind=task') && ${pageLbl} === 'Trang 1 trên 2' && ${rows} === 20`)
    && await br.evalJs(`${rowTexts}.every((t) => t.includes('Việc'))`), [await br.evalJs('location.search'), await br.evalJs(pageLbl)]);
  await clickAt(br, `document.getElementById('agent-transcript-kind')`);
  await clickAt(br, `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === 'Chat')`);
  ok('"Chat" → 1 dòng (B1)', await until(br, `location.search.includes('tkind=chat') && ${rows} === 1 && ${rowTexts}[0].includes('Bot Dev TR')`));

  // Lọc bot
  await clickAt(br, `document.getElementById('agent-transcript-bot-select')`);
  const botOpts = await br.evalJs(`[...document.querySelectorAll('[role="listbox"] li, [role="listbox"] [role="option"]')].map((o) => o.innerText.trim())`) as string[];
  ok('ô Bot: "Tất cả" + chỉ tài khoản bot (không có người thường)', botOpts.includes('Tất cả') && botOpts.some((o) => o.includes('Bot ')) && !botOpts.some((o) => o.includes(H.code)), botOpts);
  await br.send('Input.insertText', { text: B2.code });
  await br.sleep(300);
  await clickAt(br, `[...document.querySelectorAll('[role="listbox"] li, [role="listbox"] [role="option"]')].find((o) => o.innerText.includes(${JSON.stringify(B2.code)}))`);
  ok('chọn B2 + "Chat" → trống theo bộ lọc', await until(br, `location.search.includes('bot=${B2.userId}') && !!document.querySelector('[data-testid="agent-transcript-empty"]')`)
    && await br.evalJs(`document.querySelector('[data-testid="agent-transcript-empty"]').innerText.includes('khớp bộ lọc')`));
  await clickAt(br, `document.getElementById('agent-transcript-kind')`);
  await clickAt(br, `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === 'Mọi loại')`);
  ok('B2 + Mọi loại → 2 dòng (họp + việc), ô Bot hiện tên B2', await until(br, `!location.search.includes('tkind') && ${rows} === 2`)
    && await br.evalJs(`${selText('agent-transcript-bot-select')}.includes(${JSON.stringify(B2.code)})`), [await br.evalJs(rows), await br.evalJs(selText('agent-transcript-bot-select'))]);
  await br.go(`${BASE}/ai-access?tab=transcripts&bot=${B1.userId}&tkind=chat`, 2500);
  ok('tải lại / gửi link ?bot=&tkind= giữ bộ lọc (1 dòng chat, ô Loại "Chat")', await until(br, `${rows} === 1 && ${selText('agent-transcript-kind')} === 'Chat'`));
  await clickAt(br, `[...document.querySelectorAll('[data-testid="agent-transcript-tab"] button')].find((b) => b.innerText.includes('Bỏ lọc'))`);
  ok('"Bỏ lọc" → bỏ ?bot ?tkind, 20 dòng', await until(br, `!location.search.includes('bot=') && !location.search.includes('tkind=') && ${rows} === 20`));
  await br.go(`${BASE}/ai-access?tab=transcripts&tkind=xyz&bot=abc`, 2500);
  ok('?tkind / ?bot lạ → coi như không lọc (20 dòng, "Mọi loại", "Tất cả")', await until(br, `${rows} === 20 && ${selText('agent-transcript-kind')} === 'Mọi loại' && ${selText('agent-transcript-bot-select')} === 'Tất cả'`));

  // Nút "Cột"
  await clickAt(br, `[...document.querySelectorAll('[data-testid="agent-transcript-tab"] button')].find((b) => b.innerText.trim().startsWith('Cột'))`);
  const colItems = await br.evalJs(`[...document.querySelectorAll('[role="menuitemcheckbox"]')].map((o) => o.innerText.trim())`) as string[];
  ok('nút "Cột" liệt kê 7 cột ẩn được (Cập nhật luôn hiện)', colItems.length === 7 && colItems.includes('Nhánh') && !colItems.includes('Cập nhật'), colItems);
  await clickAt(br, `[...document.querySelectorAll('[role="menuitemcheckbox"]')].find((o) => o.innerText.trim() === 'Nhánh')`);
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  ok('ẩn cột "Nhánh" → tiêu đề không còn, tải lại vẫn ẩn', await until(br, `![...document.querySelectorAll('[data-testid="agent-transcript-tab"] thead th')].some((h) => h.innerText.trim() === 'Nhánh')`)
    && (await br.go(`${BASE}/ai-access?tab=transcripts`, 2500), await until(br, `${rows} === 20 && ![...document.querySelectorAll('[data-testid="agent-transcript-tab"] thead th')].some((h) => h.innerText.trim() === 'Nhánh')`)));
  await br.evalJs(`localStorage.removeItem('officehub.columns.agent-transcripts')`);

  // Đang tải + lỗi + Thử lại: bọc fetch từ đầu trang, điều khiển bằng sessionStorage '__e2e_list' = 'slow' | 'fail' | ''
  const hook = (await br.send('Page.addScriptToEvaluateOnNewDocument', { source: `(() => { const f0 = window.fetch;
    window.fetch = async (u, i) => { const url = typeof u === 'string' ? u : u.url; const m = sessionStorage.getItem('__e2e_list');
      if (url.includes('/api/agent-transcripts?') && m === 'fail') return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
      if (url.includes('/api/agent-transcripts?') && m === 'slow') await new Promise((r) => setTimeout(r, 2500));
      return f0(u, i); }; })()` })).result?.identifier;
  await br.evalJs(`sessionStorage.setItem('__e2e_list', 'slow')`);
  await br.go(`${BASE}/ai-access?tab=transcripts&tkind=meeting`, 900);
  ok('đang tải: vòng xoay trong bảng', await until(br, `!!document.querySelector('[data-testid="agent-transcript-loading"]')`, 3000));
  ok('tải xong: 1 dòng họp', await until(br, `${rows} === 1`));
  await br.evalJs(`sessionStorage.setItem('__e2e_list', 'fail')`);
  await br.go(`${BASE}/ai-access?tab=transcripts&tkind=meeting`, 500);
  ok('lỗi tải danh sách → thông báo đỏ + "Thử lại" (sau các lần thử lại của react-query)', await until(br, `!!document.querySelector('[data-testid="agent-transcript-error"]')`, 20000)
    && await br.evalJs(`document.querySelector('[data-testid="agent-transcript-error"]').innerText.includes('Thử lại') && ${rows} === 0`));
  await br.evalJs(`sessionStorage.removeItem('__e2e_list')`);
  await clickAt(br, `[...document.querySelectorAll('[data-testid="agent-transcript-error"] button')].find((b) => b.innerText.includes('Thử lại'))`);
  ok('Thử lại → 1 dòng họp', await until(br, `${rows} === 1 && ${rowTexts}[0].includes('Họp')`));
  await br.evalJs(`sessionStorage.setItem('__e2e_list', 'fail')`);
  await clickAt(br, `document.getElementById('agent-transcript-kind')`);
  await clickAt(br, `[...document.querySelectorAll('[role="option"]')].find((o) => o.innerText.trim() === 'Chat')`);
  ok('đổi bộ lọc mà lỗi → báo lỗi, không giữ dòng cũ (họp) như kết quả mới', await until(br, `!!document.querySelector('[data-testid="agent-transcript-error"]') && ${rows} === 0`, 20000));
  await br.evalJs(`sessionStorage.removeItem('__e2e_list')`);
  if (hook) await br.send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook });

  // Ảnh sáng / tối
  await br.go(`${BASE}/ai-access?tab=transcripts`, 2500);
  await until(br, `${rows} === 20`);
  if (SHOTS) {
    await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1250, deviceScaleFactor: 1, mobile: false });
    await br.evalJs(`document.documentElement.classList.remove('dark')`);
    await br.sleep(500);
    await br.shot(`${SHOTS}/1-transcripts-light.png`);
    await br.evalJs(`document.documentElement.classList.add('dark')`);
    await br.sleep(500);
    await br.shot(`${SHOTS}/2-transcripts-dark.png`);
    await br.evalJs(`document.documentElement.classList.remove('dark')`);
    await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  }
  ok('không lỗi JS (admin)', jsErr(br.errors).length === 0, jsErr(br.errors));
} finally { br.close(); }

// Người thường: không có tab, vào thẳng ?tab=transcripts không hiện nội dung
const bh = await launch(9446, `${tmpdir()}/officehub-tr-h-${Date.now()}`, 1440, 900);
try {
  ok('người thường đăng nhập web', (await browserLogin(bh, H.user, PW)) === 200);
  await bh.go(`${BASE}/ai-access?tab=transcripts`, 3000);
  ok('người thường: không có tab "Transcript agent", ?tab=transcripts → tab "Của tôi", không có nội dung transcript',
    await until(bh, `!!document.querySelector('[role="tab"][aria-selected="true"]') && document.querySelector('[role="tab"][aria-selected="true"]').innerText.includes('Của tôi')`)
    && await bh.evalJs(`!document.querySelector('[data-testid="agent-transcript-tab-trigger"]') && !document.querySelector('[data-testid="agent-transcript-tab"]')`));
  ok('người thường: không gọi /api/agent-transcripts', await bh.evalJs(`!performance.getEntriesByType('resource').some((e) => e.name.includes('/api/agent-transcripts'))`));
  ok('không lỗi JS (người thường)', jsErr(bh.errors).length === 0, jsErr(bh.errors));
} finally { bh.close(); }

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
