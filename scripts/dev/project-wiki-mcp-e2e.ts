// E2E TEST-216: tool MCP Sổ tay dự án (list_wiki_pages, search_wiki, get_wiki_page, create_wiki_page, update_wiki_page, append_wiki_page) qua host Mcp THẬT
// bằng token của tài khoản bot: mục lục không nội dung, tìm + đoạn trích, đọc + version, tạo / sửa / nối thêm có nhãn BOT, sửa sai baseVersion → lỗi bảo đọc lại,
// trang khoá → lỗi kèm lý do, bot xem nhờ phòng ban đọc được / ghi bị chặn, dự án không xem được → không tìm thấy, get_project có wikiPages không có nội dung.
// CHỈ DB tạm — dựng Api + Mcp như mcp-profiles-e2e.ts (.agent/e2e.md):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5181 MCP_BASE=http://localhost:5201 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/project-wiki-mcp-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5181';
const MCP_BASE = process.env.MCP_BASE ?? 'http://localhost:5201';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
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

// ---------- Chuẩn bị: 2 bot có token (thành viên / xem nhờ phòng ban), dự án có phòng ban tham gia + dự án khác ----------
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posStaff = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions.at(-1);
const depTeam = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki MCP đội ${stamp}`, code: `WM${stamp}`.slice(0, 10) })).body;
const depView = (await json(admin, 'POST', '/api/org/departments', { name: `Wiki MCP xem ${stamp}`, code: `WX${stamp}`.slice(0, 10) })).body;
const bot = async (tag: string, name: string, dep: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code: `NV8${tag}${stamp}`.slice(0, 20), fullName: name, email: `e2e.wm${tag}.${stamp}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: posStaff.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const user = `e2e.wm${tag}.${stamp}`;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  await json(await login(user, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const c = await login(user, PW);
  const token = (await json(c, 'POST', '/api/auth/access-tokens', { name: 'Agent sổ tay', expiresInDays: 30 })).body?.token as string;
  await json(admin, 'PUT', `/api/org/employees/${e.id}/account/bot`, { isBot: true });
  return { id: e.id as string, token };
};
const member = await bot('m', 'Bot Sổ Tay', depTeam);
const viewer = await bot('v', 'Bot Xem Sổ Tay', depView);
ok('2 bot + token AI', member.token?.startsWith('ohk_') && viewer.token?.startsWith('ohk_'));
const code = `WM-${stamp}`.toUpperCase(), otherCode = `WO-${stamp}`.toUpperCase();
const P = (await json(admin, 'POST', '/api/projects', { code, name: `Sổ tay MCP ${stamp}`, kind: 'Internal', startOn: today, memberIds: [member.id],
  sequential: false, departmentIds: [depView] })).body;
const Other = (await json(admin, 'POST', '/api/projects', { code: otherCode, name: `Dự án khác ${stamp}`, kind: 'Internal', startOn: today, memberIds: [viewer.id], sequential: false })).body;
ok('dự án (phòng ban xem tham gia) + dự án khác', typeof P === 'string' && typeof Other === 'string', { P, Other });

// ---------- MCP ----------
let rid = 0;
const rpc = async (token: string, method: string, params: unknown = {}) => {
  const res = await fetch(`${MCP_BASE}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const call = async (token: string, name: string, args: Record<string, unknown> = {}) => {
  const x = await rpc(token, 'tools/call', { name, arguments: args });
  const text: string = x?.result?.content?.[0]?.text ?? x?.error?.message ?? '';
  const err = !!x?.result?.isError || !!x?.error;
  try { return { err, j: JSON.parse(text) as any, text }; } catch { return { err, j: null as any, text }; }
};
const M = member.token, V = viewer.token;
await rpc(M, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });

const tools: any[] = (await rpc(M, 'tools/list'))?.result?.tools ?? [];
const wikiTools = ['list_wiki_pages', 'search_wiki', 'get_wiki_page', 'create_wiki_page', 'update_wiki_page', 'append_wiki_page', 'edit_wiki_page', 'move_wiki_page'];
ok('tools/list có đủ 8 tool sổ tay (tổng 112)', wikiTools.every((n) => tools.some((t) => t.name === n)) && tools.length === 112, tools.length);
ok('3 tool đọc readOnlyHint, 5 tool ghi không', wikiTools.slice(0, 3).every((n) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint === true)
  && wikiTools.slice(3).every((n) => tools.find((t) => t.name === n)?.annotations?.readOnlyHint !== true));

// Tạo
const SECRET = `tu-khoa-hiem-${stamp}`;
const root = await call(M, 'create_wiki_page', { project: code, title: 'Quy ước', summary: 'Quy ước làm việc', content: '# Quy ước\n\nĐặt tên nhánh theo mã việc.', note: 'tạo' });
ok('create_wiki_page (mã dự án) → trang gốc, version 1, không kèm lại nội dung', !root.err && root.j?.version === 1 && root.j?.content === undefined && root.j?.contentLength > 0, root.text);
const child = await call(M, 'create_wiki_page', { project: P, title: 'Triển khai', parent: 'Quy ước', content: `Lệnh deploy: ${SECRET} chạy sau khi review.` });
ok('create_wiki_page với parent = tiêu đề → trang con, path có trang cha', !child.err && child.j?.parentId === root.j?.id && child.j?.path?.[0]?.title === 'Quy ước', child.text);
const dup = await call(M, 'create_wiki_page', { project: code, title: 'quy ước', content: 'x' });
ok('Tạo trùng tiêu đề cùng cha → lỗi', dup.err && /cùng tên/.test(dup.text), dup.text);
const web = (await json(admin, 'GET', `/api/projects/${P}/wiki/pages/${root.j?.id}`)).body;
ok('Trang trên web: createdByBot + updatedByBot (nhãn BOT)', web?.createdByBot === true && web?.updatedByBot === true && web?.createdByName === 'Bot Sổ Tay', web);

// Mục lục / tìm / đọc
const tree = await call(M, 'list_wiki_pages', { project: code });
const pages: any[] = tree.j?.pages ?? [];
ok('list_wiki_pages: cây cha trước con + depth, không nội dung', !tree.err && pages.length === 2 && pages[0].title === 'Quy ước' && pages[0].depth === 1
  && pages[1].depth === 2 && pages.every((p) => p.content === undefined && p.contentLength > 0 && p.position === undefined) && tree.j?.canEdit === true, tree.text);
const found = await call(M, 'search_wiki', { project: code, query: SECRET });
ok('search_wiki: ra đúng trang + đoạn trích', !found.err && found.j?.length === 1 && found.j[0].id === child.j?.id && found.j[0].snippet.includes(SECRET), found.text);
const none = await call(M, 'search_wiki', { project: code, query: `khong-co-${stamp}` });
ok('search_wiki không khớp → rỗng', !none.err && Array.isArray(none.j) && none.j.length === 0, none.text);
const got = await call(M, 'get_wiki_page', { project: code, page: child.j?.id });
ok('get_wiki_page: nội dung + version', !got.err && got.j?.content?.includes(SECRET) && got.j?.version === 1 && got.j?.canEdit === true, got.text);
const byTitle = await call(M, 'get_wiki_page', { project: code, page: 'triển khai' });
ok('get_wiki_page theo tiêu đề', !byTitle.err && byTitle.j?.id === child.j?.id, byTitle.text);
const noPage = await call(M, 'get_wiki_page', { project: code, page: 'Không có trang này' });
ok('get_wiki_page tiêu đề lạ → lỗi gợi ý list_wiki_pages', noPage.err && /list_wiki_pages/.test(noPage.text), noPage.text);

// Sửa / sửa đồng thời / nối thêm
const upd = await call(M, 'update_wiki_page', { project: code, page: root.j?.id, baseVersion: 1, content: '# Quy ước\n\nNhánh: TEST-<số>.', note: 'đổi quy ước nhánh' });
ok('update_wiki_page đúng baseVersion → version 2, nhãn BOT', !upd.err && upd.j?.version === 2 && upd.j?.updatedByBot === true && upd.j?.content === undefined, upd.text);
const stale = await call(M, 'update_wiki_page', { project: code, page: root.j?.id, baseVersion: 1, content: 'ghi đè' });
ok('update_wiki_page sai baseVersion → lỗi bảo đọc lại (get_wiki_page) + baseVersion mới', stale.err && /get_wiki_page/.test(stale.text) && /baseVersion = 2/.test(stale.text), stale.text);
const after = (await json(admin, 'GET', `/api/projects/${P}/wiki/pages/${root.j?.id}`)).body;
ok('Nội dung không bị ghi đè', after?.content?.includes('TEST-<số>') && after?.version === 2, after);
const nothing = await call(M, 'update_wiki_page', { project: code, page: root.j?.id, baseVersion: 2 });
ok('update_wiki_page không truyền gì → lỗi', nothing.err, nothing.text);
const sum = await call(M, 'update_wiki_page', { project: code, page: root.j?.id, baseVersion: 2, summary: 'none' });
ok('summary "none" → xoá tóm tắt, version 3', !sum.err && sum.j?.summary === undefined && sum.j?.version === 3, sum.text);
const app = await call(M, 'append_wiki_page', { project: code, page: 'Quy ước', text: '- 2026-11-23: chốt dùng sổ tay', note: 'nhật ký' });
ok('append_wiki_page → dài thêm, version + 1', !app.err && app.j?.version === 4 && app.j?.contentLength > (after?.content?.length ?? 1e9), app.text);
const full = (await json(admin, 'GET', `/api/projects/${P}/wiki/pages/${root.j?.id}`)).body;
ok('Nối vào cuối, giữ nội dung cũ', full?.content?.startsWith('# Quy ước') && full?.content?.endsWith('chốt dùng sổ tay'), full?.content);
const vers = (await json(admin, 'GET', `/api/projects/${P}/wiki/pages/${root.j?.id}/versions`)).body;
ok('Lịch sử 4 phiên bản, bản mới nhất của bot + ghi chú', vers?.total === 4 && vers?.items?.[0]?.editedByBot === true && vers?.items?.[0]?.note === 'nhật ký', vers);

// Khoá
ok('HR khoá trang trên web → 204', (await json(admin, 'POST', `/api/projects/${P}/wiki/pages/${root.j?.id}/lock`)).status === 204);
const lockedUpd = await call(M, 'update_wiki_page', { project: code, page: root.j?.id, baseVersion: 4, content: 'x' });
ok('Trang khoá: update_wiki_page → lỗi kèm lý do', lockedUpd.err && /khoá/i.test(lockedUpd.text), lockedUpd.text);
const lockedApp = await call(M, 'append_wiki_page', { project: code, page: root.j?.id, text: 'x' });
ok('Trang khoá: append_wiki_page → lỗi kèm lý do', lockedApp.err && /khoá/i.test(lockedApp.text), lockedApp.text);
const lockedGet = await call(M, 'get_wiki_page', { project: code, page: root.j?.id });
ok('Trang khoá: get_wiki_page locked + canEdit false', lockedGet.j?.locked === true && lockedGet.j?.canEdit === false, lockedGet.text);

// Bot xem nhờ phòng ban
await rpc(V, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
const vTree = await call(V, 'list_wiki_pages', { project: P });
ok('Bot xem nhờ phòng ban: list_wiki_pages đọc được, canEdit false', !vTree.err && vTree.j?.pages?.length === 2 && vTree.j?.canEdit === false, vTree.text);
const vFind = await call(V, 'search_wiki', { project: code, query: SECRET });
ok('Bot xem nhờ phòng ban: search_wiki (mã dự án) được', !vFind.err && vFind.j?.length === 1, vFind.text);
const vGet = await call(V, 'get_wiki_page', { project: P, page: child.j?.id });
ok('Bot xem nhờ phòng ban: get_wiki_page đọc được', !vGet.err && vGet.j?.content?.includes(SECRET), vGet.text);
const vCreate = await call(V, 'create_wiki_page', { project: P, title: 'Bot ngoài', content: 'x' });
ok('Bot xem nhờ phòng ban: create_wiki_page → lỗi quyền', vCreate.err && /thành viên/i.test(vCreate.text), vCreate.text);
const vApp = await call(V, 'append_wiki_page', { project: P, page: child.j?.id, text: 'x' });
ok('Bot xem nhờ phòng ban: append_wiki_page → lỗi quyền', vApp.err && /thành viên/i.test(vApp.text), vApp.text);
const vUpd = await call(V, 'update_wiki_page', { project: P, page: child.j?.id, baseVersion: 1, content: 'x' });
ok('Bot xem nhờ phòng ban: update_wiki_page → lỗi quyền', vUpd.err && /thành viên/i.test(vUpd.text), vUpd.text);

// Dự án không xem được
const oList = await call(M, 'list_wiki_pages', { project: Other });
ok('Dự án không xem được (id) → không tìm thấy', oList.err && /Không tìm thấy/i.test(oList.text), oList.text);
const oCode = await call(M, 'search_wiki', { project: otherCode, query: SECRET });
ok('Dự án không xem được (mã) → không thấy dự án', oCode.err && /Không thấy dự án/.test(oCode.text), oCode.text);
const oCreate = await call(M, 'create_wiki_page', { project: Other, title: 'Lạc', content: 'x' });
ok('Dự án không xem được: create_wiki_page → không tìm thấy', oCreate.err && /Không tìm thấy/i.test(oCreate.text), oCreate.text);

// get_project
const proj = await call(M, 'get_project', { project: code });
ok('get_project: project.wikiPages = 2, myAccess có wiki / wikiEdit, không có nội dung sổ tay', !proj.err && proj.j?.project?.wikiPages === 2 && !proj.text.includes(SECRET)
  && ['wiki', 'wikiEdit'].every((a) => proj.j?.myAccess?.includes(a)), proj.text.slice(0, 400));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
