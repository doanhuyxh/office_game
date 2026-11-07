/**
 * NGUỒN SINH mặt bằng 68 × 30 m (2 040 m²): lõi 50 × 30 duyệt 2026-11-06 (design/office-1500m2-proposal.md) + cánh đông
 * "Nội dung số" x 50–68 (Studio, phòng quay, livestream, thu âm — cùng ngày). Tên file giữ "1500" cho khỏi đổi tài liệu. shared/office-map.json là bản sao của
 * kết quả script này (đổi $schema, name, notes) → sửa mặt bằng = sửa file này, KHÔNG sửa tay JSON. Quy trình đầy đủ: design/README.md.
 *
 *   bun design/tools/gen-map-1500.ts                      # → design/drafts/office-map-1500.json (bản nháp để xem trước)
 *   bun design/tools/render-plan.ts design/drafts/office-map-1500.json design/drafts/floor-plan-1500.svg
 *   # duyệt xong: chép sang shared/office-map.json, rồi `bun design/tools/render-plan.ts` (SVG chính + lưới) và khởi động lại Realtime.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

type Facing = 'n' | 's' | 'e' | 'w';
type Obj = { id: string; prefab: string; x: number; z: number; w: number; d: number; rot: number; solid: boolean; action?: string; interact?: string };
type Seat = { id: string; dept: string; zone: string; x: number; z: number; facing: Facing };

const r2 = (n: number) => Math.round(n * 100) / 100;
const objects: Obj[] = [];
const seats: Seat[] = [];
const obj = (id: string, prefab: string, x: number, z: number, w: number, d: number, extra: Partial<Obj> = {}) =>
  objects.push({ id, prefab, x: r2(x), z: r2(z), w, d, rot: 0, solid: true, ...extra });

/** Cụm 6 bàn (3 đối diện 3, như bản 24 × 16): tâm (cx, cz); bàn ở cz ± 0,35; ghế ở cz ± 1,0. */
function cluster(dept: string, zone: string, cx: number, cz: number, from: number, large = false) {
  let n = from;
  for (const [dz, facing] of [[-0.35, 's'], [0.35, 'n']] as [number, Facing][])
    for (const dx of [-1.6, 0, 1.6]) {
      const id = `${dept}-${String(n++).padStart(2, '0')}`;
      const x = cx + dx, zDesk = cz + dz, zSeat = cz + (facing === 's' ? -1.0 : 1.0);
      obj(`desk-${id}`, large ? 'deskLarge' : 'desk', x, zDesk, 1.4, 0.7);
      obj(`pc-${id}`, 'computerScreen', x, zDesk, 0.5, 0.2, { solid: false });
      seats.push({ id, dept, zone, x: r2(x), z: r2(zSeat), facing });
    }
  return n;
}
/** Cụm 6 bàn xoay 90°: bàn xếp dọc theo z, ghế hai bên quay mặt vào nhau (đông / tây). Dài 4,8 m × rộng 2,5 m. */
function clusterRot(dept: string, zone: string, cx: number, cz: number, from: number) {
  let n = from;
  for (const [dx, facing] of [[-0.35, 'e'], [0.35, 'w']] as [number, Facing][])
    for (const dz of [-1.6, 0, 1.6]) {
      const id = `${dept}-${String(n++).padStart(2, '0')}`;
      const xDesk = cx + dx, z = cz + dz, xSeat = cx + (facing === 'e' ? -1.0 : 1.0);
      obj(`desk-${id}`, 'desk', xDesk, z, 1.4, 0.7, { rot: 90 });
      obj(`pc-${id}`, 'computerScreen', xDesk, z, 0.5, 0.2, { rot: 90, solid: false });
      seats.push({ id, dept, zone, x: r2(xSeat), z: r2(z), facing });
    }
  return n;
}
/** Bàn họp w × d tại (cx, cz) + ghế quanh: `along` ghế mỗi cạnh dài, `ends` ghế 2 đầu. */
function meetingTable(id: string, cx: number, cz: number, w: number, d: number, along: number, ends: boolean) {
  obj(`${id}-table`, 'tableMeeting', cx, cz, w, d);
  const step = w / along;
  for (let i = 0; i < along; i++) {
    const x = cx - w / 2 + step * (i + 0.5);
    obj(`${id}-chair-${i}-s`, 'chair', x, cz - d / 2 - 0.5, 0.5, 0.5, { solid: false });
    obj(`${id}-chair-${i}-n`, 'chair', x, cz + d / 2 + 0.5, 0.5, 0.5, { solid: false });
  }
  if (ends) {
    obj(`${id}-chair-w`, 'chair', cx - w / 2 - 0.5, cz, 0.5, 0.5, { solid: false });
    obj(`${id}-chair-e`, 'chair', cx + w / 2 + 0.5, cz, 0.5, 0.5, { solid: false });
  }
}
function diningTable(id: string, cx: number, cz: number) {
  obj(`${id}`, 'tableDining', cx, cz, 2.4, 1.1);
  for (const dx of [-0.8, 0, 0.8]) for (const dz of [-0.8, 0.8]) obj(`${id}-chair-${r2(cx + dx)}-${r2(cz + dz)}`, 'chair', cx + dx, cz + dz, 0.5, 0.5, { solid: false });
}

