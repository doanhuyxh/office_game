// E2E TEST-137: mức dùng AI XUYÊN các khâu — bên chạy agent (giả runner) → nginx web → Mcp /mcp/usage → Api (audit.ai_usage_*) → API đọc → giao diện.
// Khác ai-session-usage-e2e.ts (Api + Mcp gọi thẳng) và ai-usage-ui-e2e.ts (ghi qua đường nội bộ Api): ở đây dữ liệu CHỈ đi bằng đường runner thật dùng
// (POST /mcp/usage với token AI của bot), qua đúng file frontend/nginx.conf nếu có WEB_URL, rồi kiểm tra tới /ai-access + /profile trên Chrome.
// Kiểm tra: phiên việc (Claude, đủ chi phí, 2 model) / chat (chi phí null) / họp / năm trước; gửi lại cùng sourceId không trùng; 23:30 UTC → ngày VN hôm sau;
// không token 401, người thật 403, body sai / > 50 phiên 400, /api/audit/internal/ai-usage qua nginx → 404; summary day / month / year + costMissing + kind;
// quyền (người thường chỉ của mình, HR xem người khác + tất cả, token AI không đọc); Excel đọc được (giải nén xlsx: 2 sheet, mã việc, mã phiên, số dòng);
// Chrome: tab "Mức dùng AI" (thẻ tổng, biểu đồ, bảng model, danh sách phiên + link việc, Năm) và thẻ "AI tháng này" ở Hồ sơ.
// CHỈ DB tạm (lệnh dựng Api / Mcp / nginx / Vite: .agent/e2e.md mục "ai-usage-flow-e2e.ts"):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5287 MCP_BASE=http://localhost:5207 [WEB_URL=http://127.0.0.1:7137] BASE_URL=http://localhost:5179 \
//   ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/ai-usage-flow-e2e.ts      (không BASE_URL → bỏ phần Chrome; không WEB_URL → gửi thẳng Mcp, bỏ kiểm tra nginx)
import { BASE, launch } from './cdp';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { inflateRawSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5287';
const MCP_BASE = process.env.MCP_BASE ?? 'http://localhost:5207';
const WEB = process.env.WEB_URL ?? '';
const UI = !!process.env.BASE_URL;
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const USAGE_URL = `${WEB || MCP_BASE}/mcp/usage`;
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

/** Giải nén xlsx (zip) trong bộ nhớ → { tên file: nội dung }. Chỉ cần stored / deflate. */
const unzip = (buf: Uint8Array): Record<string, string> => {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = buf.length - 22;
  while (eocd >= 0 && dv.getUint32(eocd, true) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('Không phải file zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const data = buf.subarray(start, start + size);
    out[name] = new TextDecoder().decode(method === 8 ? inflateRawSync(data) : data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const vnDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const today = vnDate(new Date());
const thisMonth = today.slice(0, 7);

// ── Tài khoản: bot B (người làm việc), bot B2 (bot khác), người thật H, HR ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV AUF ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Mức dùng AI xuyên ${stamp}`, code: `AF${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles = ['employee']) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, user, name, userId: me?.id as string, token: t?.token as string };
};
const B = await mkEmp(`FB${stamp}`, 'Bot Dev Xuyên', `e2e.auf.b.${stamp}`);
const B2 = await mkEmp(`FC${stamp}`, 'Bot QA Xuyên', `e2e.auf.c.${stamp}`);
const H = await mkEmp(`FH${stamp}`, 'Người Thật Xuyên', `e2e.auf.h.${stamp}`);
const HR = await mkEmp(`FR${stamp}`, 'HR Xuyên', `e2e.auf.r.${stamp}`, ['hr']);
for (const b of [B, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('4 tài khoản (2 bot, người thật, HR) + token AI', [B, B2, H].every((x) => x.userId && x.token?.startsWith('ohk_')) && !!HR.userId);

// ── Giả runner: gửi usage như agent-runner sẽ gửi sau mỗi phiên ──
const push = async (token: string | null, body: unknown, raw?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(USAGE_URL, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const OPUS = 'claude-opus-5-5', HAIKU = 'claude-haiku-5-5', SONNET = 'claude-sonnet-5-5';
const PID = crypto.randomUUID(), TID = crypto.randomUUID();
const [y, mo, d] = today.split('-').map(Number);
const iso = (t: Date) => t.toISOString();
const before = (t: Date, sec: number) => new Date(t.getTime() - sec * 1000);
// Việc: kết thúc 23:30 UTC hôm qua = 06:30 sáng nay giờ VN → phải rơi vào kỳ HÔM NAY
const tFin = new Date(Date.UTC(y, mo - 1, d - 1, 23, 30));
const task = { sourceId: `job:${stamp}:1`, kind: 'task', taskId: TID, projectId: PID, taskCode: 'TEST-137', executor: 'claude', status: 'done',
  startedAt: iso(before(tFin, 900)), finishedAt: iso(tFin), turns: 14, costUsd: 1.25,
  models: [{ model: OPUS, inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 300, costUsd: 1.0 },
    { model: HAIKU, inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.25 }] };
const cFin = new Date(Date.now() - 60_000);
const chat = { sourceId: `chat:${stamp}:1`, kind: 'chat', executor: 'custom', status: 'done', startedAt: iso(before(cFin, 90)), finishedAt: iso(cFin),
  costUsd: null, models: [{ model: SONNET, inputTokens: 500, outputTokens: 700, cacheReadTokens: null, cacheWriteTokens: null, costUsd: null }] };
const mFin = new Date(`${today}T10:00:00+07:00`); mFin.setUTCDate(mFin.getUTCDate() - 1); // hôm qua 10:00 VN
const meeting = { sourceId: `meet:${stamp}:1`, kind: 'meeting', executor: 'claude', status: 'failed', startedAt: iso(before(mFin, 300)), finishedAt: iso(mFin),
  turns: 3, costUsd: 0.3, models: [{ model: SONNET, inputTokens: 300, outputTokens: 400, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.3 }] };
const oldFin = new Date('2025-06-15T03:00:00Z');
const old = { sourceId: `job:${stamp}:old`, kind: 'task', taskCode: 'TEST-1', executor: 'claude', status: 'done', startedAt: iso(before(oldFin, 600)), finishedAt: iso(oldFin),
  costUsd: 3, models: [{ model: OPUS, inputTokens: 10, outputTokens: 20, costUsd: 3 }] };

// Ghi: quyền + dữ liệu sai
ok(`${WEB ? 'qua nginx: ' : ''}không token → 401`, (await push(null, { sessions: [task] })).status === 401);
const human = await push(H.token, { sessions: [task] });
ok('token người thật → 403 (chỉ bot gửi)', human.status === 403, human);
ok('body hỏng → 400', (await push(B.token, null, '{"sessions": [')).status === 400);
ok('thiếu sourceId → 400', (await push(B.token, { sessions: [{ ...task, sourceId: '' }] })).status === 400);
ok('kind lạ → 400', (await push(B.token, { sessions: [{ ...task, kind: 'abc' }] })).status === 400);
ok('> 50 phiên → 400', (await push(B.token, { sessions: Array.from({ length: 51 }, (_, i) => ({ ...chat, sourceId: `x${i}` })) })).status === 400);
if (WEB) {
  const r = await fetch(`${WEB}/api/audit/internal/ai-usage`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': 'x'.repeat(40) },
    body: JSON.stringify({ userId: B.userId, sessions: [chat] }) });
  ok('nginx web: /api/audit/internal/ai-usage → 404 (không lộ đường nội bộ)', r.status === 404, r.status);
  ok('nginx web: /api/ai-usage/summary vẫn tới Api (401 khi chưa đăng nhập)', (await fetch(`${WEB}/api/ai-usage/summary`)).status === 401);
}
const sum0 = await json(B.cookie, 'GET', '/api/ai-usage/summary?group=year');
ok('dữ liệu sai không ghi gì (bot vẫn 0 phiên)', sum0.status === 200 && sum0.body?.total?.sessions === 0, sum0.body?.total);

// Ghi: 4 phiên trong một lô, rồi gửi lại (runner thử lại sau lỗi mạng)
const first = await push(B.token, { sessions: [task, chat, meeting, old] });
ok('bot gửi lô 4 phiên (việc / chat / họp / năm trước) → created 4', first.status === 200 && first.body?.accepted === 4 && first.body?.created === 4, first);
const again = await push(B.token, { sessions: [task, chat] });
ok('gửi lại cùng sourceId → updated 2, created 0', again.status === 200 && again.body?.created === 0 && again.body?.updated === 2, again);
const other = await push(B2.token, { sessions: [{ ...chat, costUsd: 0.05, models: [{ model: SONNET, inputTokens: 1, outputTokens: 1, costUsd: 0.05 }] }] });
ok('bot khác cùng sourceId → phiên riêng', other.status === 200 && other.body?.created === 1, other);

// ── Đọc: tổng day / month / year ──
const near = 1e-9;
const day = await json(B.cookie, 'GET', '/api/ai-usage/summary');
const dt = day.body?.total;
ok('Ngày (30 ngày): 3 phiên, $1,55, costMissing 1 (chat)', day.status === 200 && dt?.sessions === 3 && Math.abs(dt.costUsd - 1.55) < near && dt.costMissing === 1, dt);
ok('token cộng mọi model (vào 1900, ra 1320, cache đọc 5000, ghi 300)', dt?.inputTokens === 1900 && dt?.outputTokens === 1320 && dt?.cacheReadTokens === 5000 && dt?.cacheWriteTokens === 300, dt);
const tb = day.body?.groups?.filter((g: any) => g.model === OPUS || g.model === HAIKU) ?? [];
ok('phiên 23:30 UTC hôm qua → kỳ hôm nay (giờ VN), tách 2 model', tb.length === 2 && tb.every((g: any) => g.bucket === today && g.sessions === 1), tb);
const son = day.body?.groups?.filter((g: any) => g.model === SONNET) ?? [];
ok('sonnet: chat (thiếu chi phí) + họp ($0,30)', son.reduce((a: number, g: any) => a + g.sessions, 0) === 2 && son.reduce((a: number, g: any) => a + g.costMissing, 0) === 1
  && Math.abs(son.reduce((a: number, g: any) => a + g.costUsd, 0) - 0.3) < near, son);
const todayBucket = day.body?.buckets?.find((b: any) => b.bucket === today);
ok('kỳ hôm nay đếm phiên việc MỘT lần dù 2 model', todayBucket?.sessions === 2 && Math.abs(todayBucket.costUsd - 1.25) < near, todayBucket);
const month = await json(B.cookie, 'GET', '/api/ai-usage/summary?group=month');
const mThis = month.body?.buckets?.find((b: any) => b.bucket === thisMonth);
const meetingThisMonth = vnDate(mFin).slice(0, 7) === thisMonth;
ok('Tháng: 3 phiên, kỳ tháng này đúng', month.status === 200 && month.body?.total?.sessions === 3 && mThis?.sessions === (meetingThisMonth ? 3 : 2), month.body?.buckets);
const year = await json(B.cookie, 'GET', '/api/ai-usage/summary?group=year');
const yt = year.body?.total;
ok('Năm: 4 phiên, $4,55, kỳ 2025 = $3', yt?.sessions === 4 && Math.abs(yt.costUsd - 4.55) < near && year.body?.buckets?.find((b: any) => b.bucket === '2025')?.costUsd === 3, year.body?.buckets);
const kChat = (await json(B.cookie, 'GET', '/api/ai-usage/summary?kind=chat')).body?.total;
ok('kind=chat → 1 phiên, costMissing 1, chi phí 0', kChat?.sessions === 1 && kChat?.costMissing === 1 && kChat?.costUsd === 0, kChat);
const kMeet = await json(B.cookie, 'GET', '/api/ai-usage/sessions?kind=meeting&page=1');
ok('kind=meeting → phiên họp trạng thái failed', kMeet.body?.total === 1 && kMeet.body?.items?.[0]?.status === 'failed', kMeet.body);
const list = await json(B.cookie, 'GET', '/api/ai-usage/sessions?page=1&pageSize=10');
const job = list.body?.items?.find((x: any) => x.sourceId === task.sourceId);
ok('danh sách: 3 phiên, phiên việc giữ taskId / projectId / mã việc, 900 giây, 14 lượt', list.body?.total === 3 && job?.taskCode === 'TEST-137'
  && job?.taskId === TID && job?.projectId === PID && job?.durationSeconds === 900 && job?.turns === 14, job);

// ── Quyền đọc ──
const hOwn = await json(H.cookie, 'GET', '/api/ai-usage/summary');
ok('người thường xem của mình → 0 phiên', hOwn.status === 200 && hOwn.body?.total?.sessions === 0, hOwn.body?.total);
ok('người thường xem của bot / all → 403', (await json(H.cookie, 'GET', `/api/ai-usage/summary?userId=${B.userId}`)).status === 403
  && (await json(H.cookie, 'GET', '/api/ai-usage/summary?userId=all')).status === 403);
ok('bot B2 xem của B → 403', (await json(B2.cookie, 'GET', `/api/ai-usage/sessions?userId=${B.userId}`)).status === 403);
const hrOne = await json(HR.cookie, 'GET', `/api/ai-usage/summary?userId=${B.userId}&group=year`);
ok('HR xem bot B → 4 phiên', hrOne.status === 200 && hrOne.body?.total?.sessions === 4, hrOne.body?.total);
const hrAll = await json(HR.cookie, 'GET', `/api/ai-usage/sessions?userId=all&page=1&pageSize=100`);
const names = new Set((hrAll.body?.items ?? []).map((x: any) => x.fullName));
ok('HR xem tất cả → có cả 2 bot', hrAll.status === 200 && names.has(B.name) && names.has(B2.name), [...names]);
ok('token AI đọc /api/ai-usage → 403', (await fetch(`${API}/api/ai-usage/summary`, { headers: { authorization: `Bearer ${B.token}` } })).status === 403);

// ── Excel đọc được ──
const xl = await fetch(`${API}/api/ai-usage/export?userId=${B.userId}&group=month`, { headers: { cookie: HR.cookie } });
const files = xl.status === 200 ? unzip(new Uint8Array(await xl.arrayBuffer())) : {};
const wbXml = files['xl/workbook.xml'] ?? '';
const strings = Object.entries(files).filter(([n]) => n.startsWith('xl/')).map(([, v]) => v).join('\n');
ok('HR xuất Excel của bot → xlsx giải nén được, 2 sheet "Tổng hợp" + "Phiên"', wbXml.includes('Tổng hợp') && wbXml.includes('Phiên'), Object.keys(files));
const sheets = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort();
// Đếm dòng CÓ giá trị (ô <v> / chuỗi trong dòng) — dòng trống chỉ có định dạng không tính
const rows = (xml: string) => (xml.match(/<(?:\w+:)?row[ >][\s\S]*?<\/(?:\w+:)?row>/g) ?? []).filter((r) => /<(?:\w+:)?(?:v|t)>/.test(r)).length;
ok('sheet "Phiên": tiêu đề + 3 phiên (12 tháng, không có phiên 2025)', rows(files[sheets[1]] ?? '') === 4,
  { sheets: sheets.map((s) => rows(files[s])), head: (files[sheets[1]] ?? '').slice(0, 300) });
ok('Excel có mã việc TEST-137 + mã phiên + model', strings.includes('TEST-137') && strings.includes(task.sourceId) && strings.includes(OPUS), strings.length);
ok('người thường xuất Excel của bot → 403', (await fetch(`${API}/api/ai-usage/export?userId=${B.userId}`, { headers: { cookie: H.cookie } })).status === 403);

// ── Giao diện (Chrome qua Vite) ──
if (UI) {
  type Br = Awaited<ReturnType<typeof launch>>;
  const until = async (br: Br, js: string, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (await br.evalJs(js).catch(() => false)) return true; await br.sleep(250); } return false; };
  const jsErr = (errs: string[]) => errs.filter((e) => !/negotiation|Failed to start the connection|WebSocket|\/rt\/|hub/i.test(e));
  const text = (id: string) => `(document.querySelector('[data-testid="${id}"]')?.innerText ?? '')`;
  const statCost = text('ai-usage-stat-cost'), statSessions = text('ai-usage-stat-sessions');
  const br = await launch(9397, `${tmpdir()}/officehub-auf-${Date.now()}`, 1440, 900);
  try {
    await br.go(`${BASE}/login`, 1500);
    const st = await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(B.user)},password:${JSON.stringify(PW)}})}).then(r=>r.status)`);
    ok('bot đăng nhập web', st === 200, st);
    await br.go(`${BASE}/ai-access?tab=usage`, 3000);
    ok('tab "Mức dùng AI": 3 phiên, $1,55 + "1 phiên không có chi phí"', await until(br, `${statSessions}.includes('3') && ${statCost}.includes('$1,55') && ${statCost}.includes('1 phiên không có chi phí')`),
      [await br.evalJs(statSessions), await br.evalJs(statCost)]);
    ok('biểu đồ: 30 cột ngày, cột hôm nay có dữ liệu', await br.evalJs(`document.querySelectorAll('[data-testid="ai-usage-bar"]').length === 30
      && !!document.querySelector('[data-testid="ai-usage-bar"][data-bucket="${today}"] > div > div')`), await br.evalJs(`document.querySelectorAll('[data-testid="ai-usage-bar"]').length`));
    const models = await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-model-row"]')].map(r => r.innerText.replace(/\\s+/g, ' '))`) as string[];
    ok('bảng theo model: opus, haiku, sonnet (sonnet có * thiếu chi phí)', models.length === 3 && [OPUS, HAIKU].every((x) => models.some((r) => r.includes(x)))
      && models.some((r) => r.includes(SONNET) && r.includes('*')), models);
    const rowsUi = await br.evalJs(`[...document.querySelectorAll('[data-testid="ai-usage-session-row"]')].map(r => ({ t: r.innerText.replace(/\\s+/g, ' '), red: r.className.includes('destructive'), href: r.querySelector('a')?.getAttribute('href') ?? null }))`) as { t: string; red: boolean; href: string | null }[];
    ok('danh sách phiên: 3 dòng, link việc TEST-137, họp lỗi tô đỏ, chat "—"', rowsUi.length === 3 && rowsUi.some((r) => r.href === `/projects/${PID}?task=${TID}` && r.t.includes('TEST-137'))
      && rowsUi.some((r) => r.red && r.t.includes('Họp')) && rowsUi.some((r) => r.t.includes('Chat') && r.t.includes('—')), rowsUi);
    await br.evalJs(`document.querySelector('[data-testid="ai-usage-group-year"]').click()`);
    ok('Năm: 4 phiên, $4,55, cột đầu 2025', await until(br, `location.search.includes('usage=year') && ${statSessions}.includes('4') && ${statCost}.includes('$4,55')`)
      && await br.evalJs(`document.querySelector('[data-testid="ai-usage-bar"]').dataset.bucket === '2025'`), await br.evalJs(statCost));
    await br.go(`${BASE}/profile`, 3000);
    const botMonth = 2 + (meetingThisMonth ? 1 : 0);
    ok(`Hồ sơ: thẻ "AI tháng này" ${botMonth} phiên, có opus`, await until(br, `${text('ai-month-sessions')} === '${botMonth}' && ${text('ai-month-card')}.includes('${OPUS}')`),
      await br.evalJs(text('ai-month-card')));
    ok('không lỗi JS', jsErr(br.errors).length === 0, jsErr(br.errors));
  } finally { br.close(); }
} else console.log('(bỏ phần Chrome: không có BASE_URL)');

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
