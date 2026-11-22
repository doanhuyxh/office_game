// E2E: tài khoản mạng xã hội (Facebook Business Manager) + đăng bài lên Fanpage — module Assets.
// Chạy kèm MÁY CHỦ GRAPH GIẢ (cổng FAKE_PORT, mặc định 5199) trong cùng tiến trình: Api phải khởi động với
//   Facebook__GraphUrl=http://localhost:5199 Facebook__VideoUrl=http://localhost:5199
// Kiểm tra: token sai / đúng (mã hoá, không bao giờ trả ra API, lịch sử sửa che), đồng bộ trang (phân trang, trang thiếu quyền), token gửi qua header
// (không nằm trong URL), quyền (HR / người giữ BM / người ngoài), bàn giao / thu hồi (huỷ bài chờ), đăng chữ + link, nhiều ảnh (attached_media),
// video (file_url, permalink tương đối), Facebook tự tải ảnh / video từ link S3 (PUT S3 THẬT `assets/social/` — file giữ lại), lỗi tạm thời → thử lại,
// quyền của token (/me/permissions: đủ quyền, thiếu pages_manage_posts, lấy quyền lỗi, token lỗi giữ danh sách cũ),
// token bị thu hồi (190) → BM "Token lỗi" + chuông, hẹn giờ + huỷ, ngừng dùng BM, tài sản đang giữ (+ nghỉ việc), kiểm tra dữ liệu.
// TEST-206: chi tiết Fanpage + đồng bộ bài viết hiện có (/published_posts: chỉ 100 bài mới nhất qua cursor after, lần 2 không trùng + cập nhật số tương tác,
// nhãn "đăng từ OfficeHub", chặn bấm dồn < 1 phút, thiếu quyền → PostsSyncError, 190 → BM token lỗi + chuông, quyền HR / người giữ / người ngoài 404).
// TEST-208: sửa bài đã hẹn (nội dung + giờ hẹn → giờ cũ không đăng, giờ mới đăng nội dung mới; bỏ / thêm / đổi thứ tự ảnh + xoá tệp trên S3; bỏ / thêm trang;
// chuyển sang đăng ngay; đã đăng / đã huỷ / chờ thử lại → 409; người ngoài 404, người giữ BM sửa bài HR 403; sửa song song với job → luôn đăng bản cuối). Mất ~4 phút.
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/social-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const FAKE_PORT = Number(process.env.FAKE_PORT ?? 5199);
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
/** SDK S3 ký link https — S3 tạm (RustFS) chạy http trên máy → đổi giao thức cho link trỏ localhost; link S3 thật giữ nguyên. */
const s3url = (u: string) => u.replace(/^https:\/\/(127\.0\.0\.1|localhost)([:/])/, 'http://$1$2');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------- Máy chủ Graph giả ----------------
const SU_GOOD = 'EAAGsuGOODtoken000000000000000001', SU_BAD = 'EAAGsuBADtoken0000000000000000002';
// Token hợp lệ nhưng thiếu quyền đăng (pages_manage_posts bị từ chối, không có business_management)
const SU_LIMITED = 'EAAGsuLIMITEDtoken000000000000003';
const PT1 = 'EAAGpageONEtoken00000000000000001', PT2 = 'EAAGpageTWOtoken00000000000000002';
interface Req { method: string; path: string; search: string; auth: string | null; form: Record<string, string> }
const log: Req[] = [];
const fake = { transient1002: 1, revoked1001: false, permFail: false, s3Fetch: [] as number[],
  // TEST-206: bài hiện có của trang 1001 (130 bài cũ + bài đăng từ OfficeHub), số thích cộng thêm, bài mới thêm sau; trang 1002: lỗi khi đọc bài
  published1001: [] as string[], likeBoost: 0, newPosts: 0, posts1002: 'perm' as 'perm' | 'revoked' | 'ok' };
