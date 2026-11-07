// E2E module News / Bảng tin (REST, Api): phạm vi người xem (toàn công ty / phòng ban + phòng con / tuỳ chọn / chỉ mình → người ngoài nhận 404),
// lọc HTML (XSS), sửa / xoá / quyền, cảm xúc, bình luận (trả lời một cấp, tắt bình luận, ảnh), @nhắc, thông báo chuông, email tuỳ chọn + hạn mức 3 bài/ngày,
// kiểm duyệt HR (ẩn / hiện / ghim), badge bài mới, phân trang con trỏ, tệp S3 thật (thư mục feed/), token AI chỉ đọc (chữ thuần).
// TẠO NHÂN VIÊN THẬT + GHI VÀI FILE NHỎ LÊN S3 THẬT (files/feed/, giữ lại) → CHỈ chạy trên DB tạm:
//   docker run -d --name officehub-e2e-pg -e POSTGRES_DB=officehub_e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e_pw_7391 -p 127.0.0.1:55432:5432 postgres:18-alpine
//   Api (từ backend/): ASPNETCORE_URLS=http://localhost:5180 ConnectionStrings__Default="Host=127.0.0.1;Port=55432;Database=officehub_e2e;Username=e2e;Password=e2e_pw_7391"
//        Seed__AdminEmail=e2e.admin@officehub.test Seed__AdminPassword='E2e-Admin-2026!' dotnet run --project src/OfficeHub.Api --no-launch-profile
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/news-e2e.ts
// (email gửi tới @officehub.test luôn bị bỏ qua — kiểm tra bằng thông báo chuông.)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '=')) ?? '';
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
    if (e.status !== 200) throw new Error(`Không bật được 2FA cho ${login}: ${s.status} ${e.status} ${JSON.stringify(e.body)}`);
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const MAIL = 'officehub.test'; // tên miền dành riêng → hệ thống không bao giờ gửi email
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

const HR = { cookie: admin }; // admin seed có vai trò admin + hr
const stamp = Date.now().toString(36);
const mkEmp = async (code: string, name: string, user: string, departmentId: string | null = null) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  return { e, cookie, userId: me.id as string, name };
};

// ---------- Phòng ban: D1 cha → D2 con; D3 riêng ----------
const mkDept = async (name: string, code: string, parentId: string | null) => {
  const r = await json(admin, 'POST', '/api/org/departments', { name, code, parentId, headEmployeeId: null, mapZone: null, sortOrder: 0 });
  if (r.status >= 300) throw new Error(`Tạo phòng ${code} lỗi: ${JSON.stringify(r.body)}`);
  return typeof r.body === 'string' ? r.body : (r.body.id as string);
};
const D1 = await mkDept(`Khối Kinh doanh ${stamp}`, `K1${stamp.slice(-4)}`, null);
const D2 = await mkDept(`Nhóm Bán lẻ ${stamp}`, `K2${stamp.slice(-4)}`, D1);
const D3 = await mkDept(`Khối Kỹ thuật ${stamp}`, `K3${stamp.slice(-4)}`, null);
const A = await mkEmp(`NV8${stamp.slice(-3)}1`, 'Nguyễn Đức Anh', `e2e.news.a.${stamp}`, D1);
const B = await mkEmp(`NV8${stamp.slice(-3)}2`, 'Trần Bảo Bình', `e2e.news.b.${stamp}`, D2);
const C = await mkEmp(`NV8${stamp.slice(-3)}3`, 'Lê Chí Cường', `e2e.news.c.${stamp}`, D3);
const E = await mkEmp(`NV8${stamp.slice(-3)}4`, 'Phạm Đăng Em', `e2e.news.e.${stamp}`, null);
ok('4 tài khoản + 3 phòng ban', [A, B, C, E].every((x) => !!x.cookie && !!x.userId) && !!D1 && !!D2 && !!D3);

