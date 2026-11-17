// Kiểm tra trình xem ảnh dùng chung (TEST-147) — gọi từ chat-ui-e2e.ts (/chat) và office-chat-full-e2e.ts (khung chat 3D).
// Thao tác bằng chuột / phím thật qua CDP (Input.dispatch*), không gọi click() của DOM.
import { deflateSync } from 'node:zlib';

type Page = { send: (m: string, p?: any) => Promise<any>; evalJs: (e: string) => Promise<any>; shot: (path: string) => Promise<void> };
type Ok = (name: string, cond: boolean, extra?: unknown) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** PNG RGB w × h (sọc chéo theo `seed`) — đủ lớn để "vừa màn hình" < 100%. */
export function makePng(w: number, h: number, seed = 0): Uint8Array {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    out.set(new TextEncoder().encode(type), 4);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * (w * 3 + 1) + 1 + x * 3, band = ((x + y + seed * 40) >> 6) & 1;
    raw[i] = band ? 30 + seed * 80 : 220; raw[i + 1] = band ? 120 : 200; raw[i + 2] = band ? 200 : 60 + seed * 60;
  }
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const V = `document.querySelector('[data-testid=image-viewer]')`;
const IMG = `document.querySelector('[data-testid=image-viewer-img]')`;
const waitFor = async (p: Page, expr: string, ms = 6000) => { for (let t = 0; t < ms; t += 150) { if (await p.evalJs(expr)) return true; await sleep(150); } return false; };
const mouse = async (p: Page, x: number, y: number, clickCount = 1) => {
  await p.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await p.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount });
  await p.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount });
};
const press = async (p: Page, key: string, code: string, vk: number, ms = 0) => {
  await p.send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, ...(key.length === 1 ? { text: key } : {}) });
  if (ms) await sleep(ms);
  await p.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk });
  await sleep(200);
};
const rectOf = (p: Page, expr: string) => p.evalJs(`(() => { const e = ${expr}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`) as Promise<{ x: number; y: number; w: number; h: number } | null>;
const counter = (p: Page) => p.evalJs(`document.querySelector('[data-testid=image-viewer-counter]')?.textContent ?? null`) as Promise<string | null>;
const scale = (p: Page) => p.evalJs(`(() => { const i = ${IMG}; return i ? { s: +i.dataset.scale, fit: +i.dataset.fit, nw: i.naturalWidth } : null; })()`) as Promise<{ s: number; fit: number; nw: number } | null>;

/**
 * Hội thoại đang mở (trong `scope`) có ≥ 2 ảnh, hai ảnh CUỐI là ảnh vừa gửi (ảnh đầu trong hai ảnh: ≥ 2400 px).
 * `label` = tiền tố tên kiểm tra; `sender` = tên người gửi phải có trên thanh trên; `myPos` (văn phòng 3D) = vị trí nhân vật để kiểm tra phím không đi.
 */