// ---------- phòng ----------
const rooms = [
  { id: 'bgd', name: 'Phòng Giám đốc', kind: 'office', zone: 'dept-bgd', x0: 0, x1: 10, z0: 0, z1: 8, walls: true, doors: [{ side: 's', at: 8.5, w: 1.0 }] },
  { id: 'meeting-hall', name: 'Hội trường', kind: 'meeting', zone: 'meeting', x0: 10, x1: 22, z0: 0, z1: 8, walls: true, glass: true, capacity: 20, voice: 'room', doors: [{ side: 's', at: 0.5, w: 1.5 }, { side: 's', at: 10.0, w: 1.5 }] },
  { id: 'meeting-large', name: 'Phòng họp lớn', kind: 'meeting', zone: 'meeting', x0: 22, x1: 30, z0: 0, z1: 8, walls: true, glass: true, capacity: 10, voice: 'room', doors: [{ side: 's', at: 0.5, w: 1.0 }] },
  { id: 'meeting-small', name: 'Phòng họp nhỏ', kind: 'meeting', zone: 'meeting', x0: 30, x1: 35, z0: 0, z1: 8, walls: true, glass: true, capacity: 6, voice: 'room', doors: [{ side: 's', at: 0.5, w: 1.0 }] },
  { id: 'kt', name: 'Phòng Kế toán', kind: 'office', zone: 'dept-kt', x0: 35, x1: 43, z0: 0, z1: 8, walls: true, doors: [{ side: 's', at: 6.5, w: 1.0 }] },
  { id: 'focus', name: 'Phòng yên tĩnh', kind: 'office', zone: 'quiet', x0: 43, x1: 50, z0: 0, z1: 8, walls: true, doors: [{ side: 's', at: 1.0, w: 1.0 }] },
  ...[1, 2, 3, 4].map((i) => ({ id: `booth-${i}`, name: `Phòng gọi ${i}`, kind: 'booth', zone: 'booth', x0: 46, x1: 50, z0: 8 + (i - 1) * 3.5, z1: 8 + i * 3.5, walls: true, glass: true, capacity: 2, voice: 'room', doors: [{ side: 'w', at: 1.0, w: 1.0 }] })),
  { id: 'open', name: 'Khu làm việc chung', kind: 'open', zone: 'work', x0: 0, x1: 46, z0: 8, z1: 22, walls: false },
  { id: 'lounge', name: 'Khu nghỉ', kind: 'lounge', zone: 'lounge', x0: 0, x1: 17, z0: 22, z1: 30, walls: false },
  { id: 'lobby', name: 'Sảnh & Lễ tân', kind: 'lobby', zone: 'reception', x0: 17, x1: 33, z0: 22, z1: 30, walls: false },
  { id: 'pantry', name: 'Pantry', kind: 'pantry', zone: 'pantry', x0: 33, x1: 50, z0: 22, z1: 30, walls: false },
  // ---------- cánh đông "Nội dung số" x 50–68 (chủ dự án chốt 2026-11-06: mở rộng sàn, không nhét vào khu cũ) ----------
  // Vào từ Pantry (mép đông pantry không có tường). Studio = phòng làm việc của đội (kênh voice riêng, nghe theo khoảng cách);
  // phòng quay / livestream / thu âm = kind 'studio' + voice 'room' (cả phòng nghe rõ, chia sẻ màn hình), KHÔNG đặt lịch qua Meetings.
  { id: 'studio', name: 'Studio Nội dung', kind: 'office', zone: 'dept-studio', x0: 50, x1: 59, z0: 0, z1: 12, walls: true, doors: [{ side: 's', at: 6.5, w: 1.5 }] },
  { id: 'film-main', name: 'Phòng quay', kind: 'studio', zone: 'studio-film', x0: 59, x1: 68, z0: 0, z1: 12, walls: true, capacity: 8, voice: 'room', doors: [{ side: 's', at: 1.0, w: 1.5 }] },
  { id: 'studio-prep', name: 'Khu chuẩn bị Studio', kind: 'lounge', zone: 'studio-prep', x0: 50, x1: 62, z0: 12, z1: 30, walls: false },
  ...([['live-1', 'Livestream 1'], ['live-2', 'Livestream 2'], ['recording', 'Phòng thu âm']] as const).map(([id, name], i) => ({
    id, name, kind: 'studio', zone: 'studio-film', x0: 62, x1: 68, z0: 12 + i * 6, z1: 18 + i * 6, walls: true, capacity: id === 'recording' ? 4 : 3, voice: 'room',
    doors: [{ side: 'w', at: 3.5, w: 1.5 }],
  })),
];