// ---------- Helper: giãn cách đăng bài (5 s) / bình luận (1 s) theo từng tài khoản ----------
const last = new Map<string, number>();
const spaced = async (key: string, ms: number) => { const w = ms - (Date.now() - (last.get(key) ?? 0)); if (w > 0) await sleep(w); last.set(key, Date.now()); };
type U = { cookie: string; userId: string; name: string; e: any };
const post = async (u: { cookie: string }, over: Record<string, unknown> = {}) => {
  await spaced('p' + u.cookie, 5200);
  const r = await json(u.cookie, 'POST', '/api/news/posts', { contentHtml: '<p>Bài thử</p>', audience: 'Company', targets: [], uploadIds: [], sendEmail: false, commentsDisabled: false, ...over });
  last.set('p' + u.cookie, Date.now());
  return r;
};
const comment = async (u: { cookie: string }, postId: string, text: string | null, parentId: string | null = null, uploadId: string | null = null) => {
  await spaced('c' + u.cookie, 1200);
  return json(u.cookie, 'POST', `/api/news/posts/${postId}/comments`, { text, parentId, uploadId });
};
const feed = async (u: { cookie: string }, qs = '') => (await json(u.cookie, 'GET', `/api/news/feed${qs}`)).body as { pinned: any[]; items: any[]; nextCursor: number | null };
const sees = async (u: { cookie: string }, id: string) => (await json(u.cookie, 'GET', `/api/news/posts/${id}`)).status === 200;
const inFeed = async (u: { cookie: string }, id: string) => { const f = await feed(u, '?take=30'); return [...f.pinned, ...f.items].some((p) => p.id === id); };
const notes = async (u: { cookie: string }) => ((await json(u.cookie, 'GET', '/api/notifications?take=100')).body?.items ?? []) as any[];
const hasNote = async (u: { cookie: string }, category: string, contains?: string) => (await notes(u)).some((n) => n.category === category && (!contains || (n.title + n.body).includes(contains)));
const dep = (id: string) => ({ kind: 'Department', id });
const usr = (id: string) => ({ kind: 'User', id });

// ---------- Đăng bài cơ bản ----------
const p1 = await post(A, { contentHtml: '<h2>Thông báo nghỉ lễ</h2><p>Công ty <strong>nghỉ</strong> ngày 2/9.</p>' });
ok('A đăng bài toàn công ty → 200, tên tác giả, phạm vi, plainText', p1.status === 200 && p1.body.author.name === A.name && p1.body.audience === 'Company' && p1.body.plainText.includes('Công ty nghỉ ngày 2/9') && p1.body.canEdit === true && p1.body.canDelete === true && p1.body.canHide === false, p1.body);
ok('tác giả có phòng ban trong bài', p1.body.author.departmentName?.includes('Kinh doanh'), p1.body.author);
ok('B, C, E đều thấy trong feed', (await inFeed(B, p1.body.id)) && (await inFeed(C, p1.body.id)) && (await inFeed(E, p1.body.id)));
ok('B không sửa / xoá được bài của A (canEdit/canDelete false)', (await json(B.cookie, 'GET', `/api/news/posts/${p1.body.id}`)).body?.canEdit === false);
ok('bài trống → 400 (contentHtml)', (await post(B, { contentHtml: '<p></p>' })).status === 400);
const emptyR = await post(B, { contentHtml: '   ' });
ok('chỉ khoảng trắng → 400 với lỗi theo field', emptyR.status === 400 && !!emptyR.body?.errors?.contentHtml, emptyR.body);
ok('quá 20.000 ký tự → 400', (await post(B, { contentHtml: `<p>${'a'.repeat(20001)}</p>` })).status === 400);

// ---------- Lọc HTML (XSS) ----------
const x = await post(B, { contentHtml: '<p onclick="x()">Chào</p><script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">bấm</a><iframe src="https://evil"></iframe><a href="https://ok.vn">tốt</a>' });
const xh: string = x.body?.contentHtml ?? '';
ok('XSS: script / onerror / onclick / javascript: / iframe bị loại', x.status === 200 && !/script|onerror|onclick|javascript:|iframe|<img/i.test(xh), xh);
ok('link https giữ lại + target _blank + rel noopener', xh.includes('href="https://ok.vn"') && xh.includes('target="_blank"') && xh.includes('noopener'), xh);

// ---------- Phạm vi người xem ----------
const priv = await post(A, { contentHtml: '<p>Ghi chú riêng</p>', audience: 'Private' });
ok('Chỉ mình tôi: A thấy, B / C / E không thấy (404) và không có trong feed', (await sees(A, priv.body.id)) && !(await sees(B, priv.body.id)) && (await json(B.cookie, 'GET', `/api/news/posts/${priv.body.id}`)).status === 404 && !(await inFeed(B, priv.body.id)));
ok('admin (HR) cũng không đọc được bài riêng của A', !(await sees(HR, priv.body.id)));

const dp = await post(A, { contentHtml: '<p>Họp khối Kinh doanh</p>', audience: 'Departments', targets: [dep(D1)] });
ok('Phòng ban D1: A (D1) và B (phòng con D2) thấy; C (D3) và E (không phòng) không thấy', dp.status === 200 && (await sees(A, dp.body.id)) && (await sees(B, dp.body.id)) && !(await sees(C, dp.body.id)) && !(await sees(E, dp.body.id)), dp.body);
ok('đích hiển thị tên phòng', dp.body.targets?.[0]?.name?.includes('Kinh doanh') && dp.body.targets[0].kind === 'Department', dp.body.targets);
const dp3 = await post(C, { contentHtml: '<p>Chỉ nhóm bán lẻ</p>', audience: 'Departments', targets: [dep(D2)] });
ok('Phòng con D2: B thấy, A (phòng cha D1) KHÔNG thấy', (await sees(B, dp3.body.id)) && !(await sees(A, dp3.body.id)));

