// E2E văn phòng 3D: 2 trình duyệt, tài khoản thử kythuat.nhanvien1 + kythuat.truongphong. Cần FE (dev) + Api + Realtime đang chạy.
//   TEST_PASSWORD=… bun scripts/dev/office-e2e.ts <thư-mục-ảnh> <tiền-tố-profile-chrome>
import { launch } from './cdp';
const PW = process.env.TEST_PASSWORD ?? (() => { throw new Error('Đặt TEST_PASSWORD (mật khẩu chung trong account.txt)'); })();
const [shots = '/tmp/office-shots', prof = '/tmp/office-e2e-profile'] = process.argv.slice(2);
let pass = 0, total = 0;
const check = (n: string, ok: boolean, d?: unknown) => { total++; if (ok) pass++; console.log(ok ? 'PASS' : 'FAIL', n, ok ? '' : JSON.stringify(d)); };
const A = await launch(9401, `${prof}-a`), B = await launch(9402, `${prof}-b`, 1100, 700);
const snap = (p: typeof A) => p.evalJs('window.__officeScene?.snapshot()');
const waitFor = async (p: typeof A, expr: string, ms = 15000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evalJs(expr)) return true; await p.sleep(250); } return false; };
try {
  check('login A', (await A.login('kythuat.nhanvien1', PW)) === 200);
  check('login B', (await B.login('kythuat.truongphong', PW)) === 200);
  await A.evalJs(`localStorage.setItem('officehub:theme','light')`);
  await A.go('http://localhost:5173/office', 1000); await B.go('http://localhost:5173/office', 1000);
  check('A scene ready + online', await waitFor(A, `!!window.__officeScene?.snapshot().me && document.body.innerText.includes('người online')`));
  check('B scene ready', await waitFor(B, `!!window.__officeScene?.snapshot().me`));
  check('A sees B (by name)', await waitFor(A, `window.__officeScene.snapshot().others.some(o=>o.name==='Ngô Thanh Tùng')`));
  await A.sleep(1500);
  await A.shot(`${shots}/50-office-spawn.png`);

  // 1) Tìm đường vào phòng Giám đốc (phải đi qua cửa x 4–5, z 5.5); (2.5, 2.75) là ô trống giữa phòng
  await A.evalJs(`window.__officeScene.walkTo(2.75, 2.75)`);
  check('pathfinding into director room', await waitFor(A, `(()=>{const m=window.__officeScene.snapshot().me;return Math.hypot(m.x-2.75,m.z-2.75)<0.2 && !window.__officeScene.snapshot().target})()`, 12000), await snap(A));
  // 2) Va chạm: giữ S 1.5s trong phòng → không xuyên tường nam (z < 5.5)
  await A.key('s', 1500);
  let me = (await snap(A)).me;
  check('wall blocks walking (stay inside room)', me.z < 5.45 && me.x < 6, me);
  // 3) Ra khỏi phòng, tới khu Kỹ thuật, bấm "đi tới ghế rồi ngồi"
  await A.evalJs(`(()=>{const sc=window.__officeScene;const seat=${JSON.stringify({ id: 'KTH-02', dept: 'KTH', zone: 'dept-kth', x: 3.5, z: 6.75, facing: 's' })};sc.walkTo(3.5,6.6,seat)})()`);
  check('walk to seat and sit', await waitFor(A, `document.body.innerText.includes('Đang ngồi ở bàn KTH-02')`, 15000), await snap(A));
  check('zone label = Kỹ thuật', await A.evalJs(`[...document.querySelectorAll('.zone')].some(e=>e.textContent.includes('Kỹ thuật'))`));
  check('B sees A sitting', await waitFor(B, `window.__officeScene.snapshot().others.some(o=>o.anim===2 && Math.hypot(o.x-3.5,o.z-6.75)<0.3)`, 5000), await snap(B));
  await A.sleep(800);
  await A.shot(`${shots}/51-office-sitting.png`);
  // 4) B tới ngồi đúng ghế đó → bị từ chối
  await B.evalJs(`window.__officeScene.walkTo(3.5, 6.3)`);
  await waitFor(B, `(()=>{const m=window.__officeScene.snapshot().me;return Math.hypot(m.x-3.5,m.z-6.3)<0.3})()`, 15000);
  const bSat = await B.evalJs(`window.__officeScene.toggleSit()`);
  const bText = await B.evalJs(`document.body.innerText`);
  check('B cannot take occupied seat (sits elsewhere or nothing)', !bText.includes('Đang ngồi ở bàn KTH-02'), { bSat });
  // 5) A đứng dậy bằng phím E
  await A.key('e', 80);
  check('stand up with E', await waitFor(A, `document.body.innerText.includes('Bàn KTH-02') && !document.body.innerText.includes('Đang ngồi')`, 4000));
  // 6) Xoay camera + minimap
  await A.key('r', 80); await A.sleep(1200);
  await A.shot(`${shots}/52-office-rotated.png`);
  check('minimap present', await A.evalJs(`!!document.querySelector('[data-testid=office-minimap]')`));
  // 7) Server không teleport A về (mọi vị trí hợp lệ) — vị trí B thấy khớp vị trí A
  await A.sleep(1000);
  me = (await snap(A)).me;
  const seen = (await snap(B)).others.find((o: any) => o.name === 'Đỗ Hải Nam');
  check('B sees A at same position (server accepted moves)', Math.hypot(seen.x - me.x, seen.z - me.z) < 0.3, { me, seen });
  check('no console errors A', A.errors.length === 0, A.errors.slice(0, 3));
  check('no console errors B', B.errors.length === 0, B.errors.slice(0, 3));
} finally {
  A.close(); B.close();
}
console.log(`\n${pass}/${total} passed`);
