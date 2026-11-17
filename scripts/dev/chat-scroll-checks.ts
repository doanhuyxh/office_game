// Kiểm tra khung tin tự cuộn khi nội dung cao lên sau khi vẽ (TEST-148) — gọi từ chat-ui-e2e.ts (/chat) và office-chat-full-e2e.ts (khung chat 3D).
// Ảnh trả chậm bằng CDP `Fetch` (giống page.route của Playwright): mọi request loại Image bị giữ `ms` rồi mới cho đi; tắt cache để mở lại vẫn tải chậm.
type Page = { send: (m: string, p?: any) => Promise<any>; on: (m: string, fn: (p: any) => void) => void; evalJs: (e: string) => Promise<any> };
type Ok = (name: string, cond: boolean, extra?: unknown) => void;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (p: Page, expr: string, ms = 15000) => { for (let t = 0; t < ms; t += 200) { if (await p.evalJs(expr)) return true; await sleep(200); } return false; };

/** Bật ảnh trả chậm `ms` cho trang `p` (gọi một lần / trang; giữ qua các lần điều hướng). Trả về hàm tắt. */
export async function slowImages(p: Page, ms = 2000) {
  let on = true;
  p.on('Fetch.requestPaused', (e) => {
    const go = () => void p.send('Fetch.continueRequest', { requestId: e.requestId });
    if (on) setTimeout(go, ms); else go();
  });
  await p.send('Network.enable');
  await p.send('Network.setCacheDisabled', { cacheDisabled: true });
  await p.send('Fetch.enable', { patterns: [{ urlPattern: '*', resourceType: 'Image', requestStage: 'Request' }] });
  return async () => { on = false; await p.send('Fetch.disable'); await p.send('Network.setCacheDisabled', { cacheDisabled: false }); };
}

/** Gửi `n` tin chữ vào hội thoại `conv` qua Api, xen kẽ các trang (giới hạn 1 tin / giây / tài khoản) — để khung tin đủ dài và có trang tin cũ. */
export async function fillMessages(pages: Page[], conv: string, n: number, prefix: string) {
  const gap = Math.ceil(1150 / pages.length);
  for (let i = 0; i < n; i++) {
    const p = pages[i % pages.length];
    const r = await p.evalJs(`fetch(${JSON.stringify(`/api/chat/conversations/${encodeURIComponent(conv)}/messages`)}, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: ${JSON.stringify(`${prefix} ${i + 1}`)} }) }).then((r) => r.status)`) as number;
    if (r >= 300) throw new Error(`Gửi tin đệm ${i + 1} lỗi ${r}`);
    await sleep(gap);
  }
}

/**
 * `rx` đang mở hội thoại (trong `scope`) đã có nhiều tin (khung cuộn được), ảnh của `rx` đã bật `slowImages`.
 * `sendImage(seed)` = người kia gửi một ảnh mới; `reopen()` = `rx` tải lại trang / mở lại đúng hội thoại đó.
 */