const cu = await post(A, { contentHtml: '<p>Gửi riêng Cường</p>', audience: 'Custom', targets: [usr(C.userId)] });
ok('Tuỳ chọn [C]: C và A (tác giả) thấy, B / E không', cu.status === 200 && (await sees(C, cu.body.id)) && (await sees(A, cu.body.id)) && !(await sees(B, cu.body.id)) && !(await sees(E, cu.body.id)), cu.body);
ok('Tuỳ chọn có tên người trong targets', cu.body.targets?.[0]?.name === C.name, cu.body.targets);
ok('Phòng ban không chọn đích → 400', (await post(B, { audience: 'Departments', targets: [] })).status === 400);
ok('Phòng ban không tồn tại → 400', (await post(B, { audience: 'Departments', targets: [dep(crypto.randomUUID())] })).status === 400);
ok('Tuỳ chọn người không tồn tại → 400', (await post(B, { audience: 'Custom', targets: [usr(crypto.randomUUID())] })).status === 400);
ok('Tuỳ chọn trộn kiểu đích (phòng ban trong Custom) → 400', (await post(B, { audience: 'Custom', targets: [dep(D1)] })).status === 400);

// ---------- Sửa / xoá ----------
const ed1 = await json(B.cookie, 'PUT', `/api/news/posts/${p1.body.id}`, { contentHtml: '<p>hack</p>', audience: 'Company', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false });
ok('B sửa bài của A → 404', ed1.status === 404);
const ed2 = await json(A.cookie, 'PUT', `/api/news/posts/${p1.body.id}`, { contentHtml: '<p>Đã sửa nội dung</p>', audience: 'Company', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false });
ok('A sửa bài → editedAt có giá trị, nội dung đổi', ed2.status === 200 && !!ed2.body.editedAt && ed2.body.plainText === 'Đã sửa nội dung', ed2.body);
const ed3 = await json(A.cookie, 'PUT', `/api/news/posts/${dp.body.id}`, { contentHtml: '<p>Chuyển sang riêng tư</p>', audience: 'Private', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false });
ok('Đổi phạm vi sang Chỉ mình tôi → B mất quyền xem', ed3.status === 200 && !(await sees(B, dp.body.id)));
const del = await post(B, { contentHtml: '<p>Bài sẽ xoá</p>' });
ok('A xoá bài của B → 404 (không phải chủ, không phải HR)', (await json(A.cookie, 'DELETE', `/api/news/posts/${del.body.id}`)).status === 404);
ok('B xoá bài của mình → 204, biến mất khỏi feed + 404', (await json(B.cookie, 'DELETE', `/api/news/posts/${del.body.id}`)).status === 204 && !(await sees(B, del.body.id)) && !(await inFeed(A, del.body.id)));

// ---------- Cảm xúc ----------
const r1 = await json(B.cookie, 'PUT', `/api/news/posts/${p1.body.id}/reaction`, { type: 'Like' });
ok('B thả Like → total 1, mine = Like', r1.status === 200 && r1.body.total === 1 && r1.body.mine === 'Like', r1.body);
const r2 = await json(B.cookie, 'PUT', `/api/news/posts/${p1.body.id}/reaction`, { type: 'Love' });
ok('B đổi sang Love → vẫn 1 (mỗi người một cảm xúc)', r2.body.total === 1 && r2.body.mine === 'Love' && r2.body.counts.Love === 1 && !r2.body.counts.Like, r2.body);
await json(C.cookie, 'PUT', `/api/news/posts/${p1.body.id}/reaction`, { type: 'Haha' });
const f1 = (await feed(E)).items.concat((await feed(E)).pinned).find((p: any) => p.id === p1.body.id);
ok('feed phản ánh reactionCount = 2 và myReaction null cho E', f1?.reactionCount === 2 && f1.myReaction === null, f1);
const rs = await json(A.cookie, 'GET', `/api/news/posts/${p1.body.id}/reactions`);
ok('danh sách người thả có tên', rs.body?.length === 2 && rs.body.some((r: any) => r.name === B.name && r.type === 'Love'), rs.body);
const r3 = await json(B.cookie, 'DELETE', `/api/news/posts/${p1.body.id}/reaction`);
ok('B gỡ cảm xúc → total 1, mine null', r3.body.total === 1 && r3.body.mine === null, r3.body);
ok('thả cảm xúc bài ngoài phạm vi → 404', (await json(B.cookie, 'PUT', `/api/news/posts/${priv.body.id}/reaction`, { type: 'Like' })).status === 404);
ok('loại cảm xúc không hợp lệ → lỗi 4xx', (await json(B.cookie, 'PUT', `/api/news/posts/${p1.body.id}/reaction`, { type: 'Bogus' })).status >= 400);

