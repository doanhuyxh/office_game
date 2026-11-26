// E2E TEST-237 (G1): thông báo mang target (type / id / params), link vẫn chạy song song.
// Pha a: giao việc / bình luận / gửi đơn phê duyệt / tin chat 1-1 → API chuông + trang trả đúng target + link (client cũ), webhook `notification`
//        + `chat.message` có target, email (Mailpit) nút mở đúng URL, FE `targetToRoute` (import thẳng từ Vite) + `public/sw.js` targetUrl
//        ra cùng URL với link BE cho mọi thông báo, bấm chuông (Chrome headless) mở đúng việc. Ảnh vào SHOTS_DIR.
// Pha prep + b: backfill thông báo cũ (chỉ có link) sau migration NotificationTargets.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm + Mailpit:
//   docker run -d --name e2e237-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15437:5432 postgres:17-alpine
//   docker run -d --name e2e237-mail -p 127.0.0.1:11237:1025 -p 127.0.0.1:18237:8025 axllent/mailpit
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5237
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15437;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=11237 Smtp__UseSsl=false Smtp__Username= Smtp__Password= Sentry__Dsn= Seq__Url= App__BaseUrl=http://localhost:5238
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng> Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Database__MigrateOnStartup=true Seed__AdminEmail=e2e237-admin@officehub-e2e.vn Seed__AdminPassword=E2e237-Admin-2026
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Vite (frontend/): VITE_API_TARGET=http://localhost:5237 bunx vite --port 5238 --strictPort
//   Pha a: E2E_LOCAL_DB=1 API_URL=http://localhost:5237 BASE_URL=http://localhost:5238 MAILPIT_URL=http://127.0.0.1:18237 SHOTS_DIR=… bun scripts/dev/notification-target-e2e.ts a
//   Backfill: dừng Api → (backend/) dotnet ef database update TelegramMessages --project src/Modules/Notification/OfficeHub.Modules.Notification
//        --startup-project src/OfficeHub.Api --context NotificationDbContext --connection "<chuỗi DB tạm>" --no-build
//        → E2E_LOCAL_DB=1 PG_CONTAINER=e2e237-pg bun scripts/dev/notification-target-e2e.ts prep → khởi động lại Api → … notification-target-e2e.ts b
import { $ } from 'bun';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { totp } from './totp';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5237';
const BASE = process.env.BASE_URL ?? 'http://localhost:5238';
const MAILPIT = process.env.MAILPIT_URL ?? 'http://127.0.0.1:18237';
const PG = process.env.PG_CONTAINER ?? 'e2e237-pg';
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/t237`;
const HOOK_PORT = Number(process.env.HOOK_PORT ?? 5299);
const ADMIN_LOGIN = process.env.ADMIN_LOGIN ?? 'e2e237-admin@officehub-e2e.vn', ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'E2e237-Admin-2026';
const STATE = `${tmpdir()}/officehub-e2e237-state.json`;
const phase = process.argv[2] ?? 'a';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 700) : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sql = (q: string) => $`docker exec ${PG} psql -U e2e -d e2e -tAc ${q}`.text();

// ---- đăng nhập ----
const KEYS_FILE = `${tmpdir()}/officehub-e2e-2fa-keys-${new URL(API).port}.json`;
const keys: Record<string, string> = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, 'utf8')) : {};
const cookieOf = (r: Response, name: string) => (r.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).filter((c) => c.startsWith(name + '=')).at(-1) ?? '';
const post = (path: string, body: unknown, cookie = '') =>
  fetch(API + path, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
const login = async (user: string, password: string): Promise<string> => {
  const r = await post('/api/auth/login', { login: user, password });
  const body = await r.json().catch(() => null) as any;
  if (r.status === 403 && body?.title === '2fa_required') {
    const r2 = await post('/api/auth/login/2fa', { code: totp(keys[user]), isRecoveryCode: false, rememberMe: true }, cookieOf(r, 'officehub.2fa'));
    return cookieOf(r2, 'officehub.auth');
  }
  let cookie = cookieOf(r, 'officehub.auth');
  if (r.ok && body?.mustSetupTwoFactor) {
    const sr = await post('/api/auth/2fa/setup', {}, cookie);
    cookie = cookieOf(sr, 'officehub.auth') || cookie;
    const s = await sr.json() as any;
    const code = totp(s.sharedKey);
    if (!(await post('/api/auth/2fa/enable', { code }, cookie)).ok) throw new Error(`Không bật được 2FA cho ${user}`);
    keys[user] = s.sharedKey;
    writeFileSync(KEYS_FILE, JSON.stringify(keys));
    while (totp(s.sharedKey) === code) await Bun.sleep(1000);
    return login(user, password);
  }
  return cookie;
};
const json = async (cookie: string, method: string, path: string, body?: unknown) => {
  const r = await fetch(API + path, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await r.text();
  let parsed: any = null;
  try { parsed = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: r.status, body: parsed, text };
};
const bell = async (cookie: string) => ((await json(cookie, 'GET', '/api/notifications?take=50')).body?.items ?? []) as any[];
const PW = 'E2e-Local-2026';
const MAIL = 'officehub-e2e.vn';

// sw.js: lấy hàm targetUrl ra chạy trong Bun (cùng mã trình duyệt chạy khi bấm push).
const swSrc = readFileSync(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8');
const swFn = swSrc.slice(swSrc.indexOf('function targetUrl'), swSrc.indexOf("self.addEventListener('notificationclick'"));
const targetUrl = new Function(`${swFn}; return targetUrl;`)() as (d: Record<string, string>) => string | null;
const pushData = (t: any): Record<string, string> => ({
  targetType: t.type, ...(t.id ? { targetId: t.id } : {}), ...(t.params ? { targetParams: JSON.stringify(t.params) } : {}),
});

if (phase === 'a') {
  // ---- webhook giả ----
  const hits: { event: string; json: any }[] = [];
  Bun.serve({ port: HOOK_PORT, async fetch(req) { hits.push({ event: req.headers.get('x-officehub-event') ?? '', json: JSON.parse(await req.text()) }); return new Response('ok'); } });
  const until = async (cond: () => boolean, ms = 15000) => { for (let i = 0; i < ms / 250; i++) { if (cond()) return true; await sleep(250); } return cond(); };

  const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
  if (!admin) throw new Error('Không đăng nhập được admin seed');
  const stamp = Date.now().toString(36).slice(-5);
  const mkEmp = async (code: string, name: string, managerId: string | null, user: string, roles: string[]) => {
    const r = await json(admin, 'POST', '/api/org/employees', { code, fullName: name, email: `${user}@${MAIL}`, phone: null, dateOfBirth: null,
      departmentId: null, positionId: null, managerId, status: 'Active', joinedAt: '2026-01-05', note: null });
    if (r.status >= 300) throw new Error(`Tạo ${code} lỗi: ${r.text}`);
    const e = r.body.employee;
    const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles, userName: user })).body;
    const c = await login(user, acc.tempPassword);
    await json(c, 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
    const cookie = await login(user, PW);
    const userId = (await json(cookie, 'GET', '/api/auth/me')).body?.id as string;
    return { e, cookie, user, userId, email: `${user}@${MAIL}` };
  };
  const M = await mkEmp(`NM${stamp}`.toUpperCase(), 'Mai Quản Lý', null, `e2e.nt.m.${stamp}`, ['employee', 'manager']);
  const S = await mkEmp(`NS${stamp}`.toUpperCase(), 'Sơn Nhân Viên', M.e.id, `e2e.nt.s.${stamp}`, ['employee']);
  ok('2 nhân viên (quản lý + cấp dưới) đăng nhập', !!M.cookie && !!S.cookie && !!M.userId && !!S.userId);
  let hooksOk = true;
  for (const x of [M, S]) hooksOk &&= (await json(x.cookie, 'PUT', '/api/notifications/webhook', { url: `http://localhost:${HOOK_PORT}/hook`, enabled: true })).status === 200;
  ok('đặt webhook (localhost giả)', hooksOk);

  // ---- việc: giao + bình luận ----
  const created = await json(M.cookie, 'POST', '/api/projects', { code: `NT${stamp}`.toUpperCase(), name: `Thông báo target ${stamp}`, kind: 'Internal', sequential: false,
    memberIds: [S.e.id] });
  const P = created.body?.id ?? created.body;
  const T = (await json(M.cookie, 'POST', `/api/projects/${P}/tasks`, { title: 'Việc thử target', assigneeEmployeeId: S.e.id })).body as string;
  ok('M tạo dự án + giao việc cho S', typeof P === 'string' && typeof T === 'string', { created, T });
  const cm = await json(M.cookie, 'POST', `/api/projects/tasks/${T}/comments`, { content: 'Bình luận thử target' });
  const C = cm.body?.id ?? cm.body;
  ok('M bình luận việc của S', cm.status === 201 || cm.status === 200, cm);

  const sBell = await bell(S.cookie);
  const assigned = sBell.find((n) => n.title.startsWith('Bạn được giao việc'));
  ok('chuông S: giao việc → target project_task (id = việc, params.projectId)', assigned?.target?.type === 'project_task' && assigned.target.id === T
    && assigned.target.params?.projectId === P && !assigned.target.params?.commentId, assigned);
  ok('… link giữ như cũ /projects/{p}?task={t}', assigned?.link === `/projects/${P}?task=${T}`, assigned?.link);
  const commented = sBell.find((n) => n.title.includes('bình luận việc'));
  ok('chuông S: bình luận → target project_task + params.commentId', commented?.target?.type === 'project_task' && commented.target.id === T
    && commented.target.params?.commentId === C, commented);
  ok('… link /projects/{p}?task={t}&comment={c}', commented?.link === `/projects/${P}?task=${T}&comment=${C}`, commented?.link);

  // ---- đơn phê duyệt ----
  const types = (await json(S.cookie, 'GET', '/api/leave/types')).body as any[];
  const unpaid = types.find((t) => t.code === 'unpaid') ?? types[types.length - 1];
  let day = new Date(Date.now() + 40 * 86400000);
  while ([0, 6].includes(day.getUTCDay())) day = new Date(day.getTime() + 86400000);
  const d = day.toISOString().slice(0, 10);
  const lr = await json(S.cookie, 'POST', '/api/leave/requests', { leaveTypeId: unpaid.id, startDate: d, endDate: d, period: 'FullDay', reason: 'E2E target' });
  const A = lr.body?.approvalRequestId as string;
  ok('S gửi đơn nghỉ → có đơn phê duyệt', lr.status < 300 && !!A, lr);
  const mBell = await bell(M.cookie);
  const appr = mBell.find((n) => n.category === 'approval_requested');
  ok('chuông M: đơn chờ duyệt → target approval_request đúng id đơn', appr?.target?.type === 'approval_request' && appr.target.id === A && appr.target.params === null, appr);
  ok('… link vẫn /approvals (web chưa mở theo id)', appr?.link === '/approvals', appr?.link);

  // ---- trang /notifications (phân trang) ----
  const page = (await json(S.cookie, 'GET', '/api/notifications?page=1&pageSize=20')).body;
  ok('trang thông báo (page) cũng có target + link', page?.items?.length >= 2 && page.items.every((n: any) => n.target?.type && 'link' in n), page?.items?.[0]);

  // ---- webhook ----
  await until(() => hits.some((h) => h.event === 'notification' && h.json.data?.target?.type === 'approval_request'));
  const hookAssigned = hits.find((h) => h.event === 'notification' && h.json.data?.target?.id === T && !h.json.data.target.params?.commentId);
  ok('webhook notification: data.target { type, id, params } + link + url', hookAssigned?.json.data.target.type === 'project_task'
    && hookAssigned.json.data.target.params?.projectId === P && hookAssigned.json.data.link === `/projects/${P}?task=${T}`
    && hookAssigned.json.data.url === `http://localhost:5238/projects/${P}?task=${T}`, hookAssigned?.json ?? hits.map((h) => h.event));
  const hookAppr = hits.find((h) => h.event === 'notification' && h.json.data?.target?.type === 'approval_request');
  ok('webhook notification (đơn): target có id đơn', hookAppr?.json.data.target.id === A && hookAppr.json.data.link === '/approvals', hookAppr?.json);

  // ---- chat 1-1 → webhook chat.message ----
  const DM = (await json(S.cookie, 'POST', '/api/chat/conversations/direct', { userId: M.userId })).body?.id as string;
  const msg = await json(S.cookie, 'POST', `/api/chat/conversations/${DM}/messages`, { text: 'Chào chị, tin thử target' });
  const msgId = msg.body?.message?.id ?? msg.body?.id;
  await until(() => hits.some((h) => h.event === 'chat.message' && h.json.data?.conversationId === DM));
  const hookChat = hits.find((h) => h.event === 'chat.message' && h.json.data?.conversationId === DM);
  ok('webhook chat.message: target chat_conversation (id hội thoại, params.messageId) + link /chat?c=', hookChat?.json.data.target?.type === 'chat_conversation'
    && hookChat.json.data.target.id === DM && hookChat.json.data.target.params?.messageId === msgId && hookChat.json.data.link === `/chat?c=${DM}`, hookChat?.json ?? msg);

  // ---- email ----
  let mail: any = null;
  for (let i = 0; i < 40 && !mail; i++) {
    const list = await (await fetch(`${MAILPIT}/api/v1/messages?limit=100`)).json() as any;
    mail = list.messages?.find((x: any) => x.To?.some((t: any) => t.Address === M.email) && x.Subject.includes('Đơn chờ bạn duyệt'));
    if (!mail) await sleep(500);
  }
  const html = mail ? ((await (await fetch(`${MAILPIT}/api/v1/message/${mail.ID}`)).json()) as any).HTML as string : '';
  ok('email "Đơn chờ bạn duyệt" có nút mở đúng URL (App__BaseUrl + link)', html.includes('href="http://localhost:5238/approvals"'), html.slice(0, 400));

  // ---- client: sw.js + FE target.ts ra cùng URL với link BE ----
  const all = [...await bell(S.cookie), ...await bell(M.cookie)];
  const swBad = all.filter((n) => targetUrl(pushData(n.target)) !== n.link).map((n) => ({ t: n.target, link: n.link, sw: targetUrl(pushData(n.target)) }));
  ok(`sw.js targetUrl(data push) = link BE cho ${all.length} thông báo`, all.length >= 4 && swBad.length === 0, swBad);
  ok('sw.js: thiếu target → null (dùng data.link)', targetUrl({ link: '/x' } as any) === null && targetUrl({ targetType: 'la_lam' } as any) === null);

  writeFileSync(STATE, JSON.stringify({ S: { user: S.user, userId: S.userId }, P, T, C }));
  const br = await launch(9337, `${tmpdir()}/t237-chrome`, 1440, 900);
  try {
    await br.go(`${BASE}/login`, 1500);
    const st = await br.evalJs(`fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({login:${JSON.stringify(S.user)},password:${JSON.stringify(PW)}})}).then(r=>r.status)`);
    ok('S đăng nhập trên trình duyệt', st === 200, st);
    await br.go(`${BASE}/`, 4000);
    const feCheck = await br.evalJs(`(async () => {
      const m = await import('/src/features/notifications/utils/target.ts');
      const r = await fetch('/api/notifications?take=50').then((x) => x.json());
      const bad = r.items.filter((n) => m.routeHref(m.notificationRoute(n)) !== n.link).map((n) => ({ t: n.target, link: n.link, fe: m.routeHref(m.notificationRoute(n)) }));
      const legacy = m.routeHref(m.notificationRoute({ target: null, link: '/news/abc?comment=1' }));
      const unknown = m.routeHref(m.notificationRoute({ target: { type: 'la_lam', id: null, params: null }, link: '/approvals' }));
      const push = m.routeHref(m.pushRoute({ targetType: 'project_task', targetId: 't1', targetParams: JSON.stringify({ projectId: 'p1' }), link: '/x' }));
      return { n: r.items.length, bad, legacy, unknown, push };
    })()`);
    ok('FE targetToRoute (chuông / trang) = link BE cho mọi thông báo của S', feCheck.n >= 2 && feCheck.bad.length === 0, feCheck);
    ok('FE: thiếu target → link cũ; loại lạ → link; push data → route', feCheck.legacy === '/news/abc?comment=1' && feCheck.unknown === '/approvals'
      && feCheck.push === '/projects/p1?task=t1', feCheck);
    await br.evalJs(`document.querySelector('[data-testid="notification-bell"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }))`);
    await br.sleep(1200);
    await br.shot(`${SHOTS}/t237-bell.png`);
    const clicked = await br.evalJs(`(() => { const it = [...document.querySelectorAll('[data-testid="notification-item"]')].find((x) => x.textContent.includes('bình luận việc')); if (!it) return false; it.click(); return true; })()`);
    await br.sleep(3000);
    const url = await br.evalJs('location.pathname + location.search');
    ok('bấm thông báo bình luận trong chuông → mở dự án + hộp thoại việc + cuộn tới bình luận', clicked && url === `/projects/${P}?task=${T}&comment=${C}`, { clicked, url });
    const dialog = await br.evalJs(`!!document.querySelector('[role="dialog"]') && document.querySelector('[role="dialog"]').textContent.includes('Việc thử target')`);
    ok('… hộp thoại việc đang mở', dialog === true);
    await br.shot(`${SHOTS}/t237-task-opened.png`);
    await br.go(`${BASE}/notifications`, 3000);
    await br.evalJs(`[...document.querySelectorAll('span')].find((x) => x.textContent.startsWith('Bạn được giao việc'))?.closest('button,[role="button"],a,li,div[class*="cursor"]')?.click()`);
    await br.sleep(2500);
    const url2 = await br.evalJs('location.pathname + location.search');
    ok('trang /notifications: bấm "Bạn được giao việc" → /projects/{p}?task={t}', url2 === `/projects/${P}?task=${T}`, url2);
    ok('không lỗi console (bỏ SignalR khi không chạy Realtime)', br.errors.filter((e) => !/negotiat|hub|SignalR|WebSocket|502/i.test(e)).length === 0, br.errors);
  } finally { br.close(); }
}