export async function checkImageViewer(p: Page, ok: Ok, { scope, label, sender, shot, myPos }: {
  scope: string; label: string; sender: string; shot?: string; myPos?: () => Promise<{ x: number; z: number }>;
}) {
  const imgs = `[...(${scope} ?? document).querySelectorAll('[data-testid=chat-images] button')]`;
  const n = await p.evalJs(`${imgs}.length`) as number;
  const openFirst = async () => {
    await p.evalJs(`${imgs}[${n - 2}].scrollIntoView({ block: 'center' })`);
    await sleep(300);
    const r = await rectOf(p, `${imgs}[${n - 2}]`);
    if (r) await mouse(p, r.x + r.w / 2, r.y + r.h / 2);
    return waitFor(p, `!!${V} && !!${IMG}?.complete && ${IMG}.naturalWidth > 0`, 10000);
  };

  ok(`${label}: bấm ảnh thứ nhất (trong 2 ảnh vừa gửi) → trình xem mở, ảnh tải xong`, n >= 2 && await openFirst(), n);
  ok(`${label}: thanh trên có tên người gửi`, await waitFor(p, `(document.querySelector('[data-testid=image-viewer-caption]')?.textContent ?? '').includes(${JSON.stringify(sender)})`, 2000),
    await p.evalJs(`document.querySelector('[data-testid=image-viewer-caption]')?.textContent`));
  ok(`${label}: bộ đếm "${n - 1} / ${n}"`, await counter(p) === `${n - 1} / ${n}`, await counter(p));
  ok(`${label}: có nút Tải về / Mở tab mới / Đóng (aria-label)`, await p.evalJs(`['image-viewer-download', 'image-viewer-open', 'image-viewer-close'].every((t) => !!document.querySelector('[data-testid=' + t + '][aria-label]'))`));
  ok(`${label}: nền đen phủ toàn màn hình`, await p.evalJs(`(() => { const o = [...document.querySelectorAll('[data-state=open]')].find((e) => getComputedStyle(e).position === 'fixed' && ((b) => b.startsWith('rgba(0, 0, 0, 0.9') || b.startsWith('oklab(0 0 0 / 0.9'))(getComputedStyle(e).backgroundColor)); const r = o?.getBoundingClientRect(); return !!r && r.width >= innerWidth && r.height >= innerHeight; })()`));
  // Thanh trên tách khỏi ảnh: đáy thanh ≤ đỉnh ảnh
  const bar = await rectOf(p, `document.querySelector('[data-testid=image-viewer-close]').parentElement`);
  const im = await rectOf(p, IMG);
  ok(`${label}: nút trên thanh không đè ảnh`, !!bar && !!im && bar.y + bar.h <= im.y + 0.5, { bar, im });
  const s0 = await scale(p);
  ok(`${label}: ảnh lớn vừa màn hình (< 100%), không tràn`, !!s0 && !!im && s0.fit < 1 && Math.abs(s0.s - s0.fit) < 1e-3 && im.w <= 1440 && im.h <= 900, { s0, im });
  if (shot) { await sleep(500); await p.shot(shot); }

  await press(p, 'ArrowRight', 'ArrowRight', 39);
  ok(`${label}: phím → sang ảnh ${n} / ${n}`, await waitFor(p, `document.querySelector('[data-testid=image-viewer-counter]')?.textContent === '${n} / ${n}'`, 2000), await counter(p));
  await press(p, 'ArrowLeft', 'ArrowLeft', 37);
  ok(`${label}: phím ← quay lại ${n - 1} / ${n}`, await waitFor(p, `document.querySelector('[data-testid=image-viewer-counter]')?.textContent === '${n - 1} / ${n}'`, 2000), await counter(p));
  await waitFor(p, `!!${IMG}?.complete && ${IMG}.naturalWidth > 0 && +${IMG}.dataset.fit < 1`, 5000);

  // Nhấp đúp vào ảnh → 100%; lần nữa → vừa màn hình
  let r = await rectOf(p, IMG);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2, 1);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2, 2);
  ok(`${label}: nhấp đúp → ảnh ở 100%`, await waitFor(p, `+${IMG}?.dataset.scale === 1`, 2000), await scale(p));
  r = await rectOf(p, `document.querySelector('[data-testid=image-viewer-stage]')`);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2, 1);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2, 2);
  ok(`${label}: nhấp đúp lần nữa → vừa màn hình`, await waitFor(p, `(() => { const i = ${IMG}; return !!i && i.dataset.scale === i.dataset.fit; })()`, 2000), await scale(p));

  // Bấm một lần lên ảnh → không đóng
  await sleep(400);
  r = await rectOf(p, IMG);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2);
  await sleep(500);
  ok(`${label}: bấm lên ảnh → KHÔNG đóng`, await p.evalJs(`!!${V}`));

  if (myPos) {
    const p0 = await myPos();
    await press(p, 'w', 'KeyW', 87, 600);
    await press(p, 'ArrowUp', 'ArrowUp', 38, 600);
    const p1 = await myPos();
    ok(`${label}: trình xem đang mở, giữ W / ↑ → nhân vật đứng yên`, Math.hypot(p1.x - p0.x, p1.z - p0.z) < 0.05, { p0, p1 });
  }

  await press(p, 'Escape', 'Escape', 27);
  ok(`${label}: Esc đóng trình xem`, await waitFor(p, `!${V}`, 2000));
  if (myPos) ok(`${label}: Esc chỉ đóng trình xem, khung chat 3D vẫn mở`, await p.evalJs(`!!${scope}`));

  ok(`${label}: mở lại`, await openFirst());
  r = await rectOf(p, `document.querySelector('[data-testid=image-viewer-stage]')`);
  const ir = await rectOf(p, IMG);
  // Điểm nền: góc trên trái khung ảnh (ngoài ảnh vì ảnh ở giữa)
  ok(`${label}: (góc khung nằm ngoài ảnh)`, !!r && !!ir && (ir.y > r.y + 4 || ir.x > r.x + 4), { r, ir });
  await mouse(p, r!.x + 3, r!.y + 3);
  ok(`${label}: bấm nền → đóng`, await waitFor(p, `!${V}`, 2000));
}