// ---------- khu mở (chủ dự án chốt 2026-11-06): Kinh doanh sát tường tây, Công nghệ xoay dọc kế bên, rồi 5 cột cụm thường + 1 cụm dọc sát phòng gọi ----------
// Khoảng hở vật lý giữa các cụm (mép ghế / bàn) = 1,5 m. Cụm thường rộng 4,6 m (bàn ±2,3), cụm dọc rộng 2,5 m (ghế ±1,25), dài 4,8 m.
const KD_X = 2.8;                                  // cụm thường: bàn 0,5–5,1
const KTH_X = 7.85;                                // cụm dọc: 6,6–9,1
const COLS = [12.9, 19.0, 25.1, 31.2, 37.3];       // cụm thường: 10,6–15,2 … 35,0–39,6
const MR_ROT_X = 42.35;                            // cụm dọc: 41,1–43,6 (cách tường phòng gọi 2,4 m)
const GAPS = [5.85, 9.85, 15.95, 22.05, 28.15, 34.25, 40.35]; // tâm lối đi giữa các cụm
const ROW_A = 11.25, ROW_B = 16.25, ROW_MID = (ROW_A + ROW_B) / 2; // tâm cụm (bàn ở ±0,35, ghế ở ±1,0)
const areas = [
  { id: 'dept-kd', name: 'Kinh doanh', dept: 'KD', x0: 0.2, x1: KD_X + 2.9, z0: ROW_A - 1.75, z1: ROW_B + 1.75 },
  { id: 'dept-kth', name: 'Công nghệ', dept: 'KTH', x0: KTH_X - 1.5, x1: KTH_X + 1.5, z0: ROW_MID - 2.75, z1: ROW_MID + 2.75 },
  { id: 'dept-hcns', name: 'Hành chính – Nhân sự', dept: 'HCNS', x0: COLS[4] - 3.0, x1: COLS[4] + 3.0, z0: ROW_B - 1.75, z1: ROW_B + 1.75 },
];
let n = cluster('KD', 'dept-kd', KD_X, ROW_A, 1); cluster('KD', 'dept-kd', KD_X, ROW_B, n);
clusterRot('KTH', 'dept-kth', KTH_X, ROW_MID, 1);
cluster('HCNS', 'dept-hcns', COLS[4], ROW_B, 1);
n = 1;
for (const cx of COLS) for (const cz of [ROW_A, ROW_B]) if (!(cx === COLS[4] && cz === ROW_B)) n = cluster('MR', 'work', cx, cz, n);
clusterRot('MR', 'work', MR_ROT_X, ROW_MID, n);