// ---------- Bình luận ----------
const c1 = await comment(B, p1.body.id, 'Bình luận đầu của B');
ok('B bình luận → 200, tên, chưa xoá', c1.status === 200 && c1.body.author.name === B.name && c1.body.text === 'Bình luận đầu của B' && c1.body.canEdit === true, c1.body);
ok('A (chủ bài) nhận chuông news_comment', await hasNote(A, 'news_comment', B.name));
const c2 = await comment(A, p1.body.id, 'A trả lời B', c1.body.id);
ok('A trả lời B → parentId đúng', c2.status === 200 && c2.body.parentId === c1.body.id, c2.body);
ok('B nhận chuông "trả lời bình luận của bạn"', await hasNote(B, 'news_comment', 'trả lời'));
const c3 = await comment(C, p1.body.id, 'C trả lời tiếp (vào trả lời)', c2.body.id);
ok('trả lời vào một trả lời → gom về bình luận gốc (một cấp)', c3.body?.parentId === c1.body.id, c3.body);
const cl = await json(E.cookie, 'GET', `/api/news/posts/${p1.body.id}/comments`);
ok('danh sách bình luận: 1 gốc + 2 trả lời, commentCount = 3', cl.body.items.filter((c: any) => !c.parentId).length === 1 && cl.body.items.length === 3 && (await json(E.cookie, 'GET', `/api/news/posts/${p1.body.id}`)).body.commentCount === 3, cl.body);
ok('bình luận trống → 400', (await comment(B, p1.body.id, '  ')).status === 400);
ok('bình luận > 2000 ký tự → 400', (await comment(B, p1.body.id, 'x'.repeat(2001))).status === 400);
ok('bình luận bài ngoài phạm vi → 404', (await comment(B, priv.body.id, 'lén')).status === 404);
ok('trả lời bình luận không thuộc bài → 404', (await comment(B, cu.body.id === p1.body.id ? p1.body.id : (await post(B, { contentHtml: '<p>bài phụ</p>' })).body.id, 'x', c1.body.id)).status === 404);
const ce = await json(B.cookie, 'PUT', `/api/news/comments/${c1.body.id}`, { text: 'B đã sửa' });
ok('B sửa bình luận của mình → editedAt', ce.status === 200 && ce.body.text === 'B đã sửa' && !!ce.body.editedAt, ce.body);
ok('A sửa bình luận của B → 404', (await json(A.cookie, 'PUT', `/api/news/comments/${c1.body.id}`, { text: 'hack' })).status === 404);
const cr = await json(C.cookie, 'PUT', `/api/news/comments/${c3.body.id}/reaction`, { type: 'Like' });
ok('thả cảm xúc cho bình luận', cr.status === 200 && cr.body.total === 1 && cr.body.mine === 'Like', cr.body);
const cdel = await json(A.cookie, 'DELETE', `/api/news/comments/${c3.body.id}`);
ok('chủ bài (A) xoá bình luận của C trên bài mình → 204', cdel.status === 204);
ok('E không xoá được bình luận của B (404)', (await json(E.cookie, 'DELETE', `/api/news/comments/${c1.body.id}`)).status === 404);
const cl2 = await json(E.cookie, 'GET', `/api/news/posts/${p1.body.id}/comments`);
ok('sau khi xoá: 2 bình luận, commentCount = 2', cl2.body.items.length === 2 && (await json(E.cookie, 'GET', `/api/news/posts/${p1.body.id}`)).body.commentCount === 2, cl2.body);
const noc = await post(A, { contentHtml: '<p>Tắt bình luận</p>', commentsDisabled: true });
ok('bài tắt bình luận → 409', (await comment(B, noc.body.id, 'x')).status === 409);

