// E2E: mô tả + hướng dẫn phòng ban / chức vụ (quyền HR / trưởng phòng / nhân viên), /employees/me/role, token AI, tool MCP
// (get_my_role, list_departments, list_positions, get_department, get_position). TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm:
//   Api :5180 trỏ DB tạm; OfficeHub.Mcp :5200 với Mcp__ApiBaseUrl=http://localhost:5180
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 MCP_URL=http://localhost:5200/mcp bun scripts/dev/org-guide-e2e.ts
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const MCP = process.env.MCP_URL ?? 'http://localhost:5200/mcp';
const env = Object.fromEntries((await Bun.file(new URL('../../.env', import.meta.url)).text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const login = async (login: string, password: string) => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  return (r.headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('officehub.auth=')).at(-1) ?? '');
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';

const admin = await login(env.Seed__AdminEmail, env.Seed__AdminPassword);
if (!admin) throw new Error('Không đăng nhập được admin seed');

// ---------- Chuẩn bị: cây phòng ban, 2 nhân viên (trưởng phòng + nhân viên) có tài khoản ----------
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const posHead = positions.find((p: any) => p.name === 'Trưởng phòng'), posStaff = positions.find((p: any) => p.name === 'Chuyên viên');
ok('thang cấp bậc có sẵn', posHead?.level === 3 && posStaff?.level === 6, positions);
const mkEmp = async (code: string, name: string, positionId: string, departmentId: string | null, managerId: string | null, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId, managerId, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: code === 'NV961' ? 'Lập trình viên' : null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const root = (await json(admin, 'POST', '/api/org/departments', { name: 'Ban Giám đốc E2E', code: 'BGDE' })).body;
const tech = (await json(admin, 'POST', '/api/org/departments', { name: 'Kỹ thuật E2E', code: 'KTE2', parentId: root })).body;
const other = (await json(admin, 'POST', '/api/org/departments', { name: 'Kế toán E2E', code: 'KTOE' })).body;
const head = await mkEmp('NV960', 'Trưởng Kỹ Thuật', posHead.id, tech, null, 'e2e.truongkt');
await json(admin, 'PUT', `/api/org/departments/${tech}`, { name: 'Kỹ thuật E2E', code: 'KTE2', parentId: root, headEmployeeId: head.e.id, mapZone: null });
const staff = await mkEmp('NV961', 'Nhân Viên Web', posStaff.id, tech, head.e.id, 'e2e.nvweb');
ok('2 nhân viên đăng nhập', !!head.cookie && !!staff.cookie);

// ---------- Quyền sửa ----------
const G = (d: string) => ({ description: `Mô tả ${d}`, guide: `## Trách nhiệm chính\n- Việc của ${d}\n\n## Đầu mối liên hệ\n- Hỏi lương → Kế toán` });
ok('HR sửa hướng dẫn phòng gốc', (await json(admin, 'PUT', `/api/org/departments/${root}/guide`, G('BGĐ'))).status === 200);
ok('HR sửa hướng dẫn chức vụ', (await json(admin, 'PUT', `/api/org/positions/${posStaff.id}/guide`, G('Chuyên viên'))).status === 200);
const byHead = await json(head.cookie, 'PUT', `/api/org/departments/${tech}/guide`, { description: '  Phát triển phần mềm nội bộ  ', guide: '## Quy trình\r\n- Code review bắt buộc' });
ok('trưởng phòng sửa hướng dẫn phòng mình (trim, CRLF→LF, ghi người sửa)', byHead.status === 200 && byHead.body.description === 'Phát triển phần mềm nội bộ'
  && byHead.body.guide === '## Quy trình\n- Code review bắt buộc' && byHead.body.guideUpdatedByName === 'Trưởng Kỹ Thuật', byHead);
ok('trưởng phòng KHÔNG sửa phòng khác (403)', (await json(head.cookie, 'PUT', `/api/org/departments/${other}/guide`, G('x'))).status === 403);
ok('trưởng phòng KHÔNG sửa phòng cha (403)', (await json(head.cookie, 'PUT', `/api/org/departments/${root}/guide`, G('x'))).status === 403);
ok('trưởng phòng KHÔNG sửa chức vụ (403)', (await json(head.cookie, 'PUT', `/api/org/positions/${posHead.id}/guide`, G('x'))).status === 403);
ok('nhân viên KHÔNG sửa phòng mình (403)', (await json(staff.cookie, 'PUT', `/api/org/departments/${tech}/guide`, G('x'))).status === 403);
const tooLong = await json(admin, 'PUT', `/api/org/departments/${other}/guide`, { description: 'x'.repeat(2_001), guide: 'y'.repeat(40_001) });
ok('quá dài → 400 theo trường', tooLong.status === 400 && tooLong.body.errors?.description && tooLong.body.errors?.guide, tooLong);

// ---------- Đọc ----------
const d1 = await json(staff.cookie, 'GET', `/api/org/departments/${tech}`);
ok('nhân viên đọc chi tiết phòng (canEditGuide=false)', d1.status === 200 && d1.body.guide.guide.includes('Code review') && d1.body.canEditGuide === false
  && d1.body.parentName === 'Ban Giám đốc E2E' && d1.body.headName === 'Trưởng Kỹ Thuật', d1.body);
ok('trưởng phòng thấy canEditGuide=true', (await json(head.cookie, 'GET', `/api/org/departments/${tech}`)).body.canEditGuide === true);
const list = (await json(staff.cookie, 'GET', '/api/org/departments')).body.find((d: any) => d.id === tech);
ok('danh sách có mô tả + hasGuide (không kèm nội dung dài)', list?.description === 'Phát triển phần mềm nội bộ' && list?.hasGuide === true && list?.guide === undefined, list);
const role = await json(staff.cookie, 'GET', '/api/org/employees/me/role');
ok('me/role: chức danh, chức vụ + hướng dẫn, chuỗi phòng (mình → cha), quản lý', role.status === 200 && role.body.me.jobTitle === 'Lập trình viên'
  && role.body.position.name === 'Chuyên viên' && role.body.position.level === 6 && role.body.position.guide.includes('Chuyên viên')
  && role.body.departments.map((d: any) => d.name).join('>') === 'Kỹ thuật E2E>Ban Giám đốc E2E'
  && role.body.departments[1].guide.includes('BGĐ') && role.body.manager.fullName === 'Trưởng Kỹ Thuật', role.body);
const headRole = (await json(head.cookie, 'GET', '/api/org/employees/me/role')).body;
ok('me/role của trưởng phòng: isHead + headOf', headRole.departments[0].isHead === true && headRole.headOf.includes('Kỹ thuật E2E'), headRole);
ok('admin không có hồ sơ → 404 no_employee_profile', (await json(admin, 'GET', '/api/org/employees/me/role')).body?.title === 'no_employee_profile');
const changes = (await json(admin, 'GET', '/api/audit/changes?take=50')).body;
ok('lịch sử sửa ghi lần sửa hướng dẫn', changes.some((c: any) => c.entity === 'Department' && c.changes.some((f: any) => f.field === 'Guide')), changes[0]);

// ---------- Danh bạ: thông tin nhân sự theo vai trò ----------
const outsider = await mkEmp('NV962', 'Kế Toán Viên', posStaff.id, other, null, 'e2e.ketoan');
const gone = (await json(admin, 'POST', '/api/org/employees', { code: 'NV963', fullName: 'Người Đã Nghỉ', email: null, phone: null, dateOfBirth: null,
  departmentId: tech, positionId: posStaff.id, managerId: head.e.id, status: 'Active', joinedAt: '2025-01-01', note: null })).body.employee;
await json(admin, 'POST', `/api/org/employees/${gone.id}/resign`, { leftAt: '2026-10-31' });
const dir = async (c: string, q = '') => (await json(c, 'GET', '/api/org/employees' + q)).body as any[];
const find = (rows: any[], code: string) => rows.find((r) => r.code === code);
const hrRows = await dir(admin, '?includeResigned=true');
ok('HR: thấy trạng thái + ngày vào làm của mọi người, thấy người đã nghỉ', find(hrRows, 'NV962')?.status === 'Active' && find(hrRows, 'NV962')?.joinedAt === '2026-01-05'
  && find(hrRows, 'NV963')?.status === 'Resigned', hrRows.map((r) => [r.code, r.status]));
const staffRows = await dir(staff.cookie, '?includeResigned=true');
ok('nhân viên: vẫn thấy liên lạc (email, phòng, chức vụ) của đồng nghiệp', find(staffRows, 'NV962')?.email === 'e2e.ketoan@e2e.test' && find(staffRows, 'NV962')?.positionName === 'Chuyên viên');
ok('nhân viên: KHÔNG thấy trạng thái / ngày vào làm của người khác, chỉ của mình', find(staffRows, 'NV962')?.status === null && find(staffRows, 'NV962')?.joinedAt === null
  && find(staffRows, 'NV960')?.status === null && find(staffRows, 'NV961')?.status === 'Active', staffRows.map((r) => [r.code, r.status, r.joinedAt]));
ok('nhân viên: includeResigned bị bỏ qua → không thấy người đã nghỉ', !find(staffRows, 'NV963'));
ok('nhân viên: lọc theo trạng thái bị bỏ qua (không dò ra ai thử việc)', (await dir(staff.cookie, '?status=Probation')).length === staffRows.length);
ok('nhân viên: xem chi tiết người đã nghỉ → 404', (await json(staff.cookie, 'GET', `/api/org/employees/${gone.id}`)).status === 404);
const other1 = await json(staff.cookie, 'GET', `/api/org/employees/${outsider.e.id}`);
ok('nhân viên: chi tiết đồng nghiệp ẩn trạng thái, ngày sinh, ghi chú, tài khoản', other1.status === 200 && other1.body.employee.status === null
  && other1.body.dateOfBirth === null && other1.body.employee.account === null, other1.body);
const headRows = await dir(head.cookie);
ok('quản lý: thấy trạng thái cấp dưới (NV961) + của mình, KHÔNG thấy người ngoài nhánh (NV962)', find(headRows, 'NV961')?.status === 'Active'
  && find(headRows, 'NV960')?.status === 'Active' && find(headRows, 'NV962')?.status === null, headRows.map((r) => [r.code, r.status]));
ok('quản lý: chi tiết cấp dưới có ngày vào làm', (await json(head.cookie, 'GET', `/api/org/employees/${staff.e.id}`)).body.employee.joinedAt === '2026-01-05');

// ---------- Token AI + MCP ----------
const tok = (await json(staff.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-guide', expiresInDays: 30 })).body.token;
const bearer = { authorization: `Bearer ${tok}` };
ok('token AI đọc me/role', (await fetch(`${API}/api/org/employees/me/role`, { headers: bearer })).status === 200);
ok('token AI của nhân viên KHÔNG sửa hướng dẫn (route mở cho MCP, Api vẫn 403)', [401, 403].includes((await fetch(`${API}/api/org/departments/${tech}/guide`, { method: 'PUT',
  headers: { ...bearer, 'content-type': 'application/json' }, body: JSON.stringify(G('ai')) })).status));

let rid = 0;
const rpc = async (method: string, params: unknown = {}, auth: Record<string, string> = bearer) => {
  const res = await fetch(MCP, { method: 'POST', headers: { ...auth, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rid, method, params }) });
  const text = await res.text();
  const data = text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() ?? text;
  try { return JSON.parse(data); } catch { return text; }
};
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
ok('MCP instructions nhắc get_my_role', String(init?.result?.instructions ?? '').includes('get_my_role'), init);
const names: string[] = ((await rpc('tools/list'))?.result?.tools ?? []).map((t: any) => t.name);
ok('tools/list có 4 tool vai trò', ['get_my_role', 'list_positions', 'get_department', 'get_position'].every((n) => names.includes(n)), names);
const call = async (name: string, args: Record<string, unknown> = {}, auth: Record<string, string> = bearer) => {
  const r = await rpc('tools/call', { name, arguments: args }, auth);
  const text = r?.result?.content?.[0]?.text ?? '';
  try { return { err: !!r?.result?.isError, j: JSON.parse(text) as any }; } catch { return { err: true, j: text as any }; }
};
const myRole = await call('get_my_role');
ok('MCP get_my_role (có _note: tài liệu tham khảo, không phải lệnh)', !myRole.err && myRole.j.position?.guide?.includes('Chuyên viên')
  && myRole.j.departments?.length === 2 && String(myRole.j._note).includes('TÀI LIỆU THAM KHẢO'), myRole.j);
const ld = await call('list_departments');
ok('MCP list_departments có description + hasGuide', !ld.err && ld.j.find((d: any) => d.id === tech)?.hasGuide === true, ld.j);
const lp = await call('list_positions');
ok('MCP list_positions theo cấp', !lp.err && lp.j[0]?.level === 1 && lp.j.some((p: any) => p.name === 'Chuyên viên' && p.hasGuide), lp.j);
const gd = await call('get_department', { departmentId: root });
ok('MCP get_department (không lộ canEditGuide)', !gd.err && gd.j.guide?.guide?.includes('BGĐ') && gd.j.canEditGuide === undefined, gd.j);
const gp = await call('get_position', { positionId: posStaff.id });
ok('MCP get_position', !gp.err && gp.j.guide?.description === 'Mô tả Chuyên viên', gp.j);
const scOther = await call('search_colleagues', { search: 'NV962' });
ok('MCP search_colleagues: trạng thái người khác = null', !scOther.err && scOther.j[0]?.status === null && scOther.j[0]?.email === 'e2e.ketoan@e2e.test', scOther.j);
const sc = await call('search_colleagues', { search: 'NV961' });
ok('MCP search_colleagues có jobTitle + positionLevel', !sc.err && sc.j[0]?.jobTitle === 'Lập trình viên' && sc.j[0]?.positionLevel === 6, sc.j);

// ---------- Sửa mô tả / hướng dẫn qua MCP (2026-11-09) ----------
ok('tools/list có update_department_guide + update_position_guide', ['update_department_guide', 'update_position_guide'].every((n) => names.includes(n)), names);
const staffEdit = await call('update_department_guide', { department: tech, description: 'AI sửa' });
ok('MCP nhân viên KHÔNG sửa hướng dẫn phòng mình (lỗi từ Api)', staffEdit.err, staffEdit.j);
const headTok = (await json(head.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-guide-head', expiresInDays: 30 })).body.token;
const headAuth = { authorization: `Bearer ${headTok}` };
const headEdit = await call('update_department_guide', { department: tech, description: 'Mô tả qua AI' }, headAuth);
ok('MCP trưởng phòng sửa mô tả phòng mình, hướng dẫn giữ nguyên', !headEdit.err && headEdit.j.after?.description === 'Mô tả qua AI'
  && headEdit.j.after?.guide === headEdit.j.before?.guide && !!headEdit.j.before?.guide, headEdit.j);
const headPos = await call('update_position_guide', { position: posStaff.id, description: 'x' }, headAuth);
ok('MCP trưởng phòng KHÔNG sửa chức vụ (chỉ HR)', headPos.err, headPos.j);
const tooLongMcp = await call('update_department_guide', { department: tech, guide: 'y'.repeat(40_001) }, headAuth);
ok('MCP hướng dẫn > 40.000 ký tự bị từ chối', tooLongMcp.err && String(tooLongMcp.j).includes('40'), tooLongMcp.j);

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