const validSu = (t: string) => t === SU_GOOD || t === SU_LIMITED;
let seq = 100;
const err = (status: number, code: number, message: string) => Response.json({ error: { message, type: 'OAuthException', code } }, { status });
Bun.serve({
  port: FAKE_PORT,
  async fetch(req) {
    const u = new URL(req.url);
    const form: Record<string, string> = req.method === 'POST' ? Object.fromEntries(new URLSearchParams(await req.text())) : {};
    const auth = req.headers.get('authorization');
    log.push({ method: req.method, path: u.pathname, search: u.search, auth, form });
    const token = auth?.replace(/^Bearer /, '') ?? '';
    const p = u.pathname.replace(/^\/v23\.0\//, '');
    if (p === 'me') return validSu(token) ? Response.json({ id: 'su1', name: 'OfficeHub Bot' }) : err(400, 190, 'Error validating access token: Session has expired');
    if (p === 'me/permissions') {
      if (!validSu(token)) return err(400, 190, 'Invalid OAuth access token');
      if (fake.permFail) return err(500, 1, 'An unknown error occurred');
      if (token === SU_LIMITED) return Response.json({ data: [
        { permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_read_engagement', status: 'granted' },
        { permission: 'pages_manage_posts', status: 'declined' }, { permission: 'public_profile', status: 'granted' }] });
      // 2 trang kết quả: cursor after, link next chứa token (không được theo)
      return u.searchParams.get('after') === 'q1'
        ? Response.json({ data: [{ permission: 'business_management', status: 'granted' }, { permission: 'pages_read_user_content', status: 'granted' },
          { permission: 'ads_read', status: 'expired' }] })
        : Response.json({
          data: [{ permission: 'pages_show_list', status: 'granted' }, { permission: 'pages_manage_posts', status: 'granted' },
            { permission: 'pages_read_engagement', status: 'granted' }, { permission: 'public_profile', status: 'granted' }],
          paging: { cursors: { after: 'q1' }, next: `http://localhost:${FAKE_PORT}/v23.0/me/permissions?after=q1&access_token=LEAK` },
        });
    }
    if (p === 'me/accounts') {
      if (!validSu(token)) return err(400, 190, 'Invalid OAuth access token');
      const pic = (id: string) => ({ data: { url: `https://example.test/pic/${id}.jpg` } });
      return u.searchParams.get('after') === 'c1'
        ? Response.json({ data: [{ id: '1003', name: 'Trang Thiếu Quyền', category: 'Brand', picture: pic('1003') }] })
        : Response.json({
          data: [
            { id: '1001', name: 'Trang Một', category: 'Company', link: 'https://facebook.com/1001', picture: pic('1001'), access_token: PT1 },
            { id: '1002', name: 'Trang Hai', category: 'Shop', picture: pic('1002'), access_token: PT2 },
          ],
          paging: { cursors: { before: 'c0', after: 'c1' }, next: `http://localhost:${FAKE_PORT}/v23.0/me/accounts?after=c1&access_token=LEAK` },
        });
    }
    const pp = p.match(/^(\d+)\/published_posts$/);
    if (pp && req.method === 'GET') {
      const page = pp[1];
      if (token !== (page === '1001' ? PT1 : page === '1002' ? PT2 : '-')) return err(400, 190, 'Invalid page token');
      if (page === '1002' && fake.posts1002 === 'perm') return err(403, 10, '(#10) This endpoint requires the pages_read_user_content permission');
      if (page === '1002' && fake.posts1002 === 'revoked') return err(400, 190, 'Error validating access token: The user has not authorized application');
      // Mới nhất trước: bài mới thêm sau → bài đăng từ OfficeHub → 130 bài cũ. Mỗi lượt tối đa 40 bài (buộc phân trang cursor after)
      const all = page === '1001'
        ? [...Array.from({ length: fake.newPosts }, (_, i) => `1001_new${fake.newPosts - i}`), ...fake.published1001.toReversed(),
          ...Array.from({ length: 130 }, (_, i) => `1001_old${130 - i}`)]
        : ['1002_a'];
      const start = Number(u.searchParams.get('after') ?? 0), size = Math.min(40, Number(u.searchParams.get('limit') ?? 25));
      const day = (i: number) => new Date(Date.UTC(2026, 10, 20) - i * 3_600_000).toISOString().replace('.000Z', '+0000');
      const data = all.slice(start, start + size).map((id, k) => ({
        id, message: id.endsWith('old1') ? 'Bài cũ nhất' : `Nội dung ${id}`, created_time: day(start + k), permalink_url: `https://www.facebook.com/${id}`,
        full_picture: `https://example.test/cdn/${id}.jpg`, status_type: 'mobile_status_update',
        ...(start + k === 0 ? { shares: { count: 4 + fake.likeBoost } } : {}),
        reactions: { data: [], summary: { total_count: 10 + fake.likeBoost } }, comments: { data: [], summary: { total_count: 2 } },
      }));
      const next = start + size < all.length;
      return Response.json({ data, ...(next ? { paging: { cursors: { after: String(start + size) },
        next: `http://localhost:${FAKE_PORT}/v23.0/${page}/published_posts?after=${start + size}&access_token=LEAK` } } : {}) });
    }
    const m = p.match(/^(\d+)\/(feed|photos|videos)$/);
    if (m && req.method === 'POST') {
      const [, page, edge] = m;
      if (token !== (page === '1001' ? PT1 : page === '1002' ? PT2 : '-')) return err(400, 190, 'Invalid page token');
      if (page === '1001' && fake.revoked1001) return err(400, 190, 'The session has been invalidated because the user changed their password');
      if (page === '1002' && edge === 'feed' && fake.transient1002 > 0) { fake.transient1002--; return err(500, 2, 'An unexpected error has occurred. Please retry your request later.'); }
      const src = form.url ?? form.file_url;
      if (src) fake.s3Fetch.push((await fetch(s3url(src))).status); // Facebook tự tải tệp từ link S3
      const id = `${page}_${++seq}`;
      if (page === '1001' && edge === 'feed') fake.published1001.push(id);
      if (edge === 'photos') return Response.json(form.published === 'false' ? { id: `ph${seq}` } : { id: `ph${seq}`, post_id: id });
      if (edge === 'videos') return Response.json({ id: `vid${seq}` });
      return Response.json({ id });
    }
    if (req.method === 'GET' && u.searchParams.get('fields') === 'permalink_url') {
      return Response.json({ permalink_url: p.startsWith('vid') ? `/1001/videos/${p}/` : `https://www.facebook.com/${p}` });
    }
    return err(404, 803, `Không hỗ trợ: ${req.method} ${u.pathname}`);
  },
});

// ---------------- Đăng nhập (giống assets-handover-e2e.ts) ----------------
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
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* rỗng */ }
  return { status: r.status, body: parsed, text };
};
const noSecrets = (text: string) => ![SU_GOOD, SU_BAD, SU_LIMITED, PT1, PT2].some((t) => text.includes(t));

const PW = 'E2e-Local-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const stamp = Date.now().toString(36).slice(-5);
const pos = (await json(admin, 'GET', '/api/org/positions')).body[0].id;
const mkEmp = async (code: string, name: string, departmentId: string, user: string) => {
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId, positionId: pos, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, cookie: await login(user, PW) };
};
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `MXH E2E ${stamp}`, code: `MX${stamp}` })).body;
const holder = await mkEmp(`MH${stamp}`, 'Người Giữ BM', dept, `e2e.mxh.holder.${stamp}`);
const outsider = await mkEmp(`MO${stamp}`, 'Người Ngoài MXH', dept, `e2e.mxh.out.${stamp}`);
ok('2 nhân viên đăng nhập', !!holder.cookie && !!outsider.cookie);

// ---------------- BM: token sai → đúng ----------------
const bmId = `9${Date.now()}`.slice(0, 15);
const c1 = await json(admin, 'POST', '/api/assets/social/facebook/accounts', { name: `BM E2E ${stamp}`, externalId: bmId, loginHint: 'mkt@e2e.test', ownerDepartmentId: dept,
  note: null, token: SU_BAD });
const bm = c1.body?.account;
ok('Tạo BM với token sai → lưu, trạng thái "Invalid" + lý do của Facebook', c1.status === 200 && bm.hasToken && bm.tokenStatus === 'Invalid'
  && /expired/.test(bm.tokenError ?? '') && c1.body.pages.length === 0, c1.body);
ok('Phản hồi không chứa token', noSecrets(c1.text));
ok('Route cũ /api/assets/social/accounts không còn (404) — API Facebook ở /api/assets/social/facebook/* (TEST-207)',
  (await json(admin, 'GET', '/api/assets/social/accounts')).status === 404 && (await json(admin, 'GET', '/api/assets/social/pages')).status === 404);
ok('Trùng ID Business Manager → 400', (await json(admin, 'POST', '/api/assets/social/facebook/accounts', { name: 'Trùng', externalId: bmId })).status === 400);
ok('ID BM có chữ → 400', (await json(admin, 'POST', '/api/assets/social/facebook/accounts', { name: 'Sai', externalId: '12ab' })).status === 400);
ok('Nhân viên không xem / tạo được BM (403)', (await json(holder.cookie, 'GET', '/api/assets/social/facebook/accounts')).status === 403
  && (await json(holder.cookie, 'POST', '/api/assets/social/facebook/accounts', { name: 'x' })).status === 403);
ok('Token có khoảng trắng → 400', (await json(admin, 'PUT', `/api/assets/social/facebook/accounts/${bm.id}/token`, { token: 'abc def' })).status === 400);

log.length = 0;
const t1 = await json(admin, 'PUT', `/api/assets/social/facebook/accounts/${bm.id}/token`, { token: SU_GOOD });
ok('Token đúng → Valid, tên System User, 3 trang (qua 2 trang kết quả)', t1.status === 200 && t1.body.account.tokenStatus === 'Valid'
  && t1.body.account.tokenOwnerName === 'OfficeHub Bot' && t1.body.pages.length === 3 && t1.body.account.pageCount === 3, t1.body);