// ---------- @nhắc ----------
const mn = await post(A, { contentHtml: `<p>Chào <span data-mention="${C.userId}">@Lê Chí Cường</span> và <span data-mention="${E.userId}">@E</span></p>` });
ok('@nhắc trong bài: C và E nhận chuông news_mention', mn.status === 200 && (await hasNote(C, 'news_mention')) && (await hasNote(E, 'news_mention')));
ok('data-mention giữ nguyên Guid trong HTML đã lưu', mn.body.contentHtml.includes(`data-mention="${C.userId}"`), mn.body.contentHtml);
const mnPriv = await post(A, { contentHtml: `<p>Nhắc <span data-mention="${B.userId}">@B</span></p>`, audience: 'Private' });
const bBefore = (await notes(B)).filter((n) => n.category === 'news_mention').length;
ok('nhắc người không xem được bài (Chỉ mình tôi) → KHÔNG báo', mnPriv.status === 200 && bBefore === 0, bBefore);
const cm = await comment(B, p1.body.id, `Gửi @Phạm Đăng Em ${'@[Phạm Đăng Em](' + E.userId + ')'} xem nhé`);
ok('@nhắc trong bình luận → E nhận chuông news_mention', cm.status === 200 && (await notes(E)).filter((n) => n.category === 'news_mention').length === 2);
// C trả lời bình luận của A trên bài của A: A vừa là chủ bài vừa là người được trả lời → chỉ MỘT chuông
const before = (await notes(A)).filter((n) => n.category === 'news_comment').length;
const cA = await comment(A, p1.body.id, 'A tự bình luận bài mình');
await comment(C, p1.body.id, 'C trả lời A', cA.body.id);
const after = (await notes(A)).filter((n) => n.category === 'news_comment').length;
ok('chủ bài cũng là người được trả lời → chỉ một chuông (không trùng)', after - before === 1, { before, after });
ok('A tự bình luận bài mình → không tự gửi chuông cho mình', cA.status === 200);

// ---------- Email tuỳ chọn + hạn mức ----------
const em1 = await post(A, { contentHtml: '<p>Họp toàn công ty lúc 9h</p>', sendEmail: true });
ok('đăng kèm email → 200, emailSent = true', em1.status === 200 && em1.body.emailSent === true, em1.body);
ok('người xem nhận chuông news_published; tác giả thì không', (await hasNote(B, 'news_published', A.name)) && (await hasNote(C, 'news_published')) && (await hasNote(E, 'news_published')) && !(await hasNote(A, 'news_published')));
const noMail = (await notes(B)).filter((n) => n.category === 'news_published').length;
await post(A, { contentHtml: '<p>Không gửi email</p>', sendEmail: false });
ok('bài không chọn email → không tạo chuông news_published', (await notes(B)).filter((n) => n.category === 'news_published').length === noMail);
const emDept = await post(A, { contentHtml: '<p>Email riêng phòng</p>', audience: 'Departments', targets: [dep(D1)], sendEmail: true });
ok('email theo phòng: B (phòng con) nhận, C (D3) không nhận', emDept.status === 200 && (await notes(B)).filter((n) => n.category === 'news_published').length === noMail + 1 && (await notes(C)).filter((n) => n.category === 'news_published').length === 1);
const em3 = await post(A, { contentHtml: '<p>Email lần 3</p>', sendEmail: true });
ok('bài email thứ 3 trong ngày vẫn được', em3.status === 200, em3.body);
const em4 = await post(A, { contentHtml: '<p>Email lần 4</p>', sendEmail: true });
ok('bài email thứ 4 trong ngày → 429', em4.status === 429, em4.body);
ok('bài thường (không email) vẫn đăng được sau khi hết hạn mức', (await post(A, { contentHtml: '<p>vẫn đăng</p>' })).status === 200);
ok('Chỉ mình tôi + email → 400', (await post(B, { audience: 'Private', sendEmail: true })).status === 400);
let adminOk = true;
for (let i = 0; i < 4; i++) adminOk = adminOk && (await post(HR, { contentHtml: `<p>Admin email ${i}</p>`, sendEmail: true })).status === 200;
ok('admin / HR không bị giới hạn 3 bài email', adminOk);