if (phase === 'prep') {
  // DB đã hạ migration NotificationTargets (không còn cột Target*): chèn thông báo kiểu cũ cho S.
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const cols = await sql(`select string_agg(column_name, ',') from information_schema.columns where table_schema='notifications' and table_name='notifications' and column_name like 'Target%'`);
  ok('DB đã hạ migration (không còn cột Target*)', cols.trim() === '', cols);
  const links = [`/projects/${s.P}?task=${s.T}&comment=${s.C}`, `/projects/${s.P}?tab=guide`, '/approvals', '/reports?tab=ai', '/sales?tab=receivables', null];
  for (const [i, l] of links.entries())
    await sql(`insert into notifications.notifications ("Id","UserId","Category","Title","Body","Link","CreatedAt","EmailStatus","EmailAttempts") values
      (gen_random_uuid(), '${s.S.userId}', 'project_task', 'Cũ ${i} e2e237', 'Thông báo cũ', ${l === null ? 'null' : `'${l}'`}, now() - interval '${i + 1} minute', 'None', 0)`);
  ok('chèn 6 thông báo kiểu cũ (chỉ link)', Number((await sql(`select count(*) from notifications.notifications where "Title" like 'Cũ % e2e237'`)).trim()) >= 6);
}

if (phase === 'b') {
  const s = JSON.parse(readFileSync(STATE, 'utf8'));
  const nulls = Number((await sql(`select count(*) from notifications.notifications where "TargetType" is null`)).trim());
  ok('sau migration + backfill: không dòng nào TargetType rỗng', nulls === 0, nulls);
  const cookie = await login(s.S.user, PW);
  const old = (await bell(cookie)).filter((n) => n.title.endsWith('e2e237'));
  const by = (i: number) => old.find((n) => n.title === `Cũ ${i} e2e237`);
  ok('việc + bình luận cũ → project_task (id việc, projectId, commentId)', by(0)?.target?.type === 'project_task' && by(0).target.id === s.T
    && by(0).target.params?.projectId === s.P && by(0).target.params?.commentId === s.C, by(0));
  ok('dự án ?tab=guide → project + params.tab', by(1)?.target?.type === 'project' && by(1).target.id === s.P && by(1).target.params?.tab === 'guide', by(1));
  ok('/approvals → page key approvals', by(2)?.target?.type === 'page' && by(2).target.params?.key === 'approvals', by(2));
  ok('/reports?tab=ai → page key reports + tab', by(3)?.target?.params?.key === 'reports' && by(3).target.params?.tab === 'ai', by(3));
  ok('link null → page key rỗng', by(5)?.target?.type === 'page' && by(5).target.params?.key === '' && by(5).link === null, by(5));
  ok('cột link cũ giữ nguyên (client cũ)', by(0)?.link === `/projects/${s.P}?task=${s.T}&comment=${s.C}` && by(4)?.link === '/sales?tab=receivables', old.map((n) => n.link));
  const swBad = old.filter((n) => n.link && targetUrl(pushData(n.target)) !== n.link).map((n) => ({ t: n.target, link: n.link }));
  ok('target backfill dựng lại đúng link (sw.js)', swBad.length === 0, swBad);
}

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
