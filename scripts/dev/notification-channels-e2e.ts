// E2E TEST-43: GET /api/system/notification-channels — trang Hệ thống → Kênh thông báo.
// Chỉ admin (nhân viên / HR / token AI → 403), đủ 5 kênh (chuông, email, push, webhook, Telegram), nguồn DB / .env đúng theo cấu hình,
// đổi cấu hình → trạng thái đổi ngay, lần gửi thành công / lỗi gần nhất (Telegram giả), response không chứa bí mật.
// CHỈ DB tạm — Api như telegram-e2e.ts (Telegram__ApiUrl=http://localhost:5198):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5185 PG_CONTAINER=e2e-sec-pg bun scripts/dev/notification-channels-e2e.ts
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
const EMP = await mkEmp(`CE${stamp}`.toUpperCase(), 'Nhân Viên KN', `e2e.kn.emp.${stamp}`, ['employee']);
const HR = await mkEmp(`CR${stamp}`.toUpperCase(), 'HR KN', `e2e.kn.hr.${stamp}`, ['employee', 'hr']);
const PM = await mkEmp(`CM${stamp}`.toUpperCase(), 'Quản Lý KN', `e2e.kn.pm.${stamp}`, ['employee', 'manager']);
const BOT = await mkEmp(`CB${stamp}`.toUpperCase(), 'Bot KN', `e2e.kn.bot.${stamp}`, ['employee']);
ok('Tài khoản đăng nhập', [EMP, HR, PM, BOT].every((x) => !!x.cookie));

