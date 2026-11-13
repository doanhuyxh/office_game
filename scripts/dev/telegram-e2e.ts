// E2E TEST-42 / TEST-48 / TEST-63 / TEST-86: kênh Telegram đánh thức agent khi việc được giao cho tài khoản bot, bot được @nhắc trong bình luận việc,
// hoặc việc bot làm hết phải chờ (việc trước sang Xong → event ready).
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
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

// ---- Cấu hình kênh ----
let r = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true } });
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
const wakes = () => sent.filter((s) => s.text.startsWith('{'));
const wakeData = (s: Sent) => JSON.parse(s.text);
let before = wakes().length;
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc cho bot 1', description: 'Nội dung bí mật không được gửi', assigneeEmployeeId: B1.e.id });
ok('Tạo việc giao cho bot (201)', r.status === 201, r.body);
const T1 = r.body as string;
ok('Telegram nhận đúng 1 tin', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1), wakes().length - before);
const w = wakes().at(-1)!;
const data = wakeData(w);
ok('Một dòng JSON, đúng chat, không nhắc bot', !w.text.includes('\n') && !w.text.includes('@') && w.chat_id === '-1001234567890', w);
ok('JSON đúng 5 trường + giá trị (event assigned)', JSON.stringify(Object.keys(data)) === JSON.stringify(['employee_code', 'project_id', 'task_id', 'task_code', 'event'])
  && data.employee_code === B1.code && data.project_id === P && data.task_id === T1 && data.task_code === `${PCODE}-1` && data.event === 'assigned', data);
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
await sleep(4000);
ok('… không gửi tin nào', wakes().length === before, wakes().length - before);
ok('Đổi lại → bot 1', (await upd(T1, { assigneeEmployeeId: B1.e.id })).status === 204);
ok('… gửi đúng 1 tin', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1));
before = wakes().length;
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc cho người', assigneeEmployeeId: HU.e.id });
r = await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc không giao' });
await sleep(4000);
ok('Tạo việc giao người thật / không giao → không gửi', wakes().length === before);

// ---- TEST-63: bot được @nhắc trong bình luận việc ----
const comment = (c: string, id: string, content: string) => json(c, 'POST', `/api/projects/tasks/${id}/comments`, { content });
before = wakes().length;
r = await comment(PM.cookie, T1, `@${B2.code} xem giúp, cc @${HU.code}`);
const C1 = r.body as string;
ok('Nhắc bot không phải người làm (+ người thật) → đúng 1 tin cho bot', r.status === 201 && await until(() => wakes().length === before + 1)
  && (await sleep(3500), wakes().length === before + 1), { status: r.status, n: wakes().length - before });
let m = wakeData(wakes().at(-1)!);
ok('… JSON event mentioned + comment_id, đúng bot / việc', JSON.stringify(Object.keys(m)) === JSON.stringify(['employee_code', 'project_id', 'task_id', 'task_code', 'event', 'comment_id'])
  && m.event === 'mentioned' && m.employee_code === B2.code && m.task_id === T1 && m.project_id === P && m.comment_id === C1, m);
ok('… tin không chứa nội dung bình luận', !wakes().at(-1)!.text.includes('xem giúp'));
before = wakes().length;
r = await comment(PM.cookie, T1, `@${B1.code} trả lời giúp`);
ok('Nhắc bot là người làm việc → vẫn 1 tin mentioned', r.status === 201 && await until(() => wakes().length === before + 1)
  && wakeData(wakes().at(-1)!).employee_code === B1.code && wakeData(wakes().at(-1)!).event === 'mentioned');
before = wakes().length;
ok('Nhắc người thật → 201', (await comment(PM.cookie, T1, `@${HU.code} nhé`)).status === 201);
ok('Bot tự nhắc mình → 201', (await comment(B2.cookie, T1, `@${B2.code} ghi chú`)).status === 201);
ok('Bình luận không nhắc ai → 201', (await comment(PM.cookie, T1, 'không nhắc ai')).status === 201);
await sleep(4000);
ok('… không gửi tin nào', wakes().length === before, wakes().slice(before).map((x) => x.text));
const qk = (await sql(`select count(*) from notifications.telegram_messages where "Kind"='task_mentioned' and "TaskId"='${T1}'`)).trim();
ok('DB: hàng đợi Kind = task_mentioned (2 tin)', qk === '2', qk);

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
  const mcpTask = wakeData(wakes().at(-1)!).task_code;
  x = await rpc('tools/call', { name: 'update_task', arguments: { task: mcpTask, assignee: 'none' } });
  before = wakes().length;
  x = await rpc('tools/call', { name: 'update_task', arguments: { task: mcpTask, assignee: B1.code } });
  ok('MCP update_task giao lại bot → 1 tin', !x?.result?.isError && await until(() => wakes().length === before + 1), x?.result?.content?.[0]?.text?.slice(0, 200));
}