const p1003 = t1.body.pages.find((p: any) => p.externalId === '1003');
ok('Trang không có page token → canPost = false', p1003 && !p1003.canPost && t1.body.pages.filter((p: any) => p.canPost).length === 2, t1.body.pages);
ok('Gọi Graph bằng header Bearer, không đặt token trong URL, không dùng link "next" chứa token',
  log.length >= 3 && log.every((r) => r.auth === `Bearer ${SU_GOOD}` && !/[?&]access_token=/.test(r.search) && !r.search.includes('LEAK')), log);
ok('Phản hồi không chứa token System User / page token', noSecrets(t1.text));
const audit = await json(admin, 'GET', `/api/audit/changes?entity=SocialAccount&entityId=${bm.id}`);
const perm = (acc: any, name: string) => acc?.tokenPermissions?.find((x: any) => x.permission === name);
const a1 = t1.body.account;
ok('Quyền của token: đủ 5 quyền OfficeHub cần (đánh dấu required), gộp 2 trang kết quả, không thiếu quyền',
  a1.tokenPermissions?.length === 7 && ['pages_show_list', 'pages_manage_posts', 'pages_read_engagement', 'business_management', 'pages_read_user_content']
    .every((n) => perm(a1, n)?.status === 'granted' && perm(a1, n)?.required) && perm(a1, 'ads_read')?.status === 'expired' && !perm(a1, 'ads_read')?.required
  && a1.missingPermissions.length === 0 && a1.tokenPermissionsError === null, a1);
ok('Lấy quyền qua /me/permissions bằng header, theo cursor after (không theo link next)',
  log.filter((r) => r.path.endsWith('/me/permissions')).map((r) => r.search).join('|') === '?limit=100|?limit=100&after=q1', log.map((r) => r.path + r.search));

const lim = await json(admin, 'PUT', `/api/assets/social/facebook/accounts/${bm.id}/token`, { token: SU_LIMITED });
const la = lim.body?.account;
ok('Token thiếu pages_manage_posts → vẫn Valid, API báo thiếu pages_manage_posts + business_management + pages_read_user_content kèm hậu quả',
  la?.tokenStatus === 'Valid' && perm(la, 'pages_manage_posts')?.status === 'declined' && !perm(la, 'ads_read')
  && la.missingPermissions.map((m: any) => m.permission).join(',') === 'pages_manage_posts,business_management,pages_read_user_content'
  && la.missingPermissions.every((m: any) => m.impact), la);
