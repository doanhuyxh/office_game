// E2E TEST-242: hộp thoại chi tiết việc — khung xương khi chi tiết (GET /projects/tasks/{tid}?comments=false) chưa về, nội dung thay vào MỘT lần
// (không có khung hình mô tả rỗng, không đổi chế độ xem ↔ sửa), mở lại / rê chuột tải trước → hiện ngay, tạo việc mới không khung xương,
// lỗi → Thử lại, tên gõ trong lúc chờ không bị ghi đè, Lưu không mất mô tả.
// Dùng dữ liệu seed của TEST-240 (dự án ~240 việc: mô tả ~2 KB; việc chia 5 có 2 link media; chia 4 / 8 có người theo dõi; việc 10k+1 chờ việc 10k).
// CHỈ DB tạm:
//   docker run -d --name e2e242-pg -e POSTGRES_DB=e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -p 127.0.0.1:15442:5432 postgres:17-alpine
//   Api (từ backend/): env ASPNETCORE_ENVIRONMENT=Development ASPNETCORE_URLS=http://localhost:5260
//        'ConnectionStrings__Default=Host=127.0.0.1;Port=15442;Database=e2e;Username=e2e;Password=e2e' Encryption__Key=<base64 32 byte>
//        Smtp__Host=127.0.0.1 Smtp__Port=9 Sentry__Dsn= Seq__Url= Telegram__ApiUrl=http://127.0.0.1:9 Firebase__CredentialsPath=
//        Chat__InternalKey=<≥32> Chat__RealtimeToApiKey=<cùng> Chat__McpToApiKey=<cùng>
//        Database__MigrateOnStartup=true Seed__AdminEmail=e2e240-admin@officehub-e2e.vn Seed__AdminPassword=E2e240-Admin-2026
//        dotnet run --project src/OfficeHub.Api --no-launch-profile
//   (TEMP / TMP riêng nếu phiên khác đang dùng officehub-e2e240-state.json trong tmpdir)
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5260 BASE_URL=http://localhost:5261 bun scripts/dev/task-list-summary-e2e.ts seed
//   FE (frontend/): bun run build && VITE_API_TARGET=http://localhost:5260 bunx vite preview --port 5261 --strictPort
//   E2E_LOCAL_DB=1 API_URL=http://localhost:5260 BASE_URL=http://localhost:5261 SHOTS_DIR=… bun scripts/dev/task-dialog-skeleton-e2e.ts
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { launch } from './cdp';

if (process.env.E2E_LOCAL_DB !== '1') throw new Error('Chỉ chạy với DB tạm: đặt E2E_LOCAL_DB=1');
const API = process.env.API_URL ?? 'http://localhost:5260';
const BASE = process.env.BASE_URL ?? 'http://localhost:5261';
const SHOTS = process.env.SHOTS_DIR ?? `${tmpdir()}/t242`;
const STATE = `${tmpdir()}/officehub-e2e240-state.json`;
const PW = 'E2e-Local-2026';
let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? '✔' : '✘'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra).slice(0, 900) : ''}`);
};
type State = { P: string; pmUser: string; aUser: string; aId: string; bId: string; titles: Record<string, number> };
const st = JSON.parse(readFileSync(STATE, 'utf8')) as State;
const byNo = (n: number) => Object.entries(st.titles).find(([, i]) => i === n)![0];
const desc = (i: number) => `## Việc số ${i}\n\n${`Mô tả chi tiết việc ${i} — nội dung tiếng Việt có dấu để đo dung lượng. `.repeat(28)}`.slice(0, 2000).trimEnd();

// "Slow 4G" của Chrome DevTools (bản mới): 1.6 Mbps × 0.9 xuống, 750 kbps × 0.9 lên, độ trễ 150 ms × 3.75
const SLOW_4G = { offline: false, latency: 562.5, downloadThroughput: (1.6 * 1000 * 1000 / 8) * 0.9, uploadThroughput: (750 * 1000 / 8) * 0.9 };
const NO_THROTTLE = { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };

