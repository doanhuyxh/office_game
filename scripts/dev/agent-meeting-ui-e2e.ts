// E2E TEST-83: giao diện "Họp với AI" — danh sách bot cho hộp thoại (/api/meetings/agent-bots), người mở vào kênh phòng, tin hệ thống mở / kết thúc,
// rồi (BASE_URL) Chrome: nút trên trang Phòng họp → hộp thoại → sang kênh phòng, thanh trạng thái (đang nói / lượt) đổi khi bot nói, Dừng họp,
// HUD 3D trong phòng họp (thanh trạng thái, nút "Họp với AI" điền sẵn phòng), thẻ cấu hình trần ở Hệ thống → Cấu hình (admin).
// TẠO TÀI KHOẢN THẬT → CHỈ chạy trên DB tạm:
//   docker run -d --name e2e-agmui-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:55483:5432 postgres:18-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5188
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=55483;Database=e2e;Username=e2e;Password=e2e'
//        Chat__InternalKey=<≥32 ký tự> Chat__RealtimeToApiKey=<cùng giá trị>
//        Seed__AdminEmail=agmui-admin@officehub-e2e.vn Seed__AdminPassword=Agmui-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Giao diện (tuỳ chọn): Realtime (Realtime__ApiBaseUrl=http://localhost:5188 ASPNETCORE_URLS=http://localhost:5192 + cùng khoá Chat__*)
//        + Vite (frontend/: VITE_API_TARGET=http://localhost:5188 VITE_RT_TARGET=http://localhost:5192 bunx vite --port 5176 --strictPort)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5188 ADMIN_LOGIN=agmui-admin@officehub-e2e.vn ADMIN_PASSWORD=Agmui-Admin-2026 BASE_URL=http://localhost:5176 \
//     bun scripts/dev/agent-meeting-ui-e2e.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5188';
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
const tk = async (token: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026';
const EMPTY = '00000000-0000-0000-0000-000000000000';
const stamp = Date.now().toString(36).slice(-5);

const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
if (!admin) throw new Error('Không đăng nhập được admin seed');
// Lần chạy trước dừng giữa chừng → còn phiên đang họp chiếm phòng: admin (HR) dừng hết
for (const s of (await json(admin, 'GET', '/api/meetings/sessions?active=true')).body ?? []) await json(admin, 'POST', `/api/meetings/sessions/${s.id}/stop`);
const positions = (await json(admin, 'GET', '/api/org/positions')).body;
const pos = positions.find((p: any) => p.name === 'Chuyên viên') ?? positions[0];
const depName = `Họp AI UI ${stamp}`;
const dep = (await json(admin, 'POST', '/api/org/departments', { name: depName, code: `AU${stamp}`.slice(0, 10) })).body;
let seq = 800 + Math.floor(Math.random() * 90);
const mkEmp = async (name: string, user: string) => {
  const code = `NV${seq++}${stamp}`.slice(0, 20);
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null,
    dateOfBirth: null, departmentId: dep, positionId: pos.id, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  const cookie = await login(user, PW);
  const t = (await json(cookie, 'POST', '/api/auth/access-tokens', { name: `Agent ${user}`, expiresInDays: 30 })).body;
  return { e, code: e.code as string, user, cookie, token: t?.token as string, name };
};
const H = await mkEmp('Người Mở Họp', `e2e.au.h.${stamp}`);
const N = await mkEmp('Đồng Nghiệp', `e2e.au.n.${stamp}`);
const B1 = await mkEmp('Bot Chiến Lược', `e2e.au.b1.${stamp}`);
const B2 = await mkEmp('Bot Kỹ Thuật', `e2e.au.b2.${stamp}`);
ok('4 tài khoản + token', [H, N, B1, B2].every((x) => x.e?.id && x.token?.startsWith('ohk_')));
for (const b of [B1, B2]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });

// ---------- Danh sách bot cho hộp thoại ----------
const bots = await json(H.cookie, 'GET', '/api/meetings/agent-bots');
const b1Opt = bots.body?.find((x: any) => x.employeeId === B1.e.id);
ok('agent-bots: có 2 bot vừa đánh dấu kèm mã / phòng ban / chức vụ', bots.status === 200 && !!b1Opt && b1Opt.code === B1.code && b1Opt.departmentName === depName
  && b1Opt.positionName === pos.name && bots.body.some((x: any) => x.employeeId === B2.e.id), bots);