ok('Phản hồi token thiếu quyền không chứa token', noSecrets(lim.text));
fake.permFail = true;
const pf = (await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/sync`)).body?.account;
ok('Lấy quyền lỗi nhưng /me + trang OK → token Valid, danh sách quyền trống + ghi chú', pf?.tokenStatus === 'Valid' && pf.tokenPermissions === null
  && /Không lấy được danh sách quyền/.test(pf.tokenPermissionsError ?? '') && pf.missingPermissions.length === 0 && pf.pageCount === 3, pf);
fake.permFail = false;
const back = (await json(admin, 'PUT', `/api/assets/social/facebook/accounts/${bm.id}/token`, { token: SU_GOOD })).body?.account;
ok('Thay lại token đủ quyền → danh sách mới, hết cảnh báo', back?.tokenStatus === 'Valid' && back.missingPermissions.length === 0
  && back.tokenPermissions?.length === 7 && back.tokenPermissionsError === null, back);
ok('Lịch sử sửa có BM nhưng che token', audit.status === 200 && audit.text.includes('TokenEncrypted') && noSecrets(audit.text)
  && !/"(old|new)":"[A-Za-z0-9+/=]{40,}"/.test(audit.text), audit.text.slice(0, 500));
const pageId = (ext: string) => t1.body.pages.find((p: any) => p.externalId === ext).id as string;
const P1 = pageId('1001'), P2 = pageId('1002'), P3 = pageId('1003');

// ---------------- Quyền trước khi bàn giao ----------------
ok('Nhân viên chưa được giao: không có trang', (await json(holder.cookie, 'GET', '/api/assets/social/facebook/pages')).body?.length === 0);
ok('Nhân viên chưa được giao: đăng bài 403', (await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: 'x', pageIds: [P1] })).status === 403);
ok('Nhân viên chưa được giao: xin link tải tệp 403', (await json(holder.cookie, 'POST', '/api/assets/social/facebook/media', { fileName: 'a.png', size: 10 })).status === 403);

// ---------------- Bàn giao ----------------
const as = await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/assign`, { employeeId: holder.e.id, note: 'Phụ trách fanpage' });
ok('Bàn giao BM → người giữ + lịch sử', as.status === 200 && as.body.account.holderEmployeeId === holder.e.id && as.body.history.length === 1, as.body);
ok('Bàn giao lần nữa khi đang có người giữ → 409', (await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/assign`, { employeeId: outsider.e.id })).status === 409);
const nAssign = (await json(holder.cookie, 'GET', '/api/notifications?take=10')).body?.items?.find((n: any) => n.category === 'asset_assigned');
ok('Người giữ nhận chuông bàn giao (link /social/facebook)', !!nAssign && nAssign.link === '/social/facebook' && nAssign.title.includes(`BM E2E ${stamp}`), nAssign);
const my = await json(holder.cookie, 'GET', '/api/assets/my');
ok('Tài sản của tôi có BM (3 trang, không token)', my.body?.socials?.length === 1 && my.body.socials[0].pageCount === 3 && noSecrets(my.text), my.body);
const hp = await json(holder.cookie, 'GET', '/api/assets/social/facebook/pages');
ok('Người giữ thấy 3 trang của BM', hp.status === 200 && hp.body.length === 3 && noSecrets(hp.text), hp.body);
ok('Người ngoài vẫn không có trang', (await json(outsider.cookie, 'GET', '/api/assets/social/facebook/pages')).body?.length === 0);

// ---------------- Kiểm tra dữ liệu ----------------
const bad = async (body: unknown) => (await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', body)).status;
ok('Bài rỗng → 400', (await bad({ message: ' ', pageIds: [P1] })) === 400);
ok('Không chọn trang → 400', (await bad({ message: 'x', pageIds: [] })) === 400);
ok('Trang thiếu quyền đăng → 400', (await bad({ message: 'x', pageIds: [P3] })) === 400);
ok('Link không phải http(s) → 400', (await bad({ message: 'x', link: 'ftp://a.b', pageIds: [P1] })) === 400);
ok('Hẹn giờ sau 1 phút → 400', (await bad({ message: 'x', pageIds: [P1], scheduledAt: new Date(Date.now() + 60_000).toISOString() })) === 400);
ok('Hẹn giờ quá 180 ngày → 400', (await bad({ message: 'x', pageIds: [P1], scheduledAt: new Date(Date.now() + 200 * 86400_000).toISOString() })) === 400);
ok('Tệp không phải ảnh / video → 400', (await json(holder.cookie, 'POST', '/api/assets/social/facebook/media', { fileName: 'a.pdf', size: 10 })).status === 400);
ok('Ảnh > 10 MB → 400', (await json(holder.cookie, 'POST', '/api/assets/social/facebook/media', { fileName: 'a.jpg', size: 11 * 1024 * 1024 })).status === 400);

const waitPost = async (cookie: string, id: string, done: (p: any) => boolean, ms = 30_000) => {
  const until = Date.now() + ms;
  let p: any = null;
  while (Date.now() < until) {
    p = (await json(cookie, 'GET', `/api/assets/social/facebook/posts/${id}`)).body;
    if (p && done(p)) return p;
    await sleep(1000);
  }
  return p;
};

// ---------------- Đăng chữ + link lên 2 trang (trang 2 lỗi tạm thời 1 lần) ----------------
log.length = 0;
const text = await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: `Xin chào từ OfficeHub ${stamp}`, link: 'https://example.com/a', pageIds: [P1, P2] });
ok('Đăng ngay → 200, 2 đích Chờ', text.status === 200 && text.body.targets.length === 2 && text.body.scheduledAt == null, text.body);
let tp = await waitPost(holder.cookie, text.body.id, (p) => p.targets.find((t: any) => t.pageId === P1).status === 'Published'
  && p.targets.find((t: any) => t.pageId === P2).attempts >= 1 && p.targets.find((t: any) => t.pageId === P2).status === 'Pending');
const tP1 = tp?.targets.find((t: any) => t.pageId === P1), tP2 = tp?.targets.find((t: any) => t.pageId === P2);
ok('Trang 1 đã đăng ngay (job được đánh thức), có link bài', tP1?.status === 'Published' && tP1.permalink?.startsWith('https://www.facebook.com/1001_'), tp);
ok('Trang 2 lỗi tạm thời → chờ thử lại (lần 2) kèm lý do', tP2?.status === 'Pending' && tP2.attempts === 1 && /Thử lại lần 2/.test(tP2.error ?? ''), tP2);
const feed1 = log.find((r) => r.path === '/v23.0/1001/feed');
ok('Graph nhận /feed với message + link, header page token', feed1?.form.message === `Xin chào từ OfficeHub ${stamp}` && feed1.form.link === 'https://example.com/a'
  && feed1.auth === `Bearer ${PT1}` && !('access_token' in feed1.form), feed1);
ok('Trạng thái bài lúc này: Chờ đăng (còn trang 2)', tp?.status === 'Scheduled', tp?.status);
console.log('  … đợi job thử lại trang 2 (≤ 100 giây)');
tp = await waitPost(holder.cookie, text.body.id, (p) => p.targets.every((t: any) => t.status === 'Published'), 100_000);
ok('Thử lại sau 1 phút → trang 2 đã đăng, bài "Đã đăng"', tp?.status === 'Published' && tp.targets.find((t: any) => t.pageId === P2).attempts === 2, tp);

// ---------------- Ảnh (S3 thật) → attached_media ----------------
const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
const upload = async (cookie: string, name: string, bytes: Uint8Array) => {
  const t = await json(cookie, 'POST', '/api/assets/social/facebook/media', { fileName: name, size: bytes.length });
  if (t.status !== 200) return { status: t.status, body: t.body };
  const put = await fetch(s3url(t.body.uploadUrl), { method: 'PUT', headers: { 'Content-Type': t.body.contentType }, body: bytes });
  const c = await json(cookie, 'POST', `/api/assets/social/facebook/media/${t.body.id}/confirm`, {});
  return { status: put.ok ? c.status : put.status, body: c.body, ticket: t.body };
};
const early = await json(holder.cookie, 'POST', '/api/assets/social/facebook/media', { fileName: 'chua-put.png', size: png.length });
ok('Xác nhận khi chưa PUT → 409', (await json(holder.cookie, 'POST', `/api/assets/social/facebook/media/${early.body.id}/confirm`, {})).status === 409);
const i1 = await upload(holder.cookie, 'anh 1.png', png), i2 = await upload(holder.cookie, 'anh-2.png', png);
ok('Tải 2 ảnh lên S3 + xác nhận', i1.status === 200 && i2.status === 200 && i1.body.kind === 'Image' && i1.ticket?.uploadUrl.includes('assets/social/'), [i1, i2]);
ok('Người khác không xác nhận được tệp của mình (404)', (await json(outsider.cookie, 'POST', `/api/assets/social/facebook/media/${i1.body.id}/confirm`, {})).status === 404);
ok('Bài có ảnh không gắn được link xem trước → 400', (await bad({ message: 'x', link: 'https://a.b', pageIds: [P1], mediaIds: [i1.body.id] })) === 400);
log.length = 0;
fake.s3Fetch.length = 0;
const pic = await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: 'Album', pageIds: [P1], mediaIds: [i2.body.id, i1.body.id] });
const picDone = await waitPost(holder.cookie, pic.body.id, (p) => p.status === 'Published');
const photos = log.filter((r) => r.path === '/v23.0/1001/photos'), albumFeed = log.find((r) => r.path === '/v23.0/1001/feed');
ok('2 ảnh: tải ẩn từng ảnh (published=false) rồi /feed + attached_media đúng thứ tự', picDone?.status === 'Published' && photos.length === 2
  && photos.every((r) => r.form.published === 'false') && albumFeed?.form['attached_media[0]']?.includes('media_fbid') && albumFeed.form['attached_media[1]'] != null
  && albumFeed.form.message === 'Album', { picDone, photos, albumFeed });
ok('Facebook tải được ảnh từ link S3 (200)', fake.s3Fetch.length === 2 && fake.s3Fetch.every((s) => s === 200), fake.s3Fetch);
ok('Bài có 2 ảnh trả về theo thứ tự chọn', picDone?.media.map((m: any) => m.id).join() === [i2.body.id, i1.body.id].join(), picDone?.media);
ok('Dùng lại ảnh đã gắn bài khác → 400', (await bad({ message: 'x', pageIds: [P1], mediaIds: [i1.body.id] })) === 400);
const mu = await json(holder.cookie, 'GET', `/api/assets/social/facebook/media/${i1.body.id}/url`);
ok('Xem ảnh: người đăng được, người ngoài 404', mu.status === 200 && mu.body.url.startsWith('http')
  && (await json(outsider.cookie, 'GET', `/api/assets/social/facebook/media/${i1.body.id}/url`)).status === 404);

// ---------------- Video ----------------
const vid = await upload(holder.cookie, 'clip.mp4', new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 112, 52, 50]));
ok('Video + ảnh cùng bài → 400', (await bad({ message: 'x', pageIds: [P1], mediaIds: [vid.body.id, (await upload(holder.cookie, 'a3.png', png)).body.id] })) === 400);
log.length = 0;
const vp = await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: 'Video mới', pageIds: [P1], mediaIds: [vid.body.id] });
const vDone = await waitPost(holder.cookie, vp.body.id, (p) => p.status === 'Published');
const vreq = log.find((r) => r.path === '/v23.0/1001/videos');
ok('Video: /videos với file_url (S3) + description; permalink tương đối → tuyệt đối', vDone?.status === 'Published' && vreq?.form.description === 'Video mới'
  && vreq.form.file_url?.includes('assets/social/') && vDone.targets[0].permalink?.startsWith('https://www.facebook.com/1001/videos/vid'), { vDone, vreq });

// ---------------- TEST-206: chi tiết Fanpage + bài viết hiện có ----------------
const pageApi = (id: string) => `/api/assets/social/facebook/pages/${id}`;
const d0 = await json(holder.cookie, 'GET', pageApi(P1));
ok('Người giữ xem chi tiết trang: chưa đồng bộ bài, được đồng bộ', d0.status === 200 && d0.body.page.name === 'Trang Một' && d0.body.postCount === 0
  && d0.body.postsSyncedAt === null && d0.body.canSync && d0.body.holderName === 'Người Giữ BM' && noSecrets(d0.text), d0.body);
ok('Người ngoài: chi tiết / bài / đồng bộ trang → 404', (await json(outsider.cookie, 'GET', pageApi(P1))).status === 404
  && (await json(outsider.cookie, 'GET', `${pageApi(P1)}/posts`)).status === 404 && (await json(outsider.cookie, 'POST', `${pageApi(P1)}/sync-posts`)).status === 404);
ok('Trang không tồn tại → 404', (await json(admin, 'GET', pageApi(crypto.randomUUID()))).status === 404);
log.length = 0;
const s1 = await json(holder.cookie, 'POST', `${pageApi(P1)}/sync-posts`);
ok('Đồng bộ bài → 200, đúng 100 bài, thời điểm đồng bộ, không lỗi', s1.status === 200 && s1.body.postCount === 100 && !!s1.body.postsSyncedAt
  && s1.body.postsSyncError === null && !s1.body.postsSyncing, s1.body);
const ppCalls = log.filter((r) => r.path === '/v23.0/1001/published_posts');
ok('Graph /published_posts bằng page token qua header, đủ trường, cursor after (không theo link next), dừng khi đủ 100',
  ppCalls.length === 3 && ppCalls.every((r) => r.auth === `Bearer ${PT1}` && !/access_token=/.test(r.search))
  && ppCalls.map((r) => new URLSearchParams(r.search).get('after')).join(',') === ',40,80'
  && new URLSearchParams(ppCalls[0].search).get('fields')?.includes('reactions.summary(total_count).limit(0)') === true
  && new URLSearchParams(ppCalls[2].search).get('limit') === '20', ppCalls.map((r) => r.search));
const l1 = await json(holder.cookie, 'GET', `${pageApi(P1)}/posts?page=1&pageSize=100`);
const ohId = (tP1?.permalink ?? '').replace('https://www.facebook.com/', '');
const ohPost = l1.body?.items?.find((x: any) => x.externalPostId === ohId);
ok('Danh sách bài: 100 bài mới nhất trước, bài cũ nhất (ngoài 100) không lưu', l1.status === 200 && l1.body.total === 100
  && l1.body.items[0].createdTime > l1.body.items[99].createdTime && !l1.body.items.some((x: any) => x.message === 'Bài cũ nhất'), l1.body?.items?.slice(0, 2));
ok('Bài đăng từ OfficeHub có nhãn + id bài OfficeHub; bài khác không', !!ohPost && ohPost.fromOfficeHub && ohPost.postId === text.body.id
  && l1.body.items.filter((x: any) => x.fromOfficeHub).length === fake.published1001.length, { ohId, ohPost });
const top = l1.body?.items?.[0];
ok('Lưu số tương tác (thích / bình luận / chia sẻ), ảnh CDN, link bài', top?.reactionCount === 10 && top.commentCount === 2 && top.shareCount === 4
  && top.pictureUrl?.startsWith('https://example.test/cdn/') && top.permalink?.startsWith('https://www.facebook.com/'), top);
log.length = 0;
const sAgain = await json(holder.cookie, 'POST', `${pageApi(P1)}/sync-posts`);
ok('Bấm lại < 1 phút → trả kết quả hiện có, không gọi Facebook', sAgain.status === 200 && Date.parse(sAgain.body.postsSyncedAt) === Date.parse(s1.body.postsSyncedAt)
  && log.filter((r) => r.path.endsWith('/published_posts')).length === 0, sAgain.body);
const hrD = await json(admin, 'GET', pageApi(P1)), hrL = await json(admin, 'GET', `${pageApi(P1)}/posts?page=2&pageSize=30`);
ok('HR xem chi tiết + bài (phân trang)', hrD.status === 200 && hrD.body.postCount === 100 && hrL.status === 200 && hrL.body.items.length === 30 && hrL.body.page === 2, hrL.body?.page);
const e1 = await json(holder.cookie, 'POST', `${pageApi(P2)}/sync-posts`);
ok('Thiếu quyền (#10) → 200, PostsSyncError ghi lý do, BM vẫn Valid', e1.status === 200 && /#10/.test(e1.body.postsSyncError ?? '') && e1.body.postCount === 0
  && e1.body.accountTokenStatus === 'Valid', e1.body);
const p3 = await json(admin, 'POST', `${pageApi(P3)}/sync-posts`);
ok('Trang không có page token → 409', p3.status === 409 && (await json(admin, 'GET', pageApi(P3))).body?.canSync === false, p3.body);
fake.posts1002 = 'revoked';
const e2 = await json(holder.cookie, 'POST', `${pageApi(P2)}/sync-posts`);
await sleep(300);
const tokNotes = ((await json(holder.cookie, 'GET', '/api/notifications?take=20')).body?.items ?? []).filter((n: any) => n.category === 'social_post' && n.title?.includes('Token BM'));
ok('Lỗi 190 khi đồng bộ bài → BM "Token lỗi" + người giữ nhận chuông token hỏng', e2.status === 200 && e2.body.accountTokenStatus === 'Invalid'
  && /not authorized/.test(e2.body.postsSyncError ?? '') && tokNotes.length === 1, { e2: e2.body, tokNotes });
fake.posts1002 = 'ok';
ok('Đồng bộ lại BM → token Valid', (await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/sync`)).body?.account.tokenStatus === 'Valid');
const e3 = await json(holder.cookie, 'POST', `${pageApi(P2)}/sync-posts`);
ok('Trang 2 hết lỗi → đồng bộ 1 bài, xoá lỗi', e3.body?.postCount === 1 && e3.body.postsSyncError === null, e3.body);
console.log('  … đợi hết 1 phút chặn bấm dồn để đồng bộ lần 2');
await sleep(Math.max(0, Date.parse(s1.body.postsSyncedAt) + 61_000 - Date.now()));
fake.likeBoost = 7; fake.newPosts = 2;
const s2b = await json(holder.cookie, 'POST', `${pageApi(P1)}/sync-posts`);
const l2 = await json(holder.cookie, 'GET', `${pageApi(P1)}/posts?page=1&pageSize=100`);
const ids2 = l2.body?.items?.map((x: any) => x.externalPostId) ?? [];
ok('Đồng bộ lần 2: thêm 2 bài mới, giữ bài cũ ngoài khoảng 100 (102 bài), không trùng', s2b.status === 200 && s2b.body.postCount === 102
  && Date.parse(s2b.body.postsSyncedAt) > Date.parse(s1.body.postsSyncedAt) && l2.body.total === 102 && new Set(ids2).size === ids2.length && ids2[0] === '1001_new2', s2b.body);