// ---------- Kiểm duyệt HR ----------
const mod = await post(B, { contentHtml: '<p>Nội dung cần kiểm duyệt</p>' });
ok('nhân viên không dùng được API quản trị (403)', (await json(B.cookie, 'POST', `/api/news/admin/posts/${mod.body.id}/hide`, { reason: 'x' })).status === 403);
ok('ẩn bài không lý do → 400', (await json(admin, 'POST', `/api/news/admin/posts/${mod.body.id}/hide`, { reason: ' ' })).status === 400);
const modPost = (await json(admin, 'GET', `/api/news/posts/${mod.body.id}`)).body;
ok('HR thấy canHide = true', modPost.canHide === true && modPost.canDelete === true && modPost.canEdit === false, modPost);
ok('HR ẩn bài kèm lý do → 204', (await json(admin, 'POST', `/api/news/admin/posts/${mod.body.id}/hide`, { reason: 'Vi phạm quy định' })).status === 204);
ok('sau khi ẩn: A (người khác) không thấy / 404; HR và tác giả B vẫn thấy', !(await sees(A, mod.body.id)) && !(await inFeed(A, mod.body.id)) && (await sees(HR, mod.body.id)) && (await sees(B, mod.body.id)));
const bv = (await json(B.cookie, 'GET', `/api/news/posts/${mod.body.id}`)).body;
ok('tác giả thấy hidden + lý do', bv.hidden === true && bv.hiddenReason === 'Vi phạm quy định', bv);
ok('tác giả nhận chuông news_moderated kèm lý do', await hasNote(B, 'news_moderated', 'Vi phạm quy định'));
ok('bài bị ẩn: tác giả không sửa được (409)', (await json(B.cookie, 'PUT', `/api/news/posts/${mod.body.id}`, { contentHtml: '<p>x</p>', audience: 'Company', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false })).status === 409);
ok('bài bị ẩn: người khác không bình luận được (404 như không tồn tại)', (await comment(C, mod.body.id, 'x')).status === 404);
await json(admin, 'POST', `/api/news/admin/posts/${mod.body.id}/unhide`);
ok('hiện lại → A thấy', await sees(A, mod.body.id));

const pin = await json(admin, 'POST', `/api/news/admin/posts/${mod.body.id}/pin`, { days: 3 });
const fp = await feed(A);
ok('ghim bài → nằm ở mảng pinned trang đầu, pinned = true', pin.status === 204 && fp.pinned.some((p: any) => p.id === mod.body.id && p.pinned === true) && !fp.items.some((p: any) => p.id === mod.body.id), fp.pinned.map((p: any) => p.id));
ok('trang sau (có cursor) không lặp bài ghim', !(await feed(A, `?cursor=${fp.items.at(-1)?.seq ?? 1}`)).pinned.length);
ok('nhân viên không ghim được (403)', (await json(B.cookie, 'POST', `/api/news/admin/posts/${mod.body.id}/pin`, { days: 3 })).status === 403);
ok('ghim bài không phải toàn công ty → 404/409', [404, 409].includes((await json(admin, 'POST', `/api/news/admin/posts/${dp3.body.id}/pin`, { days: 3 })).status));
ok('bỏ ghim → hết pinned', (await json(admin, 'POST', `/api/news/admin/posts/${mod.body.id}/unpin`)).status === 204 && (await feed(A)).pinned.length === 0);

const cmod = await comment(B, p1.body.id, 'Bình luận cần ẩn');
ok('HR ẩn bình luận → người khác thấy text = null, tác giả thấy kèm lý do', (await json(admin, 'POST', `/api/news/admin/comments/${cmod.body.id}/hide`, { reason: 'Lời lẽ không phù hợp' })).status === 204
  && (await json(A.cookie, 'GET', `/api/news/posts/${p1.body.id}/comments`)).body.items.find((c: any) => c.id === cmod.body.id)?.text === null
  && (await json(B.cookie, 'GET', `/api/news/posts/${p1.body.id}/comments`)).body.items.find((c: any) => c.id === cmod.body.id)?.hiddenReason === 'Lời lẽ không phù hợp');
const aDel = await post(C, { contentHtml: '<p>Bài C để HR xoá</p>' });
ok('HR xoá bài của người khác → 204 + tác giả nhận chuông', (await json(admin, 'DELETE', `/api/news/posts/${aDel.body.id}`)).status === 204 && (await hasNote(C, 'news_moderated', 'gỡ')));

// ---------- Badge bài mới ----------
const u0 = await json(E.cookie, 'GET', '/api/news/unseen-count');
await json(E.cookie, 'POST', '/api/news/seen');
ok('unseen-count có số; sau /seen = 0', u0.status === 200 && (await json(E.cookie, 'GET', '/api/news/unseen-count')).body.count === 0, u0.body);
await post(A, { contentHtml: '<p>Bài mới sau khi xem</p>' });
ok('có bài mới của người khác → unseen = 1', (await json(E.cookie, 'GET', '/api/news/unseen-count')).body.count === 1);
const newMine = await post(E, { contentHtml: '<p>Bài của chính E</p>' });
ok('bài của chính mình không tính vào bài mới', (await json(E.cookie, 'GET', '/api/news/unseen-count')).body.count === 1 && newMine.status === 200);

