// E2E TEST-197: xem nhanh transcript phiên agent ngay trên web — Kết nối AI → tab "Transcript agent" → nút "Xem" (chỉ admin / HR).
// Dữ liệu ghi qua đường nội bộ Api (/api/audit/internal/agent-transcripts, X-Internal-Key): bot B1 — phiên adapter `claude` mẫu (prompt dài, assistant
// Markdown, suy nghĩ có / không nội dung, Bash, Edit diff, Read, MCP, kết quả dài > 4000 ký tự, kết quả lỗi, agent con, bản ghi nội bộ, dòng hỏng),
// phiên adapter khác (codex-like → JSON thô), phiên lớn (~24k lượt, cuộn ảo), phiên vượt ngưỡng (> 3 MB nén), phiên sẽ hết hạn.
// Kiểm tra: từng loại lượt đúng nhãn / nội dung, thu gọn sẵn + mở / thu, "Xem đủ", lọc loại lượt, tìm, Về đầu / Xuống cuối, tổng số lượt,
// JSON thô không vỡ trang, file lớn: số nút DOM ít + cuộn tới giữa / cuối + đo thời gian tải, file vượt ngưỡng → thông báo + Tải về + "Vẫn mở",
// bản hết hạn → báo lỗi rõ, lỗi giải nén → báo + Thử lại, không lưu vào localStorage / sessionStorage, ảnh sáng / tối, người thường không có tab + API 403.
// Tuỳ chọn MEASURE_FILE=<.jsonl thật> → ghi thêm bản đó, đo thời gian mở (chỉ in số đo, không tính đạt / trượt).
// CHỈ DB tạm + S3 tạm (RustFS) — dựng Api / Vite như đầu agent-transcripts-ui-e2e.ts, rồi:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5247 BASE_URL=http://localhost:5187 ADMIN_LOGIN=… ADMIN_PASSWORD=… INTERNAL_KEY=… PG_CONTAINER=… SHOTS_DIR=…
//     bun scripts/dev/agent-transcript-viewer-e2e.ts
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5247';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? '';
if (!INTERNAL_KEY) throw new Error('Thiếu INTERNAL_KEY (= Chat__InternalKey của Api tạm)');
const PG = process.env.PG_CONTAINER ?? 'e2e197-pg', PG_USER = process.env.PG_USER ?? 'e2e', PG_DB = process.env.PG_DB ?? 'e2e';
const SHOTS = process.env.SHOTS_DIR;
const MEASURE_FILE = process.env.MEASURE_FILE;
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

// ── Tài khoản ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV TV ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Transcript xem ${stamp}`, code: `TV${stamp}` })).body;
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
const H = await mkEmp(`VH${stamp}`.toUpperCase(), 'Người Thường TV', `e2e.tv.h.${stamp}`);
const B1 = await mkEmp(`VB1${stamp}`.toUpperCase(), 'Bot Dev TV', `e2e.tv.b1.${stamp}`, true);
ok('2 tài khoản (người thường + bot)', !!H.userId && !!B1.userId);

