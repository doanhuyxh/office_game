// E2E chat theo phòng + joystick cảm ứng (văn phòng 3D). Cần FE dev + Api + Realtime.
//   TEST_PASSWORD=… bun scripts/dev/office-chat-e2e.ts <tiền-tố-profile-chrome>
// A, B vào Phòng họp lớn; C đứng ngoài (giả lập điện thoại). Chat phòng: chỉ A, B nhận. Chat chung: cả 3. Joystick C: nhân vật di chuyển.
import { BASE, launch } from './cdp';
const PW = process.env.TEST_PASSWORD ?? (() => { throw new Error('Thiếu TEST_PASSWORD'); })();
const [prof = '/tmp/office-chat-e2e'] = process.argv.slice(2);
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, extra?: unknown) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${!cond && extra !== undefined ? ' → ' + JSON.stringify(extra) : ''}`);
};
const A = await launch(9501, `${prof}-a`), B = await launch(9502, `${prof}-b`), C = await launch(9503, `${prof}-c`, 390, 844, ['--touch-events=enabled']);
await C.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
await C.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
const all = [A, B, C];
const logOf = (b: typeof A) => b.evalJs(`[...document.querySelectorAll('[data-testid=office-chat] .log div')].map(d=>d.textContent).join('|')`);
const send = (b: typeof A, text: string) => b.evalJs(`(() => {
  const f = document.querySelector('[data-testid=office-chat]'); const i = f.querySelector('input');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i, ${JSON.stringify(text)});
  i.dispatchEvent(new Event('input',{bubbles:true})); f.requestSubmit(); return true; })()`);
try {
  check('login', (await A.login('kythuat.nhanvien1', PW)) === 200 && (await B.login('kythuat.nhanvien2', PW)) === 200 && (await C.login('kythuat.truongphong', PW)) === 200);
  for (const b of all) await b.go(`${BASE}/office`, 6000);
  for (const b of all) await b.evalJs("[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Đã hiểu'))?.click()");
  // C (điện thoại): mở chat thu gọn
  await C.evalJs("document.querySelector('.chat-toggle')?.click()");
  check('điện thoại: có joystick, chat thu gọn mặc định', await C.evalJs("!!document.querySelector('[data-testid=office-joystick]')"));
  check('máy tính: không có joystick', !(await A.evalJs("!!document.querySelector('[data-testid=office-joystick]')")));

  await A.evalJs('window.__officeScene.walkTo(25, 6.5)');
  await B.evalJs('window.__officeScene.walkTo(27, 6.5)');
  await A.sleep(9000);
  check('A, B trong phòng: có tab phòng', await A.evalJs("!!document.querySelector('[data-testid=office-chat-room-tab]')") && await B.evalJs("!!document.querySelector('[data-testid=office-chat-room-tab]')"));
  check('C ngoài phòng: không có tab phòng', !(await C.evalJs("!!document.querySelector('[data-testid=office-chat-room-tab]')")));

  await A.evalJs("document.querySelector('[data-testid=office-chat-room-tab]').click()");
  await A.sleep(300);
  await send(A, 'bí mật phòng họp');
  await A.sleep(1500);
  check('A thấy tin phòng ở tab phòng', (await logOf(A)).includes('bí mật phòng họp'));
  check('B: chấm báo tin mới ở tab phòng', await B.evalJs("!!document.querySelector('[data-testid=office-chat-room-tab] .dot-new')"));
  await B.evalJs("document.querySelector('[data-testid=office-chat-room-tab]').click()");
  await B.sleep(300);
  check('B nhận tin phòng', (await logOf(B)).includes('bí mật phòng họp'));
  check('C KHÔNG nhận tin phòng', !(await C.evalJs("JSON.stringify(window.__officeChat ?? '')")).includes('bí mật') && !(await logOf(C)).includes('bí mật'));

  await C.sleep(1100);
  await send(C, 'xin chào cả văn phòng');
  await C.sleep(1500);
  await A.evalJs("[...document.querySelectorAll('[data-testid=office-chat] .tabs button')][0].click()");
  await A.sleep(300);
  check('chat chung tới mọi người', (await logOf(A)).includes('xin chào cả văn phòng') && (await logOf(C)).includes('xin chào cả văn phòng'));
  check('tin phòng không lẫn vào tab chung', !(await logOf(A)).includes('bí mật phòng họp'));

  // Joystick trên điện thoại: kéo phải 1 giây → nhân vật di chuyển
  const before = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  const box = await C.evalJs("(() => { const r = document.querySelector('[data-testid=office-joystick]').getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()");
  await C.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x, y: box.y, id: 1 }] });
  for (let i = 1; i <= 10; i++) { await C.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + i * 6, y: box.y - i * 3, id: 1 }] }); await C.sleep(100); }
  await C.sleep(500);
  await C.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const after = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  const d = (a: string, b: string) => { const p = JSON.parse(a), q = JSON.parse(b); return Math.hypot(p.x - q.x, p.z - q.z); };
  check('joystick làm nhân vật di chuyển', d(before, after) > 0.5, { before, after });
  await C.sleep(800);
  const stopped = await C.evalJs('JSON.stringify(window.__officeScene.myPosition())');
  check('thả joystick → đứng lại', d(after, stopped) < 0.05, { after, stopped });
  for (const [n, b] of [['A', A], ['B', B], ['C', C]] as const) check(`không lỗi console ${n}`, b.errors.filter((e) => !/livekit|voice|ICE|WebSocket|getUserMedia|NotAllowed/i.test(e)).length === 0, b.errors.slice(0, 3));
} finally { for (const b of all) b.close(); }
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
