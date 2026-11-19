// E2E TEST-179: MCP + giao diện sau khi bỏ người review (TEST-178).
// MCP: tools/list không còn tham số `reviewer` (create_task / update_task), get_project / get_task trả columns[].wakeFollowers, get_task không có `reviewer`,
//      ServerInstructions không còn vòng cố định "Doing → Review → Done" (bot đọc get_my_role + workGuide), get_my_role: token bot → ghi chú
//      "quy trình làm việc của vai trò bạn", token người thật → ghi chú "tài liệu tham khảo".
// Giao diện (Chrome headless 1440×900): hộp thoại việc không còn ô "Người review"; hộp thoại cột có công tắc "Đánh thức bot theo dõi"
//      — tick / bỏ tick lưu đúng (kiểm qua API), tiêu đề cột có biểu tượng bot khi bật (TEST-189). Ảnh vào SHOTS_DIR.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Api (backend/) như đầu task-column-wake-e2e.ts (+ Telegram__ApiUrl=http://127.0.0.1:9), Mcp cùng Api, Vite trỏ Api:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5293 MCP_URL=http://localhost:5213/mcp BASE_URL=http://localhost:5183 ADMIN_LOGIN=… ADMIN_PASSWORD=… \
//     bun scripts/dev/task-wake-ui-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5293';
const MCP = process.env.MCP_URL ?? 'http://localhost:5213/mcp';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/task-wake-ui`;
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
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const stamp = Date.now().toString(36).slice(-5);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });

// ── Dữ liệu: quản lý dự án (người, được sửa cột), bot thợ, người thật theo dõi ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV UW ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead UW ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wake UI ${stamp}`, code: `UW${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const token = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body?.token as string;
  return { e, code, name, cookie, token, user };
};
const PM = await mkEmp(`UM${stamp}`, 'Quản Lý Cột', `e2e.uw.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Bot = await mkEmp(`UB${stamp}`, 'Bot Review', `e2e.uw.bot.${stamp}`, ['employee']);
const Hum = await mkEmp(`UH${stamp}`, 'Người Thật', `e2e.uw.hum.${stamp}`, ['employee']);
ok('3 tài khoản + token AI', [PM, Bot, Hum].every((x) => x.cookie && x.token?.startsWith('ohk_')));
ok('đánh dấu Bot là tài khoản bot', (await json(admin, 'PUT', `/api/org/employees/${Bot.e.id}/account/bot`, { isBot: true })).status < 300);
const CODE = `UW${stamp}`.toUpperCase();
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: CODE, name: 'Cột đánh thức (UI)', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Bot.e.id, Hum.e.id] })).body as string;
let cols = (await json(PM.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
const col = (n: string) => cols.find((c) => c.name === n)!.id as string;
const DOING = col('Đang làm');
const T = (await json(PM.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc có bot theo dõi', columnId: DOING, assigneeEmployeeId: Hum.e.id })).body as string;
ok('thêm Bot làm người theo dõi', (await json(PM.cookie, 'POST', `/api/projects/tasks/${T}/followers/${Bot.e.id}`, {})).status < 300);

// ── MCP ──
let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(MCP, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown>) => {
  const x = await rpc(token, 'tools/call', { name, arguments: args });
  const text = x?.result?.content?.[0]?.text ?? '';
  try { return { err: !!x?.result?.isError, j: JSON.parse(text) as any, text }; } catch { return { err: !!x?.result?.isError, j: null as any, text }; }
};
const init = await rpc(Bot.token, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
const instr = String(init?.result?.instructions ?? '');
ok('instructions: bot đọc get_my_role + workGuide, có wakeFollowers, không còn vòng "update_task_status Review"',
  instr.includes('get_my_role') && instr.includes('wakeFollowers') && !instr.includes('update_task_status Review') && !instr.includes('requireReview'), instr.slice(0, 300));
const tools = ((await rpc(Bot.token, 'tools/list'))?.result?.tools ?? []) as any[];
const tool = (n: string) => tools.find((t) => t.name === n);
ok('create_task / update_task không còn tham số reviewer',
  !!tool('create_task') && !!tool('update_task') && !('reviewer' in (tool('create_task').inputSchema?.properties ?? {})) && !('reviewer' in (tool('update_task').inputSchema?.properties ?? {})));
ok('mô tả get_project nói wakeFollowers, update_task_status theo workGuide',
  String(tool('get_project')?.description).includes('wakeFollowers') && String(tool('update_task_status')?.description).includes('workGuide')
  && !String(tool('update_task_status')?.description).includes('ngay trước trạng thái cần duyệt'));
const gp = await call(Bot.token, 'get_project', { project: CODE });
ok('get_project → columns[].wakeFollowers ("Chờ review" bật)', !gp.err && gp.j.columns?.find((c: any) => c.name === 'Chờ review')?.wakeFollowers === true
  && gp.j.columns.every((c: any) => typeof c.wakeFollowers === 'boolean' && !('isReview' in c)), gp.text.slice(0, 300));
const gt = await call(Bot.token, 'get_task', { task: T });
ok('get_task: không có reviewer, có followers + columns[].wakeFollowers', !gt.err && !('reviewer' in gt.j) && gt.j.followers?.some((f: any) => f.employeeId === Bot.e.id)
  && gt.j.columns?.some((c: any) => c.wakeFollowers === true), gt.text.slice(0, 300));
const ut = await call(Bot.token, 'update_task', { task: T, title: 'Việc có bot theo dõi (sửa qua MCP)' });
ok('update_task vẫn chạy, kết quả không có reviewer', !ut.err && ut.j.title?.includes('sửa qua MCP') && !('reviewer' in ut.j), ut.text.slice(0, 300));
const rb = await call(Bot.token, 'get_my_role', {});
ok('get_my_role token bot → ghi chú "quy trình làm việc của vai trò bạn"', !rb.err && String(rb.j._note).includes('QUY TRÌNH LÀM VIỆC') && String(rb.j._note).includes('không duyệt'), rb.j?._note);
const rh = await call(Hum.token, 'get_my_role', {});
ok('get_my_role token người thật → ghi chú cũ "tài liệu tham khảo"', !rh.err && String(rh.j._note).includes('TÀI LIỆU THAM KHẢO'), rh.j?._note);

// ── Giao diện ──
const br = await launch(9339, `${tmpdir()}/task-wake-ui-${stamp}`);
try {
  ok('đăng nhập UI quản lý dự án', (await br.login(PM.user, PW)) === 200);
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await br.shot(`${SHOTS}/1-board.png`);
  ok('tiêu đề cột "Chờ review" có biểu tượng bot đánh thức, "Đang làm" không',
    await br.evalJs(`!!document.querySelector('[data-testid="col-Chờ review"] [data-testid="col-wake-icon"]') && !document.querySelector('[data-testid="col-Đang làm"] [data-testid="col-wake-icon"]')`));
  const openCol = async (name: string) => {
    await br.evalJs(`document.querySelector('[aria-label="Sửa trạng thái ${name}"]').click()`);
    await br.sleep(700);
  };
  await openCol('Đang làm');
  const dlg = await br.evalJs(`(() => { const d = document.querySelector('[data-testid="column-dialog"]'); return d ? { text: d.innerText, wake: !!d.querySelector('[data-testid="col-wake"]'), checked: d.querySelector('[data-testid="col-wake"]')?.getAttribute('aria-checked') === 'true' } : null })()`);
  ok('hộp thoại cột: công tắc "Đánh thức bot theo dõi" + dòng giải thích, không còn "Cột review"',
    dlg?.wake && dlg.checked === false && dlg.text.includes('Đánh thức bot theo dõi') && dlg.text.includes('gọi bot theo dõi việc') && !dlg.text.includes('Cột review'), dlg);
  await br.evalJs(`document.querySelector('[data-testid="col-wake"]').click()`);
  await br.sleep(300);
  await br.shot(`${SHOTS}/2-column-dialog-ticked.png`);
  await br.evalJs(`document.querySelector('[data-testid="column-dialog"] button[type="submit"]').click()`);
  await br.sleep(1500);
  cols = (await json(Hum.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
  ok('tick → lưu wakeFollowers = true cho "Đang làm"', cols.find((c) => c.id === DOING)?.wakeFollowers === true, cols);
  ok('tiêu đề cột "Đang làm" hiện biểu tượng bot sau khi lưu', await br.evalJs(`!!document.querySelector('[data-testid="col-Đang làm"] [data-testid="col-wake-icon"]')`));
  await br.shot(`${SHOTS}/3-board-after-tick.png`);
  await openCol('Đang làm');
  ok('mở lại: công tắc đang bật', await br.evalJs(`document.querySelector('[data-testid="col-wake"]')?.getAttribute('aria-checked') === 'true'`));
  await br.evalJs(`document.querySelector('[data-testid="col-wake"]').click()`);
  await br.sleep(200);
  await br.evalJs(`document.querySelector('[data-testid="column-dialog"] button[type="submit"]').click()`);
  await br.sleep(1500);
  cols = (await json(Hum.cookie, 'GET', `/api/projects/${P}/columns`)).body as any[];
  ok('bỏ tick → lưu wakeFollowers = false, các cột khác giữ nguyên', cols.find((c) => c.id === DOING)?.wakeFollowers === false
    && cols.find((c) => c.name === 'Chờ review')?.wakeFollowers === true, cols);
  // Hộp thoại việc
  await br.evalJs(`document.querySelector('[data-testid="col-Đang làm"] [data-testid="task-card"]').click()`);
  await br.sleep(1800);
  const td = await br.evalJs(`(() => { const d = document.querySelector('[role="dialog"]'); return d ? { text: d.innerText, reviewer: !!document.getElementById('tk-reviewer') } : null })()`);
  ok('hộp thoại việc: không còn ô "Người review", vẫn có "Người làm" + "Người theo dõi"',
    !!td && !td.reviewer && !td.text.includes('Người review') && td.text.includes('Người làm') && td.text.includes('Người theo dõi') && td.text.includes('Bot Review'), td?.text?.slice(0, 400));
  await br.shot(`${SHOTS}/4-task-dialog.png`);
  const errs = br.errors.filter((e) => !/negotiat|signalr|hub|502|WebSocket/i.test(e ?? ''));
  ok('không lỗi console (bỏ SignalR khi không chạy Realtime)', errs.length === 0, errs);
} finally {
  br.close();
}

console.log(`\n${pass} pass / ${fail} fail — ảnh: ${SHOTS}`);
process.exit(fail ? 1 : 0);