// ---------- Phân trang con trỏ ----------
const seen = new Set<string>();
let cursor: number | null = null, pages = 0, dup = false;
do {
  const f = await feed(E, `?take=4${cursor ? `&cursor=${cursor}` : ''}`);
  for (const p of f.items) { if (seen.has(p.id)) dup = true; seen.add(p.id); }
  cursor = f.nextCursor; pages++;
} while (cursor && pages < 20);
// tổng bài xem được: đi hết trang với take=30 (take bị kẹp 1–30 nên một lần gọi có thể chưa đủ)
const allIds = new Set<string>();
let cur2: number | null = null, guard = 0;
do { const f = await feed(E, `?take=30${cur2 ? `&cursor=${cur2}` : ''}`); f.items.forEach((p: any) => allIds.add(p.id)); cur2 = f.nextCursor; } while (cur2 && ++guard < 20);
ok(`phân trang take=4: ${pages} trang, không trùng, đủ số bài`, !dup && pages > 1 && seen.size === allIds.size, { pages, seen: seen.size, all: allIds.size });
ok('cursor không hợp lệ (0 / rất lớn) không làm lỗi', (await json(E.cookie, 'GET', '/api/news/feed?cursor=0')).status === 200 && (await json(E.cookie, 'GET', '/api/news/feed?cursor=999999')).status === 200);
ok('lọc "bài của tôi" chỉ có bài của E', (await feed(E, '?mine=true')).items.every((p: any) => p.author.userId === E.userId));
ok('lọc theo tác giả', (await feed(E, `?authorId=${A.userId}`)).items.every((p: any) => p.author.userId === A.userId));

// ---------- Người / phòng ban ----------
const ppl = (await json(A.cookie, 'GET', '/api/news/people?search=tran%20bao')).body as any[];
ok('tìm người bỏ dấu "tran bao" ra Trần Bảo Bình, không có chính mình', ppl.some((p) => p.userId === B.userId) && !ppl.some((p) => p.userId === A.userId), ppl);
const deps = (await json(A.cookie, 'GET', '/api/news/departments')).body as any[];
ok('danh sách phòng ban có D1/D2 với parentId', deps.some((d) => d.id === D2 && d.parentId === D1) && deps.some((d) => d.id === D1), deps.length);

// ---------- Tệp S3 (thư mục feed/) ----------
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const up = (u: { cookie: string }, over: Record<string, unknown> = {}) =>
  json(u.cookie, 'POST', '/api/news/uploads', { fileName: 'Ảnh thử news.png', contentType: 'image/png', size: PNG.length, forComment: false, ...over });
