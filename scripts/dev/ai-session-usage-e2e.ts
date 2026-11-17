// E2E TEST-134: mức dùng AI (chi phí / token) theo phiên agent.
// Bot gửi qua POST /mcp/usage (host Mcp, token AI của bot) → Api lưu audit.ai_usage_sessions; đọc /api/ai-usage/summary|sessions|export bằng cookie.
// Kiểm tra: chỉ bot gửi được (người thật 403, không token 401), 2 phiên (1 có chi phí, 1 không), gửi lại cùng sourceId → cập nhật không trùng,
// cùng sourceId ở bot khác là phiên khác, 400 dữ liệu sai (thiếu sourceId, giờ không múi giờ, > 50 phiên), đường nội bộ Api không khoá → 401,
// gộp theo ngày giờ VN (23:30 UTC → ngày hôm sau) / tháng, quyền xem (của mình; người khác / all → 403; admin xem tất cả), token AI đọc → 403, Excel.
// CHỈ DB tạm. Cần Api :5180 + Mcp :5200 (Mcp__ApiBaseUrl=http://localhost:5180), cùng Chat__InternalKey (lệnh: .agent/e2e.md "Test trên DB tạm").
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_BASE=http://localhost:5200 ADMIN_LOGIN=… ADMIN_PASSWORD=… [INTERNAL_KEY=…] bun scripts/dev/ai-session-usage-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const MCP_BASE = process.env.MCP_BASE ?? 'http://localhost:5200';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const INTERNAL_KEY = process.env.INTERNAL_KEY ?? '';
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
  return { status: r.status, body: await r.json().catch(() => null) as any, type: r.headers.get('content-type') ?? '' };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const vnDate = (d: Date) => d.toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const today = vnDate(new Date());

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const dep = (await json(admin, 'POST', '/api/org/departments', { name: `AI usage ${stamp}`, code: `AU${stamp}`.slice(0, 10) })).body;
let seq = 700 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV${seq++}${stamp}`.slice(0, 20), fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, cookie, userId: me?.id as string, token: t?.token as string, name };
};
const H = await mkEmp('Người Thật Mức Dùng', `e2e.auh.${stamp}`);
const B1 = await mkEmp('Bot Dev Mức Dùng', `e2e.aub1.${stamp}`);
const B2 = await mkEmp('Bot QA Mức Dùng', `e2e.aub2.${stamp}`);
ok('3 tài khoản + token', [H, B1, B2].every((x) => x.userId && x.token?.startsWith('ohk_')));
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

const usage = async (token: string | null, body: unknown, raw?: string) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const r = await fetch(`${MCP_BASE}/mcp/usage`, { method: 'POST', headers, body: raw ?? JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

// Phiên kết thúc 23:30 UTC hôm qua (theo ngày VN hôm nay) = 06:30 sáng nay giờ VN → thuộc ngày hôm nay.
const [y, m, d] = today.split('-').map(Number);
const finished1 = new Date(Date.UTC(y, m - 1, d - 1, 23, 30));
const started1 = new Date(finished1.getTime() - 15 * 60_000);
const s1 = {
  sourceId: `e2e:${stamp}:job-1`, kind: 'task', taskCode: 'TEST-134', executor: 'claude', status: 'done',
  startedAt: started1.toISOString(), finishedAt: finished1.toISOString(), turns: 12, costUsd: 1.25,
  models: [
    { model: 'claude-opus-5-5', inputTokens: 1000, outputTokens: 200, cacheReadTokens: 5000, cacheWriteTokens: 300, costUsd: 1.0 },
    { model: 'claude-haiku-5-5', inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.25 },
  ],
};
const now = new Date();
const s2 = { sourceId: `e2e:${stamp}:chat-1`, kind: 'chat', executor: 'custom', status: 'done',
  startedAt: new Date(now.getTime() - 120_000).toISOString(), finishedAt: new Date(now.getTime() - 60_000).toISOString() };

// ---------- Ghi: quyền ----------
ok('không token → 401', (await usage(null, { sessions: [s1] })).status === 401);
const human = await usage(H.token, { sessions: [s1] });
ok('người thật dùng token → 403', human.status === 403, human);

// ---------- Ghi: kiểm tra dữ liệu ----------
ok('thiếu sourceId → 400', (await usage(B1.token, { sessions: [{ ...s1, sourceId: '' }] })).status === 400);
const noZone = await usage(B1.token, { sessions: [{ ...s2, finishedAt: '2026-11-17T08:00:00' }] });
ok('thời điểm không múi giờ → 400', noZone.status === 400, noZone);
ok('> 50 phiên → 400', (await usage(B1.token, { sessions: Array.from({ length: 51 }, (_, i) => ({ ...s2, sourceId: `x${i}` })) })).status === 400);
ok('chi phí âm → 400', (await usage(B1.token, { sessions: [{ ...s1, costUsd: -1 }] })).status === 400);
ok('tương lai > 1 ngày → 400', (await usage(B1.token, { sessions: [{ ...s2, finishedAt: new Date(now.getTime() + 2 * 86_400_000).toISOString() }] })).status === 400);
ok('body hỏng → 400', (await usage(B1.token, null, '{"sessions": [')).status === 400);

// ---------- Ghi: 2 phiên, gửi lại ----------
const first = await usage(B1.token, { sessions: [s1, s2] });
ok('bot gửi 2 phiên (1 có chi phí, 1 không) → 200 created 2', first.status === 200 && first.body?.accepted === 2 && first.body?.created === 2, first);
const again = await usage(B1.token, { sessions: [{ ...s1, costUsd: 1.5, models: [{ ...s1.models[0], costUsd: 1.25 }, s1.models[1]] }] });
ok('gửi lại cùng sourceId → updated 1, không tạo mới', again.status === 200 && again.body?.created === 0 && again.body?.updated === 1, again);
const other = await usage(B2.token, { sessions: [s1] });
ok('bot khác cùng sourceId → phiên riêng (created 1)', other.status === 200 && other.body?.created === 1, other);

// Đường nội bộ Api không mở cho ai không có khoá
const internal = await fetch(`${API}/api/audit/internal/ai-usage`, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ userId: B1.userId, sessions: [s2] }) });
ok('Api /api/audit/internal/ai-usage không khoá → 401', internal.status === 401);
const wrongKey = await fetch(`${API}/api/audit/internal/ai-usage`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': 'sai'.repeat(12) },
  body: JSON.stringify({ userId: B1.userId, sessions: [s2] }) });
ok('Api đường nội bộ sai khoá → 401', wrongKey.status === 401);
if (INTERNAL_KEY) {
  const right = await fetch(`${API}/api/audit/internal/ai-usage`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Internal-Key': INTERNAL_KEY },
    body: JSON.stringify({ userId: B1.userId, sessions: [{ ...s2, sourceId: '' }] }) });
  ok('Api đường nội bộ đúng khoá, dữ liệu sai → 400', right.status === 400);
}
ok('token AI không ghi thẳng Api (cookie-less, không khoá) → 401', (await fetch(`${API}/api/audit/internal/ai-usage`, { method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${B1.token}` }, body: JSON.stringify({ userId: B1.userId, sessions: [s2] }) })).status === 401);