// đồ chung khu mở: bảng trắng Kinh doanh (tường tây) + Công nghệ (lối đi), cây hành lang bắc
obj('kd-board', 'whiteboard', 0.1, 13.75, 0.1, 1.8);
obj('kth-board', 'whiteboard', GAPS[1], 13.75, 0.1, 1.8);
[0.5, GAPS[0], GAPS[2], GAPS[4], GAPS[5]].forEach((x, i) => obj(`plant-open-${i + 1}`, 'pottedPlant', x, 8.75, 0.5, 0.5)); // tránh trước cửa phòng

// ---------- dải nam khu mở (z 20–22, chủ dự án chốt 2026-11-06); lối đi chính z 17,5–20 để trống ----------
// 1. Góc cà phê phụ (x 1–5)
obj('west-counter', 'kitchenCounter', 3.0, 21.65, 2.4, 0.6);
obj('west-coffee', 'coffeeMachine', 2.4, 21.65, 0.4, 0.4, { solid: false, interact: 'coffee' });
obj('west-water', 'waterDispenser', 3.6, 21.65, 0.4, 0.4);
obj('west-stool-1', 'chair', 2.4, 20.8, 0.5, 0.5, { solid: false });
obj('west-stool-2', 'chair', 3.6, 20.8, 0.5, 0.5, { solid: false });
obj('strip-plant-1', 'pottedPlant', 0.5, 21.6, 0.5, 0.5);
// 2. Bàn trao đổi nhanh 1 (x 6–11) + bảng trắng di động
meetingTable('huddle-1', 8.5, 21.0, 1.8, 1.0, 2, false);
obj('huddle-1-board', 'whiteboard', 10.6, 21.0, 0.1, 1.8);
// 3. Góc in ấn tây (x 12–16)
obj('lockers-1', 'lockers', 12.9, 21.6, 2.4, 0.5);
obj('printer-west', 'printer', 14.6, 21.6, 0.7, 0.6, { interact: 'printer' });
obj('west-cabinet', 'cabinetFiles', 15.6, 21.65, 0.9, 0.5, { interact: 'documents' });
// 4. Màn hình thông báo + ghế băng (x 17–21)
obj('open-notices', 'televisionWall', 19.0, 21.85, 2.0, 0.1, { interact: 'notices' });
obj('notices-bench', 'loungeSofa', 19.0, 20.6, 2.2, 0.9);
obj('strip-plant-2', 'pottedPlantLarge', 17.3, 21.6, 0.6, 0.6);
obj('strip-plant-3', 'pottedPlantLarge', 20.7, 21.6, 0.6, 0.6);
// 5. Trục vào sảnh (x 22–28): chỉ cây hai bên
obj('strip-plant-4', 'pottedPlantLarge', 22.3, 21.6, 0.6, 0.6);
obj('strip-plant-5', 'pottedPlantLarge', 27.7, 21.6, 0.6, 0.6);
// 6. Bàn trao đổi nhanh 2 (x 29–33)
meetingTable('huddle-2', 30.5, 21.0, 1.8, 1.0, 2, false);
obj('huddle-2-board', 'whiteboard', 32.6, 21.0, 0.1, 1.8);
// 7. Thư viện mini (x 34–39)
obj('library-shelf-1', 'bookcaseOpen', 35.0, 21.75, 2.4, 0.4, { interact: 'library' });
obj('library-shelf-2', 'bookcaseOpen', 38.0, 21.75, 2.4, 0.4, { interact: 'library' });
obj('library-beanbag-1', 'beanbag', 35.6, 20.7, 0.8, 0.8, { solid: false });
obj('library-beanbag-2', 'beanbag', 37.4, 20.7, 0.8, 0.8, { solid: false });
// 8. Góc HCNS (x 40–45): tủ đồ, hồ sơ, máy in, bàn tiếp ứng viên; ô trước cửa phòng gọi 4 (x 45,5–46, z 19,5–20,5) để trống
obj('lockers-2', 'lockers', 41.0, 21.6, 2.4, 0.5);
obj('hcns-cabinet-1', 'cabinetFiles', 42.9, 21.65, 0.9, 0.5, { interact: 'documents' });
obj('hcns-cabinet-2', 'cabinetFiles', 43.9, 21.65, 0.9, 0.5, { interact: 'documents' });
obj('printer', 'printer', 44.8, 21.0, 0.7, 0.6, { interact: 'printer' });
obj('hcns-guest-table', 'tableSmall', 43.2, 20.45, 1.0, 0.6);
obj('hcns-guest-chair-1', 'chair', 42.4, 20.45, 0.5, 0.5, { solid: false });
obj('hcns-guest-chair-2', 'chair', 44.0, 20.45, 0.5, 0.5, { solid: false });

