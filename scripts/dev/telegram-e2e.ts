// E2E TEST-42: kênh Telegram đánh thức agent khi việc được giao cho tài khoản bot có "Bot Telegram".
// MÁY CHỦ TELEGRAM GIẢ trong cùng tiến trình (cổng FAKE_PORT, mặc định 5198) — không gọi Telegram thật. Api phải chạy với Telegram__ApiUrl trỏ vào đây.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm (container như security-e2e.ts):
//   Api (từ backend/): env ASPNETCORE_URLS=http://localhost:5185 'ConnectionStrings__Default=Host=127.0.0.1;Port=55461;Database=e2e;Username=e2e;Password=e2e'
//        Telegram__ApiUrl=http://localhost:5198 Smtp__Host=127.0.0.1 Smtp__Port=11061 Smtp__UseSsl=false Smtp__Username= Smtp__Password=
//        Seed__AdminEmail=sec-admin@officehub-e2e.vn Seed__AdminPassword=Sec-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile > api.log
//   MCP (tuỳ chọn): Mcp__ApiBaseUrl=http://localhost:5185 ASPNETCORE_URLS=http://localhost:5200 dotnet run --project src/OfficeHub.Mcp --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 MCP_URL=http://localhost:5200/mcp API_LOG=…/api.log PG_CONTAINER=e2e-sec-pg bun scripts/dev/telegram-e2e.ts
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5185';
const MCP = process.env.MCP_URL ?? '';
const API_LOG = process.env.API_LOG ?? '';
const PG = process.env.PG_CONTAINER ?? 'e2e-sec-pg';
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5198);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'sec-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Sec-Admin-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();

