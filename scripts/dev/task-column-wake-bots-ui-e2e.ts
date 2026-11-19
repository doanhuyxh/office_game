// E2E TEST-184 giao diện hộp thoại cột: chọn bot được đánh thức (wakeBotIds).
// Chrome headless 1440×900: tick "Đánh thức bot theo dõi" → hiện danh sách bot thành viên dự án (tên + nhãn BOT) + ghi chú "Không chọn bot nào = …",
// người thật không có trong danh sách; tick 1 bot → lưu (kiểm API), mở lại hiện đúng; bỏ tick bot → []; bỏ tick đánh thức → ẩn danh sách + API xoá;
// dự án không có bot → "Dự án chưa có thành viên là bot". Ảnh vào SHOTS_DIR.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm. Api như đầu task-column-wake-e2e.ts, Vite trỏ Api (không cần Mcp / Realtime):
//   VITE_API_TARGET=http://localhost:5291 bunx vite --port 5183   (trong frontend/)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5291 BASE_URL=http://localhost:5183 ADMIN_LOGIN=… ADMIN_PASSWORD=… bun scripts/dev/task-column-wake-bots-ui-e2e.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { BASE, launch } from './cdp';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5291';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/task-wake-bots-ui`;
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

// ── Dữ liệu: quản lý dự án (được sửa cột, tự tạo dự án), 2 bot, 1 người thật ──
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const pos = (await json(admin, 'POST', '/api/org/positions', { name: `NV WB ${stamp}`, level: 7, financePermissions: 0 })).body;
const leadPos = (await json(admin, 'POST', '/api/org/positions', { name: `Lead WB ${stamp}`, level: 5, manageTaskColumns: true })).body;
const dept = (await json(admin, 'POST', '/api/org/departments', { name: `Wake bots ${stamp}`, code: `WB${stamp}` })).body;
const mkEmp = async (rawCode: string, name: string, user: string, roles: string[], position = pos) => {
  const code = rawCode.toUpperCase();
  const e = (await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@e2e.test`, phone: null, dateOfBirth: null,
    departmentId: dept, positionId: position, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
  const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
  const c = await login(user, acc.tempPassword);
  await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
  return { e, code, name, user, cookie: await login(user, PW) };
};
const PM = await mkEmp(`BM${stamp}`, 'Quản Lý Cột', `e2e.wb.pm.${stamp}`, ['employee', 'manager'], leadPos);
const Rev = await mkEmp(`BR${stamp}`, 'Bot Review', `e2e.wb.rev.${stamp}`, ['employee']);
const Ops = await mkEmp(`BO${stamp}`, 'Bot DevOps', `e2e.wb.ops.${stamp}`, ['employee']);
const Hum = await mkEmp(`BH${stamp}`, 'Người Thật', `e2e.wb.hum.${stamp}`, ['employee']);
for (const b of [Rev, Ops]) await json(admin, 'PUT', `/api/org/employees/${b.e.id}/account/bot`, { isBot: true });
const P = (await json(PM.cookie, 'POST', '/api/projects', { code: `WB${stamp}`, name: 'Chọn bot đánh thức (UI)', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Rev.e.id, Ops.e.id, Hum.e.id] })).body as string;
const P2 = (await json(PM.cookie, 'POST', '/api/projects', { code: `WN${stamp}`, name: 'Không có bot', kind: 'Internal', startOn: today, sequential: false,
  memberIds: [Hum.e.id] })).body as string;
// Kiểm API bằng cookie người thật (đăng nhập UI của PM huỷ cookie API của PM)
const colOf = async (p: string, name: string) => ((await json(Hum.cookie, 'GET', `/api/projects/${p}/columns`)).body as any[]).find((c) => c.name === name);
ok('dữ liệu: 2 dự án, cột "Chờ review"', !!(await colOf(P, 'Chờ review')) && !!(await colOf(P2, 'Chờ review')));

const br = await launch(9341, `${tmpdir()}/task-wake-bots-ui-${stamp}`);
try {
  ok('đăng nhập UI quản lý dự án', (await br.login(PM.user, PW)) === 200);
  const openEdit = async (name: string) => {
    await br.evalJs(`document.querySelector('[aria-label="Sửa trạng thái ${name}"]').click()`);
    await br.sleep(700);
  };
  const save = async () => { await br.evalJs(`document.querySelector('[data-testid="column-dialog"] button[type="submit"]').click()`); await br.sleep(1500); };
  const botBox = (code: string) => `document.querySelector('[data-testid="col-wake-bot-${code}"]')`;
  await br.go(`${BASE}/projects/${P}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  const d1 = await br.evalJs(`(() => { const l = document.querySelector('[data-testid="col-wake-bots"]'); return l ? { text: l.innerText, n: l.querySelectorAll('input[type=checkbox]').length } : null })()`);
  ok('cột "Chờ review" (đã tick): danh sách 2 bot + nhãn BOT + ghi chú, không có người thật',
    d1?.n === 2 && d1.text.includes('Bot Review') && d1.text.includes('Bot DevOps') && !d1.text.includes('Người Thật') && /bot/i.test(d1.text)
    && d1.text.includes('Không chọn bot nào = đánh thức tất cả bot theo dõi việc') && d1.text.includes('Bot được chọn vẫn phải là người theo dõi của việc'), d1);
  ok('mặc định không bot nào được tick', await br.evalJs(`!${botBox(Rev.code)}.checked && !${botBox(Ops.code)}.checked`));
  await br.evalJs(`${botBox(Rev.code)}.click()`);
  await br.sleep(300);
  await br.shot(`${SHOTS}/1-column-dialog-bots.png`);
  await save();
  ok('lưu → API wakeBotIds = [Bot Review]', JSON.stringify((await colOf(P, 'Chờ review'))?.wakeBotIds) === JSON.stringify([Rev.e.id]));
  await openEdit('Chờ review');
  ok('mở lại: Bot Review đang tick, Bot DevOps không', await br.evalJs(`${botBox(Rev.code)}.checked && !${botBox(Ops.code)}.checked`));
  await br.evalJs(`${botBox(Rev.code)}.click()`);
  await br.evalJs(`${botBox(Ops.code)}.click()`);
  await br.sleep(200);
  await save();
  ok('đổi sang Bot DevOps → API [Bot DevOps]', JSON.stringify((await colOf(P, 'Chờ review'))?.wakeBotIds) === JSON.stringify([Ops.e.id]));
  await openEdit('Chờ review');
  await br.evalJs(`${botBox(Ops.code)}.click()`);
  await br.sleep(200);
  await save();
  ok('bỏ tick hết bot → API [] (đánh thức tất cả)', (await colOf(P, 'Chờ review'))?.wakeBotIds?.length === 0);
  await openEdit('Chờ review');
  await br.evalJs(`${botBox(Rev.code)}.click()`);
  await br.evalJs(`document.querySelector('[data-testid="col-wake"]').click()`);
  await br.sleep(300);
  ok('bỏ tick "Đánh thức bot theo dõi" → ẩn danh sách bot', await br.evalJs(`!document.querySelector('[data-testid="col-wake-bots"]')`));
  await br.shot(`${SHOTS}/2-column-dialog-untick.png`);
  await save();
  const c2 = await colOf(P, 'Chờ review');
  ok('lưu → API wakeFollowers false, wakeBotIds []', c2?.wakeFollowers === false && c2?.wakeBotIds?.length === 0, c2);
  await br.go(`${BASE}/projects/${P2}?tab=tasks`, 4000);
  await openEdit('Chờ review');
  ok('dự án không có bot → "Dự án chưa có thành viên là bot"',
    await br.evalJs(`document.querySelector('[data-testid="col-wake-bots"]')?.innerText.includes('Dự án chưa có thành viên là bot') === true`));
  await br.shot(`${SHOTS}/3-column-dialog-no-bots.png`);
  const errs = br.errors.filter((e) => !/negotiat|signalr|hub|502|WebSocket/i.test(e ?? ''));
  ok('không lỗi console (bỏ SignalR)', errs.length === 0, errs);
} finally {
  br.close();
}
console.log(`\nẢnh: ${SHOTS}`);
console.log(`\n${pass} ✔ / ${fail} ✘`);
process.exit(fail ? 1 : 0);
