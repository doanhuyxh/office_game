// E2E TEST-54 (bảng tin): bài hẹn giờ (chỉ tác giả thấy tới giờ, job đăng → đầu feed + "bài mới" + chuông @nhắc, đổi giờ, đăng ngay),
// thống kê "ai đã xem" (chỉ tác giả + HR, bỏ bài không xem được, không tính tác giả), chia sẻ lại (trỏ bài gốc, không mở rộng phạm vi bài gốc), token AI.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm (Api như chat-e2e.ts); mất ~2 phút (đợi job hẹn giờ 30 giây / lần):
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=e2e.admin@officehub.test ADMIN_PASSWORD='E2e-Admin-2026!' bun scripts/dev/news-extra-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
if (!ADMIN_LOGIN || !ADMIN_PASSWORD) throw new Error('Đặt ADMIN_LOGIN / ADMIN_PASSWORD của DB tạm');
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 600) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
const MAIL = 'officehub.test';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');

const stamp = Date.now().toString(36);
const mkEmp = async (code: string, name: string, user: string) => {
  const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const e = r.body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const me = (await json(cookie, 'GET', '/api/auth/me')).body;
  return { e, cookie, userId: me.id as string, name };
};
const A = await mkEmp(`NW${stamp.slice(-4)}1`, 'Nguyễn Văn An', `e2e.nw.a.${stamp}`);
const B = await mkEmp(`NW${stamp.slice(-4)}2`, 'Trần Thị Bình', `e2e.nw.b.${stamp}`);
const C = await mkEmp(`NW${stamp.slice(-4)}3`, 'Lê Văn Cường', `e2e.nw.c.${stamp}`);
ok('3 tài khoản đăng nhập', [A, B, C].every((x) => !!x.cookie && !!x.userId));

const lastPost = new Map<string, number>();
const post = async (u: { cookie: string }, body: Record<string, unknown>) => {
  const wait = 5200 - (Date.now() - (lastPost.get(u.cookie) ?? 0)); // 1 bài / 5 giây
  if (wait > 0) await sleep(wait);
  const r = await json(u.cookie, 'POST', '/api/news/posts', { audience: 'Company', targets: [], uploadIds: [], sendEmail: false, commentsDisabled: false, ...body });
  lastPost.set(u.cookie, Date.now());
  return r;
};
const feedIds = async (u: { cookie: string }) => (((await json(u.cookie, 'GET', '/api/news/feed?take=30')).body?.items ?? []) as any[]).map((p) => p.id as string);
const notes = async (u: { cookie: string }) => ((await json(u.cookie, 'GET', '/api/notifications?take=100')).body?.items ?? []) as any[];
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

// ---------- Hẹn giờ ----------
ok('hẹn giờ trong quá khứ → 400', (await post(A, { contentHtml: '<p>quá khứ</p>', publishAt: iso(-60_000) })).status === 400);
ok('hẹn giờ quá 60 ngày → 400', (await post(A, { contentHtml: '<p>xa</p>', publishAt: iso(61 * 86400_000) })).status === 400);
const sch = await post(A, { contentHtml: `<p>Bài hẹn giờ <span data-mention="${B.userId}">@Bình</span></p>`, publishAt: iso(70_000) });
ok('A hẹn giờ đăng → 200, publishAt có', sch.status === 200 && !!sch.body.publishAt, sch.body);
const S = sch.body.id as string;
ok('B (chưa tới giờ) → 404 chi tiết, không có trong feed', (await json(B.cookie, 'GET', `/api/news/posts/${S}`)).status === 404 && !(await feedIds(B)).includes(S));
ok('admin / HR cũng không thấy bài chưa đăng', (await json(admin, 'GET', `/api/news/posts/${S}`)).status === 404);
ok('A thấy bài hẹn trong "Bài của tôi"', (((await json(A.cookie, 'GET', '/api/news/feed?mine=true')).body?.items ?? []) as any[]).some((p) => p.id === S && p.publishAt));
ok('B chưa nhận chuông @nhắc', !(await notes(B)).some((n) => n.link === `/news/${S}`));
const later = await post(C, { contentHtml: '<p>Bài thường của C (đăng sau khi A hẹn)</p>' });
const unseenBefore = (await json(B.cookie, 'GET', '/api/news/unseen-count')).body?.count ?? 0;