// ---------- Đọc: bot xem của mình ----------
const sum = await json(B1.cookie, 'GET', '/api/ai-usage/summary');
const t = sum.body?.total;
ok('bot xem của mình: 2 phiên (gửi lại không đếm hai lần)', sum.status === 200 && t?.sessions === 2, sum.body);
ok('tổng chi phí = chi phí mới 1.5, costMissing = 1', Math.abs((t?.costUsd ?? 0) - 1.5) < 1e-9 && t?.costMissing === 1, t);
ok('token cộng các model (input 1100, cache đọc 5000)', t?.inputTokens === 1100 && t?.cacheReadTokens === 5000, t);
const opus = sum.body?.groups?.find((g: any) => g.model === 'claude-opus-5-5');
ok('phiên 23:30 UTC hôm qua → kỳ hôm nay (giờ VN)', opus?.bucket === today && opus?.costUsd === 1.25, sum.body?.groups);
const unknown = sum.body?.groups?.find((g: any) => g.model === 'không rõ');
ok('phiên không model / không chi phí → dòng "không rõ", costMissing 1', unknown?.sessions === 1 && unknown?.costMissing === 1 && unknown?.costUsd === 0, unknown);
const byMonth = await json(B1.cookie, 'GET', '/api/ai-usage/summary?group=month');
ok('group=month → kỳ yyyy-MM', byMonth.status === 200 && byMonth.body?.buckets?.length === 1 && byMonth.body.buckets[0].bucket === today.slice(0, 7), byMonth.body?.buckets);
const byYear = await json(B1.cookie, 'GET', '/api/ai-usage/summary?group=year');
ok('group=year → kỳ yyyy, mặc định 5 năm', byYear.status === 200 && byYear.body?.buckets?.[0]?.bucket === today.slice(0, 4)
  && byYear.body?.from === `${Number(today.slice(0, 4)) - 4}-01-01`, byYear.body);