// ── Transcript mẫu ──
const ts = (s: number) => new Date(Date.UTC(2026, 10, 19, 3, 0, s)).toISOString();
const L = (o: unknown) => JSON.stringify(o);
const PROMPT = Array.from({ length: 20 }, (_, i) => `Dòng ${i + 1} của prompt runner — làm việc TEST-900.`).join('\n');
const LONG_RESULT = 'Kết quả dài: ' + 'abcdefghij '.repeat(600) + 'ĐUÔI-KẾT-QUẢ';
const claudeLines = [
  L({ type: 'queue-operation', operation: 'enqueue', timestamp: ts(0), content: 'prompt' }),
  L({ type: 'user', timestamp: ts(1), uuid: 'u1', message: { role: 'user', content: PROMPT } }),
  L({ type: 'assistant', timestamp: ts(2), message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'Mình cần đọc AGENTS.md trước. SUY-NGHĨ-MẪU' }] } }),
  L({ type: 'assistant', timestamp: ts(3), message: { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'AAAA' }] } }),
  L({ type: 'assistant', timestamp: ts(4), message: { role: 'assistant', content: [{ type: 'text', text: '## Kế hoạch\n- Đọc **AGENTS.md**\n- Sửa `index.tsx`' }] } }),
  L({ type: 'assistant', timestamp: ts(5), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_bash', name: 'Bash', input: { command: 'cd frontend && bun run build', description: 'Build frontend' } }] } }),
  L({ type: 'user', timestamp: ts(6), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_bash', content: '✓ built in 1.34s\nKẾT-QUẢ-BUILD' }] } }),
  L({ type: 'assistant', timestamp: ts(7), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_edit', name: 'Edit', input: { file_path: 'frontend/src/a.ts', old_string: 'const a = 1;', new_string: 'const a = 2;\nconst b = 3;' } }] } }),
  L({ type: 'user', timestamp: ts(8), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_edit', content: [{ type: 'text', text: 'The file has been updated.' }] }] } }),
  L({ type: 'assistant', timestamp: ts(9), message: { role: 'assistant', content: [
    { type: 'text', text: 'Đọc task.' },
    { type: 'tool_use', id: 'toolu_mcp', name: 'mcp__officehub__get_task', input: { task: 'TEST-900' } },
  ] } }),
  L({ type: 'user', timestamp: ts(10), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_mcp', content: LONG_RESULT }] } }),
  L({ type: 'assistant', timestamp: ts(11), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_read', name: 'Read', input: { file_path: 'AGENTS.md', offset: 1, limit: 50 } }] } }),
  L({ type: 'user', timestamp: ts(12), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_read', is_error: true, content: 'File does not exist. LỖI-ĐỌC' }] } }),
  L({ type: 'assistant', timestamp: ts(13), isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'Lời agent con SIDECHAIN' }] } }),
  L({ type: 'api-request', timestamp: ts(14), params: { model: 'x' } }),
  L({ type: 'attachment', timestamp: ts(15), attachment: { type: 'environment' } }),
  L({ type: 'loai-moi-chua-biet', timestamp: ts(16), data: { x: 1 } }),
  '{ dòng này không phải JSON <script>alert(1)</script>',
  L({ type: 'assistant', timestamp: ts(17), message: { role: 'assistant', content: [{ type: 'text', text: 'Đã xong — MARKER-CUỐI <img src=x onerror=alert(1)>' }] } }),
  L({ type: 'last-prompt', lastPrompt: 'x' }),
];
const claudeJsonl = claudeLines.join('\n') + '\n';
const codexJsonl = [
  L({ timestamp: ts(1), type: 'session_meta', payload: { id: 'abc', cwd: '/srv' } }),
  L({ timestamp: ts(2), type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'CODEX-PROMPT' }] } }),
  L({ timestamp: ts(3), type: 'event_msg', payload: { type: 'agent_message', message: 'CODEX-REPLY' } }),
  L([1, 2, 3]),
  L('chuỗi trần'),
  'null',
].join('\n') + '\n';
// Phiên lớn: 6000 vòng × (assistant + tool_use + tool_result + thinking) ≈ 24k lượt
const big: string[] = [L({ type: 'user', timestamp: ts(0), message: { role: 'user', content: 'Bắt đầu phiên lớn — LỚN-ĐẦU' } })];
for (let i = 0; i < 6000; i++) {
  big.push(L({ type: 'assistant', timestamp: ts(i), message: { role: 'assistant', content: [{ type: 'thinking', thinking: `Suy nghĩ ${i} ` + 'x'.repeat(i % 200) }] } }));
  big.push(L({ type: 'assistant', timestamp: ts(i), message: { role: 'assistant', content: [{ type: 'text', text: `Vòng **${i}**: ${randomBytes(24).toString('hex')}` }] } }));
  big.push(L({ type: 'assistant', timestamp: ts(i), message: { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'Bash', input: { command: `echo ${i} ${randomBytes(16).toString('hex')}` } }] } }));
  big.push(L({ type: 'user', timestamp: ts(i), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: `${i}\n`.repeat(1 + (i % 30)) + randomBytes(48).toString('base64') }] } }));
}
big.push(L({ type: 'assistant', timestamp: ts(9999), message: { role: 'assistant', content: [{ type: 'text', text: 'Kết thúc phiên lớn — LỚN-CUỐI' }] } }));
const bigJsonl = big.join('\n') + '\n';
// Vượt ngưỡng: dữ liệu khó nén (base64 ngẫu nhiên) > 3 MB sau gzip
const hugeJsonl = Array.from({ length: 64 }, (_, i) => L({ type: 'user', message: { role: 'user', content: `${i} ` + randomBytes(52_000).toString('base64') } })).join('\n') + '\n';

const gz = new Map<string, number>();
const ingest = async (key: string, kind: string, text: string, summary: string | null) => {
  const g = gzipSync(Buffer.from(text));
  gz.set(key, g.length);
  const upload = { key, kind, sessionId: crypto.randomUUID(), cwd: '/srv/work', branch: 'main', summary, contentBase64: g.toString('base64') };
  const r = await fetch(`${API}/api/audit/internal/agent-transcripts`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': INTERNAL_KEY }, body: JSON.stringify({ userId: B1.userId, upload }) });
  if (r.status !== 200) console.log(key, r.status, (await r.text()).slice(0, 300));
  return r.status;
};
await psql('DELETE FROM audit.agent_transcripts');
const st: number[] = [];
if (MEASURE_FILE) st.push(await ingest('REAL-1', 'task', readFileSync(MEASURE_FILE, 'utf8'), 'Bản thật để đo'));
st.push(await ingest('EXP-1', 'task', claudeJsonl, 'Sẽ hết hạn'));
st.push(await ingest('HUGE-1', 'task', hugeJsonl, 'Vượt ngưỡng'));
st.push(await ingest('BIG-1', 'task', bigJsonl, 'Phiên lớn'));
st.push(await ingest(`${B1.code}:codex`, 'chat', codexJsonl, 'Adapter khác'));
st.push(await ingest('TEST-900', 'task', claudeJsonl, 'Phiên claude mẫu'));
ok('ghi transcript mẫu qua đường nội bộ (200)', st.every((s) => s === 200), st);
console.log(`  kích thước nén: ${[...gz].map(([k, v]) => `${k}=${(v / 1024).toFixed(0)} KB`).join(' · ')} (chữ: lớn ${(bigJsonl.length / 1048576).toFixed(1)} MB)`);
ok('HUGE-1 > 3 MB nén, BIG-1 ≤ 3 MB nén', gz.get('HUGE-1')! > 3 * 1048576 && gz.get('BIG-1')! <= 3 * 1048576, [...gz]);

// ── Giao diện ──
type Br = Awaited<ReturnType<typeof launch>>;
const until = async (br: Br, js: string, ms = 8000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js).catch(() => false)) return true; await br.sleep(250); } return false; };
const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\/|hub|status of 500|status of 404/i.test(e));
const browserLogin = async (br: Br, user: string, password: string, key?: string) => {
  await br.go(`${BASE}/login`, 1500);
  const s = await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  if (s !== 403 || !key) return s;
  for (let i = 0; i < 2; i++) {
    const s2 = await br.evalJs(`fetch('/api/auth/login/2fa',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(totp(key))},isRecoveryCode:false,rememberMe:true})}).then(r=>r.status)`);
    if (s2 === 200) return 200;
    await br.sleep(31_000);
    await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(user)},password:${JSON.stringify(password)}})}).then(r=>r.status)`);
  }
  return 0;
};
const clickAt = async (br: Br, expr: string) => {
  const r = await br.evalJs(`(() => { const e = ${expr}; if (!e) return null; e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`) as { x: number; y: number } | null;
  if (!r) throw new Error(`Không thấy phần tử: ${expr}`);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'] as const)
    await br.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  await br.sleep(300);
};
const V = `document.querySelector('[data-testid="transcript-viewer"]')`;
const rowOf = (key: string) => `[...document.querySelectorAll('[data-testid="agent-transcript-row"]')].find((r) => r.innerText.includes(${JSON.stringify(key)}))`;
const openView = async (br: Br, key: string) => {
  await clickAt(br, `${rowOf(key)}?.querySelector('[data-testid="agent-transcript-view"]')`);
  return until(br, `!!${V}`);
};
const closeView = async (br: Br) => {
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
  await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape' });
  return until(br, `!${V}`);
};
const turnsJs = `[...${V}.querySelectorAll('[data-testid="transcript-turn"]')]`;
const turnBy = (text: string) => `${turnsJs}.find((t) => t.innerText.includes(${JSON.stringify(text)}))`;
const countText = `(${V}?.querySelector('[data-testid="transcript-count"]')?.innerText ?? '')`;
const kindBtn = (k: string) => `${V}.querySelector('[data-testid="transcript-kind"][data-kind="${k}"]')`;
const typeSearch = async (br: Br, text: string) => {
  await br.evalJs(`(() => { const i = ${V}.querySelector('[data-testid="transcript-search"]'); i.focus(); i.select(); return true; })()`);
  await br.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await br.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  if (text) await br.send('Input.insertText', { text });
  await br.sleep(500);
};
const done = `!!${V}?.querySelector('[data-testid="transcript-scroll"]')`;

const br = await launch(9447, `${tmpdir()}/officehub-tv-${Date.now()}`, 1440, 900);
try {
  ok('admin đăng nhập web (2FA)', (await browserLogin(br, ADMIN_LOGIN, ADMIN_PASSWORD, keys[ADMIN_LOGIN])) === 200);
  await br.go(`${BASE}/ai-access?tab=transcripts`, 2500);
  ok('bảng có nút "Xem" cạnh "Tải về" ở mỗi dòng', await until(br, `(() => { const rs = [...document.querySelectorAll('[data-testid="agent-transcript-row"]')];
    return rs.length >= 5 && rs.every((r) => { const v = r.querySelector('[data-testid="agent-transcript-view"]'), d = r.querySelector('[data-testid="agent-transcript-download"]');
      return v && d && v.innerText.trim() === 'Xem' && v.nextElementSibling === d; }); })()`));

  // ── Phiên claude mẫu ──
  ok('bấm "Xem" → hộp thoại "Transcript — Việc TEST-900"', await openView(br, 'TEST-900') && await br.evalJs(`${V}.innerText.includes('Transcript — Việc TEST-900')`));
  ok('tải xong → danh sách lượt', await until(br, done));
  const kinds = await br.evalJs(`${turnsJs}.map((t) => t.dataset.kind)`) as string[];
  ok('thứ tự lượt claude (bản ghi nội bộ ẩn sẵn): user, thinking×2, assistant, tool_call/result Bash, Edit, assistant + MCP, Read lỗi, agent con, raw×2, assistant',
    JSON.stringify(kinds) === JSON.stringify(['user', 'thinking', 'thinking', 'assistant', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'assistant', 'tool_call', 'tool_result', 'tool_call', 'tool_result', 'assistant', 'raw', 'raw', 'assistant']), kinds);
  ok('đếm: "Đang hiện 17 / 21 lượt" (4 bản ghi Hệ thống ẩn)', (await br.evalJs(countText)) === 'Đang hiện 17 / 21 lượt', await br.evalJs(countText));
  const chips = await br.evalJs(`[...${V}.querySelectorAll('[data-testid="transcript-kind"]')].map((b) => b.dataset.kind + ':' + b.getAttribute('aria-pressed') + ':' + b.innerText.replace(/\\s+/g, ' '))`) as string[];
  ok('bộ lọc loại lượt có số đếm, "Hệ thống" tắt sẵn', JSON.stringify(chips) === JSON.stringify(['user:true:Người dùng 1', 'assistant:true:Assistant 4', 'thinking:true:Suy nghĩ 2',
    'tool_call:true:Gọi tool 4', 'tool_result:true:Kết quả tool 4', 'meta:false:Hệ thống 4', 'raw:true:Khác (JSON thô) 2']), chips);
  ok('người dùng: mở sẵn, 12 dòng đầu + "Xem cả 20 dòng"', await br.evalJs(`(() => { const t = ${turnBy('Dòng 1 của prompt')}; return t.hasAttribute('data-open')
    && t.innerText.includes('Dòng 12 của') && !t.innerText.includes('Dòng 13 của') && t.innerText.includes('Xem cả 20 dòng'); })()`));
  await clickAt(br, `${turnBy('Dòng 1 của prompt')}.querySelector('[data-testid="transcript-turn-more"]')`);
  ok('bấm "Xem cả 20 dòng" → hiện đủ tới Dòng 20', await until(br, `${turnBy('Dòng 1 của prompt')}.innerText.includes('Dòng 20 của')`));
  ok('assistant: Markdown (tiêu đề + danh sách + chữ đậm), mở sẵn', await br.evalJs(`(() => { const t = ${turnBy('Kế hoạch')}; return t.hasAttribute('data-open') && !!t.querySelector('h2, h3') && !!t.querySelector('li strong'); })()`));
  ok('assistant: chuỗi <img onerror> chỉ là chữ (không có thẻ img)', await br.evalJs(`(() => { const t = ${turnBy('MARKER-CUỐI')}; return !t.querySelector('img'); })()`));
  ok('suy nghĩ: thu gọn sẵn, dòng xem trước có chữ', await br.evalJs(`(() => { const t = ${turnBy('SUY-NGHĨ-MẪU')}; return !t.hasAttribute('data-open') && !t.querySelector('[data-testid="transcript-turn-body"]'); })()`));
  const thinkEmpty = `${turnsJs}.filter((t) => t.dataset.kind === 'thinking')[1]`;
  await clickAt(br, `${thinkEmpty}.querySelector('[data-testid="transcript-turn-head"]')`);
  ok('suy nghĩ không lưu nội dung → mở ra báo "Không lưu nội dung suy nghĩ"', await until(br, `${thinkEmpty}.innerText.includes('Không lưu nội dung suy nghĩ')`));
  const bash = `${turnsJs}.find((t) => t.dataset.kind === 'tool_call' && t.innerText.includes('Bash'))`;
  ok('gọi tool Bash: thu gọn sẵn, đầu lượt có tên tool + lệnh', await br.evalJs(`(() => { const t = ${bash}; return !t.hasAttribute('data-open') && t.innerText.includes('cd frontend && bun run build'); })()`));
  await clickAt(br, `${bash}.querySelector('[data-testid="transcript-turn-head"]')`);
  ok('bấm → mở: mô tả + khung lệnh "$ cd frontend…", aria-expanded=true', await until(br, `(() => { const t = ${bash}; const b = t.querySelector('[data-testid="transcript-turn-body"]');
    return !!b && b.innerText.includes('Build frontend') && b.innerText.includes('$ cd frontend && bun run build') && t.querySelector('[data-testid="transcript-turn-head"]').getAttribute('aria-expanded') === 'true'; })()`));
  await clickAt(br, `${bash}.querySelector('[data-testid="transcript-turn-head"]')`);
  ok('bấm lại → thu gọn', await until(br, `!${bash}.hasAttribute('data-open')`));
  const edit = `${turnsJs}.find((t) => t.dataset.kind === 'tool_call' && t.innerText.includes('frontend/src/a.ts'))`;
  await clickAt(br, `${edit}.querySelector('[data-testid="transcript-turn-head"]')`);
  ok('gọi tool Edit: đường dẫn + diff (-1 dòng đỏ, +2 dòng xanh)', await until(br, `(() => { const t = ${edit}; const sp = [...t.querySelectorAll('pre span')].map((s) => s.innerText.trim());
    return JSON.stringify(sp) === JSON.stringify(['-const a = 1;', '+const a = 2;', '+const b = 3;']) && t.querySelector('pre span').className.includes('text-destructive'); })()`));
  const mcpRes = `${turnsJs}.find((t) => t.dataset.kind === 'tool_result' && t.innerText.includes('get_task'))`;
  ok('kết quả tool biết tên tool (officehub · get_task), thu gọn sẵn', await br.evalJs(`(() => { const t = ${mcpRes}; return !!t && !t.hasAttribute('data-open') && t.innerText.includes('officehub · get_task'); })()`));
  await clickAt(br, `${mcpRes}.querySelector('[data-testid="transcript-turn-head"]')`);
  ok('kết quả dài: cắt ở 4000 ký tự + "Xem đủ (… ký tự)", chưa có đuôi', await until(br, `(() => { const t = ${mcpRes}; const m = t.querySelector('[data-testid="transcript-turn-more"]');
    return !!m && /Xem đủ \\(6[.,]?6\\d\\d ký tự\\)/.test(m.innerText) && !t.innerText.includes('ĐUÔI-KẾT-QUẢ'); })()`), await br.evalJs(`${mcpRes}.innerText.slice(-80)`));
  await clickAt(br, `${mcpRes}.querySelector('[data-testid="transcript-turn-more"]')`);
  ok('bấm "Xem đủ" → có đuôi kết quả, nút thành "Thu gọn"', await until(br, `${mcpRes}.innerText.includes('ĐUÔI-KẾT-QUẢ') && ${mcpRes}.querySelector('[data-testid="transcript-turn-more"]').innerText === 'Thu gọn'`));
  ok('kết quả tool lỗi: nhãn "Kết quả tool · lỗi" (màu đỏ)', await br.evalJs(`(() => { const t = ${turnsJs}.find((t) => t.dataset.kind === 'tool_result' && t.innerText.includes('Read'));
    return !!t && t.innerText.includes('Kết quả tool · lỗi') && t.className.includes('border-l-destructive'); })()`));
  ok('lượt agent con có nhãn "agent con"', await br.evalJs(`${turnBy('SIDECHAIN')}.innerText.includes('agent con')`));
  const raws = `${turnsJs}.filter((t) => t.dataset.kind === 'raw')`;
  ok('loại sự kiện lạ + dòng không phải JSON → "Khác (JSON thô)", thu gọn, không chạy <script>', await br.evalJs(`(() => { const r = ${raws};
    return r.length === 2 && r[0].innerText.includes('loai-moi-chua-biet') && r[1].innerText.includes('Không phải JSON') && !document.querySelector('[data-testid="transcript-viewer"] script'); })()`));
  await clickAt(br, `${raws}[0].querySelector('[data-testid="transcript-turn-head"]')`);
  ok('mở JSON thô → JSON thụt lề', await until(br, `${raws}[0].querySelector('pre')?.innerText.includes('"data": {')`));

  // Lọc + tìm
  await clickAt(br, kindBtn('meta'));
  ok('bật "Hệ thống" → 21 / 21 lượt, có api-request', await until(br, `${countText} === '21 lượt' && !!${turnBy('api-request')}`), await br.evalJs(countText));
  await clickAt(br, kindBtn('tool_result'));
  await clickAt(br, kindBtn('tool_call'));
  ok('tắt "Gọi tool" + "Kết quả tool" → 13 lượt, không còn lượt tool', await until(br, `${countText} === 'Đang hiện 13 / 21 lượt' && !${turnsJs}.some((t) => t.dataset.kind.startsWith('tool'))`), await br.evalJs(countText));
  await clickAt(br, kindBtn('tool_result'));
  await clickAt(br, kindBtn('tool_call'));
  await typeSearch(br, 'kết-quả-build');
  ok('tìm "kết-quả-build" (không phân biệt hoa thường) → 1 lượt (kết quả Bash)', await until(br, `${countText} === 'Đang hiện 1 / 21 lượt' && ${turnsJs}.length === 1 && ${turnsJs}[0].dataset.kind === 'tool_result'`), await br.evalJs(countText));
  await typeSearch(br, 'officehub');
  ok('tìm theo tên tool "officehub" → gọi + kết quả get_task', await until(br, `${countText} === 'Đang hiện 2 / 21 lượt'`), await br.evalJs(countText));
  await typeSearch(br, 'không-có-chữ-này');
  ok('không khớp → "Không có lượt nào khớp…"', await until(br, `!!${V}.querySelector('[data-testid="transcript-no-match"]')`));
  await typeSearch(br, '');
  ok('xoá ô tìm → lại 21 lượt', await until(br, `${countText} === '21 lượt'`));
  await clickAt(br, kindBtn('meta'));
  ok('không lưu nội dung vào localStorage / sessionStorage', await br.evalJs(`![...Object.values(localStorage), ...Object.values(sessionStorage)].some((v) => String(v).includes('SUY-NGHĨ-MẪU') || String(v).includes('KẾT-QUẢ-BUILD'))`));
  if (SHOTS) {
    // thu prompt dài + kết quả dài về dạng cắt, mở lệnh Bash → ảnh thấy đủ loại lượt
    await clickAt(br, `${turnBy('Dòng 1 của prompt')}.querySelector('[data-testid="transcript-turn-more"]')`);
    await clickAt(br, `${mcpRes}.querySelector('[data-testid="transcript-turn-head"]')`);
    await clickAt(br, `${bash}.querySelector('[data-testid="transcript-turn-head"]')`);
    await br.evalJs(`${V}.querySelector('[data-testid="transcript-scroll"]').scrollTop = 330`);
    const scheme = (v: string) => br.evalJs(`(() => { const r = document.documentElement; r.classList.toggle('dark', ${v === 'dark'}); r.classList.toggle('light', ${v !== 'dark'}); return true; })()`);
    await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
    await scheme('light');
    await br.sleep(400);
    await br.shot(`${SHOTS}/1-viewer-light.png`);
    await br.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    await scheme('dark');
    await br.sleep(400);
    await br.shot(`${SHOTS}/2-viewer-dark.png`);
    await br.send('Emulation.setEmulatedMedia', { features: [] });
  }
  ok('Esc đóng bảng xem', await closeView(br));

  // ── Adapter khác ──
  ok('phiên adapter khác: mở được', await openView(br, ':codex') && await until(br, done));
  ok('mọi dòng → "Khác (JSON thô)", 6 lượt, không lỗi', await br.evalJs(`${turnsJs}.length === 6 && ${turnsJs}.every((t) => t.dataset.kind === 'raw') && ${countText} === '6 lượt'`), await br.evalJs(countText));
  ok('dòng xem trước có nội dung gốc (CODEX-PROMPT, event_msg)', await br.evalJs(`${V}.innerText.includes('CODEX-PROMPT') && ${V}.innerText.includes('event_msg')`));
  ok('Esc đóng', await closeView(br));

  // ── Phiên lớn ──
  const t0 = Date.now();
  await openView(br, 'BIG-1');
  ok('phiên lớn: tải + giải nén xong', await until(br, done, 30_000));
  const loadMs = await br.evalJs(`${V}.querySelector('[data-testid="transcript-load-ms"]')?.innerText ?? ''`);
  console.log(`  phiên lớn (${(bigJsonl.length / 1048576).toFixed(1)} MB chữ, ${(gz.get('BIG-1')! / 1048576).toFixed(2)} MB nén): ${loadMs.trim()} · bấm → xong ${Date.now() - t0} ms`);
  ok('phiên lớn: 24 002 lượt; chỉ dựng ≤ 80 lượt trong DOM', await br.evalJs(`${countText}.replace(/\\D/g, '') === '24002' && ${turnsJs}.length <= 80`), [await br.evalJs(countText), await br.evalJs(`${turnsJs}.length`)]);
  const scroller = `${V}.querySelector('[data-testid="transcript-scroll"]')`;
  // cuộn liên tục 2 giây, đo khung hình
  const fps = await br.evalJs(`new Promise((res) => { const el = ${scroller}; let n = 0, worst = 0, last = performance.now(); const t0 = last;
    const step = (now) => { worst = Math.max(worst, now - last); last = now; n++; el.scrollTop += 400; if (now - t0 < 2000) requestAnimationFrame(step); else res({ fps: Math.round(n * 1000 / (now - t0)), worst: Math.round(worst), top: el.scrollTop }); };
    requestAnimationFrame(step); })`) as { fps: number; worst: number; top: number };
  console.log(`  cuộn 2 giây (400 px / khung): ${fps.fps} khung/giây, khung chậm nhất ${fps.worst} ms`);
  ok('cuộn mượt: ≥ 30 khung/giây khi cuộn liên tục, vẫn ≤ 80 lượt trong DOM', fps.fps >= 30 && await br.evalJs(`${turnsJs}.length <= 80`), fps);
  await clickAt(br, `${V}.querySelector('[data-testid="transcript-bottom"]')`);
  await br.sleep(400);
  ok('"Xuống cuối" → thấy LỚN-CUỐI', await until(br, `!!${turnBy('LỚN-CUỐI')}`));
  await clickAt(br, `${V}.querySelector('[data-testid="transcript-top"]')`);
  ok('"Về đầu" → thấy LỚN-ĐẦU', await until(br, `!!${turnBy('LỚN-ĐẦU')} && ${scroller}.scrollTop === 0`));
  await typeSearch(br, 'vòng **5999**');
  ok('tìm trong phiên lớn → 1 lượt', await until(br, `${countText} === 'Đang hiện 1 / 24.002 lượt' || ${countText} === 'Đang hiện 1 / 24,002 lượt'`, 10_000), await br.evalJs(countText));
  ok('Esc đóng', await closeView(br));

  // ── Vượt ngưỡng ──
  await openView(br, 'HUGE-1');
  ok('vượt ngưỡng: không tự tải — thông báo + nút Tải về + "Vẫn mở trên web"', await until(br, `(() => { const b = ${V}.querySelector('[data-testid="transcript-too-big"]');
    return !!b && b.innerText.includes('lớn hơn ngưỡng xem nhanh 3 MB') && !!b.querySelector('[data-testid="transcript-viewer-download"]') && !!b.querySelector('[data-testid="transcript-force-open"]'); })()`),
    await br.evalJs(`${V}.innerText`));
  ok('vượt ngưỡng: chưa gọi /download', await br.evalJs(`!performance.getEntriesByType('resource').some((e) => e.name.includes('/download') && e.startTime > performance.now() - 3000)`));
  await clickAt(br, `${V}.querySelector('[data-testid="transcript-force-open"]')`);
  ok('"Vẫn mở trên web" → tải được, 64 lượt', await until(br, `${done} && ${countText} === '64 lượt'`, 30_000), await br.evalJs(countText));
  console.log(`  phiên vượt ngưỡng (${(gz.get('HUGE-1')! / 1048576).toFixed(2)} MB nén): ${await br.evalJs(`${V}.querySelector('[data-testid="transcript-load-ms"]')?.innerText ?? ''`)}`);
  ok('Esc đóng', await closeView(br));

  // ── Lỗi giải nén + Thử lại ──
  await br.evalJs(`(() => { window.__f0 = window.__f0 ?? window.fetch; window.fetch = async (u, i) => { const url = typeof u === 'string' ? u : u.url;
    if (url.includes('/download') && sessionStorage.getItem('__bad') === '1') return new Response(new Uint8Array([0x1f, 0x8b, 8, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), { status: 200, headers: { 'content-type': 'application/gzip' } });
    return window.__f0(u, i); }; sessionStorage.setItem('__bad', '1'); return true; })()`);
  await openView(br, 'TEST-900');
  ok('gzip hỏng → "Không giải nén / đọc được…" + Thử lại + Tải về', await until(br, `(() => { const e = ${V}.querySelector('[data-testid="transcript-error"]');
    return !!e && e.innerText.includes('Không giải nén / đọc được') && e.innerText.includes('Thử lại') && !!e.querySelector('[data-testid="transcript-viewer-download"]'); })()`));
  await br.evalJs(`sessionStorage.removeItem('__bad')`);
  await clickAt(br, `[...${V}.querySelectorAll('button')].find((b) => b.innerText.includes('Thử lại'))`);
  ok('Thử lại → tải được', await until(br, `${done} && ${countText} === 'Đang hiện 17 / 21 lượt'`));
  ok('Esc đóng', await closeView(br));

  // ── Đang tải (chậm) ──
  await br.evalJs(`(() => { const f = window.fetch; window.fetch = async (u, i) => { const url = typeof u === 'string' ? u : u.url;
    if (url.includes('/download')) await new Promise((r) => setTimeout(r, 1500)); return f(u, i); }; return true; })()`);
  await openView(br, 'TEST-900');
  ok('đang tải: "Đang tải và giải nén…" + thanh tiến độ', await until(br, `!!${V}.querySelector('[data-testid="transcript-loading"]') && ${V}.innerText.includes('Đang tải và giải nén')`, 1200));
  ok('rồi tải xong', await until(br, done));
  ok('Esc đóng', await closeView(br));
  await br.evalJs(`(() => { if (window.__f0) window.fetch = window.__f0; return true; })()`);

  // ── Hết hạn ──
  await psql(`UPDATE audit.agent_transcripts SET "ExpiresAt" = now() - interval '1 minute' WHERE "Key" = 'EXP-1'`);
  await openView(br, 'EXP-1');
  ok('bản hết hạn (404) → "đã hết hạn hoặc không còn", không có nút Tải về, có Thử lại', await until(br, `(() => { const e = ${V}.querySelector('[data-testid="transcript-error"]');
    return !!e && e.innerText.includes('đã hết hạn hoặc không còn') && !e.querySelector('[data-testid="transcript-viewer-download"]'); })()`), await br.evalJs(`${V}.innerText`));
  ok('Esc đóng', await closeView(br));

  if (MEASURE_FILE) {
    const m0 = Date.now();
    await openView(br, 'REAL-1');
    if (await br.evalJs(`!!${V}.querySelector('[data-testid="transcript-force-open"]')`)) await clickAt(br, `${V}.querySelector('[data-testid="transcript-force-open"]')`);
    await until(br, done, 60_000);
    const heap = await br.evalJs(`performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null`);
    console.log(`  bản thật (${(gz.get('REAL-1')! / 1048576).toFixed(2)} MB nén): ${await br.evalJs(`${V}.querySelector('[data-testid="transcript-load-ms"]')?.innerText ?? ''`)} · bấm → xong ${Date.now() - m0} ms · ${await br.evalJs(countText)} · heap ${heap} MB`);
    await closeView(br);
  }

  // ── Giao diện điện thoại ──
  await br.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await br.sleep(500);
  await openView(br, 'TEST-900');
  await until(br, done);
  ok('điện thoại 390 px: bảng xem không cuộn ngang', await br.evalJs(`(() => { const v = ${V}; return v.scrollWidth <= v.clientWidth + 1 && v.getBoundingClientRect().width <= 390; })()`));
  if (SHOTS) await br.shot(`${SHOTS}/3-viewer-mobile.png`);
  await closeView(br);
  await br.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  ok('không lỗi JS (admin)', jsErr(br.errors).length === 0, jsErr(br.errors));
} finally { br.close(); }

// Người thường: không có tab; gọi thẳng API tải → 403
// (cookie API của admin đã mất hiệu lực khi admin đăng nhập trên trình duyệt → lấy id qua DB tạm)
const one = await psql(`SELECT "Id" FROM audit.agent_transcripts WHERE "Key" = 'TEST-900'`);
ok('người thường gọi thẳng /download → 403', !!one && (await fetch(`${API}/api/agent-transcripts/${one}/download`, { headers: { cookie: H.cookie } })).status === 403);
const bh = await launch(9448, `${tmpdir()}/officehub-tv-h-${Date.now()}`, 1440, 900);
try {
  ok('người thường đăng nhập web', (await browserLogin(bh, H.user, PW)) === 200);
  await bh.go(`${BASE}/ai-access?tab=transcripts`, 3000);
  ok('người thường: không có tab / nút Xem / bảng xem', await until(bh, `!!document.querySelector('[role="tab"][aria-selected="true"]')`)
    && await bh.evalJs(`!document.querySelector('[data-testid="agent-transcript-tab-trigger"]') && !document.querySelector('[data-testid="agent-transcript-view"]') && !document.querySelector('[data-testid="transcript-viewer"]')`));
} finally { bh.close(); }

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