const same = l2.body?.items?.find((x: any) => x.externalPostId === ohId);
ok('Đồng bộ lần 2: cập nhật số tương tác bài cũ', same?.reactionCount === 17 && same.fromOfficeHub, same);

// ---------------- Xem bài: người ngoài ----------------
ok('Người ngoài không xem được bài (404) / danh sách rỗng', (await json(outsider.cookie, 'GET', `/api/assets/social/facebook/posts/${text.body.id}`)).status === 404
  && (await json(outsider.cookie, 'GET', '/api/assets/social/facebook/posts?page=1')).body?.total === 0);
const hrList = await json(admin, 'GET', '/api/assets/social/facebook/posts?page=1&pageSize=50');
ok('HR thấy mọi bài (phân trang)', hrList.status === 200 && hrList.body.total >= 3 && hrList.body.items.some((p: any) => p.id === vp.body.id), hrList.body?.total);

// ---------------- Hẹn giờ + huỷ ----------------
const at = new Date(Date.now() + 10 * 60_000).toISOString();
const sch = await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: 'Hẹn giờ', pageIds: [P1, P2], scheduledAt: at });
ok('Hẹn giờ 10 phút → Chờ đăng, có nút huỷ', sch.status === 200 && sch.body.status === 'Scheduled' && sch.body.canCancel, sch.body);
ok('Người ngoài không huỷ được (404)', (await json(outsider.cookie, 'POST', `/api/assets/social/facebook/posts/${sch.body.id}/cancel`)).status === 404);
const cc = await json(holder.cookie, 'POST', `/api/assets/social/facebook/posts/${sch.body.id}/cancel`);
ok('Người đăng huỷ → Đã huỷ', cc.status === 200 && cc.body.status === 'Cancelled' && cc.body.targets.every((t: any) => t.cancelledByName), cc.body);
ok('Huỷ lần nữa → 409', (await json(holder.cookie, 'POST', `/api/assets/social/facebook/posts/${sch.body.id}/cancel`)).status === 409);
ok('Đăng lại trang không lỗi → 409', (await json(holder.cookie, 'POST', `/api/assets/social/facebook/targets/${cc.body.targets[0].id}/retry`)).status === 409);

