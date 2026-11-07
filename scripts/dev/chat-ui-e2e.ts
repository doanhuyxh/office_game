// E2E giao diện Chat (3 Chrome): A, B ở trang web (/chat, header, sidebar), C trong văn phòng 3D.
// Kiểm tra: chat 1-1 realtime, badge + âm thanh khi nhận tin, đánh dấu đã đọc, kênh Office ĐỒNG BỘ HAI CHIỀU với HUD chat 3D, tin trong phòng 3D
// được lưu và chỉ người từng ở phòng thấy kênh, ảnh đính kèm (S3 thật), thu hồi. Tạo nhân viên + 1 ảnh nhỏ lên S3 thật → CHỈ chạy trên DB tạm.
// Cần Api :5180 (DB tạm), Realtime :5190 (Realtime__ApiBaseUrl=http://localhost:5180), Vite :5174 (VITE_API_TARGET, VITE_RT_TARGET) — xem chat-e2e.ts / e2e.md:
//   (Vite phải ở :5173 — CORS bucket S3 chỉ cho localhost:5173 nên tải ảnh lên từ trình duyệt mới chạy được)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5180 BASE_URL=http://localhost:5173 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/chat-ui-e2e.ts [<tiền-tố-profile-chrome>]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';
if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5180';
const [prof = `${tmpdir()}/chat-ui-e2e`] = process.argv.slice(2);
const envFile = Bun.file(new URL('../../.env', import.meta.url));
const env: Record<string, string> = (await envFile.exists()) ? Object.fromEntries((await envFile.text()).split('\n')
  .filter((l) => /^[A-Za-z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()])) : {};
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? env.Seed__AdminEmail, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? env.Seed__AdminPassword;
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 500) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- REST: tạo tài khoản (giống chat-e2e.ts) ----------
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).find((c) => c.startsWith(name + '=')) ?? '';
const restLogin = async (login: string, password: string): Promise<string> => {
  const r = await fetch(`${API}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login, password }) });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
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
    await post('/api/auth/2fa/enable', { code: totp(s.body?.sharedKey ?? '') });
    keys[login] = s.body.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
  }
  return cookie;
};
const rest = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) as any };
};
const PW = 'E2e-Local-2026', stamp = Date.now().toString(36);
const admin = await restLogin(ADMIN_LOGIN, ADMIN_PASSWORD);
const mkEmp = async (code: string, name: string, user: string) => {
  const r = await rest(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@officehub.test`, phone: null, dateOfBirth: null,
    departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null });
  if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${JSON.stringify(r.body)}`);
  const acc = (await rest(admin, 'POST', `/api/org/employees/${r.body.employee.id}/account`, { mode: 'password', roles: ['employee'], userName: user })).body;
  const c = await restLogin(user, acc.tempPassword);
  await rest(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { user, name, code, cookie: await restLogin(user, PW) };
};
const A = await mkEmp(`NV8${stamp.slice(-3)}1`, 'Nguyễn Đức Anh', `ui.a.${stamp}`);
const B = await mkEmp(`NV8${stamp.slice(-3)}2`, 'Trần Bảo Bình', `ui.b.${stamp}`);
const C = await mkEmp(`NV8${stamp.slice(-3)}3`, 'Lê Chí Cường', `ui.c.${stamp}`);

// ---------- Trình duyệt ----------
// 3 cửa sổ cùng lúc → Chrome "đóng băng" cửa sổ nền và làm đứt SignalR; tắt các cơ chế đó để test ổn định
const NO_FREEZE = ['--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--disable-features=PageFreeze,CalculateNativeWinOcclusion,IntensiveWakeUpThrottling'];
const ba = await launch(9511, `${prof}-a`, 1440, 900, NO_FREEZE), bb = await launch(9512, `${prof}-b`, 1440, 900, NO_FREEZE), bc = await launch(9513, `${prof}-c`, 1440, 900, NO_FREEZE);
type Br = typeof ba;
const all = [ba, bb, bc];
// Đếm số lần phát âm (HTMLAudioElement.play) — không nghe được trong headless nên đếm lời gọi
const COUNT_PLAYS = `(() => { window.__plays = 0; const p = HTMLAudioElement.prototype.play; HTMLAudioElement.prototype.play = function () { window.__plays++; return Promise.resolve(); }; })()`;
for (const b of all) await b.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_PLAYS });
const plays = (b: Br) => b.evalJs('window.__plays ?? -1') as Promise<number>;
const q = (b: Br, expr: string) => b.evalJs(expr);
const waitFor = async (b: Br, expr: string, ms = 8000) => { for (let t = 0; t < ms; t += 250) { if (await b.evalJs(expr)) return true; await sleep(250); } return false; };
const convTitles = (b: Br) => q(b, `[...document.querySelectorAll('[data-testid=chat-conversation]')].map(e => e.textContent)`) as Promise<string[]>;
const openConv = (b: Br, title: string) => q(b, `(() => { const e = [...document.querySelectorAll('[data-testid=chat-conversation]')].find(x => x.textContent.includes(${JSON.stringify(title)})); e?.click(); return !!e; })()`);
const thread = (b: Br) => q(b, `[...document.querySelectorAll('[data-testid=chat-message]')].map(e => e.textContent)`) as Promise<string[]>;
const typeAndSend = async (b: Br, text: string) => {
  await q(b, `(() => { const i = document.querySelector('[data-testid=chat-input]'); const proto = i.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await sleep(150);
  await q(b, `document.querySelector('[data-testid=chat-send]').click()`);
};
const bell = (b: Br) => q(b, `document.querySelector('[data-testid=chat-unread]')?.textContent ?? ''`) as Promise<string>;
const sendGap = () => sleep(1250); // giới hạn 1 tin / giây / tài khoản

try {
  check('đăng nhập 3 trình duyệt', (await ba.login(A.user, PW)) === 200 && (await bb.login(B.user, PW)) === 200 && (await bc.login(C.user, PW)) === 200);

  // C vào văn phòng 3D trước để nhận tin Office; B đứng ở trang tổng quan (chưa mở chat) để thử badge + âm thanh
  await bc.go(`${BASE}/office`, 6000);
  await q(bc, "[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Đã hiểu'))?.click()");
  await bb.go(`${BASE}/`, 3500);
  await ba.go(`${BASE}/chat`, 3500);

  // ---------- Giao diện chung ----------
  const titles = await convTitles(ba);
  check('A: trang /chat có kênh "Toàn văn phòng", chưa có kênh phòng', titles.some((t) => t.includes('Toàn văn phòng')) && titles.length === 1, titles);
  check('header có nút chat; sidebar có mục "Tin nhắn"', await q(ba, "!!document.querySelector('[data-testid=chat-bell]')") && await q(ba, "[...document.querySelectorAll('a')].some(a => a.textContent.trim().startsWith('Tin nhắn'))"));

  // ---------- Chat 1-1: A → B ----------
  await q(ba, "document.querySelector('[data-testid=chat-new]').click()");
  await sleep(500);
  await q(ba, `(() => { const i = document.querySelector('[data-testid=chat-people-search]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, 'tran bao'); i.dispatchEvent(new Event('input',{bubbles:true})); return true; })()`);
  check('tìm người "tran bao" ra Trần Bảo Bình', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-person]')].some(e => e.textContent.includes('Trần Bảo Bình'))`));
  await q(ba, `[...document.querySelectorAll('[data-testid=chat-person]')].find(e => e.textContent.includes('Trần Bảo Bình')).click()`);
  check('mở được hội thoại với B', await waitFor(ba, `document.querySelector('[data-testid=chat-title]')?.textContent === 'Trần Bảo Bình'`));
  await typeAndSend(ba, 'xin chào Bình từ A');
  check('A thấy tin của mình trong khung chat (đã gửi, không treo "đang gửi")', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('xin chào Bình từ A') && !e.textContent.includes('Đang gửi'))`));

  // ---------- B (đang ở trang tổng quan): badge + âm thanh ----------
  check('B: badge chat ở header hiện "1" (realtime, không cần tải lại)', await waitFor(bb, `document.querySelector('[data-testid=chat-unread]')?.textContent === '1'`), await bell(bb));
  check('B: phát âm báo tin mới', (await plays(bb)) >= 1, await plays(bb));
  await bb.go(`${BASE}/chat`, 3500);
  const bTitles = await convTitles(bb);
  check('B: danh sách có hội thoại với A kèm xem trước + chưa đọc', bTitles.some((t) => t.includes('Nguyễn Đức Anh') && t.includes('xin chào Bình từ A')), bTitles);
  check('B: mở lại trang → phát âm đúng một lần vì còn tin chưa đọc', (await plays(bb)) === 1, await plays(bb));
  await openConv(bb, 'Nguyễn Đức Anh');
  check('B: mở hội thoại thấy tin của A', await waitFor(bb, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('xin chào Bình từ A'))`));
  check('B: mở hội thoại → badge header biến mất (đã đọc)', await waitFor(bb, `!document.querySelector('[data-testid=chat-unread]')`), await bell(bb));
  await typeAndSend(bb, 'chào A, B đây');
  check('A nhận trả lời của B realtime ở hội thoại đang mở', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('chào A, B đây'))`));
  check('A đang mở hội thoại đó nên không có badge chưa đọc', (await bell(ba)) === '');

  // ---------- Kênh Office: web ↔ HUD chat 3D (hai chiều) ----------
  await openConv(ba, 'Toàn văn phòng');
  await sleep(500);
  await sendGap();
  await typeAndSend(ba, 'A nói với cả văn phòng');
  const c3d = () => q(bc, `[...document.querySelectorAll('[data-testid=office-chat] .log div')].map(d => d.textContent).join('|')`) as Promise<string>;
  check('C (đang ở 3D) nhận tin Office gửi từ web', await waitFor(bc, `[...document.querySelectorAll('[data-testid=office-chat] .log div')].some(d => d.textContent.includes('A nói với cả văn phòng'))`), await c3d());
  check('B (đang mở hội thoại khác) thấy Office có tin chưa đọc', await waitFor(bb, `[...document.querySelectorAll('[data-testid=chat-conversation]')].some(e => e.textContent.includes('Toàn văn phòng') && !!e.querySelector('[data-testid=chat-conversation-unread]'))`));
  await q(bc, `(() => { const f = document.querySelector('[data-testid=office-chat]'); const i = f.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, 'C nói từ văn phòng 3D'); i.dispatchEvent(new Event('input',{bubbles:true})); f.requestSubmit(); return true; })()`);
  check('A (đang ở web, kênh Office) thấy tin gửi từ 3D', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('C nói từ văn phòng 3D'))`), await thread(ba));
  check('tin gửi từ 3D đã LƯU: B mở lại thấy lịch sử', await (async () => { await openConv(bb, 'Toàn văn phòng'); return waitFor(bb, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('C nói từ văn phòng 3D')) && [...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('A nói với cả văn phòng'))`); })());

  // ---------- Phòng có tường trong 3D: lưu + kênh phòng chỉ cho người từng vào ----------
  await q(bc, 'window.__officeScene.walkTo(25, 6.5)');
  await sleep(9500);
  check('C vào Phòng họp lớn (3D có tab chat phòng)', await q(bc, "!!document.querySelector('[data-testid=office-chat-room-tab]')"));
  await q(bc, "document.querySelector('[data-testid=office-chat-room-tab]').click()");
  await sleep(300);
  await sleep(1300);
  await q(bc, `(() => { const f = document.querySelector('[data-testid=office-chat]'); const i = f.querySelector('input');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, 'họp kín lúc 10h'); i.dispatchEvent(new Event('input',{bubbles:true})); f.requestSubmit(); return true; })()`);
  await sleep(2000);
  const cConvs = (await rest(C.cookie, 'GET', '/api/chat/conversations')).body as any[];
  const cRoom = cConvs.find((c) => c.type === 'Room');
  check('C là thành viên kênh "Phòng họp lớn", tin phòng 3D được lưu', cRoom?.roomId === 'meeting-large' && cRoom.lastPreview === 'họp kín lúc 10h', cConvs);
  check('A, B (chưa vào phòng) không thấy kênh phòng; không đọc được', !(await convTitles(ba)).some((t) => t.includes('Phòng họp lớn'))
    && (await rest(A.cookie, 'GET', '/api/chat/conversations/room:meeting-large/messages')).status === 404);
  await bc.go(`${BASE}/chat`, 3500);
  check('C mở /chat: thấy kênh "Phòng họp lớn" với tin vừa nhắn trong 3D', (await convTitles(bc)).some((t) => t.includes('Phòng họp lớn') && t.includes('họp kín lúc 10h')), await convTitles(bc));
  await openConv(bc, 'Phòng họp lớn');
  check('C xem được lịch sử kênh phòng trên web', await waitFor(bc, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('họp kín lúc 10h'))`));

  // ---------- Ảnh đính kèm (S3 thật) ----------
  const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
  const pngPath = `${tmpdir()}/chat-ui-e2e-${stamp}.png`;
  await Bun.write(pngPath, PNG);
  await openConv(bb, 'Nguyễn Đức Anh');
  await sleep(600);
  const doc = await bb.send('DOM.getDocument', { depth: 1 });
  const node = await bb.send('DOM.querySelector', { nodeId: doc.result.root.nodeId, selector: '[data-testid=chat-file-input]' });
  await bb.send('DOM.setFileInputFiles', { nodeId: node.result.nodeId, files: [pngPath] });
  check('B chọn ảnh: hiện trong danh sách tệp chờ gửi', await waitFor(bb, `!!document.querySelector('[data-testid=chat-files]')`));
  await sleep(1500); // tải lên S3
  await sendGap();
  await q(bb, `document.querySelector('[data-testid=chat-send]').click()`);
  await openConv(ba, 'Trần Bảo Bình');
  check('A thấy ảnh của B (tải được từ S3, hiển thị thật)', await waitFor(ba, `(() => { const im = document.querySelector('[data-testid=chat-messages] img'); return !!im && im.complete && im.naturalWidth > 0; })()`, 12000),
    await q(ba, `[...document.querySelectorAll('[data-testid=chat-messages] img')].map(i => i.src.slice(0, 120))`));
  await q(ba, `(() => { const e = [...document.querySelectorAll('[data-testid=chat-conversation]')].find(x => x.textContent.includes('Trần Bảo Bình')); e?.click(); return true; })()`);

  // ---------- Thu hồi ----------
  await openConv(ba, 'Trần Bảo Bình');
  await sleep(600);
  await sendGap();
  await typeAndSend(ba, 'tin A sắp thu hồi');
  check('A gửi tin để thu hồi', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('tin A sắp thu hồi'))`));
  await sleep(800);
  const menuOk = await waitFor(ba, `!!([...document.querySelectorAll('[data-testid=chat-message]')].find(e => e.textContent.includes('tin A sắp thu hồi'))?.querySelector('button[aria-label="Tuỳ chọn tin nhắn"]'))`, 5000);
  if (!menuOk) console.log('DEBUG tin:', await q(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].map(e => e.outerHTML.slice(0, 700))`));
  check('tin của A có menu "Tuỳ chọn tin nhắn" (đã gửi xong)', menuOk);
  await q(ba, `(() => { const m = [...document.querySelectorAll('[data-testid=chat-message]')].find(e => e.textContent.includes('tin A sắp thu hồi')); m.querySelector('button[aria-label="Tuỳ chọn tin nhắn"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })); return true; })()`);
  await sleep(400);
  await q(ba, "document.querySelector('[data-testid=chat-recall]').click()");
  await sleep(400);
  await q(ba, "document.querySelector('[data-testid=chat-recall-confirm]').click()");
  check('A: tin hiển thị "Tin nhắn đã thu hồi"', await waitFor(ba, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('Tin nhắn đã thu hồi'))`));
  check('B thấy tin bị thu hồi realtime, nội dung cũ biến mất', await waitFor(bb, `[...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('Tin nhắn đã thu hồi')) && ![...document.querySelectorAll('[data-testid=chat-message]')].some(e => e.textContent.includes('tin A sắp thu hồi'))`));

  for (const [n, b] of [['A', ba], ['B', bb], ['C', bc]] as const)
    check(`không lỗi console ${n}`, b.errors.filter((e) => !/livekit|voice|ICE|WebSocket|getUserMedia|NotAllowed|favicon/i.test(e)).length === 0, b.errors.slice(0, 3));
} finally { for (const b of all) b.close(); }
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
