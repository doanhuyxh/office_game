// E2E kết nối AI (MCP): token truy cập + danh sách route cho phép + tool qua JSON-RPC (Streamable HTTP).
// Cần Api (:5080) + OfficeHub.Mcp (:5100) đang chạy. Chạy từ gốc repo:
//   TEST_PASSWORD=<mật khẩu trong account.txt> bun scripts/dev/mcp-e2e.ts
// Tạo dữ liệu trên tài khoản thử: 1 sự kiện chấm công (Mcp/Remote — append-only), 1 đơn nghỉ rồi huỷ; token tự thu hồi ở cuối.
const API = process.env.API_URL ?? 'http://localhost:5080';
const MCP = process.env.MCP_URL ?? 'http://localhost:5100/mcp';
const USER = process.env.TEST_USER ?? 'kythuat.nhanvien1';
const PASS = process.env.TEST_PASSWORD ?? (() => { throw new Error('Thiếu TEST_PASSWORD (mật khẩu trong account.txt)'); })();
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};

const login = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: USER, password: PASS }) });
const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
ok('đăng nhập web', login.ok);

const created = await fetch(`${API}/api/auth/access-tokens`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'mcp-e2e', expiresInDays: 30 }) });
const { token, accessToken } = await created.json();
ok('tạo token', created.ok && token?.startsWith('ohk_'), accessToken);
const bad = await fetch(`${API}/api/auth/access-tokens`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ name: '', expiresInDays: 7 }) });
ok('validate tạo token (400)', bad.status === 400);
const list = await (await fetch(`${API}/api/auth/access-tokens`, { headers: { cookie } })).json();
ok('liệt kê token không lộ hash', list.some((t: any) => t.id === accessToken.id) && !JSON.stringify(list).includes(token));

const auth = { authorization: `Bearer ${token}` };
const st = async (method: string, path: string) => (await fetch(API + path, { method, headers: { ...auth, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' })).status;
ok('token: /api/leave/balance 200', (await st('GET', '/api/leave/balance')) === 200);
ok('token: /api/contracts/my bị chặn 403', (await st('GET', '/api/contracts/my')) === 403);
ok('token: tạo token mới bị chặn 403', (await st('POST', '/api/auth/access-tokens')) === 403);
ok('token: đổi mật khẩu bị chặn 403', (await st('POST', '/api/auth/change-password')) === 403);
ok('token: /api/leave/balances (HR) bị chặn 403', (await st('GET', '/api/leave/balances')) === 403);
ok('token sai → 401', (await fetch(`${API}/api/auth/me`, { headers: { authorization: 'Bearer ohk_khongtontai' } })).status === 401);

// ---- MCP (JSON-RPC qua Streamable HTTP) ----
let rid = 0;
async function rpc(method: string, params: unknown = {}, headers: Record<string, string> = auth) {
  const res = await fetch(MCP, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }),
  });
  const text = await res.text();
  const data = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5)).pop() ?? text;
  let body: any; try { body = JSON.parse(data); } catch { body = text; }
  return { status: res.status, body };
}
const init = { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'smoke', version: '1' } };
ok('MCP không token → 401', (await rpc('initialize', init, {})).status === 401);
ok('MCP token sai → 401', (await rpc('initialize', init, { authorization: 'Bearer ohk_sai' })).status === 401);
const i = await rpc('initialize', init);
ok('MCP initialize', i.status === 200 && i.body?.result?.serverInfo?.name === 'officehub', i);
ok('MCP có instructions', String(i.body?.result?.instructions ?? '').includes('THAY MẶT'));
const tl = await rpc('tools/list');
const tools: any[] = tl.body?.result?.tools ?? [];
console.log('  tools:', tools.map(t => t.name).join(', '));
ok('tools/list ≥ 25 tool', tools.length >= 25, tl);
ok('không có tool hợp đồng / lương', !tools.some(t => /contract|salary|luong/i.test(t.name)));
ok('approve_request đánh dấu destructive', tools.find(t => t.name === 'approve_request')?.annotations?.destructiveHint === true);

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const r = await rpc('tools/call', { name, arguments: args });
  const res = r.body?.result;
  const text = res?.content?.[0]?.text ?? '';
  let json: any; try { json = JSON.parse(text); } catch { json = undefined; }
  return { isError: !!res?.isError, text, json, raw: r };
};