/**
 * Bảng tin (media-grid): `p` đã đăng nhập ở `base` (Vite :5173 — CORS bucket). Đăng bài 2 ảnh ngay trong trình duyệt (vé → PUT S3 → bài),
 * mở /news/<id>, bấm ảnh 1 → trình xem "1 / 2", → / ← chuyển ảnh, Tải về gọi link `?download` (bắt window.open), Mở tab mới trỏ đúng ảnh.
 */
export async function checkNewsViewer(p: Page, ok: Ok, base: string, stamp: string, shot?: string) {
  const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
  const imgs = [b64(makePng(2400, 1600, 2)), b64(makePng(900, 600, 3))];
  const post = await p.evalJs(`(async () => {
    const ids = [];
    for (const [i, b] of ${JSON.stringify(imgs)}.entries()) {
      const bytes = Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
      const t = await fetch('/api/news/uploads', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fileName: 'news-viewer-' + (i + 1) + '.png', contentType: 'image/png', size: bytes.length, forComment: false }) }).then((r) => r.json());
      const put = await fetch(t.url, { method: 'PUT', headers: { 'content-type': t.contentType }, body: bytes });
      if (!put.ok) return { error: 'PUT ' + put.status };
      ids.push(t.id);
    }
    const r = await fetch('/api/news/posts', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contentHtml: '<p>Bài 2 ảnh ${stamp}</p>', audience: 'Company', targets: [], uploadIds: ids, sendEmail: false, commentsDisabled: false }) });
    return { status: r.status, body: await r.json().catch(() => null) };
  })()`) as { status?: number; body?: any; error?: string };
  ok('Bảng tin: đăng bài 2 ảnh (S3 thật)', post.status !== undefined && post.status < 300 && post.body?.media?.length === 2, post);
  if (!post.body?.id) return;
  await p.send('Page.navigate', { url: `${base}/news/${post.body.id}` });
  const grid = `document.querySelectorAll('[data-testid=media-grid] button')`;
  ok('Bảng tin: lưới 2 ảnh hiện', await waitFor(p, `${grid}.length === 2 && [...document.querySelectorAll('[data-testid=media-grid] img')].every((i) => i.complete && i.naturalWidth > 0)`, 15000));
  await p.evalJs(`window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; }`);
  const r = await rectOf(p, `${grid}[0]`);
  await mouse(p, r!.x + r!.w / 2, r!.y + r!.h / 2);
  ok('Bảng tin: bấm ảnh 1 → trình xem dùng chung, "1 / 2"', await waitFor(p, `!!${V} && document.querySelector('[data-testid=image-viewer-counter]')?.textContent === '1 / 2'`, 5000), await counter(p));
  ok('Bảng tin: ảnh vừa màn hình', await waitFor(p, `!!${IMG}?.complete && +${IMG}.dataset.fit < 1 && ${IMG}.dataset.scale === ${IMG}.dataset.fit`, 8000), await scale(p));
  if (shot) { await sleep(500); await p.shot(shot); }
  await press(p, 'ArrowRight', 'ArrowRight', 39);
  ok('Bảng tin: → "2 / 2"', await counter(p) === '2 / 2', await counter(p));
  const nb = await rectOf(p, `document.querySelector('[data-testid=image-viewer-next]')`);
  await mouse(p, nb!.x + nb!.w / 2, nb!.y + nb!.h / 2);
  ok('Bảng tin: nút "Ảnh sau" ở ảnh cuối → vòng về "1 / 2"', await waitFor(p, `document.querySelector('[data-testid=image-viewer-counter]')?.textContent === '1 / 2'`, 2000), await counter(p));
  ok('Bảng tin: "Mở tab mới" trỏ đúng ảnh đang xem', await p.evalJs(`document.querySelector('[data-testid=image-viewer-open]')?.getAttribute('href') === ${IMG}?.getAttribute('src') && document.querySelector('[data-testid=image-viewer-open]')?.target === '_blank'`));
  const db = await rectOf(p, `document.querySelector('[data-testid=image-viewer-download]')`);
  await mouse(p, db!.x + db!.w / 2, db!.y + db!.h / 2);
  ok('Bảng tin: Tải về → mở link tải (presigned mới, tải xuống)', await waitFor(p, `window.__opened.length === 1 && /^https?:/.test(window.__opened[0])`, 5000), await p.evalJs('window.__opened'));
  await press(p, 'Escape', 'Escape', 27);
  ok('Bảng tin: Esc đóng', await waitFor(p, `!${V}`, 2000));

  // Điện thoại nằm ngang 844 × 390 (cảm ứng) + theme tối: nút không đè ảnh, không cuộn ngang, nền vẫn đen / chữ trắng
  await p.send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const dark0 = await p.evalJs(`document.documentElement.classList.contains('dark')`) as boolean;
  await p.evalJs(`document.documentElement.classList.toggle('dark', ${!dark0})`);
  await sleep(400);
  const g = await rectOf(p, `${grid}[0]`);
  await p.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: g!.x + g!.w / 2, y: g!.y + Math.min(g!.h / 2, 100) }] });
  await p.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  ok('Bảng tin (điện thoại ngang): chạm ảnh → trình xem mở', await waitFor(p, `!!${V} && !!${IMG}?.complete && ${IMG}.naturalWidth > 0`, 5000));
  await sleep(500);
  const L = await p.evalJs(`(() => { const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; };
    const im = r('[data-testid=image-viewer-img]'), bar = document.querySelector('[data-testid=image-viewer-close]').parentElement.getBoundingClientRect();
    const hit = (a) => !!a && !(a.r <= im.x || a.x >= im.r || a.b <= im.y || a.y >= im.b);
    return { im, barBottom: bar.bottom, prevHit: hit(r('[data-testid=image-viewer-prev]')), nextHit: hit(r('[data-testid=image-viewer-next]')),
      scrollX: document.documentElement.scrollWidth > innerWidth, inView: im.x >= 0 && im.r <= innerWidth + 0.5 && im.b <= innerHeight + 0.5,
      color: getComputedStyle(document.querySelector('[data-testid=image-viewer-filename]')).color }; })()`) as any;
  ok('Bảng tin (điện thoại ngang): thanh trên + nút trước / sau không đè ảnh, ảnh nằm trọn, không cuộn ngang',
    L.barBottom <= L.im.y + 0.5 && !L.prevHit && !L.nextHit && !L.scrollX && L.inView, L);
  ok(`Bảng tin (theme ${dark0 ? 'sáng' : 'tối'}): chữ thanh trên vẫn trắng trên nền đen`, /^rgba?\(255, 255, 255/.test(L.color) || L.color.startsWith('oklab(1 0 0') || L.color.startsWith('color(srgb 1 1 1'), L.color);
  if (shot) await p.shot(shot.replace(/\.png$/, '-mobile.png'));
  await press(p, 'Escape', 'Escape', 27);
  await p.evalJs(`document.documentElement.classList.toggle('dark', ${dark0})`);
  await p.send('Emulation.setTouchEmulationEnabled', { enabled: false });
  await p.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
}