ok('group sai → 400', (await json(B1.cookie, 'GET', '/api/ai-usage/summary?group=week')).status === 400);
ok('from > to → 400', (await json(B1.cookie, 'GET', '/api/ai-usage/summary?from=2026-12-01&to=2026-11-01')).status === 400);
const past = await json(B1.cookie, 'GET', `/api/ai-usage/summary?from=2025-01-01&to=2025-01-31`);
ok('khoảng không có phiên → 0', past.status === 200 && past.body?.total?.sessions === 0 && past.body?.groups?.length === 0, past.body);

const list = await json(B1.cookie, 'GET', '/api/ai-usage/sessions?page=1&pageSize=10');
const it = list.body?.items ?? [];
ok('danh sách phiên phân trang: 2, mới nhất trước', list.status === 200 && list.body?.total === 2 && it[0]?.sourceId === s2.sourceId, list.body);
const job = it.find((x: any) => x.sourceId === s1.sourceId);
ok('phiên task: mã việc, 2 model, thời lượng 900 giây, lượt 12', job?.taskCode === 'TEST-134' && job?.models?.length === 2 && job?.durationSeconds === 900
  && job?.turns === 12 && job?.costUsd === 1.5, job);
ok('danh sách không page → mảng', Array.isArray((await json(B1.cookie, 'GET', '/api/ai-usage/sessions')).body));

// ---------- Quyền đọc ----------
const hOwn = await json(H.cookie, 'GET', '/api/ai-usage/summary');
ok('nhân viên xem của mình → 200, 0 phiên', hOwn.status === 200 && hOwn.body?.total?.sessions === 0, hOwn.body);
ok('nhân viên xem của bot → 403', (await json(H.cookie, 'GET', `/api/ai-usage/summary?userId=${B1.userId}`)).status === 403);
ok('nhân viên userId=all → 403', (await json(H.cookie, 'GET', '/api/ai-usage/summary?userId=all')).status === 403);
ok('nhân viên xem phiên của bot → 403', (await json(H.cookie, 'GET', `/api/ai-usage/sessions?userId=${B1.userId}`)).status === 403);
ok('bot B2 xem của B1 → 403', (await json(B2.cookie, 'GET', `/api/ai-usage/summary?userId=${B1.userId}`)).status === 403);
ok('userId sai định dạng → 400', (await json(admin, 'GET', '/api/ai-usage/summary?userId=abc')).status === 400);
const aOne = await json(admin, 'GET', `/api/ai-usage/summary?userId=${B1.userId}`);
ok('admin xem B1 → 2 phiên', aOne.status === 200 && aOne.body?.total?.sessions === 2 && aOne.body?.userId === B1.userId, aOne.body?.total);
const aAll = await json(admin, 'GET', '/api/ai-usage/summary?userId=all');
ok('admin xem tất cả → 3 phiên (B1 2 + B2 1), userId null', aAll.status === 200 && aAll.body?.total?.sessions === 3 && aAll.body?.userId === null, aAll.body?.total);
const aList = await json(admin, 'GET', '/api/ai-usage/sessions?userId=all&page=1');
ok('admin danh sách tất cả có tên bot', aList.status === 200 && aList.body?.total === 3 && aList.body.items.some((x: any) => x.fullName === B2.name), aList.body?.items?.map((x: any) => x.fullName));
const tokRead = await fetch(`${API}/api/ai-usage/summary`, { headers: { authorization: `Bearer ${B1.token}` } });
ok('token AI đọc /api/ai-usage → 403', tokRead.status === 403);

// ---------- Excel ----------
const xl = await fetch(`${API}/api/ai-usage/export?userId=all&group=month`, { headers: { cookie: admin } });
const buf = new Uint8Array(await xl.arrayBuffer());
ok('admin xuất Excel → xlsx (PK…)', xl.status === 200 && (xl.headers.get('content-type') ?? '').includes('spreadsheetml') && buf[0] === 0x50 && buf[1] === 0x4b);
ok('nhân viên xuất Excel của bot → 403', (await fetch(`${API}/api/ai-usage/export?userId=${B1.userId}`, { headers: { cookie: H.cookie } })).status === 403);

// ---------- Không vào nhật ký AI ----------
const logs = await json(admin, 'GET', `/api/audit/ai-requests?userId=${B1.userId}`);
const paths: string[] = (Array.isArray(logs.body) ? logs.body : logs.body?.items ?? []).map((x: any) => x.path);
ok('nhật ký AI không có dòng /api/audit/internal', logs.status === 200 && !paths.some((p) => p?.includes('/internal/')), paths.slice(0, 5));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