ok('chặn .exe / .html / .svg (400)', (await up(A, { fileName: 'a.exe', contentType: 'application/octet-stream' })).status === 400 && (await up(A, { fileName: 'a.html', contentType: 'text/html' })).status === 400 && (await up(A, { fileName: 'a.svg', contentType: 'image/svg+xml' })).status === 400);
ok('ảnh > 10 MB, video > 200 MB, tệp > 25 MB → 400', (await up(A, { size: 11 * 1024 * 1024 })).status === 400 && (await up(A, { fileName: 'v.mp4', contentType: 'video/mp4', size: 201 * 1024 * 1024 })).status === 400 && (await up(A, { fileName: 'a.pdf', contentType: 'application/pdf', size: 26 * 1024 * 1024 })).status === 400);
ok('video 150 MB hợp lệ (xin vé được)', (await up(A, { fileName: 'v.mp4', contentType: 'video/mp4', size: 150 * 1024 * 1024 })).status === 200);
ok('bình luận chỉ nhận ảnh: video → 400', (await up(A, { fileName: 'v.mp4', contentType: 'video/mp4', size: 1000, forComment: true })).status === 400);
const t1 = await up(A);
ok('vé ảnh → presigned PUT trỏ thư mục feed/, kind Image', t1.status === 200 && /\/files\/feed\/\d{4}\/\d{2}\//.test(decodeURIComponent(t1.body.url)) && t1.body.kind === 'Image' && !t1.body.url.includes('chat/') && !t1.body.url.includes('documents/'), t1.body?.url?.slice(0, 200));
ok('đăng khi tệp chưa PUT lên S3 → 409', (await post(A, { contentHtml: '<p>x</p>', uploadIds: [t1.body.id] })).status === 409);
ok('PUT ảnh lên S3 thật', (await fetch(t1.body.url, { method: 'PUT', headers: { 'content-type': t1.body.contentType }, body: PNG })).status === 200);
const tv = await up(A, { fileName: 'clip thử.mp4', contentType: 'video/mp4', size: 16 });
const vbytes = new Uint8Array(16);
ok('PUT video nhỏ (kiểu video/mp4) lên S3', tv.body.kind === 'Video' && (await fetch(tv.body.url, { method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: vbytes })).status === 200);
const tf = await up(A, { fileName: 'Báo cáo thử.pdf', contentType: 'application/pdf', size: 8 });
ok('PUT tệp pdf nhỏ lên S3', tf.body.kind === 'File' && (await fetch(tf.body.url, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: new Uint8Array(8) })).status === 200);
ok('vé của A không dùng được bởi B (400)', (await post(B, { contentHtml: '<p>x</p>', uploadIds: [t1.body.id] })).status === 400);
const withMedia = await post(A, { contentHtml: '<p>Bài có đính kèm</p>', audience: 'Departments', targets: [dep(D1)], uploadIds: [t1.body.id, tv.body.id, tf.body.id] });
const mk = (withMedia.body?.media ?? []).map((m: any) => m.kind).join(',');
ok('đăng với ảnh + video + tệp → 3 media đúng thứ tự và loại, có url', withMedia.status === 200 && mk === 'Image,Video,File' && withMedia.body.media.every((m: any) => !!m.url), withMedia.body);
const img = withMedia.body.media[0];
const got = await fetch(img.url);
ok('tải ảnh qua presigned GET đúng nội dung', got.status === 200 && (await got.arrayBuffer()).byteLength === PNG.length, got.status);
ok('B (cùng phạm vi) lấy link tải; C (ngoài phạm vi) → 404', (await json(B.cookie, 'GET', `/api/news/media/${withMedia.body.media[2].id}/url?download=true`)).body?.url?.includes('attachment') && (await json(C.cookie, 'GET', `/api/news/media/${img.id}/url`)).status === 404);
const edM = await json(A.cookie, 'PUT', `/api/news/posts/${withMedia.body.id}`, { contentHtml: '<p>Bài có đính kèm</p>', audience: 'Departments', targets: [dep(D1)], uploadIds: [], removeMediaIds: [withMedia.body.media[1].id], commentsDisabled: false });
ok('sửa bài: gỡ video → còn Image,File', edM.status === 200 && edM.body.media.map((m: any) => m.kind).join(',') === 'Image,File', edM.body);
ok('đăng > 10 tệp → 400', (await post(A, { contentHtml: '<p>x</p>', uploadIds: Array.from({ length: 11 }, () => crypto.randomUUID()) })).status === 400);
// ảnh trong bình luận
const tc = await up(B, { forComment: true });
await fetch(tc.body.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG });
const ci = await comment(B, withMedia.body.id, 'kèm ảnh', null, tc.body.id);
ok('bình luận kèm ảnh → imageUrl', ci.status === 200 && !!ci.body.imageUrl, ci.body);
const ciOnly = await (async () => { const t = await up(B, { forComment: true }); await fetch(t.body.url, { method: 'PUT', headers: { 'content-type': 'image/png' }, body: PNG }); return comment(B, withMedia.body.id, null, null, t.body.id); })();
ok('bình luận chỉ có ảnh (không chữ) → hợp lệ', ciOnly.status === 200 && ciOnly.body.text === null && !!ciOnly.body.imageUrl, ciOnly.body);

// ---------- Token AI: chỉ đọc, chữ thuần ----------
const tok = (await json(A.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-news', expiresInDays: 30 })).body?.token;
const aiGet = async (path: string, method = 'GET', body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const aiFeed = await aiGet('/api/news/feed?take=30');
const aiPost = aiFeed.body?.items?.find((p: any) => p.id === withMedia.body.id);
ok('token AI đọc feed → 200, contentHtml = null, có plainText, media không có url', aiFeed.status === 200 && !!aiPost && aiPost.contentHtml === null && aiPost.plainText.includes('Bài có đính kèm') && aiPost.media.every((m: any) => m.url === null), aiPost);
ok('token AI đọc chi tiết + bình luận (ảnh bình luận không có url)', (await aiGet(`/api/news/posts/${withMedia.body.id}`)).status === 200 && (await aiGet(`/api/news/posts/${withMedia.body.id}/comments`)).body.items.every((c: any) => c.imageUrl === null));
ok('token AI không thấy bài ngoài phạm vi của chủ token (404)', (await aiGet(`/api/news/posts/${dp3.body.id}`)).status === 404);
ok('token AI không đăng / bình luận / thả cảm xúc / xoá / lấy link tệp (403)', (await aiGet('/api/news/posts', 'POST', { contentHtml: '<p>x</p>', audience: 'Company' })).status === 403
  && (await aiGet(`/api/news/posts/${p1.body.id}/comments`, 'POST', { text: 'x' })).status === 403
  && (await aiGet(`/api/news/posts/${p1.body.id}/reaction`, 'PUT', { type: 'Like' })).status === 403
  && (await aiGet(`/api/news/posts/${p1.body.id}`, 'DELETE')).status === 403
  && (await aiGet(`/api/news/media/${img.id}/url`)).status === 403
  && (await aiGet('/api/news/uploads', 'POST', { fileName: 'a.png', contentType: 'image/png', size: 10 })).status === 403);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