ok('agent-bots: không có người thật', !bots.body?.some((x: any) => [H.e.id, N.e.id].includes(x.employeeId)));
ok('agent-bots: token AI → 403', (await tk(H.token, 'GET', '/api/meetings/agent-bots')).status === 403 && (await tk(B1.token, 'GET', '/api/meetings/agent-bots')).status === 403);

// ---------- Mở: người mở vào kênh phòng + tin hệ thống ----------
const ROOM = 'meeting-small';
const roomConv = async (cookie: string) => ((await json(cookie, 'GET', '/api/chat/conversations')).body as any[] ?? []).find((c) => c.type === 'Room' && c.roomId === ROOM);
ok('trước khi mở: H chưa có kênh Phòng họp nhỏ', !(await roomConv(H.cookie)));
const open = await json(H.cookie, 'POST', '/api/meetings/sessions', { roomId: ROOM, topic: `Chiến lược ${stamp}`, chairEmployeeId: B1.e.id, botIds: [B1.e.id, B2.e.id] });
ok('H mở họp ở Phòng họp nhỏ', open.status === 200 && open.body.status === 'Active', open);
const conv = await roomConv(H.cookie);
ok('người mở được thêm vào kênh phòng', !!conv, conv);
const msgs = async () => ((await json(H.cookie, 'GET', `/api/chat/conversations/${conv?.id}/messages?take=20`)).body?.items ?? []) as any[];
const openMsg = (await msgs()).find((m) => m.senderId === EMPTY && m.text?.includes('mở cuộc họp agent') && m.text.includes(stamp));
ok('tin hệ thống mở họp: người mở, chủ đề, chủ trì, trần', !!openMsg && openMsg.senderName === 'OfficeHub' && openMsg.text.includes(H.name)
  && openMsg.text.includes(`Chiến lược ${stamp}`) && openMsg.text.includes(`chủ trì: ${B1.name}`) && /\d+ lượt \/ \d+ phút/.test(openMsg.text), openMsg);
ok('N (không phải người mở, không phải HR) thấy phiên, canStop=false',
  (await json(N.cookie, 'GET', `/api/meetings/sessions?roomId=${ROOM}`)).body?.[0]?.canStop === false);
ok('nhân viên xem / lưu trần → 403', (await json(N.cookie, 'GET', '/api/meetings/agent-settings')).status === 403
  && (await json(N.cookie, 'PUT', '/api/meetings/agent-settings', { maxTurns: 30, maxMinutes: 30 })).status === 403);
const stop = await json(H.cookie, 'POST', `/api/meetings/sessions/${open.body.id}/stop`);
ok('H dừng → Stopped', stop.status === 200 && stop.body.endReason === 'Stopped', stop);
ok('tin hệ thống kết thúc trong kênh phòng', (await msgs()).some((m) => m.senderId === EMPTY && m.text?.includes('dừng cuộc họp')));