export async function checkSlowImageScroll(rx: Page, ok: Ok, { scope, label, sendImage, reopen }: {
  scope: string; label: string; sendImage: (seed: number) => Promise<void>; reopen: () => Promise<void>;
}) {
  const box = `${scope}.querySelector('[data-testid=chat-messages]')`;
  const gap = () => rx.evalJs(`(() => { const b = ${box}; return b ? Math.round(b.scrollHeight - b.scrollTop - b.clientHeight) : -1; })()`) as Promise<number>;
  const count = () => rx.evalJs(`${scope}.querySelectorAll('[data-testid=chat-images] img').length`) as Promise<number>;
  const lastLoaded = `(() => { const im = [...${scope}.querySelectorAll('[data-testid=chat-images] img')].at(-1); return !!im && im.complete && im.naturalWidth > 0; })()`;

  ok(`${label}: khung tin đủ dài để cuộn`, await waitFor(rx, `(() => { const b = ${box}; return !!b && b.scrollHeight > b.clientHeight + 400; })()`),
    await rx.evalJs(`(() => { const b = ${box}, m = [...${scope}.querySelectorAll('[data-testid=chat-message]')];
      return b && { h: [b.scrollHeight, b.clientHeight], title: ${scope}.querySelector('[data-testid=chat-title]')?.textContent, n: m.length, first: m[0]?.textContent, last: m.at(-1)?.textContent }; })()`));
  await rx.evalJs(`(() => { const b = ${box}; b.scrollTop = b.scrollHeight; return true; })()`);
  await sleep(400);

  // 1. Đang ở cuối, người kia gửi ảnh (tải chậm 2 giây) → ảnh tải xong vẫn ở cuối
  let n = await count();
  await sendImage(1);
  ok(`${label}: nhận tin ảnh mới`, await waitFor(rx, `${scope}.querySelectorAll('[data-testid=chat-images] img').length > ${n}`), await count());
  const early = await rx.evalJs(lastLoaded) as boolean;
  ok(`${label}: ảnh thật sự tải chậm (lúc tin hiện, ảnh chưa tải xong)`, !early);
  ok(`${label}: ảnh tải xong`, await waitFor(rx, lastLoaded));
  await sleep(500);
  const g1 = await gap();
  ok(`${label}: đang ở cuối + tin ảnh tải chậm → sau khi ảnh tải xong vẫn ở cuối (≤ 2 px)`, g1 >= 0 && g1 <= 2, g1);

  // 2. Mở lại hội thoại có ảnh ở cuối → ở cuối sau khi ảnh tải
  await reopen();
  ok(`${label}: mở lại hội thoại → ảnh cuối tải xong`, await waitFor(rx, lastLoaded, 20000));
  await sleep(500);
  const g2 = await gap();
  ok(`${label}: mở lại hội thoại có ảnh ở cuối → ở cuối sau khi ảnh tải (≤ 2 px)`, g2 >= 0 && g2 <= 2, g2);

  // 3. Đang cuộn lên đọc tin cũ, người kia gửi ảnh → vị trí cuộn không đổi
  await rx.evalJs(`(() => { const b = ${box}; b.scrollTop = b.scrollHeight - b.clientHeight - 500; return true; })()`);
  await sleep(500);
  const top0 = await rx.evalJs(`${box}.scrollTop`) as number;
  n = await count();
  await sendImage(2);
  await waitFor(rx, `${scope}.querySelectorAll('[data-testid=chat-images] img').length > ${n}`);
  ok(`${label}: (đang đọc tin cũ) ảnh mới tải xong`, await waitFor(rx, lastLoaded));
  await sleep(500);
  const top1 = await rx.evalJs(`${box}.scrollTop`) as number, g3 = await gap();
  ok(`${label}: đang cuộn lên đọc tin cũ + ảnh mới tới → vị trí cuộn KHÔNG đổi`, Math.abs(top1 - top0) <= 1 && g3 > 120, { top0, top1, g3 });
}

/** Hội thoại đang mở có > 50 tin (còn trang tin cũ): cuộn lên đầu → tải tin cũ → tin đang nhìn giữ nguyên chỗ (cả khi ảnh trong trang cũ tải chậm). */
export async function checkLoadOlderKeepsPosition(rx: Page, ok: Ok, { scope, label }: { scope: string; label: string }) {
  const box = `${scope}.querySelector('[data-testid=chat-messages]')`;
  const msgCount = () => rx.evalJs(`${scope}.querySelectorAll('[data-testid=chat-message]').length`) as Promise<number>;
  const before = await msgCount();
  // Cùng một tác vụ JS: cuộn sát đầu (sự kiện scroll → tải tin cũ chạy sau) rồi đánh dấu tin đầu tiên đang nhìn thấy + vị trí của nó
  const top0 = await rx.evalJs(`(() => { const b = ${box}; b.scrollTop = 30; const bt = b.getBoundingClientRect().top;
    const m = [...b.querySelectorAll('[data-testid=chat-message]')].find((e) => e.getBoundingClientRect().top >= bt);
    if (!m) return null; m.dataset.e2eAnchor = '1'; return m.getBoundingClientRect().top - bt; })()`) as number | null;
  ok(`${label}: tải tin cũ khi cuộn lên đầu`, top0 !== null && await waitFor(rx, `${scope}.querySelectorAll('[data-testid=chat-message]').length > ${before}`), { top0, before, after: await msgCount() });
  await sleep(3000); // ảnh trong trang cũ (nếu có) tải chậm 2 giây
  const top1 = await rx.evalJs(`(() => { const b = ${box}, m = b.querySelector('[data-e2e-anchor]'); return m ? m.getBoundingClientRect().top - b.getBoundingClientRect().top : null; })()`) as number | null;
  ok(`${label}: tải tin cũ → tin đang đọc giữ nguyên vị trí (≤ 2 px)`, top0 !== null && top1 !== null && Math.abs(top1 - top0) <= 2, { top0, top1 });
}