// ---------------- TEST-208: sửa bài đã hẹn còn chờ ----------------
const FB = '/api/assets/social/facebook';
const put = (cookie: string, id: string, body: unknown) => json(cookie, 'PUT', `${FB}/posts/${id}`, body);
const feedMsgs = (prefix: string) => log.filter((r) => /\/v23\.0\/\d+\/feed$/.test(r.path) && (r.form.message ?? '').startsWith(prefix));
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();
// (1) Nội dung + giờ hẹn: giờ cũ ~2 phút 10 giây, sửa sang ~3 phút 10 giây — kiểm tra ở cuối mục (chạy song song các bước khác)
const oldAt = new Date(Date.now() + 130_000).toISOString();
const ed = await json(holder.cookie, 'POST', `${FB}/posts`, { message: `EDIT-old ${stamp}`, pageIds: [P1], scheduledAt: oldAt });
ok('[208] Bài hẹn giờ của mình: canEdit = true, chưa sửa', ed.status === 200 && ed.body.canEdit === true && ed.body.editedAt == null, ed.body);
const newAt = inMin(3 + 1 / 6);
const ed1 = await put(holder.cookie, ed.body.id, { message: `EDIT-new ${stamp}`, pageIds: [P1], scheduledAt: newAt });
ok('[208] Sửa nội dung + giờ hẹn → 200, ghi "đã sửa lúc … bởi …"', ed1.status === 200 && ed1.body.message === `EDIT-new ${stamp}`
  && Date.parse(ed1.body.scheduledAt) === Date.parse(newAt) && Date.parse(ed1.body.targets[0].dueAt) === Date.parse(newAt)
  && !!ed1.body.editedAt && ed1.body.editedByName === 'Người Giữ BM' && ed1.body.status === 'Scheduled', ed1.body);
ok('[208] Giờ hẹn mới < hiện tại + 2 phút → 400', (await put(holder.cookie, ed.body.id, { message: 'x', pageIds: [P1], scheduledAt: inMin(1) })).status === 400);
ok('[208] Kiểm tra như lúc tạo: không trang → 400', (await put(holder.cookie, ed.body.id, { message: 'x', pageIds: [], scheduledAt: newAt })).status === 400);
ok('[208] Thêm trang chưa có quyền đăng (thiếu page token) → 400', (await put(holder.cookie, ed.body.id, { message: 'x', pageIds: [P1, P3], scheduledAt: newAt })).status === 400);
ok('[208] Người ngoài sửa → 404', (await put(outsider.cookie, ed.body.id, { message: 'x', pageIds: [P1], scheduledAt: newAt })).status === 404);
ok('[208] Lần sửa bị từ chối không đổi bài', (await json(holder.cookie, 'GET', `${FB}/posts/${ed.body.id}`)).body?.message === `EDIT-new ${stamp}`);

// (2) Người giữ BM không phải tác giả: chỉ huỷ, không sửa; HR sửa được bài của người khác
const hrPost = await json(admin, 'POST', `${FB}/posts`, { message: `HR-post ${stamp}`, pageIds: [P2], scheduledAt: inMin(20) });
const hrSeen = (await json(holder.cookie, 'GET', `${FB}/posts/${hrPost.body.id}`)).body;
ok('[208] Người giữ BM xem bài HR: canCancel nhưng không canEdit', hrSeen?.canCancel === true && hrSeen?.canEdit === false, hrSeen);
ok('[208] Người giữ BM sửa bài HR → 403', (await put(holder.cookie, hrPost.body.id, { message: 'sửa trộm', pageIds: [P2], scheduledAt: inMin(20) })).status === 403);
const hrEd = await put(admin, ed.body.id, { message: `EDIT-new ${stamp}`, pageIds: [P1], scheduledAt: newAt });
ok('[208] HR sửa bài của người giữ → 200 (ghi tên HR)', hrEd.status === 200 && hrEd.body.editedByName !== 'Người Giữ BM' && hrEd.body.canEdit, hrEd.body);
await json(admin, 'POST', `${FB}/posts/${hrPost.body.id}/cancel`);