// ---------- Giám đốc ----------
for (const [i, x] of [2.5, 6.5].entries()) {
  const id = `BGD-${String(i + 1).padStart(2, '0')}`;
  obj(`desk-${id}`, 'deskLarge', x, 1.6, 1.8, 0.8);
  obj(`pc-${id}`, 'computerScreen', x, 1.6, 0.5, 0.2, { solid: false });
  seats.push({ id, dept: 'BGD', zone: 'dept-bgd', x, z: 0.95, facing: 's' });
}
obj('bgd-sofa', 'loungeSofa', 1.6, 6.9, 2.2, 0.9);
obj('bgd-table', 'tableCoffee', 1.6, 5.9, 1.2, 0.6);
meetingTable('bgd-meet', 6.5, 5.6, 1.8, 1.0, 2, false);
obj('bgd-shelf', 'bookcaseOpen', 9.6, 3.2, 0.4, 1.6);
obj('bgd-plant', 'pottedPlant', 0.5, 7.5, 0.5, 0.5);

// ---------- Hội trường 20 ----------
meetingTable('hall-a', 13.5, 4.0, 4.2, 1.4, 4, true);
meetingTable('hall-b', 18.5, 4.0, 4.2, 1.4, 4, true);
obj('hall-screen', 'televisionWall', 16, 0.15, 3.0, 0.1, { interact: 'screen' });
obj('hall-board', 'whiteboard', 21.85, 4.0, 0.1, 2.0);
// ---------- Họp lớn 10 ----------
meetingTable('ml', 26, 4.0, 4.2, 1.4, 4, true);
obj('ml-screen', 'televisionWall', 26, 0.15, 2.0, 0.1, { interact: 'screen' });
obj('ml-board', 'whiteboard', 29.85, 4.0, 0.1, 1.8);
// ---------- Họp nhỏ 6 ----------
meetingTable('ms', 32.5, 4.0, 2.4, 1.1, 3, false);
obj('ms-screen', 'televisionWall', 32.5, 0.15, 1.4, 0.1, { interact: 'screen' });