// Ghi lại MỌI trạng thái khác nhau của hộp thoại (MutationObserver chạy sau mỗi lần React commit DOM) → kiểm "thay một lần", không khung hình rỗng.
const RECORDER = (n: number) => `(() => {
  window.__obs?.disconnect(); window.__snaps = []; let last = '';
  const snap = () => {
    const d = document.querySelector('[role="dialog"]'); if (!d) return;
    const q = (s) => !!d.querySelector(s);
    const text = d.textContent;
    const s = { title: (d.querySelector('#tk-title')?.value ?? ''), descSk: q('[data-testid="task-desc-skeleton"]'), mediaSk: q('[data-testid="task-media-skeleton"]'),
      folSk: q('[data-testid="task-followers-skeleton"]'), depSk: q('[data-testid="task-dependencies-skeleton"]'), histSk: q('[data-testid="task-history-skeleton"]'),
      editing: q('textarea#tk-desc'), hasDesc: text.includes('Mô tả chi tiết việc ${n}'), empty: text.includes('Chưa có nội dung.'),
      media: new Set([...d.querySelectorAll('img[src*="example.com/anh-${n}-"], a[href*="example.com/anh-${n}-"]')].map((e) => e.getAttribute('src') ?? e.getAttribute('href'))).size, followers: q('[data-testid="task-followers"]'), deps: q('[data-testid="task-dependencies"]'),
      history: /Lịch sử \\(\\d+\\)/.test(text), saveDisabled: !!d.querySelector('button[type="submit"]')?.disabled, error: q('[data-testid="task-detail-error"]') };
    if (!s.descSk && !s.hasDesc && !s.empty) s.probe = (d.querySelector('fieldset')?.textContent ?? '').slice(0, 300);
    const k = JSON.stringify(s); if (k !== last) { last = k; window.__snaps.push({ t: Math.round(performance.now()), ...s }); }
  };
  window.__obs = new MutationObserver(snap); window.__obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true }); snap();
})()`;
type Snap = { t: number; title: string; descSk: boolean; mediaSk: boolean; folSk: boolean; depSk: boolean; histSk: boolean; editing: boolean; hasDesc: boolean; empty: boolean;
  media: number; followers: boolean; deps: boolean; history: boolean; saveDisabled: boolean; error: boolean };

const br = await launch(9561, `${tmpdir()}/officehub-t242-${Date.now()}`, 1440, 900);
type Req = { url: string; method: string };
const reqs: Req[] = [];
await br.send('Network.enable');
br.on('Network.requestWillBeSent', (p: any) => reqs.push({ url: p.request.url, method: p.request.method }));
const detailReqs = (id: string) => reqs.filter((r) => r.url.includes(`/api/projects/tasks/${id}?comments=false`));
const until = async (cond: () => Promise<boolean>, ms = 15000) => { for (let i = 0; i < ms / 100; i++) { try { if (await cond()) return true; } catch { /* đang chuyển trang */ } await br.sleep(100); } return false; };
const snaps = async () => (await br.evalJs('window.__snaps ?? []')) as Snap[];
const dialogOpen = () => br.evalJs(`!!document.querySelector('[role="dialog"]')`) as Promise<boolean>;
const card = (n: number) => `[...document.querySelectorAll('[data-testid="task-card"]')].find(x => /Việc ${n}([^0-9]|$)/.test(x.textContent))`;
const clickCard = (n: number) => br.evalJs(`${card(n)}.click()`);
const closeDialog = async () => { await br.evalJs(`[...document.querySelectorAll('[role="dialog"] button')].find(b => b.textContent.trim() === 'Đóng').click()`); await until(async () => !(await dialogOpen()), 5000); await br.sleep(300); };
const startRec = (n: number) => br.evalJs(RECORDER(n));
const loadedOk = (s: Snap | undefined, n: number, media: number) => !!s && !s.descSk && s.hasDesc && !s.editing && s.media === media && !s.saveDisabled;
const summary = (xs: Snap[]) => xs.map((s) => `${s.t}:${s.descSk ? 'SK' : s.hasDesc ? 'DESC' : s.empty ? 'EMPTY' : `?[${((s as any).probe ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 160)}]`}${s.editing ? '/edit' : ''}${s.mediaSk ? '+mSK' : ''}${s.media ? `+m${s.media}` : ''}${s.folSk ? '+fSK' : ''}${s.followers ? '+fol' : ''}${s.depSk ? '+dSK' : ''}${s.deps ? '+dep' : ''}${s.error ? '+ERR' : ''}`).join(' → ');

