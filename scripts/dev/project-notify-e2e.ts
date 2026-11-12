// E2E TEST-32 + TEST-38: chuông cho MỌI thành viên dự án khi việc được tạo / đổi trạng thái / có bình luận (bỏ người thao tác, mỗi người ≤ 1 chuông / sự kiện);
// thao tác qua token AI (BOT) cũng báo. Người ngoài dự án và thành viên đã nghỉ việc không nhận.
// TẠO DỮ LIỆU THẬT → CHỈ chạy trên DB tạm (Api :5180 trỏ DB tạm, `dotnet run --no-launch-profile`):
//   MCP tuỳ chọn: MCP_URL=http://localhost:5200/mcp (host Mcp với Mcp__ApiBaseUrl=http://localhost:5180)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 PG_CONTAINER=officehub-e2e-pg PG_USER=e2e PG_DB=officehub_e2e ADMIN_LOGIN=… ADMIN_PASSWORD=… \
//     bun scripts/dev/project-notify-e2e.ts
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const MCP = process.env.MCP_URL ?? '';
const PG = process.env.PG_CONTAINER ?? 'officehub-e2e-pg', PG_USER = process.env.PG_USER ?? 'e2e', PG_DB = process.env.PG_DB ?? 'officehub_e2e';
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
const call = async (headers: Record<string, string>, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { ...headers, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const json = (cookie: string, method: string, path: string, body?: unknown) => call({ cookie }, method, path, body);
const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV NT ${stamp}`, level: 7, financePermissions: 0 })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Thông báo E2E ${stamp}`, code: `NT${stamp}` })).body;
const mkEmp = async (code: string, name: string, user: string, roles: string[]) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const PM = await mkEmp(`NM${stamp}`, 'Quản Lý NT', `e2e.nt.pm.${stamp}`, ['employee', 'manager']);
const A = await mkEmp(`NA${stamp}`, 'Thành Viên A', `e2e.nt.a.${stamp}`, ['employee']);
const B = await mkEmp(`NB${stamp}`, 'Thành Viên B', `e2e.nt.b.${stamp}`, ['employee']);
const Bot = await mkEmp(`NX${stamp}`, 'Bot NT', `e2e.nt.bot.${stamp}`, ['employee']);
const O = await mkEmp(`NO${stamp}`, 'Người Ngoài NT', `e2e.nt.out.${stamp}`, ['employee']);
ok('5 nhân viên đăng nhập', [PM, A, B, Bot, O].every((x) => !!x.cookie));

const pr = await json(PM.cookie, 'POST', '/api/projects', { code: `nt-${stamp}`, name: 'Thông báo NT', kind: 'Internal', startOn: today,
  memberIds: [A.e.id, B.e.id, Bot.e.id] });