// ---- Telegram giả ----
const GOOD = '123456789:AAH-e2e-good-token-abcdefghijklmnop';
const BAD = '987654321:AAH-e2e-bad-token-zyxwvutsrqponmlk';
type Sent = { token: string; chat_id: string; text: string; at: number };
const sent: Sent[] = [];
let fail429Once = false;
Bun.serve({
  port: FAKE_PORT,
  async fetch(req) {
    const m = new URL(req.url).pathname.match(/^\/bot([^/]+)\/sendMessage$/);
    if (!m || req.method !== 'POST') return new Response('not found', { status: 404 });
    const token = decodeURIComponent(m[1]);
    const body = await req.json() as any;
    if (token !== GOOD) return Response.json({ ok: false, error_code: 401, description: 'Unauthorized' }, { status: 401 });
    if (fail429Once) { fail429Once = false; return Response.json({ ok: false, error_code: 429, description: 'Too Many Requests: retry after 1', parameters: { retry_after: 1 } }, { status: 429 }); }
    sent.push({ token, chat_id: String(body.chat_id), text: body.text, at: Date.now() });
    return Response.json({ ok: true, result: { message_id: sent.length } });
  },
});
const until = async (cond: () => boolean, ms = 10000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

// ---- đăng nhập / dữ liệu ----
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    if (!(await post('/api/auth/2fa/enable', { code }, cookie)).ok) throw new Error(`Không bật được 2FA cho ${user}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000);
    return login(user, password);
  }
  return cookie;
};
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, text };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV TG ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Telegram E2E ${stamp}`, code: `TG${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, cookie: await login(user, PW) };
};
const PM = await mkEmp(`TP${stamp}`.toUpperCase(), 'Quản Lý TG', `e2e.tg.pm.${stamp}`, ['employee', 'manager']);
const B1 = await mkEmp(`TB${stamp}`.toUpperCase(), 'Bot Một TG', `e2e.tg.bot1.${stamp}`, ['employee']);
const B2 = await mkEmp(`TC${stamp}`.toUpperCase(), 'Bot Hai TG', `e2e.tg.bot2.${stamp}`, ['employee']);
const HU = await mkEmp(`TH${stamp}`.toUpperCase(), 'Người Thật TG', `e2e.tg.hu.${stamp}`, ['employee']);
const HR = await mkEmp(`TR${stamp}`.toUpperCase(), 'HR TG', `e2e.tg.hr.${stamp}`, ['employee', 'hr']);
ok('5 tài khoản đăng nhập', [PM, B1, B2, HU, HR].every((x) => !!x.cookie));
const BOT1 = `@e2e_${stamp}_one_bot`;

// ---- Trường "Bot Telegram" của tài khoản ----
const tgPut = (c: string, id: string, v: string | null) => json(c, 'PUT', `/api/org/employees/${id}/account/telegram`, { telegramBot: v });
ok('Chưa đánh dấu bot → 409', (await tgPut(admin, B1.e.id, BOT1)).status === 409);
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
ok('HR (không phải admin) → 403', (await tgPut(HR.cookie, B1.e.id, BOT1)).status === 403);
let r = await tgPut(admin, B1.e.id, '@khong_hop_le');
ok('Username không kết thúc bằng bot → 400', r.status === 400 && !!r.body?.errors?.telegramBot, r.body);
ok('Admin gắn bot Telegram (chữ hoa → chuẩn hoá)', (await tgPut(admin, B1.e.id, BOT1.toUpperCase().replace('@', ''))).status === 204);
ok('Bot Telegram đã gắn tài khoản khác → 409', (await tgPut(admin, B2.e.id, BOT1)).status === 409);
r = await json(admin, 'GET', `/api/org/employees/${B1.e.id}`);
ok('Hồ sơ hiện telegramBot đã chuẩn hoá', r.body?.employee?.account?.telegramBot === BOT1, r.body?.employee?.account);
ok('Người thật không gắn được', (await tgPut(admin, HU.e.id, `@e2e_${stamp}_hu_bot`)).status === 409);

// ---- Cấu hình kênh ----
r = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true } });
ok('Bật kênh thiếu chat id / token → 400', r.status === 400 && !!r.body?.errors?.chatId && !!r.body?.errors?.botToken, r.body);
r = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: GOOD } });
ok('Lưu cấu hình Telegram (200, token chỉ là cờ)', r.status === 200 && r.body.secrets.botToken === true && r.body.values.enabled === true && !r.text.includes(GOOD), r.body);
ok('GET danh sách không chứa bot token', !(await json(admin, 'GET', '/api/system/settings')).text.includes(GOOD));
ok('Token AI / nhân viên không đọc được cấu hình → 403', (await json(HU.cookie, 'GET', '/api/system/settings/telegram')).status === 403);
const dbTok = await sql(`select "SecretsEncrypted" from settings.system_settings where "Group"='telegram'`);
ok('DB: bot token mã hoá', dbTok.startsWith('v2:') && !dbTok.includes('AAH-e2e'));
r = await json(admin, 'POST', '/api/system/settings/telegram/test');
ok('Gửi thử → Telegram giả nhận tin thử đúng chat', r.body?.ok === true && sent.some((s) => s.text.includes('tin thử') && s.chat_id === '-1001234567890'), r.body);

// ---- Giao việc ----
const pr = await json(PM.cookie, 'POST', '/api/projects', { code: `tg-${stamp}`, name: 'Telegram E2E', kind: 'Internal', startOn: today, memberIds: [B1.e.id, B2.e.id, HU.e.id] });
ok('Tạo dự án', pr.status === 201, pr.body);
const P = pr.body;
const PCODE = `TG-${stamp}`.toUpperCase();
const wakes = () => sent.filter((s) => s.text.startsWith('@'));
let before = wakes().length;
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc cho bot 1', description: 'Nội dung bí mật không được gửi', assigneeEmployeeId: B1.e.id });
ok('Tạo việc giao cho bot (201)', r.status === 201, r.body);
const T1 = r.body as string;
ok('Telegram nhận đúng 1 tin', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1), wakes().length - before);
const w = wakes().at(-1)!;
const [line1, line2] = w.text.split('\n');
const data = JSON.parse(line2 ?? '{}');
ok('Dòng 1 nhắc tên bot, đúng chat', line1 === BOT1 && w.chat_id === '-1001234567890', w);
ok('JSON đúng 4 trường + giá trị', JSON.stringify(Object.keys(data)) === JSON.stringify(['employee_code', 'project_id', 'task_id', 'task_code'])
  && data.employee_code === B1.code && data.project_id === P && data.task_id === T1 && data.task_code === `${PCODE}-1`, data);
ok('Tin không chứa tên / mô tả việc', !w.text.includes('Việc cho bot') && !w.text.includes('bí mật'));

const task = async (id: string) => (await json(PM.cookie, 'GET', `/api/projects/tasks/${id}`)).body?.task ?? (await json(PM.cookie, 'GET', `/api/projects/tasks/${id}`)).body;
const upd = async (id: string, patch: Record<string, unknown>) => {
  const t = await task(id);
  return json(PM.cookie, 'PUT', `/api/projects/tasks/${id}`, { title: t.title, description: t.description, assigneeEmployeeId: t.assigneeEmployeeId, dueOn: t.dueOn,
    estimateDays: t.estimateDays, milestoneId: t.milestoneId, mediaLinks: t.mediaLinks, ...patch });
};
before = wakes().length;
ok('Sửa tên (không đổi người) → 204', (await upd(T1, { title: 'Đổi tên' })).status === 204);
ok('Đổi người → người thật', (await upd(T1, { assigneeEmployeeId: HU.e.id })).status === 204);
ok('Đổi người → bot chưa có username', (await upd(T1, { assigneeEmployeeId: B2.e.id })).status === 204);
await sleep(4000);
ok('… không gửi tin nào', wakes().length === before, wakes().length - before);
ok('Đổi lại → bot 1', (await upd(T1, { assigneeEmployeeId: B1.e.id })).status === 204);
ok('… gửi đúng 1 tin', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1));
before = wakes().length;
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc cho người', assigneeEmployeeId: HU.e.id });
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc không giao' });
await sleep(4000);
ok('Tạo việc giao người thật / không giao → không gửi', wakes().length === before);

// Qua token AI (đường MCP gọi) + MCP thật
const tok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `pm ${stamp}`, expiresInDays: 30 })).body?.token as string;
before = wakes().length;
r = await call({ authorization: `Bearer ${tok}` }, 'POST', `/api/projects/${P}/tasks`, { title: 'Qua token', assigneeEmployeeId: B1.e.id });
ok('Token AI tạo việc giao bot → 201 + 1 tin', r.status === 201 && await until(() => wakes().length === before + 1), r.status);
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    const d = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
    try { return JSON.parse(d); } catch { return text; }
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  before = wakes().length;
  let x = await rpc('tools/call', { name: 'create_task', arguments: { project: PCODE, title: 'Qua MCP', assignee: B1.code } });
  ok('MCP create_task giao bot → 1 tin', !x?.result?.isError && await until(() => wakes().length === before + 1), x?.result?.content?.[0]?.text?.slice(0, 200));
  const mcpTask = JSON.parse(wakes().at(-1)!.text.split('\n')[1]).task_code;
  x = await rpc('tools/call', { name: 'update_task', arguments: { task: mcpTask, assignee: 'none' } });
  before = wakes().length;
  x = await rpc('tools/call', { name: 'update_task', arguments: { task: mcpTask, assignee: B1.code } });
  ok('MCP update_task giao lại bot → 1 tin', !x?.result?.isError && await until(() => wakes().length === before + 1), x?.result?.content?.[0]?.text?.slice(0, 200));
}

// Kênh tắt
r = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: false, chatId: '-1001234567890' } });
ok('Tắt kênh (giữ token)', r.status === 200 && r.body.values.enabled === false && r.body.secrets.botToken === true, r.body);
before = wakes().length;
await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Khi kênh tắt', assigneeEmployeeId: B1.e.id });
await sleep(4000);
ok('Kênh tắt → không gửi', wakes().length === before);

// 429 → thử lại theo retry_after
await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' } });
fail429Once = true;
before = wakes().length;
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Bị 429', assigneeEmployeeId: B1.e.id });
const T429 = r.body as string;
ok('429 → thử lại, cuối cùng gửi được', await until(() => wakes().length === before + 1, 15000));
await sleep(1500);
ok('… DB: Sent sau 2 lần', (await sql(`select "Status" || ' ' || "Attempts" from notifications.telegram_messages where "TaskId"='${T429}'`)).trim() === 'Sent 2');

// Token sai → lỗi, việc vẫn giao
await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1001234567890' }, secrets: { botToken: BAD } });
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Token sai', assigneeEmployeeId: B1.e.id });
const TBAD = r.body as string;
ok('Token sai: việc vẫn tạo thành công (201)', r.status === 201);
let row = '';
await until(() => false, 5000);
row = (await sql(`select "Status" || '|' || coalesce("Error",'') || '|' || "Attempts" from notifications.telegram_messages where "TaskId"='${TBAD}'`)).trim();
ok('DB: Failed ngay (401 không thử lại), lỗi không chứa token', row.startsWith('Failed|Telegram trả 401') && row.endsWith('|1') && !row.includes('AAH-e2e'), row);
r = await json(admin, 'POST', '/api/system/settings/telegram/test');
ok('Gửi thử với token sai → ok=false, không lộ token', r.body?.ok === false && !r.text.includes('AAH-e2e'), r.body);
if (API_LOG) {
  const logText = readFileSync(API_LOG, 'utf8');
  ok('Log Api có cảnh báo gửi Telegram lỗi', logText.includes('Gửi Telegram lỗi'));
  ok('Log Api KHÔNG chứa bot token', !logText.includes('AAH-e2e-good') && !logText.includes('AAH-e2e-bad'));
}

// Dọn: tắt kênh, gỡ bot
await json(admin, 'DELETE', '/api/system/settings/telegram');
ok('Gỡ bot Telegram (trống)', (await tgPut(admin, B1.e.id, '')).status === 204
  && (await json(admin, 'GET', `/api/org/employees/${B1.e.id}`)).body?.employee?.account?.telegramBot === null);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