const prof = await call('get_my_profile');
ok('get_my_profile', !prof.isError && prof.json?.account?.userName === USER && !!prof.json?.now, prof.text);
const today = prof.json?.now?.slice(0, 10);
const bal = await call('get_leave_balance');
ok('get_leave_balance', !bal.isError && typeof bal.json?.available === 'number', bal.text);
const types = await call('list_leave_types');
ok('list_leave_types', !types.isError && Array.isArray(types.json) && types.json.length > 0, types.text);
const ts = await call('get_my_timesheet', {});
ok('get_my_timesheet', !ts.isError && Array.isArray(ts.json?.days), ts.text.slice(0, 200));
const dir = await call('search_colleagues', { search: 'kythuat' });
ok('search_colleagues không trả thông tin tài khoản', !dir.isError && Array.isArray(dir.json) && !dir.text.includes('"account"'), dir.text.slice(0, 200));
const badDate = await call('preview_leave', { startDate: '06/11/2026', endDate: '2026-11-06' });
ok('lỗi định dạng ngày → thông báo tiếng Việt', badDate.isError && badDate.text.includes('yyyy-MM-dd'), badDate.raw);
const inbox = await call('list_approval_inbox');
ok('list_approval_inbox (nhân viên: rỗng)', !inbox.isError && Array.isArray(inbox.json), inbox.text);
const team = await call('get_team_attendance');
ok('nhân viên gọi tool quản lý → lỗi quyền', team.isError, team.text);

// Ghi: chấm công qua AI = Remote
const before = await call('get_today_attendance');
ok('get_today_attendance: CurrentWorkMode Remote', !before.isError && before.json?.currentWorkMode === 'Remote', before.text.slice(0, 300));
const chk = await call('check_in_out');
ok('check_in_out', !chk.isError && typeof chk.json?.checkedIn === 'boolean', chk.text.slice(0, 300));
const sess = chk.json?.day?.sessions ?? [];
ok('phiên chấm công ghi Remote', chk.json?.day?.workMode === 'Remote' || sess.length === 0 || JSON.stringify(sess).includes('Remote'), chk.json?.day);

// Ghi: gửi đơn nghỉ rồi huỷ
const firstType = types.json?.[0];
const future = new Date(Date.parse(today) + 20 * 86400000);
while ([0, 6].includes(future.getUTCDay())) future.setUTCDate(future.getUTCDate() + 1);
const day = future.toISOString().slice(0, 10);
const leave = await call('submit_leave_request', { leaveType: firstType?.code, startDate: day, endDate: day, period: 'Morning', reason: 'mcp-e2e' });
ok('submit_leave_request (theo mã loại nghỉ)', !leave.isError && leave.json?.status === 'Pending', leave.text);
if (leave.json?.approvalRequestId) {
  const cancel = await call('cancel_my_request', { requestId: leave.json.approvalRequestId });
  ok('cancel_my_request', !cancel.isError && cancel.json?.status === 'Cancelled', cancel.text.slice(0, 300));
}
const wrongType = await call('submit_leave_request', { leaveType: 'KHONG_CO', startDate: day, endDate: day });
ok('loại nghỉ sai → liệt kê loại hợp lệ', wrongType.isError && wrongType.text.includes('Các loại hiện có'), wrongType.text);

// Thu hồi → Api từ chối ngay
const rev = await fetch(`${API}/api/auth/access-tokens/${accessToken.id}`, { method: 'DELETE', headers: { cookie } });
ok('thu hồi token', rev.status === 204);
const after = await call('get_leave_balance');
ok('sau thu hồi: tool lỗi ngay', after.isError && /thu hồi|không hợp lệ/i.test(after.text), after.text);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