console.log('… đợi job đăng bài hẹn giờ (~100 giây)');
let published = false;
for (let i = 0; i < 30 && !published; i++) { await sleep(5000); published = (await json(B.cookie, 'GET', `/api/news/posts/${S}`)).status === 200; }
ok('tới giờ → job đăng, B xem được', published);
const f = await feedIds(B);
ok('bài vừa đăng nổi lên đầu feed (trên bài C đăng sau lúc hẹn)', f.indexOf(S) >= 0 && f.indexOf(S) < f.indexOf(later.body.id), f.slice(0, 5));
const sp = (await json(A.cookie, 'GET', `/api/news/posts/${S}`)).body;
ok('sau khi đăng: publishAt null, createdAt = lúc đăng', sp.publishAt == null && new Date(sp.createdAt).getTime() > new Date(later.body.createdAt).getTime(), sp);
ok('B được tính thêm bài mới', ((await json(B.cookie, 'GET', '/api/news/unseen-count')).body?.count ?? 0) > unseenBefore);
ok('B nhận chuông @nhắc lúc đăng', (await notes(B)).some((n) => n.link === `/news/${S}`));

const sch2 = await post(A, { contentHtml: '<p>Hẹn rồi đăng ngay</p>', publishAt: iso(3 * 3600_000) });
const S2 = sch2.body.id as string;
const moved = await json(A.cookie, 'PUT', `/api/news/posts/${S2}`, { contentHtml: '<p>Hẹn rồi đăng ngay</p>', audience: 'Company', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false, publishAt: iso(5 * 3600_000) });
ok('đổi giờ hẹn (vẫn chưa đăng, không tính "đã sửa")', moved.status === 200 && !!moved.body.publishAt && moved.body.editedAt == null
  && Math.abs(new Date(moved.body.publishAt).getTime() - (Date.now() + 5 * 3600_000)) < 60_000, moved.body);
const now2 = await json(A.cookie, 'PUT', `/api/news/posts/${S2}`, { contentHtml: '<p>Hẹn rồi đăng ngay</p>', audience: 'Company', targets: [], uploadIds: [], removeMediaIds: [], commentsDisabled: false, publishNow: true });
ok('"Đăng ngay" → đăng luôn, B thấy', now2.status === 200 && now2.body.publishAt == null && (await json(B.cookie, 'GET', `/api/news/posts/${S2}`)).status === 200, now2.body);
ok('HR không ghim được bài chưa đăng (404)', (await json(admin, 'POST', `/api/news/admin/posts/${(await post(A, { contentHtml: '<p>x</p>', publishAt: iso(3600_000) })).body.id}/pin`, { days: 1 })).status === 404);

// ---------- Ai đã xem ----------
const P = (await post(A, { contentHtml: '<p>Thông báo cần biết ai đã đọc</p>' })).body.id as string;
const priv = (await post(A, { contentHtml: '<p>riêng tư</p>', audience: 'Private' })).body.id as string;
ok('B báo đã xem (kèm bài không xem được → bỏ qua) → 204', (await json(B.cookie, 'POST', '/api/news/posts/views', { postIds: [P, priv, crypto.randomUUID()] })).status === 204);
await json(B.cookie, 'POST', '/api/news/posts/views', { postIds: [P] }); // lặp → không tính 2 lần
await json(A.cookie, 'POST', '/api/news/posts/views', { postIds: [P] }); // tác giả → không tính
ok('quá 50 bài / lần → 400', (await json(B.cookie, 'POST', '/api/news/posts/views', { postIds: Array.from({ length: 51 }, () => crypto.randomUUID()) })).status === 400);
const pa = (await json(A.cookie, 'GET', `/api/news/posts/${P}`)).body;
ok('tác giả thấy viewCount = 1', pa.viewCount === 1, pa.viewCount);
ok('người khác không thấy viewCount', (await json(C.cookie, 'GET', `/api/news/posts/${P}`)).body?.viewCount == null);
const vw = await json(A.cookie, 'GET', `/api/news/posts/${P}/viewers`);
ok('tác giả xem danh sách: B, audienceCount ≥ 2', vw.status === 200 && vw.body.count === 1 && vw.body.items[0].userId === B.userId && vw.body.items[0].name === B.name
  && vw.body.audienceCount >= 2, vw.body);