ok('Tạo dự án (201)', pr.status === 201, pr);
const P = pr.body, CODE = `NT-${stamp}`.toUpperCase();
const cols = (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body.columns as any[];
const [todo, doing] = cols;

// Chuông project_task kể từ mốc `since` (đọc số mục mới, bỏ chuông trước đó)
const bells = async (c: string) => ((await json(c, 'GET', '/api/notifications?take=100')).body?.items ?? []).filter((n: any) => n.category === 'project_task') as any[];
const snap = async () => Object.fromEntries(await Promise.all(Object.entries({ PM, A, B, Bot, O }).map(async ([k, x]) => [k, (await bells(x.cookie)).map((n) => n.id)])));
const fresh = async (before: Record<string, string[]>) =>
  Object.fromEntries(await Promise.all(Object.entries({ PM, A, B, Bot, O }).map(async ([k, x]) => [k, (await bells(x.cookie)).filter((n) => !before[k].includes(n.id))])));

// 1) A tạo việc giao cho B → B nhận "được giao" (1 chuông), PM + Bot nhận "Việc mới", A và người ngoài không
let before = await snap();
const t1 = await json(A.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Viết tài liệu', assigneeEmployeeId: B.e.id });
ok('A tạo việc (201)', t1.status === 201, t1);
let got = await fresh(before);
ok('Tạo việc: PM + Bot nhận "Việc mới"', [got.PM, got.Bot].every((l) => l.length === 1 && l[0].title === `Việc mới ${CODE}-1: Viết tài liệu`), got);
ok('Tạo việc: người được giao nhận đúng 1 chuông (giao việc, không thêm "Việc mới")', got.B.length === 1 && got.B[0].title.startsWith('Bạn được giao việc'), got.B);
ok('Tạo việc: người tạo + người ngoài dự án không nhận', got.A.length === 0 && got.O.length === 0, { A: got.A, O: got.O });
ok('Chuông dẫn về trang dự án', got.PM[0]?.link === `/projects/${P}`, got.PM[0]);

// 2) B kéo sang "Đang làm" → mọi thành viên trừ B
before = await snap();
ok('B chuyển Đang làm (204)', (await json(B.cookie, 'POST', `/api/projects/tasks/${t1.body}/move`, { columnId: doing.id })).status === 204);
got = await fresh(before);
const movedTitle = `Thành Viên B chuyển ${CODE}-1 sang "${doing.name}"`;
ok('Đổi trạng thái: PM + A + Bot nhận', [got.PM, got.A, got.Bot].every((l) => l.length === 1 && l[0].title === movedTitle), got);
ok('Đổi trạng thái: nội dung có cột cũ → mới', got.A[0]?.body?.includes(`${todo.name} → ${doing.name}`), got.A[0]);
ok('Đổi trạng thái: người thao tác + người ngoài không nhận', got.B.length === 0 && got.O.length === 0, { B: got.B, O: got.O });

// 3) Sửa việc nhưng không đổi cột → không chuông chung
before = await snap();
ok('PUT chỉ sửa tên (204)', (await json(A.cookie, 'PUT', `/api/projects/tasks/${t1.body}`, { title: 'Viết tài liệu v2', assigneeEmployeeId: B.e.id })).status === 204);
got = await fresh(before);
ok('Sửa không đổi cột: không ai nhận chuông', Object.values(got).every((l) => l.length === 0), got);

// 4) Lùi kèm lý do qua PUT (dự án đi lần lượt) → B (người làm) nhận "Trả lại việc" (1 chuông), còn lại nhận chuông chuyển có lý do
before = await snap();
ok('PM lùi về Cần làm kèm lý do (204)', (await json(PM.cookie, 'PUT', `/api/projects/tasks/${t1.body}`,
  { title: 'Viết tài liệu v2', assigneeEmployeeId: B.e.id, columnId: todo.id, note: 'Thiếu mục lục' })).status === 204);
got = await fresh(before);
ok('Lùi: người làm nhận đúng 1 chuông "Trả lại việc"', got.B.length === 1 && got.B[0].title.startsWith('Trả lại việc'), got.B);
ok('Lùi: A + Bot nhận chuông chuyển kèm lý do, PM không', [got.A, got.Bot].every((l) => l.length === 1 && l[0].body.includes('Lý do: Thiếu mục lục')) && got.PM.length === 0, got);

// 5) Bình luận: A bình luận, @nhắc Bot → Bot nhận "nhắc bạn", B (người làm) + PM nhận "bình luận", A không
before = await snap();
ok('A bình luận (201)', (await json(A.cookie, 'POST', `/api/projects/tasks/${t1.body}/comments`, { content: `Nhờ @${Bot.e.code} xem giúp` })).status === 201);
got = await fresh(before);
ok('Bình luận: PM + B nhận "bình luận"', [got.PM, got.B].every((l) => l.length === 1 && l[0].title === `Thành Viên A bình luận việc ${CODE}-1`), got);
ok('Bình luận: người được @nhắc chỉ nhận 1 chuông "nhắc bạn"', got.Bot.length === 1 && got.Bot[0].title.startsWith('Thành Viên A nhắc bạn'), got.Bot);
ok('Bình luận: người viết + người ngoài không nhận', got.A.length === 0 && got.O.length === 0, { A: got.A, O: got.O });

// 6) BOT (token AI) tạo việc / chuyển / bình luận → người thật nhận như thường
const tok = (await json(Bot.cookie, 'POST', '/api/auth/access-tokens', { name: `bot ${stamp}`, expiresInDays: 30 })).body?.token as string;
ok('Bot có token AI', !!tok);
const bearer = { authorization: `Bearer ${tok}` };
before = await snap();
const t2 = await call(bearer, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc của bot' });
ok('Bot tạo việc qua token (201)', t2.status === 201, t2);
ok('Bot chuyển Đang làm (204)', (await call(bearer, 'POST', `/api/projects/tasks/${t2.body}/move`, { columnId: doing.id })).status === 204);
ok('Bot bình luận (201)', (await call(bearer, 'POST', `/api/projects/tasks/${t2.body}/comments`, { content: 'Đã bắt đầu' })).status === 201);
got = await fresh(before);
const titles = (l: any[]) => l.map((n) => n.title).sort();
const botExpected = [`Bot NT bình luận việc ${CODE}-2`, `Bot NT chuyển ${CODE}-2 sang "${doing.name}"`, `Việc mới ${CODE}-2: Việc của bot`].sort();
ok('BOT: PM, A, B mỗi người nhận 3 chuông (tạo, chuyển, bình luận)', [got.PM, got.A, got.B].every((l) => JSON.stringify(titles(l)) === JSON.stringify(botExpected)), got);
ok('BOT: chính tài khoản bot + người ngoài không nhận', got.Bot.length === 0 && got.O.length === 0, { Bot: got.Bot, O: got.O });

// 6b) TEST-38: sửa THÔNG TIN DỰ ÁN → mọi thành viên; web bỏ người sửa, token AI thì chủ token cũng nhận; không đổi gì → không gửi
const UPD = `Dự án ${CODE} đã được cập nhật`;
const detail = async () => (await json(PM.cookie, 'GET', `/api/projects/${P}`)).body;
const putProject = async (cookie: string, patch: Record<string, unknown>) => {
  const d = (await detail()).project;
  return json(cookie, 'PUT', `/api/projects/${P}`, { code: d.code, name: d.name, kind: d.kind, description: d.description, departmentId: d.departmentId,
    businessLineId: d.businessLineId, salesContractIds: [], startOn: d.startOn, endOn: d.endOn, budgetManDays: d.budgetManDays, status: d.status, sequential: d.sequential, ...patch });
};
before = await snap();
ok('PM sửa tên + kết thúc dự kiến (204)', (await putProject(PM.cookie, { name: 'Thông báo NT 2', endOn: '2026-12-15' })).status === 204);
got = await fresh(before);
ok('Sửa dự án (web): A, B, Bot mỗi người 1 chuông "đã được cập nhật"', [got.A, got.B, got.Bot].every((l) => l.length === 1 && l[0].title === UPD), got);
ok('Nội dung: người sửa + đúng các trường', got.A[0]?.body?.startsWith('Quản Lý NT đã sửa:') && got.A[0].body.includes('Tên: "Thông báo NT" → "Thông báo NT 2"')
  && got.A[0].body.includes('Kết thúc dự kiến: trống → 15/12/2026') && got.A[0].link === `/projects/${P}`, got.A[0]);
ok('Sửa dự án (web): người sửa + người ngoài không nhận', got.PM.length === 0 && got.O.length === 0, { PM: got.PM, O: got.O });
before = await snap();
ok('Lưu lại y nguyên (204)', (await putProject(PM.cookie, {})).status === 204);
ok('Không đổi gì → không ai nhận chuông', Object.values(await fresh(before)).every((l) => l.length === 0));
before = await snap();
await putProject(PM.cookie, { description: 'Nội dung mô tả bí mật', workGuide: '## Hướng dẫn bí mật' });
got = await fresh(before);
ok('Mô tả + hướng dẫn chỉ ghi "đã sửa", không chép nội dung', got.A.length === 1 && got.A[0].body.includes('Mô tả: đã sửa') && got.A[0].body.includes('Hướng dẫn làm việc: đã sửa')
  && !got.A[0].body.includes('bí mật'), got.A[0]);
// Token AI của quản lý dự án (đường của MCP update_project_guide)
const pmTok = (await json(PM.cookie, 'POST', '/api/auth/access-tokens', { name: `pm ${stamp}`, expiresInDays: 30 })).body?.token as string;
const pmBearer = { authorization: `Bearer ${pmTok}` };
before = await snap();
ok('Token: PUT /guide (200)', (await call(pmBearer, 'PUT', `/api/projects/${P}/guide`, { workGuide: '## Bản do bot sửa' })).status === 200);
got = await fresh(before);
ok('Sửa qua token: PM (chủ token) + A + B + Bot đều nhận, nhãn BOT, link tab Hướng dẫn', [got.PM, got.A, got.B, got.Bot].every((l) => l.length === 1 && l[0].title === UPD
  && l[0].body.startsWith('BOT (token của Quản Lý NT) đã sửa: Hướng dẫn làm việc: đã sửa') && l[0].link === `/projects/${P}?tab=guide`) && got.O.length === 0, got);
before = await snap();
await call(pmBearer, 'PUT', `/api/projects/${P}/guide`, { workGuide: '## Bản do bot sửa' });
ok('Token gửi lại cùng hướng dẫn → không ai nhận', Object.values(await fresh(before)).every((l) => l.length === 0));
if (MCP) {
  let rid = 0;
  const rpc = async (method: string, params: unknown = {}) => {
    const res = await fetch(MCP, { method: 'POST', headers: { ...pmBearer, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
    const text = await res.text();
    return JSON.parse(text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text);
  };
  await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
  before = await snap();
  const m = await rpc('tools/call', { name: 'update_project_guide', arguments: { project: CODE, guide: '## Bản qua MCP' } });
  got = await fresh(before);
  ok('MCP update_project_guide → chủ token + thành viên nhận chuông BOT', !m?.result?.isError && [got.PM, got.A, got.Bot].every((l) => l.length === 1 && l[0].body.startsWith('BOT (token')), { m: m?.result, got });
}

// 7) Thành viên nghỉ việc không nhận — B đã bị khoá nên đọc chuông của B thẳng từ DB tạm
const bUser = (await json(admin, 'GET', `/api/org/employees/${B.e.id}`)).body?.employee?.userId ?? (await json(admin, 'GET', `/api/org/employees/${B.e.id}`)).body?.userId;
const bCount = async () => Number((await $`docker exec ${PG} psql -U ${PG_USER} -d ${PG_DB} -tAc ${`select count(*) from notifications.notifications where "UserId" = '${bUser}' and ("Title" like 'Việc mới %' or "Title" like 'Dự án %')`}`.text()).trim());
ok('Có userId của B để đọc DB', !!bUser);
const bBefore = await bCount();
ok('Nghỉ việc B', (await json(admin, 'POST', '/api/org/employees/bulk/resign', { ids: [B.e.id], leftAt: today })).status === 200);
before = await snap();
ok('A tạo việc thứ 3 (201)', (await json(A.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Sau khi B nghỉ' })).status === 201);
got = await fresh(before);
ok('Sau nghỉ việc: PM + Bot nhận', got.PM.length === 1 && got.Bot.length === 1, got);
before = await snap();
await putProject(PM.cookie, { status: 'Closed' });
got = await fresh(before);
ok('Đóng dự án → Bot nhận "Trạng thái: Đang chạy → Đã đóng"', got.Bot.length === 1 && got.Bot[0].body.includes('Trạng thái: Đang chạy → Đã đóng'), got.Bot);
ok('Sau nghỉ việc: B không có chuông mới trong DB', (await bCount()) === bBefore, { bBefore, after: await bCount() });

console.log(`\n${pass} đạt / ${fail} lỗi`);
process.exit(fail ? 1 : 0);
