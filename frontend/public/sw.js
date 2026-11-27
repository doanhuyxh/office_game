// Service worker OfficeHub (PWA + push FCM). Chỉ đăng ký ở bản build production (src/pwa.ts).
// - KHÔNG bao giờ cache API / realtime / MCP / LiveKit: dữ liệu nhân sự luôn lấy mới, đăng xuất không để lại dữ liệu.
// - Trang (navigation): luôn lấy mạng; mất mạng → offline.html (không mở app khi không gọi được API — tránh trạng thái nửa vời).
// - /assets/* (tên có hash, không đổi nội dung): cache trước. Font Google: cache rồi làm mới nền.
// Đổi VERSION khi sửa file này → cache cũ bị xoá ở bước activate. Lúc build, VERSION được nối thêm mã build
// (scripts/build-version.ts) → mỗi deploy sw.js đổi nội dung → SW mới cài nền, kích hoạt khi đóng hết tab và dọn cache /assets cũ.
const VERSION = 'v2';
const SHELL = `officehub-shell-${VERSION}`;
const ASSETS = `officehub-assets-${VERSION}`;
const FONTS = `officehub-fonts-${VERSION}`;
const PRECACHE = ['/offline.html', '/offline.js', '/icons/icon-192.png'];
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

// Push FCM lúc tab đóng / nền: trình duyệt tự giao sự kiện "push" cho SW đang đăng ký (getToken() ở trang đã gắn SW này).
// Tab đang mở thì FCM gọi onMessage() trong trang thay vì event này (xem services/firebase.ts) — tránh hiện 2 lần.
self.addEventListener('push', (e) => {
  const payload = e.data?.json() ?? {};
  const { notification, data } = payload;
  e.waitUntil(self.registration.showNotification(notification?.title ?? 'OfficeHub', {
    body: notification?.body,
    icon: '/icons/icon-192.png',
    data,
  }));
});

// TEST-237: dựng URL từ target (targetType / targetId / targetParams) — bản rút gọn của features/notifications/utils/target.ts
// (SW không import được module app; giữ khớp BE NotificationLinkBuilder). TEST-238: không còn `link` — loại chưa biết / thiếu → '/notifications'.
function targetUrl(d) {
  if (!d || !d.targetType) return null;
  let p = {};
  try { p = d.targetParams ? JSON.parse(d.targetParams) : {}; } catch { p = {}; }
  const id = d.targetId || '';
  const q = (path, o) => {
    const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString();
    return s ? `${path}?${s}` : path;
  };
  switch (d.targetType) {
    case 'project_task': return p.projectId && id ? q(`/projects/${p.projectId}`, { task: id, comment: p.commentId }) : null;
    case 'project': return id ? q(`/projects/${id}`, { tab: p.tab, page: p.tab ? p.page : undefined }) : null;
    case 'wiki_share': return p.projectId ? q(`/projects/${p.projectId}`, { tab: 'wiki', page: p.pageId }) : null;
    case 'approval_request': case 'approval_delegation': return '/approvals';
    case 'chat_conversation': return id ? q('/chat', { c: id }) : null;
    case 'news_post': return id ? q(`/news/${id}`, { comment: p.commentId }) : null;
    case 'meeting_booking': return '/meetings';
    case 'labor_contract': return '/contracts';
    case 'payslip': return '/payslips';
    case 'asset_device': case 'asset_service': case 'asset_review': case 'asset_handover': return '/assets';
    case 'employee': return p.view === 'assets' ? '/assets' : '/employees';
    case 'social_account': return p.view === 'posts' ? '/social/facebook' : '/assets?tab=social&platform=facebook';
    case 'social_post': return '/social/facebook';
    case 'document_asset': return id ? q('/documents', { asset: id }) : null;
    case 'expense_request': return '/finance';
    case 'sales_customer': return id ? q('/sales', { customer: id }) : null;
    case 'sales_contract': return p.customerId ? q('/sales', { customer: p.customerId }) : null;
    case 'sales_receivable': return '/sales?tab=receivables';
    case 'profile_change_request': return p.view === 'profile' ? '/profile' : '/employees';
    case 'page': {
      const { key, ...rest } = p;
      return typeof key === 'string' && /^([a-z0-9-]+(\/[a-z0-9-]+)*)?$/.test(key) ? q(`/${key}`, rest) : null;
    }
    default: return null;
  }
}

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const d = e.notification.data;
  e.waitUntil(self.clients.openWindow(targetUrl(d) ?? '/notifications'));
});