ok('B (người xem thường) xem danh sách → 404', (await json(B.cookie, 'GET', `/api/news/posts/${P}/viewers`)).status === 404);
const hrv = await json(admin, 'GET', `/api/news/posts/${P}/viewers`);
ok('HR / admin xem danh sách → 200', hrv.status === 200 && hrv.body.count === 1, hrv);
ok('bài riêng tư không ai ghi được lượt xem', (await json(A.cookie, 'GET', `/api/news/posts/${priv}/viewers`)).body?.count === 0);

// ---------- Chia sẻ lại ----------
const sh = await post(B, { contentHtml: '', sharedPostId: P });
ok('B chia sẻ bài của A (nội dung trống được) → sharedPost = bài gốc', sh.status === 200 && sh.body.sharedPostId === P && sh.body.sharedPost?.id === P, sh.body);
const sh2 = await post(C, { contentHtml: '<p>chia sẻ tiếp</p>', sharedPostId: sh.body.id });
ok('chia sẻ bài chia sẻ → trỏ thẳng bài gốc', sh2.status === 200 && sh2.body.sharedPostId === P, sh2.body);
ok('chia sẻ bài riêng tư của người khác → 404', (await post(B, { contentHtml: '', sharedPostId: priv })).status === 404);
const only = (await post(A, { contentHtml: '<p>chỉ cho Bình</p>', audience: 'Custom', targets: [{ kind: 'User', id: B.userId }] })).body.id as string;
const leak = await post(B, { contentHtml: '<p>xem này</p>', sharedPostId: only });
ok('B chia sẻ bài chỉ-cho-B ra toàn công ty → được tạo', leak.status === 200 && leak.body.sharedPost?.id === only, leak.body);
const cView = (await json(C.cookie, 'GET', `/api/news/posts/${leak.body.id}`)).body;
ok('C thấy bài chia sẻ nhưng KHÔNG thấy bài gốc (phạm vi gốc giữ nguyên)', cView?.sharedPostId === only && cView.sharedPost == null, cView);
ok('trống nội dung khi không chia sẻ → 400', (await post(B, { contentHtml: '' })).status === 400);
await json(A.cookie, 'DELETE', `/api/news/posts/${P}`);
ok('bài gốc bị xoá → bài chia sẻ còn, sharedPost null', (await json(C.cookie, 'GET', `/api/news/posts/${sh.body.id}`)).body?.sharedPost == null);

// ---------- Vé tải lên (đường dọn file mồ côi chạy trước khi cấp vé) ----------
const up = await json(B.cookie, 'POST', '/api/news/uploads', { fileName: 'a.png', contentType: 'image/png', size: 10, forComment: false });
ok('xin vé tải lên vẫn 200 (dọn vé quá 24 giờ + file S3 trước đó)', up.status === 200 && !!up.body?.url, up);

// ---------- Token AI ----------
const tok = (await json(C.cookie, 'POST', '/api/auth/access-tokens', { name: 'e2e-nw', expiresInDays: 30 })).body?.token;
const ai = (method: string, path: string, body?: unknown) => fetch(API + path, { method, headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body) }).then((r) => r.status);
const aiS = [await ai('POST', '/api/news/posts/views', { postIds: [S] }), await ai('GET', `/api/news/posts/${S}/viewers`)];
ok('token AI không báo đã xem / xem danh sách (403)', !!tok && aiS.every((s) => s === 403), aiS);

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