// (3) Ảnh: bỏ một, thêm một, đổi thứ tự + bỏ trang 1 thêm trang 2 + chuyển sang đăng ngay
const m1 = await upload(holder.cookie, 'sua-1.png', png), m2 = await upload(holder.cookie, 'sua-2.png', png), m3 = await upload(holder.cookie, 'sua-3.png', png);
const im = await json(holder.cookie, 'POST', `${FB}/posts`, { message: `IMG-old ${stamp}`, pageIds: [P1], mediaIds: [m1.body.id, m2.body.id], scheduledAt: inMin(30) });
const m1Url = (await json(holder.cookie, 'GET', `${FB}/media/${m1.body.id}/url`)).body?.url as string;
ok('[208] Ảnh sắp bỏ còn trên S3 trước khi sửa', !!m1Url && (await fetch(s3url(m1Url))).status === 200);
const foreign = await upload(admin, 'cua-hr.png', png);
ok('[208] Thêm ảnh do người khác tải lên → 400', (await put(holder.cookie, im.body.id, { message: 'x', pageIds: [P1], mediaIds: [foreign.body.id], scheduledAt: inMin(30) })).status === 400);
const logBefore = log.length;
const im1 = await put(holder.cookie, im.body.id, { message: `IMG-new ${stamp}`, pageIds: [P2], mediaIds: [m3.body.id, m2.body.id], scheduledAt: null });
ok('[208] Sửa ảnh + trang + đăng ngay → 200: trang 2, ảnh [3, 2]', im1.status === 200 && im1.body.targets.length === 1 && im1.body.targets[0].pageId === P2
  && im1.body.media.map((m: any) => m.id).join() === [m3.body.id, m2.body.id].join() && im1.body.scheduledAt == null, im1.body);
const imDone = await waitPost(holder.cookie, im.body.id, (p) => p.status === 'Published', 20_000);
const after = log.slice(logBefore);
const imPhotos = after.filter((r) => r.path === '/v23.0/1002/photos');
const keyOf = (m: any) => (m.body.id as string).replaceAll('-', '');
ok('[208] Chuyển sang đăng ngay → đăng trong vài giây', imDone?.status === 'Published', imDone);
ok('[208] Graph nhận đúng bộ ảnh mới theo thứ tự [3, 2] lên trang 2, nội dung mới', imPhotos.length === 2 && imPhotos[0].form.url?.includes(keyOf(m3))
  && imPhotos[1].form.url?.includes(keyOf(m2)) && after.some((r) => r.path === '/v23.0/1002/feed' && r.form.message === `IMG-new ${stamp}`),
  imPhotos.map((r) => r.form.url?.slice(0, 120)));
ok('[208] Không đăng lên trang đã bỏ, không dùng ảnh đã bỏ', !after.some((r) => r.path.startsWith('/v23.0/1001/')) && !after.some((r) => r.form.url?.includes(keyOf(m1))));
ok('[208] Ảnh bị bỏ: hết link xem (404) + tệp không còn trên S3', (await json(holder.cookie, 'GET', `${FB}/media/${m1.body.id}/url`)).status === 404
  && (await fetch(s3url(m1Url))).status === 404);

// (4) Đã đăng / đã huỷ → 409
const pubSeen = (await json(holder.cookie, 'GET', `${FB}/posts/${text.body.id}`)).body;
ok('[208] Bài đã đăng: canEdit = false', pubSeen?.canEdit === false);
const pub409 = await put(holder.cookie, text.body.id, { message: 'x', pageIds: [P1], scheduledAt: null });
ok('[208] Sửa bài đã đăng → 409 kèm lý do', pub409.status === 409 && /đã gửi lên Facebook/.test(pub409.body?.detail ?? ''), pub409.body);
ok('[208] Sửa bài đã huỷ → 409', (await put(holder.cookie, sch.body.id, { message: 'x', pageIds: [P1], scheduledAt: inMin(30) })).status === 409);

// (5) Sửa đúng lúc job đăng: 6 vòng, mỗi vòng một bài hẹn giờ + 3 lần sửa song song cùng chuyển "đăng ngay" (lần commit đầu đánh thức job,
// các lần sau chạy đua với job nhận đích: thắng → 200, thua → 409) → nội dung lên Facebook luôn là bản cuối đã lưu, đúng một lần
let raceOk = true, raceWins = 0, race409 = 0;
for (let i = 0; i < 6; i++) {
  const v0 = `RACE${i}-v0 ${stamp}`;
  const rp = await json(holder.cookie, 'POST', `${FB}/posts`, { message: v0, pageIds: [P1], scheduledAt: inMin(30) });
  const rs = await Promise.all([1, 2, 3].map((k) => put(holder.cookie, rp.body.id, { message: `RACE${i}-v${k} ${stamp}`, pageIds: [P1], scheduledAt: null })));
  const okMsgs = rs.filter((r) => r.status === 200).map((r) => r.body.message);
  raceWins += okMsgs.length;
  race409 += rs.filter((r) => r.status === 409).length;
  const done = await waitPost(holder.cookie, rp.body.id, (p) => p.status === 'Published', 20_000);
  const sent = feedMsgs(`RACE${i}-`);
  const good = done?.status === 'Published' && sent.length === 1 && sent[0].form.message === done.message
    && okMsgs.length > 0 && okMsgs.includes(sent[0].form.message)
    && rs.every((r) => r.status === 200 || r.status === 409);
  if (!good) { raceOk = false; console.log('  vòng', i, rs.map((r) => r.status), okMsgs, sent.map((s) => s.form.message), done?.message, done?.status); }
}
ok(`[208] Sửa song song với job (6 vòng × 3 lần): đăng đúng 1 lần, luôn là nội dung cuối đã lưu (200: ${raceWins}, 409: ${race409})`, raceOk && raceWins >= 6);

// (6) Đang chờ thử lại (lỗi tạm thời) → 409
fake.transient1002 = 1;
const tr = await json(holder.cookie, 'POST', `${FB}/posts`, { message: `RETRY-208 ${stamp}`, pageIds: [P2] });
const trWait = await waitPost(holder.cookie, tr.body.id, (p) => p.targets[0].status === 'Pending' && p.targets[0].attempts === 1, 20_000);
const tr409 = await put(holder.cookie, tr.body.id, { message: 'x', pageIds: [P2], scheduledAt: null });
ok('[208] Bài đang chờ thử lại: canEdit = false, sửa → 409', trWait?.canEdit === false && tr409.status === 409 && /thử lại/.test(tr409.body?.detail ?? ''), [trWait, tr409.body]);
await json(holder.cookie, 'POST', `${FB}/posts/${tr.body.id}/cancel`);