// ---------- Kế toán 6 ----------
cluster('KT', 'dept-kt', 38.5, 3.05, 1);
[35.6, 36.6, 37.6].forEach((x, i) => obj(`kt-cabinet-${i + 1}`, 'cabinetFiles', x, 0.35, 0.9, 0.5, { interact: 'documents' }));
obj('kt-cabinet-4', 'cabinetFiles', 42.65, 3.0, 0.5, 0.9, { interact: 'documents' });
obj('kt-cabinet-5', 'cabinetFiles', 42.65, 4.0, 0.5, 0.9, { interact: 'documents' });
obj('kt-safe', 'safe', 42.5, 0.4, 0.6, 0.6);
// ---------- Phòng yên tĩnh 6 ----------
cluster('YT', 'quiet', 46.5, 4.05, 1);
obj('focus-shelf', 'bookcaseOpen', 46.5, 0.25, 2.4, 0.4);
obj('focus-plant', 'pottedPlant', 49.5, 7.5, 0.5, 0.5);
// ---------- Phòng gọi ----------
for (let i = 1; i <= 4; i++) {
  const zc = 8 + (i - 1) * 3.5 + 1.75;
  obj(`booth-${i}-table`, 'tableSmall', 48.0, zc, 0.6, 1.0); // 2 ghế đối diện qua bàn
  obj(`booth-${i}-chair-w`, 'chair', 47.1, zc, 0.5, 0.5, { solid: false });
  obj(`booth-${i}-chair-e`, 'chair', 48.9, zc, 0.5, 0.5, { solid: false });
}

// ---------- Khu nghỉ ----------
obj('lounge-sofa-1', 'loungeSofaCorner', 1.4, 23.4, 2.4, 1.6);
obj('lounge-table-1', 'tableCoffee', 2.2, 24.9, 1.2, 0.7);
obj('lounge-sofa-2', 'loungeSofa', 2.2, 26.3, 2.2, 0.9);
obj('lounge-shelf', 'bookcaseOpen', 0.25, 28.3, 0.4, 1.8);
obj('lounge-sofa-3', 'loungeSofa', 7.0, 24.2, 2.2, 0.9);
obj('lounge-table-2', 'tableCoffee', 7.0, 25.3, 1.2, 0.7);
obj('lounge-sofa-4', 'loungeSofa', 7.0, 26.4, 2.2, 0.9);
obj('lounge-tv', 'televisionWall', 7.0, 29.85, 2.2, 0.1, { interact: 'screen' });
[[10.5, 25.0], [11.7, 25.6], [10.8, 27.2], [12.2, 27.4]].forEach(([x, z], i) => obj(`lounge-beanbag-${i + 1}`, 'beanbag', x, z, 0.8, 0.8, { solid: false }));
obj('lounge-game-1', 'tableGame', 14.8, 24.5, 1.4, 0.9, { interact: 'game' });
obj('lounge-game-2', 'tableGame', 14.8, 27.8, 1.4, 0.9, { interact: 'game' });
obj('lounge-plant-1', 'pottedPlantLarge', 16.5, 22.6, 0.6, 0.6);
obj('lounge-plant-2', 'pottedPlantLarge', 4.5, 29.5, 0.6, 0.6);

// ---------- Sảnh ----------
obj('reception-desk', 'deskReception', 25, 23.7, 4, 0.8);
seats.push({ id: 'LT-01', dept: 'LT', zone: 'reception', x: 24.2, z: 23.05, facing: 's' }, { id: 'LT-02', dept: 'LT', zone: 'reception', x: 25.8, z: 23.05, facing: 's' });
obj('lobby-logo', 'logoWall', 25, 22.15, 3, 0.1, { solid: false });
obj('timeclock-1', 'timeclock', 22.0, 27.5, 0.5, 0.4, { action: 'attendance.checkin' });
obj('timeclock-2', 'timeclock', 28.0, 27.5, 0.5, 0.4, { action: 'attendance.checkin' });
obj('lobby-sofa-1', 'loungeSofa', 18.4, 25.5, 0.9, 2.0, { rot: 90 });
obj('lobby-sofa-2', 'loungeSofa', 31.6, 27.0, 0.9, 2.0, { rot: 90 });
obj('noticeboard', 'noticeBoard', 32.85, 24.0, 0.1, 1.4, { interact: 'notices' });
obj('lobby-plant-1', 'pottedPlantLarge', 20.0, 29.4, 0.6, 0.6);
obj('lobby-plant-2', 'pottedPlantLarge', 30.0, 29.4, 0.6, 0.6);