const PATH = '/api/system/notification-channels';
ok('Chưa đăng nhập → 401', (await call({}, 'GET', PATH)).status === 401);
ok('Nhân viên → 403', (await json(EMP.cookie, 'GET', PATH)).status === 403);
ok('HR (không phải admin) → 403', (await json(HR.cookie, 'GET', PATH)).status === 403);
const tok = (await json(admin, 'POST', '/api/auth/access-tokens', { name: `kn ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Token AI của admin → 403', (await call({ authorization: `Bearer ${tok}` }, 'GET', PATH)).status === 403);

const get = async () => {
  const r = await json(admin, 'GET', PATH);
  return { r, by: (k: string) => (r.body as any[]).find((c) => c.key === k) };
};
let { r, by } = await get();
ok('Admin thấy đủ 5 kênh theo thứ tự', r.status === 200 && JSON.stringify(r.body.map((c: any) => c.key)) === JSON.stringify(['bell', 'email', 'push', 'webhook', 'telegram']), r.body);
ok('Chuông: có sẵn, hoạt động, dùng cho mọi sự kiện có chuông (từ danh mục)', by('bell').source === 'builtin' && by('bell').health === 'ok'
  && by('bell').usedBy.length >= 37 && by('bell').usedBy.some((u: any) => u.key === 'approval.requested' && u.label === 'Có đơn chờ duyệt')
  && !by('bell').usedBy.some((u: any) => u.key.startsWith('chat.')), by('bell'));
ok('Chip "Dùng cho" lấy từ danh mục: Telegram = giao + trả lại việc, webhook có tin 1-1, email không có giao việc',
  JSON.stringify(by('telegram').usedBy.map((u: any) => u.key)) === JSON.stringify(['projects.task_assigned', 'projects.task_returned'])
  && by('webhook').usedBy.some((u: any) => u.key === 'chat.direct') && by('push').usedBy.some((u: any) => u.key === 'chat.room')
  && by('email').usedBy.some((u: any) => u.key === 'people.account_security') && !by('email').usedBy.some((u: any) => u.key === 'projects.task_assigned'),
  { telegram: by('telegram').usedBy, email: by('email').usedBy.map((u: any) => u.key) });

// TEST-59: danh mục sự kiện theo nhóm
const EV = `${PATH}/events`;
ok('Danh mục sự kiện: chưa đăng nhập 401, nhân viên / HR / token AI 403', (await call({}, 'GET', EV)).status === 401
  && (await json(EMP.cookie, 'GET', EV)).status === 403 && (await json(HR.cookie, 'GET', EV)).status === 403
  && (await call({ authorization: `Bearer ${tok}` }, 'GET', EV)).status === 403);
const ev = await json(admin, 'GET', EV);
const evAll = (ev.body as any[] ?? []).flatMap((g: any) => g.events);
const evBy = (k: string) => evAll.find((e: any) => e.key === k);
const chans = (k: string) => (evBy(k)?.channels ?? []).map((c: any) => c.channel).join(',');
ok('Danh mục: theo nhóm, mỗi nhóm có sự kiện, mã duy nhất', ev.status === 200 && ev.body.length >= 10 && ev.body.every((g: any) => g.name && g.events.length > 0)
  && new Set(evAll.map((e: any) => e.key)).size === evAll.length && ev.body[0].key === 'approval', ev.body?.map?.((g: any) => g.key));
ok('Danh mục: kênh đúng theo sự kiện', chans('projects.task_assigned') === 'bell,push,webhook,telegram' && chans('projects.task_returned') === 'bell,push,webhook,telegram'
  && chans('projects.task_comment') === 'bell,push,webhook' && chans('people.account_security') === 'bell,email,push,webhook'
  && chans('chat.direct') === 'push,webhook' && chans('chat.room') === 'push'
  && evBy('approval.approved')?.channels.find((c: any) => c.channel === 'email')?.note?.includes('bước cuối'),
  { assigned: chans('projects.task_assigned'), sec: chans('people.account_security'), direct: chans('chat.direct') });
ok('Email: đã cấu hình, nguồn .env, link nhóm smtp', by('email').configured && by('email').source === 'env' && by('email').configGroup === 'smtp', by('email'));
const fcmCfg = (await json(admin, 'GET', '/api/system/settings/fcm')).body;
ok('Push: trạng thái khớp cấu hình FCM', by('push').configured === fcmCfg.secrets.serviceAccountJson && by('push').configGroup === 'fcm'
  && (fcmCfg.secrets.serviceAccountJson ? by('push').source === 'env' : by('push').source === 'none') && !!by('push').statsSince, { push: by('push'), fcm: fcmCfg.secrets });
ok('Webhook: mỗi người tự cài, không có khung cấu hình chung', by('webhook').source === 'user' && by('webhook').configGroup === null);
ok('Telegram: chưa cấu hình → tắt', by('telegram').source === 'none' && by('telegram').configured === false && by('telegram').health === 'off', by('telegram'));

// Đổi cấu hình → trạng thái đổi
const SMTP_PW = `kn-smtp-${stamp}-secret`;
await json(admin, 'PUT', '/api/system/settings/smtp', { values: { host: '127.0.0.1', port: 11061, fromEmail: `kn-${stamp}@officehub-e2e.vn` }, secrets: { password: SMTP_PW } });
({ r, by } = await get());
ok('Lưu SMTP trên trang → email nguồn db', by('email').source === 'db' && by('email').detail.startsWith('127.0.0.1:11061'), by('email'));
await json(admin, 'DELETE', '/api/system/settings/smtp');
({ r, by } = await get());
ok('Dùng lại .env → email nguồn env', by('email').source === 'env');

await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: false, chatId: '-1009876543210' }, secrets: { botToken: GOOD } });
({ r, by } = await get());
ok('Telegram lưu nhưng tắt → đã cấu hình, chưa bật, off', by('telegram').configured && !by('telegram').enabled && by('telegram').health === 'off' && by('telegram').source === 'db', by('telegram'));
await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1009876543210' } });
({ r, by } = await get());
ok('Bật Telegram → enabled, ok (lỗi của cấu hình cũ không tính), chi tiết có chat id', by('telegram').enabled && by('telegram').health === 'ok' && by('telegram').detail.includes('-1009876543210'), by('telegram'));

// Gửi thật qua hàng đợi (Telegram giả) → lần thành công
await json(admin, 'PUT', `/api/org/employees/${BOT.e.id}/account/bot`, { isBot: true });
await json(admin, 'PUT', `/api/org/employees/${BOT.e.id}/account/telegram`, { telegramBot: `@kn_${stamp}_bot` });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `kn-${stamp}`, name: 'Kênh E2E', kind: 'Internal', startOn: today, memberIds: [BOT.e.id] })).body;
await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Giao bot', assigneeEmployeeId: BOT.e.id });
await until(() => sent.some((s) => s.text.startsWith(`@kn_${stamp}_bot`)));
await sleep(1500);
({ r, by } = await get());
ok('Sau khi gửi được: lastSuccessAt có, dùng cho "Được giao việc"', !!by('telegram').lastSuccessAt && by('telegram').health === 'ok'
  && by('telegram').usedBy[0]?.label === 'Được giao việc', by('telegram'));

// Token sai → lỗi gần nhất, health error, không lộ token
await json(admin, 'PUT', '/api/system/settings/telegram', { values: { enabled: true, chatId: '-1009876543210' }, secrets: { botToken: BAD } });
await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Giao bot lần 2', assigneeEmployeeId: BOT.e.id });
await sleep(5000);
({ r, by } = await get());
ok('Token sai → health error, lastError có 401', by('telegram').health === 'error' && !!by('telegram').lastFailureAt && String(by('telegram').lastError).includes('401'), by('telegram'));
ok('Response không chứa token / mật khẩu / khoá', !r.text.includes('AAH-e2e') && !r.text.includes(SMTP_PW) && !r.text.includes('PRIVATE KEY'));

// Dọn
await json(admin, 'DELETE', '/api/system/settings/telegram');
({ r, by } = await get());
ok('Xoá cấu hình Telegram → none / off', by('telegram').source === 'none' && by('telegram').health === 'off');

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
