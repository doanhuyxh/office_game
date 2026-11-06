// Sinh icon PNG cho PWA từ frontend/public/favicon.svg bằng Chrome headless (không cần ImageMagick).
//   bun scripts/dev/make-icons.ts   → frontend/public/icons/{icon-192,icon-512,maskable-512,apple-touch-icon}.png
import { launch } from './cdp';
const root = new URL('../../frontend/public/', import.meta.url).pathname;
const svg = await Bun.file(root + 'favicon.svg').text();
const targets = [
  { file: 'icon-192.png', size: 192, pad: 0, bg: 'transparent' },
  { file: 'icon-512.png', size: 512, pad: 0, bg: 'transparent' },
  // maskable: nội dung trong vùng an toàn 80% + nền đặc (Android cắt tròn / bo góc tuỳ máy)
  { file: 'maskable-512.png', size: 512, pad: 0.12, bg: '#2563eb' },
  { file: 'apple-touch-icon.png', size: 180, pad: 0, bg: '#2563eb' },
];
for (const t of targets) {
  const b = await launch(9471, `/tmp/officehub-icons-${t.size}`, t.size, t.size);
  try {
    const html = `<html><body style="margin:0;background:${t.bg};width:${t.size}px;height:${t.size}px;display:grid;place-items:center">
      <div style="width:${t.size * (1 - 2 * t.pad)}px;height:${t.size * (1 - 2 * t.pad)}px">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div></body></html>`;
    await b.go('data:text/html;base64,' + Buffer.from(html).toString('base64'), 500);
    if (t.bg === 'transparent') await b.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
    const r = await b.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: t.size, height: t.size, scale: 1 } });
    await Bun.write(root + 'icons/' + t.file, Buffer.from(r.result.data, 'base64'));
    console.log('✔', t.file);
  } finally { b.close(); }
}