// ---------- Giao diện (tuỳ chọn) ----------
if (process.env.BASE_URL) {
  const BASE = process.env.BASE_URL;
  const h = await launch(9351, `${tmpdir()}/au-h-${stamp}`);
  const n = await launch(9352, `${tmpdir()}/au-n-${stamp}`);
  const ad = await launch(9353, `${tmpdir()}/au-a-${stamp}`);
  const waitJs = async (p: typeof h, expr: string, ms = 12000) => { for (let i = 0; i < ms / 250; i++) { if (await p.evalJs(expr)) return true; await p.sleep(250); } return false; };
  const click = (p: typeof h, expr: string) => p.evalJs(`(() => { const e = ${expr}; e?.click(); return !!e })()`);
  const byText = (sel: string, text: string) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.textContent.includes(${JSON.stringify(text)}))`;
  const bar = `document.querySelector('[data-testid="agent-meeting-bar"]')`;
  /** SHOTS=<thư mục> → chụp màn hình các bước chính để xem bằng mắt. */
  const snap = async (p: typeof h, file: string) => { if (process.env.SHOTS) await p.shot(`${process.env.SHOTS}/${file}.png`); };
  try {
    ok('UI: H, N đăng nhập', (await h.login(H.user, PW)) === 200 && (await n.login(N.user, PW)) === 200);
    await h.go(`${BASE}/meetings`, 3000);
    ok('UI: trang Phòng họp có nút "Họp với AI"', await click(h, `document.querySelector('[data-testid="agent-meeting-new"]')`));
    ok('UI: hộp thoại mở, có bot kèm chip BOT + phòng ban', await waitJs(h, `(() => { const d = document.querySelector('[data-testid="agent-meeting-dialog"]');
      return !!d && d.textContent.includes(${JSON.stringify(B1.name)}) && d.textContent.includes('BOT') && d.textContent.includes(${JSON.stringify(depName)}); })()`));
    // Phòng mặc định = phòng đầu danh sách (Hội trường); chủ đề + chọn 2 bot (bot chọn đầu tự làm chủ trì)
    await h.evalJs(`document.getElementById('am-topic').focus()`);
    await h.send('Input.insertText', { text: `Ra mắt sản phẩm ${stamp}` });
    // Chọn theo mã (chạy lại nhiều lần trên cùng DB → có bot trùng tên của lần trước)
    await click(h, `${byText('[data-testid="agent-meeting-dialog"] label', B1.code)}?.querySelector('button')`);
    await click(h, `${byText('[data-testid="agent-meeting-dialog"] label', B2.code)}?.querySelector('button')`);
    ok('UI: chủ trì tự chọn bot đầu', await waitJs(h, `document.getElementById('am-chair')?.textContent.includes(${JSON.stringify(B1.code)})`));
    await snap(h, '1-dialog');
    await click(h, byText('[data-testid="agent-meeting-dialog"] button[type="submit"]', 'Bắt đầu họp'));
    ok('UI: mở xong → sang /chat, kênh phòng có thanh "Đang họp"', await waitJs(h, `location.pathname === '/chat' && ${bar}?.dataset.status === 'active'`, 15000),
      await h.evalJs(`location.href + ' ' + (${bar}?.outerHTML ?? 'no-bar')`));
    ok('UI: thanh hiện chủ đề, "Đang nói: <chủ trì>", lượt 0 / trần, nút Dừng họp', await waitJs(h, `(() => { const b = ${bar};
      return b.textContent.includes(${JSON.stringify(`Ra mắt sản phẩm ${stamp}`)}) && b.querySelector('[data-testid="agent-meeting-speaker"]').textContent.includes(${JSON.stringify(B1.name)})
        && /Lượt 0 \\/ \\d+/.test(b.textContent) && !!b.querySelector('[data-testid="agent-meeting-stop"]'); })()`), await h.evalJs(`${bar}?.textContent`));
    ok('UI: tin hệ thống mở họp hiện khác tin thường', await waitJs(h, `${byText('[data-testid="chat-system-message"]', `Ra mắt sản phẩm ${stamp}`)} !== undefined`));
    // Cookie API của H đã hết hiệu lực khi H đăng nhập trên Chrome (mỗi lúc một thiết bị) → hỏi qua trình duyệt
    const hallId = await h.evalJs(`(async () => { const s = (await (await fetch('/api/meetings/sessions?active=true')).json()).find((x) => x.topic === ${JSON.stringify(`Ra mắt sản phẩm ${stamp}`)});
      return (await (await fetch('/api/chat/conversations')).json()).find((c) => c.roomId === s?.roomId)?.id ?? null; })()`);
    const hall = { id: hallId };
    // Bot chủ trì nói + @nhắc bot 2 → lượt chuyển, thanh tự cập nhật (hỏi lại 3 giây)
    const said = await tk(B1.token, 'POST', `/api/chat/conversations/${hall?.id}/messages`, { text: `Mời @${B2.code} trình bày`, uploadIds: [], clientId: crypto.randomUUID() });
    ok('bot chủ trì nói trong kênh phòng', said.status === 200, { said, hallId });
    ok('UI: lượt đổi theo thời gian thực → "Đang nói: <bot 2>", lượt 1', await waitJs(h, `(() => { const b = ${bar};
      return b?.querySelector('[data-testid="agent-meeting-speaker"]')?.textContent.includes(${JSON.stringify(B2.name)}) && /Lượt 1 \\//.test(b.textContent); })()`, 10000),
      await h.evalJs(`${bar}?.textContent`));

    // N trong văn phòng 3D đi vào Hội trường → HUD: thanh đang họp, không có nút Dừng (không phải người mở)
    await n.go(`${BASE}/office`, 6000);
    await n.evalJs(`window.__officeScene.walkTo(16, 4)`);
    ok('UI HUD: N vào Hội trường → thanh đang họp trong khung chat', await waitJs(n, `document.querySelector('[data-testid="office-chat"] [data-testid="agent-meeting-bar"]')?.dataset.status === 'active'`, 30000),
      await n.evalJs(`document.querySelector('.zone')?.textContent ?? null`));
    await snap(h, '2-chat-active');
    await snap(n, '3-hud-active');
    ok('UI HUD: N không thấy nút Dừng họp', await n.evalJs(`!document.querySelector('[data-testid="agent-meeting-stop"]')`));

    // H dừng → hộp xác nhận → thanh "đã kết thúc" + tin hệ thống
    await click(h, `document.querySelector('[data-testid="agent-meeting-stop"]')`);
    await h.sleep(600);
    ok('UI: bấm Dừng → hộp xác nhận', await click(h, byText('[role="alertdialog"] button', 'Dừng họp')));
    ok('UI: thanh chuyển "đã kết thúc: <người> dừng cuộc họp"', await waitJs(h, `${bar}?.dataset.status === 'ended' && ${bar}.textContent.includes(${JSON.stringify(`${H.name} dừng cuộc họp`)})`),
      await h.evalJs(`${bar}?.textContent`));
    ok('UI: tin hệ thống kết thúc hiện trong kênh (tải lại khi phiên đổi)', await waitJs(h, `${byText('[data-testid="chat-system-message"]', 'đã kết thúc')} !== undefined`));
    ok('UI HUD: N thấy phiên kết thúc + nút "Họp với AI"', await waitJs(n, `(() => { const b = document.querySelector('[data-testid="office-chat"] [data-testid="agent-meeting-bar"]');
      return b?.dataset.status === 'ended' && !!b.querySelector('[data-testid="agent-meeting-open"]'); })()`, 20000));
    await snap(h, '4-chat-ended');
    await snap(n, '5-hud-ended');
    await click(n, `document.querySelector('[data-testid="agent-meeting-open"]')`);
    ok('UI HUD: nút mở hộp thoại, điền sẵn phòng đang đứng', await waitJs(n, `document.getElementById('am-room')?.textContent.includes('Hội trường') === true`),
      await n.evalJs(`document.getElementById('am-room')?.textContent ?? null`));

    // Admin: thẻ "Cuộc họp với AI" ở Hệ thống → Cấu hình (cookie admin đặt thẳng vào Chrome — login 2FA đã làm qua API)
    const cookieName = admin.split('=')[0];
    await ad.send('Network.setCookie', { name: cookieName, value: admin.slice(cookieName.length + 1), url: BASE });
    await ad.go(`${BASE}/system?tab=config`, 4000);
    ok('UI admin: thẻ "Cuộc họp với AI" với trần hiện tại', await waitJs(ad, `(() => { const c = document.querySelector('[data-testid="agent-meeting-limits"]');
      return !!c && /^\\d+$/.test(document.getElementById('agent-meeting-turns')?.value ?? '') && !!document.getElementById('agent-meeting-minutes'); })()`));
    await snap(ad, '6-config');
    const errs = [...h.errors, ...n.errors, ...ad.errors].filter((e) => !/livekit|7880|voice|favicon|WebGL|GPU/i.test(e));
    ok('UI: không lỗi console', errs.length === 0, errs);
  } finally {
    h.close(); n.close(); ad.close();
  }
}

console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
