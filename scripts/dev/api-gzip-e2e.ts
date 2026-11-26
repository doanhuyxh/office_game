// E2E TEST-239: container web (nginx thật, build như deploy) nén gzip JSON của /api — danh sách việc dự án ~200 việc mô tả dài: đo trước / sau,
// Content-Encoding + Vary, client không gửi Accept-Encoding → bản thường, phản hồi nhỏ (< 1 KB) không nén, request có header Via (đi qua nginx VPS)
// vẫn nén (gzip_proxied any), Api gọi thẳng KHÔNG tự nén (chỉ nén một chỗ ở nginx), trang SPA vẫn mở, WebSocket /rt/ qua nginx vẫn bắt tay SignalR.
// TẠO DỮ LIỆU THẬT → CHỈ DB tạm:
//   docker run -d --name e2e239-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15439:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://0.0.0.0:5239
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15439;Database=e2e;Username=e2e;Password=e2e' Database__MigrateOnStartup=true
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToRealtimeKey=<cùng> Smtp__Host= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Seed__AdminEmail=e2e239-admin@officehub-e2e.vn Seed__AdminPassword=E2e239-Admin-2026 dotnet run --project src/OfficeHub.Api --no-launch-profile
//   Realtime: env ASPNETCORE_URLS=http://0.0.0.0:5249 Realtime__ApiBaseUrl=http://localhost:5239 LiveKit__Enabled=false + cùng khoá Chat__*
//        dotnet run --project src/OfficeHub.Realtime --no-launch-profile
//   Container web (từ gốc repo) + 2 cầu nối "api" / "realtime" trong mạng Docker → Api / Realtime đang chạy trên máy:
//     docker build -f frontend/Dockerfile -t officehub-web:e2e239 .
//     docker network create e2e239-net
//     docker run -d --name e2e239-api --network e2e239-net --network-alias api alpine/socat TCP-LISTEN:8080,fork,reuseaddr TCP:host.docker.internal:5239
//     docker run -d --name e2e239-rt --network e2e239-net --network-alias realtime alpine/socat TCP-LISTEN:8080,fork,reuseaddr TCP:host.docker.internal:5249
//     docker run -d --name e2e239-web --network e2e239-net -p 127.0.0.1:17239:80 officehub-web:e2e239
//     (checkout Windows: nginx-realip.sh có CRLF → container dừng "40-realip.sh: not found"; thêm -v <bản LF>:/docker-entrypoint.d/40-realip.sh:ro)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5239 WEB_URL=http://127.0.0.1:17239 ADMIN_LOGIN=e2e239-admin@officehub-e2e.vn ADMIN_PASSWORD=E2e239-Admin-2026 \
//     bun scripts/dev/api-gzip-e2e.ts
//   Dọn: docker rm -f e2e239-web e2e239-api e2e239-rt e2e239-pg && docker network rm e2e239-net
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { gunzipSync } from 'node:zlib';
import { totp } from './totp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5239';
const WEB = process.env.WEB_URL ?? 'http://127.0.0.1:17239';
const ADMIN_LOGIN = process.env.ADMIN_LOGIN!, ADMIN_PASSWORD = process.env.ADMIN_PASSWORD!;
const N = Number(process.env.TASKS ?? 200);
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
// GET thô (node:http không tự giải nén) → đo đúng số byte đi trên dây
const raw = (base: string, path: string, headers: Record<string, string>) => new Promise<{ status: number; headers: Record<string, any>; body: Buffer }>((resolve, reject) => {
  const req = request(base + path, { method: 'GET', headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on('error', reject);
  req.end();
});
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;

// ── Dữ liệu: quản lý dự án + dự án N việc, mô tả Markdown dài (giống việc thật ~2,3 KB / việc) ──
const stamp = Date.now().toString(36).slice(-5);
const PW = 'E2e239-Gzip-2026';
const admin = await login(ADMIN_LOGIN, ADMIN_PASSWORD);
const e = (await json(admin, 'POST', '/api/org/employees', { code: `GZ${stamp}`.toUpperCase(), fullName: 'Quản Lý Nén', email: `e2e.gz.${stamp}@e2e.test`, phone: null,
  dateOfBirth: null, departmentId: null, positionId: null, managerId: null, status: 'Active', joinedAt: '2026-01-05', note: null, jobTitle: null })).body.employee;
const acc = (await json(admin, 'POST', `/api/org/employees/${e.id}/account`, { mode: 'password', roles: ['employee', 'manager'], userName: `e2e.gz.${stamp}` })).body;
await json(await login(`e2e.gz.${stamp}`, acc.tempPassword), 'POST', '/api/auth/change-password', { currentPassword: acc.tempPassword, newPassword: PW });
const pm = await login(`e2e.gz.${stamp}`, PW);
const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Ho_Chi_Minh' });
const P = (await json(pm, 'POST', '/api/projects', { code: `GZ${stamp}`.toUpperCase(), name: 'Nén gzip', kind: 'Internal', startOn: today, memberIds: [], sequential: false })).body as string;
const desc = (i: number) => [
  `## Vấn đề\nViệc số ${i}: hiện trạng màn hình danh sách việc tải chậm khi dự án có nhiều việc, mô tả Markdown dài, nhiều bình luận và lịch sử.`,
  `## Phương án\n1. Bật nén gzip cho JSON ở nginx của web (\`frontend/nginx.conf\`), áp cho \`location /api/\`.\n2. Không nén WebSocket / SSE.\n3. Không thêm ResponseCompression trong ASP.NET.`,
  `## File liên quan\n- \`frontend/nginx.conf\`\n- \`.agent/ops.md\`\n- \`backend/src/Modules/Projects/OfficeHub.Modules.Projects/Features/TaskEndpoints.cs\``,
  `## Kiểm tra sau khi làm\n- \`bun run build\`, build image web như khi deploy.\n- curl với Accept-Encoding: gzip → có Content-Encoding: gzip; WebSocket /rt/ vẫn kết nối.`,
  `Ghi chú ${i}: ${'Nội dung lặp lại để mô tả đủ dài giống việc thật trong dự án. '.repeat(18)}`,
].join('\n\n');
for (let n = 1; n <= N; n++) { // tuần tự: tạo song song cùng dự án đụng khoá lạc quan (số thứ tự việc) → 500
  const r = await json(pm, 'POST', `/api/projects/${P}/tasks`, { title: `Việc thử nén ${n}`, description: desc(n) });
  if (r.status >= 300) throw new Error(`Tạo việc lỗi ${r.status}: ${JSON.stringify(r.body)}`);
}
const path = `/api/projects/${P}/tasks`;

// ── 1. Không gửi Accept-Encoding → bản thường (đo "trước") ──
const plain = await raw(WEB, path, { cookie: pm });
const plainTasks = JSON.parse(plain.body.toString('utf8'));
ok(`không Accept-Encoding: 200, không Content-Encoding, ${N} việc`, plain.status === 200 && !plain.headers['content-encoding'] && plainTasks.length === N,
  { status: plain.status, ce: plain.headers['content-encoding'], n: plainTasks.length });

// ── 2. Accept-Encoding: gzip → nén, Vary, giải nén ra đúng JSON (đo "sau") ──
const gz = await raw(WEB, path, { cookie: pm, 'accept-encoding': 'gzip, deflate, br' });
ok('Accept-Encoding gzip: Content-Encoding: gzip', gz.status === 200 && gz.headers['content-encoding'] === 'gzip', { status: gz.status, h: gz.headers });
ok('Vary có Accept-Encoding', /accept-encoding/i.test(String(gz.headers['vary'] ?? '')), gz.headers['vary']);
const unz = gunzipSync(gz.body).toString('utf8');
ok('giải nén = đúng JSON bản thường', unz === plain.body.toString('utf8'), { a: unz.length, b: plain.body.length });
ok('bản nén nhỏ hơn ≥ 3 lần', gz.body.length * 3 <= plain.body.length, { gz: gz.body.length, plain: plain.body.length });
console.log(`   ${path}: trước ${kb(plain.body.length)} → sau ${kb(gz.body.length)} (×${(plain.body.length / gz.body.length).toFixed(1)}), content-type ${gz.headers['content-type']}`);
ok('header bảo mật vẫn còn trên /api (nosniff)', gz.headers['x-content-type-options'] === 'nosniff', gz.headers['x-content-type-options']);

// ── 3. Request đi qua proxy (nginx VPS thêm Via) vẫn nén — gzip_proxied any ──
const via = await raw(WEB, path, { cookie: pm, 'accept-encoding': 'gzip', via: '1.1 nginx' });
ok('có header Via (qua proxy) vẫn nén', via.headers['content-encoding'] === 'gzip', via.headers['content-encoding']);

// ── 4. Phản hồi nhỏ (< 1024 byte) không nén; lỗi problem+json nhỏ cũng không ──
const small = await raw(WEB, `/api/projects/${P}`, { 'accept-encoding': 'gzip' }); // không cookie → 401 nhỏ
ok('phản hồi nhỏ (401) không nén', small.status === 401 && !small.headers['content-encoding'], { status: small.status, ce: small.headers['content-encoding'], len: small.body.length });

// ── 5. Api gọi thẳng KHÔNG tự nén (chỉ nén một chỗ ở nginx, không nén hai lần) ──
const direct = await raw(API, path, { cookie: pm, 'accept-encoding': 'gzip, br' });
ok('Api gọi thẳng: không Content-Encoding', direct.status === 200 && !direct.headers['content-encoding'], direct.headers['content-encoding']);

// ── 6. SPA + static vẫn phục vụ được ──
const home = await raw(WEB, '/projects', { 'accept-encoding': 'gzip' });
ok('SPA /projects: 200 text/html', home.status === 200 && /text\/html/.test(String(home.headers['content-type'])), { s: home.status, ct: home.headers['content-type'] });
const html = home.headers['content-encoding'] === 'gzip' ? gunzipSync(home.body).toString('utf8') : home.body.toString('utf8');
ok('SPA trả index.html đọc được', html.includes('<div id="root"'), html.slice(0, 200));

// ── 7. WebSocket /rt/ qua nginx: negotiate + bắt tay SignalR (văn phòng 3D / chat dùng đường này) ──
for (const hub of ['/rt/hub/office', '/rt/hub/chat']) {
  const neg = await fetch(`${WEB}${hub}/negotiate?negotiateVersion=1`, { method: 'POST', headers: { cookie: pm, 'accept-encoding': 'gzip' } });
  const nb = await neg.json().catch(() => null) as any;
  ok(`${hub} negotiate qua nginx: 200 + connectionToken + có WebSockets`, neg.status === 200 && !!nb?.connectionToken
    && (nb.availableTransports ?? []).some((t: any) => t.transport === 'WebSockets'), { status: neg.status, nb });
  const handshake = await new Promise<string>((resolve) => {
    const ws = new WebSocket(`${WEB.replace(/^http/, 'ws')}${hub}?id=${encodeURIComponent(nb?.connectionToken ?? '')}`, { headers: { cookie: pm } } as any);
    const t = setTimeout(() => { ws.close(); resolve('timeout'); }, 8000);
    ws.onopen = () => ws.send('{"protocol":"json","version":1}\u001e');
    ws.onmessage = (m) => { clearTimeout(t); resolve(String(m.data)); ws.close(); };
    ws.onerror = () => { clearTimeout(t); resolve('error'); };
  });
  ok(`${hub} WebSocket qua nginx: bắt tay SignalR thành công`, handshake.startsWith('{}'), handshake);
}

// ── 8. Cấu hình: đường stream tắt gzip ──
const conf = readFileSync(new URL('../../frontend/nginx.conf', import.meta.url), 'utf8');
const block = (re: RegExp) => conf.match(re)?.[1] ?? '';
ok('nginx.conf: /mcp (SSE), /rt/, /livekit/ có gzip off', [/location = \/mcp \{([^}]*)\}/, /location \/rt\/ \{([^}]*)\}/, /location \/livekit\/ \{([^}]*)\}/]
  .every((re) => /gzip off;/.test(block(re))));

console.log(`\n${pass}/${pass + fail} đạt`);
process.exit(fail ? 1 : 0);