// ---------- Pantry ----------
obj('pantry-counter', 'kitchenCounter', 42.5, 29.6, 10, 0.6);
obj('pantry-coffee-1', 'coffeeMachine', 39.0, 29.6, 0.4, 0.4, { solid: false, interact: 'coffee' });
obj('pantry-coffee-2', 'coffeeMachine', 40.5, 29.6, 0.4, 0.4, { solid: false, interact: 'coffee' });
obj('pantry-water', 'waterDispenser', 36.0, 29.6, 0.4, 0.4);
obj('pantry-fridge-1', 'kitchenFridge', 49.6, 26.4, 0.7, 0.7);
obj('pantry-fridge-2', 'kitchenFridge', 49.6, 27.4, 0.7, 0.7);
diningTable('pantry-table-1', 36.5, 24.6);
diningTable('pantry-table-2', 41.5, 24.6);
diningTable('pantry-table-3', 46.5, 24.6);
obj('pantry-plant', 'pottedPlantLarge', 49.5, 22.6, 0.6, 0.6);

// ---------- Studio Nội dung (x 50–59, z 0–12): 12 chỗ (2 cụm) + 2 bàn dựng + góc duyệt clip ----------
n = cluster('ND', 'dept-studio', 52.9, 2.4, 1);
n = cluster('ND', 'dept-studio', 52.9, 7.6, n);
for (const z of [6.6, 9.2]) {
  const id = `ND-${String(n++).padStart(2, '0')}`; // bàn dựng (màn lớn)
  obj(`desk-${id}`, 'deskLarge', 57.6, z, 1.8, 0.8);
  obj(`pc-${id}`, 'computerScreen', 57.6, z, 0.5, 0.2, { solid: false });
  seats.push({ id, dept: 'ND', zone: 'dept-studio', x: 57.6, z: r2(z - 0.65), facing: 's' });
}
obj('studio-review-tv', 'televisionWall', 57.5, 0.15, 2.0, 0.1, { interact: 'screen' });
obj('studio-review-table', 'tableCoffee', 57.5, 2.0, 1.2, 0.6);
obj('studio-review-sofa', 'loungeSofa', 57.5, 3.1, 2.2, 0.9, { rot: 180 });
obj('studio-board', 'whiteboard', 50.15, 5.0, 0.1, 1.8);
obj('studio-plant-1', 'pottedPlant', 50.5, 11.5, 0.5, 0.5);
obj('studio-plant-2', 'pottedPlant', 58.5, 11.5, 0.5, 0.5);

// ---------- Phòng quay (x 59–68, z 0–12): phông xanh, bộ sofa talkshow, 2 máy quay, đèn, bàn đạo diễn ----------
obj('film-backdrop', 'greenScreen', 63.5, 0.3, 6.0, 0.2);
obj('film-sofa', 'loungeSofa', 63.5, 2.3, 2.2, 0.9);
obj('film-table', 'tableCoffee', 63.5, 3.4, 1.2, 0.6);
obj('film-light-1', 'studioLight', 60.3, 2.5, 0.5, 0.5);
obj('film-light-2', 'studioLight', 66.7, 2.5, 0.5, 0.5);
obj('film-camera-1', 'cameraTripod', 62.3, 6.8, 0.6, 0.6);
obj('film-camera-2', 'cameraTripod', 64.7, 6.8, 0.6, 0.6);
obj('film-director', 'tableSmall', 64.5, 9.6, 1.8, 0.7);
obj('film-monitor-1', 'computerScreen', 63.9, 9.6, 0.5, 0.2, { solid: false });
obj('film-monitor-2', 'computerScreen', 65.1, 9.6, 0.5, 0.2, { solid: false });
obj('film-chair-1', 'chair', 63.9, 10.35, 0.5, 0.5, { solid: false });
obj('film-chair-2', 'chair', 65.1, 10.35, 0.5, 0.5, { solid: false });
obj('film-props', 'bookcaseOpen', 67.75, 9.0, 0.4, 1.8);