try {
  ok('PM đăng nhập web', (await br.login(st.pmUser, PW)) === 200);
  await br.go(`${BASE}/projects/${st.P}`, 1500);
  ok('kanban hiện thẻ việc', await until(async () => (await br.evalJs(`document.querySelectorAll('[data-testid="task-card"]').length`)) > 200));

  // 1) Slow 4G, chưa có cache: Việc 80 (mô tả 2 KB + 2 media + 2 người theo dõi) → khung xương → nội dung thay vào MỘT lần
  const N1 = 80, t1 = byNo(N1);
  await br.send('Network.emulateNetworkConditions', SLOW_4G);
  await startRec(N1);
  reqs.length = 0;
  // giữ request chi tiết tới khi chụp xong ảnh "đang tải" (thả ra vẫn chạy Slow 4G)
  await br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/tasks/${t1}?comments=false*`, requestStage: 'Request' }] });
  const held: string[] = [];
  br.on('Fetch.requestPaused', (p: any) => { if (p.request.url.includes(t1)) held.push(p.requestId); });
  await clickCard(N1);
  ok(`bấm Việc ${N1} → hộp thoại mở ngay với khung xương`, await until(async () => !!(await br.evalJs(`!!document.querySelector('[data-testid="task-desc-skeleton"]')`)), 3000));
  await until(async () => held.length > 0, 5000);
  await br.sleep(300);
  await br.shot(`${SHOTS}/t242-1-loading.png`);
  const shotWhileLoading = await br.evalJs(`!!document.querySelector('[data-testid="task-desc-skeleton"]')`) as boolean;
  ok('… ảnh "đang tải" chụp khi khung xương còn hiện', shotWhileLoading);
  for (const id of held.splice(0)) await br.send('Fetch.continueRequest', { requestId: id });
  await br.send('Fetch.disable');
  ok(`… chỉ 1 request chi tiết GET /tasks/{id}?comments=false`, await until(async () => detailReqs(t1).length === 1, 3000), reqs.map((r) => r.url));
  ok('… nội dung về', await until(async () => loadedOk((await snaps()).at(-1), N1, 2), 30000), summary(await snaps()));
  await br.sleep(800);
  await br.send('Network.emulateNetworkConditions', NO_THROTTLE);
  await br.shot(`${SHOTS}/t242-2-loaded.png`);
  let xs = await snaps();
  console.log('  các trạng thái:', summary(xs));
  const first = xs[0];
  ok('… khung hình đầu: tên / trạng thái có từ danh sách, khung xương mô tả + media + người theo dõi + lịch sử, Lưu khoá',
    !!first && first.title === `Việc ${N1}` && first.descSk && first.mediaSk && first.folSk && first.histSk && first.saveDisabled, first);
  const firstLoaded = xs.findIndex((s) => !s.descSk);
  ok('… khung hình đầu tiên hết khung xương đã đủ: mô tả (chế độ xem) + 2 media + người theo dõi + việc phải chờ + lịch sử, Lưu mở',
    firstLoaded > 0 && loadedOk(xs[firstLoaded], N1, 2) && xs[firstLoaded].followers && xs[firstLoaded].deps && xs[firstLoaded].history && !xs[firstLoaded].mediaSk && !xs[firstLoaded].folSk,
    xs[firstLoaded]);
  ok('… KHÔNG có khung hình mô tả rỗng ("Chưa có nội dung." / không khung xương mà chưa có mô tả)', xs.every((s) => s.descSk || s.hasDesc) && !xs.some((s) => s.empty), summary(xs));
  ok('… KHÔNG lúc nào chuyển sang chế độ sửa (textarea) — việc có mô tả mở ở chế độ xem', !xs.some((s) => s.editing));
  ok('… khung xương chỉ hiện trước, không quay lại sau khi đã có nội dung', xs.slice(firstLoaded).every((s) => !s.descSk && !s.mediaSk && !s.folSk));
  // chiều cao vùng nội dung: khung xương ≈ ô mô tả
  await closeDialog();

  // 2) mở lại cùng việc → hiện ngay từ cache, không khung xương
  await startRec(N1);
  await clickCard(N1);
  await until(async () => await dialogOpen(), 3000);
  await br.sleep(1500);
  xs = await snaps();
  ok(`mở lại Việc ${N1} → không có khung xương, nội dung hiện ngay ở khung hình đầu`, xs.length > 0 && xs.every((s) => !s.descSk && !s.mediaSk && !s.folSk) && loadedOk(xs[0], N1, 2), summary(xs));
  await closeDialog();

  // 3) rê chuột lên thẻ Việc 120 (≥ 150 ms) → tải trước chi tiết; bấm → không khung xương
  const N3 = 120, t3 = byNo(N3);
  reqs.length = 0;
  const box = await br.evalJs(`(() => { const c = ${card(N3)}; c.scrollIntoView({ block: 'center' }); const r = c.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number };
  await br.sleep(300);
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
  ok(`rê chuột lên thẻ Việc ${N3} → tải trước GET /tasks/{id}?comments=false`, await until(async () => detailReqs(t3).length === 1, 5000), reqs.map((r) => r.url));
  await br.sleep(1000);
  await startRec(N3);
  await br.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await br.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await until(async () => await dialogOpen(), 3000);
  await br.sleep(1500);
  xs = await snaps();
  ok(`… bấm thẻ → hộp thoại hiện đủ ngay (không khung xương)`, xs.length > 0 && xs.every((s) => !s.descSk) && loadedOk(xs[0], N3, 2), summary(xs));
  await closeDialog();
  // lướt nhanh qua nhiều thẻ (< 150 ms mỗi thẻ) → không bắn request cho từng thẻ
  reqs.length = 0;
  for (const n of [121, 122, 123, 124, 125]) {
    const b = await br.evalJs(`(() => { const r = ${card(n)}.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`) as { x: number; y: number };
    await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: b.x, y: b.y });
    await br.sleep(40);
  }
  await br.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
  await br.sleep(600);
  const swept = reqs.filter((r) => /\/api\/projects\/tasks\/[^/?]+\?comments=false/.test(r.url));
  ok('lướt chuột nhanh qua 5 thẻ → không tải trước thẻ nào (chờ 150 ms)', swept.length === 0, swept.map((r) => r.url));

  // 4) tạo việc mới → form trống, chế độ viết, không khung xương
  const firstCol = await br.evalJs(`[...document.querySelectorAll('button[aria-label^="Thêm việc vào "]')][0]?.getAttribute('aria-label')`) as string;
  await startRec(0);
  await br.evalJs(`document.querySelector('button[aria-label="${firstCol}"]').click()`);
  await until(async () => await dialogOpen(), 3000);
  await br.sleep(800);
  xs = await snaps();
  ok(`tạo việc mới (${firstCol}) → form trống, ô Markdown ở chế độ viết, không khung xương`, xs.length > 0 && xs.every((s) => !s.descSk && !s.folSk && !s.depSk && !s.histSk)
    && xs.at(-1)!.title === '' && xs.at(-1)!.editing && !xs.at(-1)!.saveDisabled, summary(xs));
  await closeDialog();

  // 5) gõ tên trong lúc chờ chi tiết (giữ request bằng Fetch) → chi tiết về KHÔNG ghi đè tên đang gõ; Lưu → tên mới + mô tả giữ nguyên
  const N5 = 160, t5 = byNo(N5);
  await br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/tasks/${t5}?comments=false*`, requestStage: 'Request' }] });
  const paused: string[] = [];
  br.on('Fetch.requestPaused', (p: any) => paused.push(p.requestId));
  await startRec(N5);
  await clickCard(N5);
  ok(`Việc ${N5}: request chi tiết bị giữ → khung xương`, await until(async () => paused.length > 0 && !!(await br.evalJs(`!!document.querySelector('[data-testid="task-desc-skeleton"]')`)), 5000));
  ok('… nút Lưu khoá trong lúc chờ', await br.evalJs(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`) as boolean);
  await br.evalJs(`(() => { const i = document.querySelector('#tk-title'); i.focus(); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, 'Việc ${N5} (gõ khi đang tải)'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await br.sleep(300);
  for (const id of paused.splice(0)) await br.send('Fetch.continueRequest', { requestId: id });
  await br.send('Fetch.disable');
  ok('… chi tiết về → mô tả hiện', await until(async () => loadedOk((await snaps()).at(-1), N5, 2), 8000), summary(await snaps()));
  ok('… tên đang gõ KHÔNG bị ghi đè', (await br.evalJs(`document.querySelector('#tk-title').value`)) === `Việc ${N5} (gõ khi đang tải)`);
  await br.evalJs(`document.querySelector('[role="dialog"] button[type="submit"]').click()`);
  ok('… Lưu → hộp thoại đóng', await until(async () => !(await dialogOpen()), 8000));
  // đọc lại bằng phiên web (đăng nhập API lần nữa sẽ đăng xuất phiên web)
  const d5 = (await br.evalJs(`fetch('/api/projects/tasks/${t5}?comments=false').then(r => r.json())`) as any).task;
  ok('… tên mới đã lưu, mô tả + 2 media GIỮ NGUYÊN', d5.title === `Việc ${N5} (gõ khi đang tải)` && d5.description === desc(N5) && d5.mediaLinks.length === 2,
    { title: d5.title, len: d5.description?.length, m: d5.mediaLinks });

  // 6) lỗi tải chi tiết → thông báo + Thử lại trong vùng mô tả (không khung xương chạy mãi) → Thử lại thành công
  const N6 = 200, t6 = byNo(N6);
  await br.send('Fetch.enable', { patterns: [{ urlPattern: `*/api/projects/tasks/${t6}?comments=false*`, requestStage: 'Request' }] });
  let failing = true;
  const failed: string[] = [];
  br.on('Fetch.requestPaused', (p: any) => { if (failing && p.request.url.includes(t6)) { failed.push(p.requestId); void br.send('Fetch.fulfillRequest', { requestId: p.requestId, responseCode: 500, responseHeaders: [{ name: 'content-type', value: 'application/problem+json' }],
    body: Buffer.from(JSON.stringify({ status: 500, title: 'Lỗi giả lập TEST-242' })).toString('base64') }); } });
  await startRec(N6);
  await clickCard(N6);
  ok(`Việc ${N6}: chi tiết lỗi → "Không tải được chi tiết việc" + Thử lại, hết khung xương`, await until(async () => {
    const s = (await snaps()).at(-1); return !!s && s.error && !s.descSk && !s.mediaSk && !s.folSk && !s.histSk;
  }, 15000), { snaps: summary(await snaps()), open: await dialogOpen(), reqs: reqs.filter((r) => r.url.includes(t6)).map((r) => r.url),
    toast: await br.evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].map(x => x.textContent).join(' | ')`) });
  ok('… Lưu vẫn khoá khi chưa có chi tiết', await br.evalJs(`document.querySelector('[role="dialog"] button[type="submit"]').disabled`) as boolean);
  await br.shot(`${SHOTS}/t242-3-error.png`);
  failing = false;
  for (const id of paused.splice(0)) await br.send('Fetch.continueRequest', { requestId: id }).catch(() => undefined);
  await br.send('Fetch.disable');
  await br.evalJs(`[...document.querySelectorAll('[data-testid="task-detail-error"] button')].find(b => b.textContent.includes('Thử lại')).click()`);
  ok('… bấm Thử lại → mô tả + media hiện', await until(async () => loadedOk((await snaps()).at(-1), N6, 2), 10000), summary(await snaps()));
  console.log(`  (đã chặn ${failed.length} request lỗi)`);
  await closeDialog();

  // 7) link ?task= (từ chuông) tải trang mới, Slow 4G: Việc 81 (chờ Việc 80) → khung xương (gồm việc phải chờ) → nội dung đúng
  const N7 = 81, t7 = byNo(N7);
  await br.send('Network.emulateNetworkConditions', SLOW_4G);
  await br.send('Page.addScriptToEvaluateOnNewDocument', { source: `document.addEventListener('DOMContentLoaded', () => ${RECORDER(N7)})` });
  await br.go(`${BASE}/projects/${st.P}?task=${t7}`, 500);
  ok(`link ?task= Việc ${N7} → hộp thoại hiện nội dung đúng`, await until(async () => {
    const s = (await snaps()).at(-1); return !!s && loadedOk(s, N7, 0) && s.deps && (await br.evalJs(`document.querySelector('[data-testid="task-dependencies"]').textContent.includes('Việc 80')`));
  }, 60000), summary(await snaps()));
  xs = await snaps();
  console.log('  các trạng thái:', summary(xs));
  const skIdx = xs.findIndex((s) => s.descSk);
  ok('… có khung xương trước (mô tả + việc phải chờ)', skIdx >= 0 && xs[skIdx].depSk, xs[skIdx]);
  const fl = xs.findIndex((s, i) => i > skIdx && !s.descSk);
  ok('… thay một lần: khung hình đầu hết khung xương đã có mô tả + việc phải chờ, không có mô tả rỗng / chế độ sửa',
    fl > 0 && loadedOk(xs[fl], N7, 0) && xs[fl].deps && !xs[fl].depSk && xs.every((s) => s.descSk || s.hasDesc) && !xs.some((s) => s.editing || s.empty), summary(xs));
  await br.send('Network.emulateNetworkConditions', NO_THROTTLE);
  await br.shot(`${SHOTS}/t242-4-link.png`);

  const jsErrors = br.errors.filter((e) => !/negotiation|Failed to start the connection|404|Not Found|status of 4|WebSocket|ERR_CONNECTION_REFUSED|Failed to fetch|ConnectionRefused/.test(e));
  ok('không lỗi JS trên trang (ngoài Realtime không bật / request cố ý chặn)', jsErrors.length === 0, jsErrors.slice(0, 3));
} finally {
  br.close();
}
console.log(`\n${pass} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
