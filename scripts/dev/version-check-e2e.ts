// TEST-227: tab đang mở tự phát hiện bản web mới sau deploy (/version.json + sw.js có mã build) → toast "Tải lại" một lần.
// Không cần DB / API: phục vụ frontend/dist bằng Bun (giống nginx: SPA fallback, /version.json no-store), /api/* → 401.
//   cd frontend && bun run build && cd .. && CHROME_PATH=... bun scripts/dev/version-check-e2e.ts
import { launch } from './cdp';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const PORT = Number(process.env.PORT ?? 5199);
const DIST = join(import.meta.dir, '../../frontend/dist');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const original = JSON.parse(await Bun.file(join(DIST, 'version.json')).text()).build as string;
const swSrc = await Bun.file(join(DIST, 'sw.js')).text();
let deployed = original; // "deploy" bản mới = đổi mã build server trả (version.json + VERSION trong sw.js)
let versionHits = 0;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url);
    if (pathname.startsWith('/api/')) return Response.json({ title: 'Unauthorized' }, { status: 401 });
    if (pathname === '/version.json') {
      versionHits++;
      return new Response(JSON.stringify({ build: deployed }), { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
    }
    if (pathname === '/sw.js') {
      return new Response(swSrc.replace(original, deployed), { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' } });
    }
    const f = Bun.file(join(DIST, pathname));
    if (pathname !== '/' && (await f.exists())) return new Response(f);
    return new Response(Bun.file(join(DIST, 'index.html')), { headers: { 'content-type': 'text/html', 'cache-control': 'no-cache' } });
  },
});

const base = `http://localhost:${PORT}`;
const { evalJs, shot, go, close } = await launch(9339, mkdtempSync(join(tmpdir(), 'ver-')), 1280, 800);
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = '') => { ok ? pass++ : fail++; console.log(`${ok ? '✓' : '✗'} ${name}${info ? ` — ${info}` : ''}`); };
const toasts = () => evalJs(`[...document.querySelectorAll('[data-sonner-toast]')].filter(t => t.textContent.includes('Có phiên bản OfficeHub mới')).length`);
const focus = () => evalJs(`window.dispatchEvent(new Event('focus')); true`);

await go(`${base}/login`, 4000);
const swReady = await evalJs(`navigator.serviceWorker.ready.then(r => r.active?.scriptURL ?? '')`);
check('service worker đăng ký', String(swReady).endsWith('/sw.js'));
await go(`${base}/login`, 3000); // lần 2: trang đã có controller

await focus(); await sleep(1500);
check('cùng mã build → không toast', (await toasts()) === 0);
const hits0 = versionHits;
check('focus → hỏi /version.json', hits0 > 0, `hits=${hits0}`);
await focus(); await sleep(500);
check('focus liền nhau → không hỏi lại (giãn 15 giây)', versionHits === hits0);

deployed = `${original}-new`;
await sleep(15500);
await focus(); await sleep(4000);
check('deploy mới + focus → toast "Có phiên bản OfficeHub mới"', (await toasts()) === 1);
await shot(join(tmpdir(), 'test227-toast.png'));
console.log('ảnh:', join(tmpdir(), 'test227-toast.png'));

await sleep(15500);
await evalJs(`document.dispatchEvent(new Event('visibilitychange')); true`); await focus(); await sleep(3000);
check('không toast lặp (SW updatefound + poll)', (await toasts()) === 1);

const cached = await evalJs(`(async () => { for (const k of await caches.keys()) if (await (await caches.open(k)).match('/version.json')) return k; return ''; })()`);
check('service worker không cache /version.json', cached === '', cached);
const cc = await evalJs(`fetch('/version.json', { cache: 'no-store' }).then(r => r.headers.get('cache-control'))`);
check('/version.json no-store', cc === 'no-store');

await evalJs(`[...document.querySelectorAll('[data-sonner-toast] button')].find(b => b.textContent.includes('Tải lại'))?.click(); true`);
await sleep(4000);
const after = await evalJs(`caches.keys().then(k => ({ keys: k.join(','), t: document.querySelectorAll('[data-sonner-toast]').length }))`);
check('"Tải lại" → trang tải lại, cache theo VERSION mới', String(after.keys).includes('-new'), after.keys);
check('sau tải lại không còn toast', after.t === 0);

console.log(`\n${pass}/${pass + fail} pass`);
close();
process.exit(fail ? 1 : 0);
