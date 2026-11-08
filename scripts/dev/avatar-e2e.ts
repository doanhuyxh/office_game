// E2E nhân vật văn phòng 3D: API (PUT/DELETE /api/auth/avatar, kiểm tra danh mục, chặn token AI) + 2 Chrome (đồng bộ
// ngoại hình qua hub khi vào và khi đổi bằng editor, model GLB đã tải, gợi ý tạo nhân vật, editor ở trang hồ sơ).
// TẠO NHÂN VIÊN THẬT → CHỈ chạy trên DB tạm. Cần Api + Realtime (trỏ DB tạm) + Vite dev:
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5080 BASE_URL=http://localhost:5173 \
//   ADMIN_LOGIN=<Seed__AdminEmail> ADMIN_PASSWORD=<Seed__AdminPassword> bun scripts/dev/avatar-e2e.ts <thư-mục-ảnh> <tiền-tố-profile-chrome>
import { BASE, launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5080';
const ADMIN = process.env.ADMIN_LOGIN!, ADMIN_PW = process.env.ADMIN_PASSWORD!;
if (!ADMIN || !ADMIN_PW) throw new Error('Đặt ADMIN_LOGIN / ADMIN_PASSWORD (admin seed của DB tạm)');
const [shots = '/tmp/avatar-shots', prof = '/tmp/avatar-e2e-profile'] = process.argv.slice(2);
const catalog = await Bun.file(new URL('../../shared/avatar-catalog.json', import.meta.url)).json();

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 400) : ''}`);
};
const login = async (l: string, p: string) =>
  ((await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: l, password: p }) })).headers.getSetCookie().map((c) => c.split(';')[0]).filter((c) => c.startsWith('officehub.auth=')).at(-1) ?? '');
const json = async (auth: string, method: string, path: string, body?: unknown) => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth.startsWith('ohk_')) headers.authorization = `Bearer ${auth}`; else headers.cookie = auth;
  const r = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};

// ---------- Chuẩn bị: admin seed + 1 nhân viên thử ----------
const admin = await login(ADMIN, ADMIN_PW);
if (!admin) throw new Error('Không đăng nhập được admin seed');
const PW = 'E2e-Avatar-2026';
const e = (await json(admin, 'POST', '/api/org/employees', { code: 'NV980', fullName: 'Chị Thử Nhân Vật', email: 'e2e.avatar@e2e.test', phone: null,
  dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null })).body?.employee;
if (!e) throw new Error('Không tạo được nhân viên thử (đã chạy script này trên DB tạm rồi? tạo DB mới)');
const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: 'e2e.avatar' })).body;
await json(await login('e2e.avatar', acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const nv = await login('e2e.avatar', PW);

// ---------- API ----------
const first = (body: string, slot: string) => catalog.bodies[body].parts[slot][0].id;
const look = (body: string, extra: Record<string, unknown> = {}) => ({
  v: 1, body, head: first(body, 'head'), top: first(body, 'top'), bottom: first(body, 'bottom'), shoes: first(body, 'shoes'),
  skin: null, hair: null, eyes: null, topColor: null, bottomColor: null, shoesColor: null, ...extra,
});
const me0 = await json(nv, 'GET', '/api/auth/me');
ok('chưa chọn → avatar null (nhân vật mặc định)', me0.status === 200 && me0.body.avatar === null, me0.body);
const femaleOnly = catalog.bodies.female.parts.bottom.map((p: any) => p.id).find((id: string) => !catalog.bodies.male.parts.bottom.some((p: any) => p.id === id));
for (const [name, body, field] of [
  ['dáng người lạ → 400', { ...look('male'), body: 'robot' }, 'body'],
  ['phần của dáng khác (váy cho nam) → 400', look('male', { bottom: femaleOnly }), 'bottom'],
  ['màu ngoài bảng → 400', look('female', { hair: 99 }), 'hair'],
  ['phiên bản lạ → 400', { ...look('female'), v: 2 }, 'v'],
] as const) {
  const r = await json(nv, 'PUT', '/api/auth/avatar', body);
  ok(name, r.status === 400 && !!r.body?.errors?.[field], r);
}
const wanted = look('female', { head: catalog.bodies.female.parts.head[2].id, skin: 3, hair: 6, topColor: 10, extra: 'bỏ' });
const put = await json(nv, 'PUT', '/api/auth/avatar', wanted);
ok('lưu nhân vật hợp lệ → 200, bỏ trường lạ', put.status === 200 && put.body.hair === 6 && put.body.extra === undefined, put);
const me1 = await json(nv, 'GET', '/api/auth/me');
ok('/me trả nhân vật đã lưu', me1.body.avatar?.body === 'female' && me1.body.avatar?.skin === 3 && me1.body.avatar?.topColor === 10, me1.body.avatar);
const del = await json(nv, 'DELETE', '/api/auth/avatar');
ok('về mặc định → 204, avatar null', del.status === 204 && (await json(nv, 'GET', '/api/auth/me')).body.avatar === null);
const tok = (await json(nv, 'POST', '/api/auth/access-tokens', { name: 'e2e avatar', expiresInDays: 30 })).body?.token;
const aiPut = await json(tok, 'PUT', '/api/auth/avatar', look('male'));
ok('token AI không đổi được nhân vật (403)', aiPut.status === 403, aiPut);
ok('admin (không có hồ sơ nhân viên) vẫn lưu được', (await json(admin, 'PUT', '/api/auth/avatar', look('male', { topColor: 4 }))).status === 200);
const adminId = (await json(admin, 'GET', '/api/auth/me')).body.id;
const nvId = (await json(nv, 'GET', '/api/auth/me')).body.id;

// ---------- Trình duyệt: A = admin (đã có nhân vật), B = nhân viên (mặc định) ----------
const A = await launch(9411, `${prof}-a`, 1280, 760), B = await launch(9412, `${prof}-b`, 1280, 760);
const waitFor = async (p: typeof A, expr: string, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evalJs(expr).catch(() => false)) return true; await p.sleep(250); } return false; };
const lookOf = (p: typeof A, id: string) => p.evalJs(`(()=>{const sc=window.__officeScene;const a=sc.me?.id===${JSON.stringify(id)}?sc.me:sc.others.get(${JSON.stringify(id)})?.avatar;return a?{look:a.currentLook,model:!!a.rig}:null})()`);
try {
  ok('A đăng nhập', (await A.login(ADMIN, ADMIN_PW)) === 200);
  ok('B đăng nhập', (await B.login('e2e.avatar', PW)) === 200);
  await A.go(`${BASE}/office`, 1000); await B.go(`${BASE}/office`, 1000);
  ok('A, B vào văn phòng', await waitFor(A, `!!window.__officeScene?.snapshot().me`) && await waitFor(B, `!!window.__officeScene?.snapshot().me`));
  ok('B thấy A với nhân vật đã lưu (model GLB đã tải)', await waitFor(B, `(()=>{const a=window.__officeScene.others.get(${JSON.stringify(adminId)})?.avatar;return a&&a.rig&&a.currentLook.topColor===4})()`), await lookOf(B, adminId));
  ok('A thấy B với nhân vật mặc định', await waitFor(A, `(()=>{const a=window.__officeScene.others.get(${JSON.stringify(nvId)})?.avatar;return a&&a.rig&&JSON.stringify(a.currentLook)===${JSON.stringify(JSON.stringify(catalog.default))}})()`), await lookOf(A, nvId));
  ok('B (chưa có nhân vật) thấy gợi ý tạo nhân vật', await waitFor(B, `!!document.querySelector('[data-testid=office-avatar-prompt]')`));
  ok('A (đã có) không thấy gợi ý', !(await A.evalJs(`!!document.querySelector('[data-testid=office-avatar-prompt]')`)));
  // Đặt 2 người cạnh nhau để chụp ảnh
  await B.evalJs(`window.__officeScene.walkTo(24.2, 27.5)`); await A.evalJs(`window.__officeScene.walkTo(25.8, 27.5)`);
  await B.sleep(4000);
  await B.shot(`${shots}/60-office-default-vs-custom.png`);

  // B mở editor từ gợi ý → chọn dáng nữ, tóc, màu áo → lưu → A thấy ngay (LookChanged)
  await B.evalJs(`document.querySelector('[data-testid=office-avatar-prompt] button.primary').click()`);
  ok('editor mở, có khung xem trước', await waitFor(B, `!!document.querySelector('[data-testid=avatar-editor] [data-testid=avatar-preview] canvas')`));
  const head = catalog.bodies.female.parts.head[1].id;
  await B.evalJs(`document.querySelector('[data-testid=avatar-body-female]').click()`);
  await B.evalJs(`[...document.querySelectorAll('[data-testid=avatar-editor] [role=tab]')].find(t=>t.textContent.includes('Tóc')).dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  await B.sleep(300);
  await B.evalJs(`document.querySelector('[data-testid=avatar-head-${head}]').click()`);
  await B.evalJs(`document.querySelectorAll('[data-testid=avatar-color-hair] button')[4].click()`);
  await B.sleep(1500);
  await B.shot(`${shots}/61-editor.png`);
  await B.evalJs(`document.querySelector('[data-testid=avatar-save]').click()`);
  ok('lưu từ editor → dialog đóng', await waitFor(B, `!document.querySelector('[data-testid=avatar-editor]')`));
  const saved = (await json(nv, 'GET', '/api/auth/me')).body.avatar;
  ok('server lưu đúng lựa chọn', saved?.body === 'female' && saved?.head === head && saved?.hair === 3, saved);
  ok('B thấy chính mình đổi ngay', await waitFor(B, `(()=>{const a=window.__officeScene.me;return a.rig&&a.currentLook.body==='female'&&a.currentLook.head===${JSON.stringify(head)}})()`), await lookOf(B, nvId));
  ok('A thấy B đổi nhân vật (LookChanged)', await waitFor(A, `(()=>{const a=window.__officeScene.others.get(${JSON.stringify(nvId)})?.avatar;return a&&a.rig&&a.currentLook.body==='female'&&a.currentLook.hair===3})()`), await lookOf(A, nvId));
  ok('gợi ý biến mất sau khi tạo', !(await B.evalJs(`!!document.querySelector('[data-testid=office-avatar-prompt]')`)));
  await A.sleep(1000);
  await A.shot(`${shots}/62-office-after-change.png`);

  // Ngồi: B ngồi ghế gần nhất → A thấy anim 2
  await B.evalJs(`window.__officeScene.walkTo(30.05, 22.7)`);
  await B.sleep(2500);
  await B.evalJs(`window.__officeScene.toggleSit()`);
  const sat = await waitFor(A, `window.__officeScene.snapshot().others.some(o=>o.anim===2)`, 6000);
  ok('ngồi ghế (nếu có ghế gần) — A thấy B ngồi', sat || !(await B.evalJs(`document.body.innerText.includes('Đang ngồi')`)));
  await B.sleep(1200);
  await B.shot(`${shots}/63-office-sitting.png`);

  // Vào lại → nhân vật giữ nguyên (đọc từ /api/auth/me khi kết nối hub)
  await B.go(`${BASE}/office`, 1000);
  ok('vào lại văn phòng vẫn giữ nhân vật', await waitFor(A, `(()=>{const a=window.__officeScene.others.get(${JSON.stringify(nvId)})?.avatar;return a&&a.rig&&a.currentLook.head===${JSON.stringify(head)}})()`));

  // Trang hồ sơ: thẻ nhân vật + editor tải lười
  await B.go(`${BASE}/profile`, 2500);
  ok('thẻ nhân vật ở trang hồ sơ', await waitFor(B, `document.querySelector('[data-testid=profile-avatar-edit]')?.textContent.includes('Sửa nhân vật')`));
  await B.evalJs(`document.querySelector('[data-testid=profile-avatar-edit]').click()`);
  ok('editor mở từ trang hồ sơ', await waitFor(B, `!!document.querySelector('[data-testid=avatar-editor] [data-testid=avatar-preview] canvas')`));
  await B.sleep(2000);
  await B.shot(`${shots}/64-profile-editor.png`);
  ok('không có lỗi console', A.errors.length === 0 && B.errors.length === 0, [...A.errors, ...B.errors]);
} finally {
  A.close(); B.close();
}
console.log(`\n${pass}/${pass + fail} PASS`);
process.exit(fail ? 1 : 0);