// (1, tiếp) Tới giờ cũ: chưa đăng; tới giờ mới: đăng nội dung mới
await sleep(Math.max(0, Date.parse(oldAt) + 40_000 - Date.now()));
const atOld = (await json(holder.cookie, 'GET', `${FB}/posts/${ed.body.id}`)).body;
ok('[208] Qua giờ hẹn cũ: chưa đăng, Graph chưa nhận gì', atOld?.status === 'Scheduled' && feedMsgs('EDIT-').length === 0, [atOld?.status, feedMsgs('EDIT-').length]);
await sleep(Math.max(0, Date.parse(newAt) - Date.now()));
const atNew = await waitPost(holder.cookie, ed.body.id, (p) => p.status === 'Published', 60_000);
const editSent = feedMsgs('EDIT-');
ok('[208] Tới giờ mới: đăng đúng nội dung mới, một lần', atNew?.status === 'Published' && editSent.length === 1 && editSent[0].form.message === `EDIT-new ${stamp}`
  && Date.parse(atNew.targets[0].publishedAt) >= Date.parse(newAt), [atNew?.status, editSent.map((r) => r.form.message)]);
ok('[208] Bài đã đăng sau khi sửa vẫn giữ dấu "đã sửa"', !!atNew?.editedAt && atNew?.canEdit === false);

// ---------------- Thu hồi BM → huỷ bài chờ của người giữ ----------------
const sch2 = await json(holder.cookie, 'POST', '/api/assets/social/facebook/posts', { message: 'Hẹn giờ 2', pageIds: [P1], scheduledAt: at });
const hrSch = await json(admin, 'POST', '/api/assets/social/facebook/posts', { message: 'HR hẹn giờ', pageIds: [P2], scheduledAt: at });
const ret = await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/return`, { note: 'Đổi người phụ trách' });
ok('Thu hồi BM → không còn người giữ, lịch sử đóng', ret.status === 200 && ret.body.account.holderEmployeeId == null && ret.body.history[0].returnedAt, ret.body);
const s2 = (await json(admin, 'GET', `/api/assets/social/facebook/posts/${sch2.body.id}`)).body;
const hs = (await json(admin, 'GET', `/api/assets/social/facebook/posts/${hrSch.body.id}`)).body;
ok('Bài hẹn giờ của người giữ bị huỷ (ghi lý do); bài của HR vẫn chờ', s2?.status === 'Cancelled' && /thu hồi/.test(s2.targets[0].error ?? '')
  && hs?.status === 'Scheduled', { s2, hs });
ok('Người bị thu hồi: không còn trang, đăng 403, tài sản không còn BM', (await json(holder.cookie, 'GET', '/api/assets/social/facebook/pages')).body?.length === 0
  && (await bad({ message: 'x', pageIds: [P1] })) === 403 && (await json(holder.cookie, 'GET', '/api/assets/my')).body?.socials?.length === 0);
ok('Người bị thu hồi vẫn xem được bài mình đã đăng', (await json(holder.cookie, 'GET', `/api/assets/social/facebook/posts/${text.body.id}`)).status === 200);
const nRet = (await json(holder.cookie, 'GET', '/api/notifications?take=10')).body?.items?.find((n: any) => n.category === 'asset_returned');
ok('Người bị thu hồi nhận chuông', !!nRet, nRet);
await json(admin, 'POST', `/api/assets/social/facebook/posts/${hrSch.body.id}/cancel`);

// ---------------- Token bị thu hồi (190) ----------------
fake.revoked1001 = true;
const rv = await json(admin, 'POST', '/api/assets/social/facebook/posts', { message: 'Sau khi đổi mật khẩu', pageIds: [P1] });
const rvDone = await waitPost(admin, rv.body.id, (p) => p.status === 'Failed');
ok('Lỗi 190 → đích Lỗi (không thử lại), có nút đăng lại', rvDone?.status === 'Failed' && rvDone.targets[0].attempts === 1 && rvDone.targets[0].canRetry
  && /password/.test(rvDone.targets[0].error ?? ''), rvDone);
const bmAfter = (await json(admin, 'GET', `/api/assets/social/facebook/accounts/${bm.id}`)).body;
ok('BM chuyển "Token lỗi" kèm lý do', bmAfter?.account.tokenStatus === 'Invalid' && /password/.test(bmAfter.account.tokenError ?? ''), bmAfter?.account);
ok('Token lỗi → giữ danh sách quyền cũ', bmAfter?.account.tokenPermissions?.length === 7, bmAfter?.account.tokenPermissions);
const adminNotes = (await json(admin, 'GET', '/api/notifications?take=20')).body?.items ?? [];
ok('Chuông social_post: đăng thất bại + token BM hỏng', adminNotes.filter((n: any) => n.category === 'social_post').length >= 2, adminNotes.map((n: any) => n.title));
fake.revoked1001 = false;
const rs = await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/sync`);
ok('Đồng bộ lại → token Valid', rs.body?.account.tokenStatus === 'Valid', rs.body?.account);
const rt = await json(admin, 'POST', `/api/assets/social/facebook/targets/${rvDone.targets[0].id}/retry`);
const rtDone = await waitPost(admin, rv.body.id, (p) => p.status === 'Published');
ok('Đăng lại trang lỗi → Đã đăng', rt.status === 200 && rtDone?.status === 'Published', rtDone);

// ---------------- Nghỉ việc còn giữ BM ----------------
await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/assign`, { employeeId: outsider.e.id });
const hold = await json(admin, 'GET', `/api/assets/employees/${outsider.e.id}/holdings`);
ok('HR xem tài sản nhân viên: có BM', hold.body?.socials?.length === 1, hold.body);

// ---------------- Ngừng dùng ----------------
ok('Ngừng dùng khi còn người giữ → 409', (await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/status`, { status: 'Disabled' })).status === 409);
await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/return`, { note: null });
const dis = await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/status`, { status: 'Disabled' });
ok('Ngừng dùng → HR không còn trang để đăng, đăng bị chặn (400 / 403 khi không còn BM nào)', dis.body?.account.status === 'Disabled'
  && !(await json(admin, 'GET', '/api/assets/social/facebook/pages')).body.some((p: any) => p.accountId === bm.id)
  && [400, 403].includes((await json(admin, 'POST', '/api/assets/social/facebook/posts', { message: 'x', pageIds: [P1] })).status));
ok('Bàn giao BM ngừng dùng → 409', (await json(admin, 'POST', `/api/assets/social/facebook/accounts/${bm.id}/assign`, { employeeId: holder.e.id })).status === 409);
const list = await json(admin, 'GET', '/api/assets/social/facebook/accounts');
ok('Danh sách BM không chứa token', list.status === 200 && list.body.some((a: any) => a.id === bm.id) && noSecrets(list.text));

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
