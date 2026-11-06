// Service worker OfficeHub (PWA, không push). Chỉ đăng ký ở bản build production (src/pwa.ts).
// - KHÔNG bao giờ cache API / realtime / MCP / LiveKit: dữ liệu nhân sự luôn lấy mới, đăng xuất không để lại dữ liệu.
// - Trang (navigation): luôn lấy mạng; mất mạng → offline.html (không mở app khi không gọi được API — tránh trạng thái nửa vời).
// - /assets/* (tên có hash, không đổi nội dung): cache trước. Font Google: cache rồi làm mới nền.
// Đổi VERSION khi sửa file này → cache cũ bị xoá ở bước activate.
const VERSION = 'v1';
const SHELL = `officehub-shell-${VERSION}`;
const ASSETS = `officehub-assets-${VERSION}`;
const FONTS = `officehub-fonts-${VERSION}`;
const PRECACHE = ['/offline.html', '/icons/icon-192.png'];
const NEVER = ['/api/', '/rt/', '/mcp', '/livekit/', '/.well-known/', '/health', '/oauth/'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keep = new Set([SHELL, ASSETS, FONTS]);
    for (const k of await caches.keys()) if (k.startsWith('officehub-') && !keep.has(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Trang báo "có bản mới" → người dùng bấm "Tải lại" → kích hoạt ngay.
self.addEventListener('message', (e) => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (NEVER.some((p) => url.pathname.startsWith(p))) return; // để trình duyệt tự xử lý (không cache)

    if (req.mode === 'navigate') {
      e.respondWith(fetch(req).catch(async () => (await caches.match('/offline.html', { cacheName: SHELL })) ?? Response.error()));
      return;
    }

    if (url.pathname.startsWith('/assets/')) {
      e.respondWith((async () => {
        const hit = await caches.match(req, { cacheName: ASSETS });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) (await caches.open(ASSETS)).put(req, res.clone());
        return res;
      })());
    }
    return;
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit ?? net;
    })());
  }
});