// ---- TEST-86: việc hết chờ (việc trước sang Xong) → event ready cho bot làm việc sau ----
const pd = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
const COLS = ['Đang làm', 'Chờ review', 'Xong'].map((n) => pd.columns.find((c: any) => c.name === n)?.id as string);
ok('Dự án có cột Đang làm / Chờ review / Xong', COLS.every(Boolean), pd.columns?.map((c: any) => c.name));
const mk = async (title: string, assigneeEmployeeId?: string) =>
  (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title, ...(assigneeEmployeeId ? { assigneeEmployeeId } : {}) })).body as string;
const deps = async (id: string, dependsOn: string[]) => (await json(PM.cookie, 'PUT', `/api/projects/tasks/${id}/dependencies`, { dependsOn })).status;
const finish = async (id: string) => { let st = 0; for (const c of COLS) st = (await json(PM.cookie, 'POST', `/api/projects/tasks/${id}/move`, { columnId: c })).status; return st; };
const readies = () => wakes().filter((x) => wakeData(x).event === 'ready');
// Việc trước không giao (không tự sinh tin); việc sau giao bot → tin assigned lúc tạo, đợi gửi xong rồi mới đếm.
const A1 = await mk('Trước 1'), B1t = await mk('Sau 1 (bot)', B1.e.id);
const A2 = await mk('Trước 2'), B2t = await mk('Sau 2 (không giao)');
const A3 = await mk('Trước 3a'), C3 = await mk('Trước 3b'), B3t = await mk('Sau 3 (bot, còn chờ)', B2.e.id);
const A4 = await mk('Trước 4'), B4t = await mk('Sau 4 (người thật)', HU.e.id);
ok('Đặt việc phải chờ → 204', [await deps(B1t, [A1]), await deps(B2t, [A2]), await deps(B3t, [A3, C3]), await deps(B4t, [A4])].every((x) => x === 204));
await sleep(4000);
before = wakes().length;
ok('A sang Xong → 204', (await finish(A1)) === 204);
ok('… đúng 1 tin ready cho B (bot)', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1), wakes().slice(before).map((x) => x.text));
const rd = wakeData(wakes().at(-1)!);
ok('… JSON 5 trường, event ready, đúng bot / dự án / việc', JSON.stringify(Object.keys(rd)) === JSON.stringify(['employee_code', 'project_id', 'task_id', 'task_code', 'event'])
  && rd.event === 'ready' && rd.employee_code === B1.code && rd.project_id === P && rd.task_id === B1t && /^TG-[A-Z0-9]+-\d+$/.test(rd.task_code), rd);
ok('… tin không chứa tên việc', !wakes().at(-1)!.text.includes('Sau 1'));
ok('DB: hàng đợi Kind = task_ready', (await sql(`select count(*) from notifications.telegram_messages where "Kind"='task_ready' and "TaskId"='${B1t}'`)).trim() === '1');
before = wakes().length;
ok('B chưa giao: A sang Xong → 204', (await finish(A2)) === 204);
ok('B còn chờ việc khác: một việc trước sang Xong → 204', (await finish(A3)) === 204);
ok('B giao người thật: A sang Xong → 204', (await finish(A4)) === 204);
await sleep(4000);
ok('… không gửi tin nào', wakes().length === before, wakes().slice(before).map((x) => x.text));
ok('B còn chờ: việc trước cuối cùng sang Xong → 204', (await finish(C3)) === 204);
ok('… đúng 1 tin ready cho bot 2', await until(() => wakes().length === before + 1) && (await sleep(3500), wakes().length === before + 1)
  && wakeData(wakes().at(-1)!).event === 'ready' && wakeData(wakes().at(-1)!).employee_code === B2.code && wakeData(wakes().at(-1)!).task_id === B3t,
  wakes().slice(before).map((x) => x.text));
const A5 = await mk('Trước 5 (kênh tắt)'), B5t = await mk('Sau 5 (bot, kênh tắt)', B1.e.id);
await deps(B5t, [A5]);
await sleep(4000);

// Kênh tắt
r = await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: false, chatId: '-1001234567890' } });
ok('Tắt kênh (giữ token)', r.status === 200 && r.body.values.enabled === false && r.body.secrets.botToken === true, r.body);
before = wakes().length;
await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Khi kênh tắt', assigneeEmployeeId: B1.e.id });
await sleep(4000);
ok('Kênh tắt → không gửi', wakes().length === before);
before = wakes().length;
ok('Kênh tắt: việc trước sang Xong vẫn 204', (await finish(A5)) === 204);
await sleep(4000);
ok('… không gửi tin ready', wakes().length === before && readies().every((x) => wakeData(x).task_id !== B5t));

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

// Dọn: xoá cấu hình kênh
ok('Xoá cấu hình Telegram', (await json(admin, 'DELETE', '/api/system/settings/telegram')).status < 300);

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