// ---------- Livestream 1, 2 + Phòng thu âm (x 62–68, mỗi phòng 6 × 6 m, cửa phía tây) ----------
for (const [i, id] of ['live-1', 'live-2'].entries()) {
  const z0 = 12 + i * 6, zc = z0 + 2.2;
  obj(`${id}-backdrop`, 'greenScreen', 67.8, zc, 0.2, 3.0);
  obj(`${id}-desk`, 'tableSmall', 65.8, zc, 0.7, 1.4);
  obj(`${id}-chair`, 'chair', 66.6, zc, 0.5, 0.5, { solid: false });
  obj(`${id}-camera`, 'cameraTripod', 64.3, zc, 0.5, 0.5);
  obj(`${id}-light`, 'studioLight', 64.3, zc - 1.4, 0.5, 0.5);
  obj(`${id}-shelf`, 'bookcaseOpen', 65.0, z0 + 0.3, 2.0, 0.4); // kệ sản phẩm affiliate
}
meetingTable('rec', 65.5, 26.5, 1.6, 0.9, 2, false);
obj('rec-light', 'studioLight', 67.5, 24.6, 0.5, 0.5);
obj('rec-plant', 'pottedPlant', 67.5, 29.5, 0.5, 0.5);

// ---------- Khu chuẩn bị Studio (x 50–62, z 12–30; mở, nối Pantry ở x = 50) ----------
obj('prep-props', 'bookcaseOpen', 52.4, 12.3, 2.4, 0.4);
obj('prep-makeup', 'tableSmall', 50.6, 15.0, 0.8, 2.6);
obj('prep-makeup-chair-1', 'chair', 51.4, 14.3, 0.5, 0.5, { solid: false });
obj('prep-makeup-chair-2', 'chair', 51.4, 15.7, 0.5, 0.5, { solid: false });
obj('prep-wardrobe', 'lockers', 50.4, 19.0, 0.6, 2.4);
meetingTable('prep-plan', 56.0, 17.5, 2.4, 1.1, 3, true); // họp kịch bản
obj('prep-board', 'whiteboard', 58.6, 17.5, 0.1, 1.8);
obj('prep-schedule', 'noticeBoard', 61.85, 14.0, 0.1, 1.4, { interact: 'notices' }); // lịch quay
obj('prep-sofa', 'loungeSofa', 55.0, 26.5, 2.2, 0.9);
obj('prep-table', 'tableCoffee', 55.0, 25.4, 1.2, 0.6);
obj('prep-beanbag-1', 'beanbag', 58.0, 25.0, 0.8, 0.8, { solid: false });
obj('prep-beanbag-2', 'beanbag', 59.2, 25.8, 0.8, 0.8, { solid: false });
obj('prep-plant-1', 'pottedPlantLarge', 61.5, 12.5, 0.6, 0.6);
obj('prep-plant-2', 'pottedPlantLarge', 61.5, 29.5, 0.6, 0.6);
obj('prep-plant-3', 'pottedPlantLarge', 52.0, 29.5, 0.6, 0.6);

const map = {
  $schema: '../../shared/schemas/office-map.schema.json',
  version: 2,
  name: 'Văn phòng OfficeHub (68 × 30 m)',
  notes: 'Sinh bởi design/tools/gen-map-1500.ts: lõi 50 × 30 m (design/office-1500m2-proposal.md) + cánh đông Nội dung số x 50–68 (Studio, phòng quay, livestream, thu âm). Đơn vị mét, gốc (0,0) góc tây-bắc, x sang đông, z xuống nam.',
  unit: 'm',
  grid: 0.5,
  floor: { x0: 0, x1: 68, z0: 0, z1: 30 },
  wallHeight: 3,
  outerDoors: [{ id: 'entrance', side: 's', at: 24, w: 2.0, name: 'Cửa chính' }],
  spawn: { x: 25, z: 29 },
  rooms, areas, seats, objects,
};
const out = join(import.meta.dir, '..', 'drafts', 'office-map-1500.json');
writeFileSync(out, JSON.stringify(map, null, 2) + '\n');
console.log(`✔ ${out}: ${rooms.length} phòng, ${areas.length} khu, ${seats.length} chỗ, ${objects.length} đồ vật`);
