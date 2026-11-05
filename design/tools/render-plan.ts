/**
 * Vẽ sơ đồ mặt bằng (SVG) từ bản đồ v2 + kiểm tra dữ liệu. Không cần cài gói.
 *
 *   bun design/tools/render-plan.ts      # shared/office-map.json → design/floor-plan.svg + shared/office-map.grid.txt
 *
 * Kiểm tra: phòng / đồ vật trong sàn, cửa nằm trong cạnh tường và căn theo lưới, chỗ ngồi không bị đồ vật chắn, nằm đúng khu,
 * id không trùng, cửa không bị chặn, điểm xuất hiện đứng được, mọi phòng / chỗ ngồi / máy chấm công đi tới được.
 * Lưới va chạm dùng CHUNG code với engine (frontend/.../engine/navGrid.ts) và được ghi ra shared/office-map.grid.txt —
 * test server (tests/OfficeHub.Realtime.Tests) so sánh lưới C# với file này. Sửa bản đồ → chạy lại script này. Lỗi → exit 1.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NavGrid } from '../../frontend/src/features/office/engine/navGrid';
import type { OfficeMapV2 } from '../../frontend/src/features/office/engine/mapTypes';

type Rect = { x0: number; x1: number; z0: number; z1: number };
type Door = { side: 'n' | 's' | 'e' | 'w'; at: number; w: number; id?: string; name?: string };
type Room = Rect & { id: string; name: string; kind: string; zone: string; walls: boolean; glass?: boolean; capacity?: number; voice?: string; doors?: Door[] };
type Area = Rect & { id: string; name: string; dept: string };
type Seat = { id: string; dept: string; zone: string; x: number; z: number; facing: 'n' | 's' | 'e' | 'w' };
type Obj = { id: string; prefab: string; x: number; z: number; w: number; d: number; rot: number; solid: boolean; action?: string; interact?: string };
type MapV2 = { name: string; grid: number; floor: Rect; outerDoors: Door[]; spawn: { x: number; z: number }; rooms: Room[]; areas: Area[]; seats: Seat[]; objects: Obj[] };

const root = join(import.meta.dir, '..', '..');
const inPath = join(root, 'shared', 'office-map.json');
const outPath = join(root, 'design', 'floor-plan.svg');
const gridPath = join(root, 'shared', 'office-map.grid.txt');
const map: MapV2 = JSON.parse(readFileSync(inPath, 'utf8'));
const nav = new NavGrid(map as unknown as OfficeMapV2);

// ---------- kiểm tra ----------
const errors: string[] = [];
const inside = (r: Rect, x: number, z: number, pad = 0) => x >= r.x0 - pad && x <= r.x1 + pad && z >= r.z0 - pad && z <= r.z1 + pad;
const footprint = (o: Obj): Rect => {
  const [w, d] = o.rot % 180 === 0 ? [o.w, o.d] : [o.d, o.w];
  return { x0: o.x - w / 2, x1: o.x + w / 2, z0: o.z - d / 2, z1: o.z + d / 2 };
};
const sideLen = (r: Rect, side: Door['side']) => (side === 'n' || side === 's' ? r.x1 - r.x0 : r.z1 - r.z0);
const doorPoint = (r: Rect, d: Door): [number, number] => {
  const m = d.at + d.w / 2;
  return d.side === 'n' ? [r.x0 + m, r.z0] : d.side === 's' ? [r.x0 + m, r.z1] : d.side === 'w' ? [r.x0, r.z0 + m] : [r.x1, r.z0 + m];
};
const ids = new Set<string>();
for (const id of [...map.rooms.map((r) => r.id), ...map.areas.map((a) => a.id), ...map.seats.map((s) => s.id), ...map.objects.map((o) => o.id)]) {
  if (ids.has(id)) errors.push(`id trùng: ${id}`);
  ids.add(id);
}
const zoneRects = new Map<string, Rect[]>();
for (const z of [...map.rooms.map((r) => ({ id: r.zone, r })), ...map.areas.map((a) => ({ id: a.id, r: a as Rect }))])
  zoneRects.set(z.id, [...(zoneRects.get(z.id) ?? []), z.r]);
for (const r of map.rooms) {
  if (!inside(map.floor, r.x0, r.z0) || !inside(map.floor, r.x1, r.z1)) errors.push(`phòng ${r.id} ra ngoài sàn`);
  for (const d of r.doors ?? []) if (d.at < 0 || d.at + d.w > sideLen(r, d.side)) errors.push(`cửa phòng ${r.id} (${d.side}) nằm ngoài cạnh tường`);
}
for (const d of map.outerDoors) if (d.at < 0 || d.at + d.w > sideLen(map.floor, d.side)) errors.push(`cửa ngoài ${d.id} nằm ngoài tường`);
const solids = map.objects.filter((o) => o.solid);
for (const o of map.objects) {
  const f = footprint(o);
  if (!inside(map.floor, f.x0, f.z0, 0.01) || !inside(map.floor, f.x1, f.z1, 0.01)) errors.push(`đồ vật ${o.id} ra ngoài sàn`);
}
for (const s of map.seats) {
  const blocker = solids.find((o) => inside(footprint(o), s.x, s.z, -0.05));
  if (blocker) errors.push(`chỗ ngồi ${s.id} bị ${blocker.id} chắn`);
  if (!(zoneRects.get(s.zone) ?? []).some((r) => inside(r, s.x, s.z))) errors.push(`chỗ ngồi ${s.id} không nằm trong zone ${s.zone}`);
}
for (const r of map.rooms.filter((r) => r.walls))
  for (const d of r.doors ?? []) {
    const [x, z] = doorPoint(r, d);
    const blocker = solids.find((o) => inside(footprint(o), x, z, 0.3));
    if (blocker) errors.push(`cửa phòng ${r.id} bị ${blocker.id} chặn`);
  }

const aligned = (v: number) => Math.abs(v / map.grid - Math.round(v / map.grid)) < 1e-6;
for (const r of map.rooms) for (const d of r.doors ?? []) if (!aligned(d.at) || !aligned(d.w) || d.w < 2 * map.grid) errors.push(`cửa phòng ${r.id} phải căn theo lưới ${map.grid} m và rộng ≥ ${2 * map.grid} m`);
for (const d of map.outerDoors) if (!aligned(d.at) || !aligned(d.w)) errors.push(`cửa ngoài ${d.id} phải căn theo lưới`);
if (!nav.walkable(map.spawn.x, map.spawn.z)) errors.push('điểm xuất hiện (spawn) bị chặn');
const reach = nav.reachableFrom(map.spawn.x, map.spawn.z);
const reachableNear = (x: number, z: number, dist: number) => {
  for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++) {
    if (!reach[j * nav.cols + i]) continue;
    const [cx, cz] = nav.center(i, j);
    if (Math.hypot(cx - x, cz - z) <= dist) return true;
  }
  return false;
};
for (const s of map.seats) if (!reachableNear(s.x, s.z, 1.2)) errors.push(`chỗ ngồi ${s.id} không đi tới được (không có ô trống trong 1,2 m)`);
for (const o of map.objects.filter((o) => o.action || o.interact)) if (!reachableNear(o.x, o.z, 1.8)) errors.push(`${o.id} (${o.action ?? o.interact}) không đi tới được`);
for (const r of map.rooms) {
  let ok = false;
  for (let j = 0; j < nav.rows && !ok; j++) for (let i = 0; i < nav.cols && !ok; i++) {
    const [cx, cz] = nav.center(i, j);
    ok = !!reach[j * nav.cols + i] && cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1;
  }
  if (!ok) errors.push(`phòng ${r.id} không vào được từ cửa chính`);
}
writeFileSync(gridPath, nav.toText());

// ---------- vẽ ----------
const S = 40; // px / m
const M = 56; // lề trái / phải
const MT = 84; // lề trên (tiêu đề)
const W = Math.max((map.floor.x1 - map.floor.x0) * S + M * 2, 1080);
const H = (map.floor.z1 - map.floor.z0) * S + MT + M + 130;
const X = (x: number) => +(M + (x - map.floor.x0) * S).toFixed(1);
const Z = (z: number) => +(MT + (z - map.floor.z0) * S).toFixed(1);
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const FILL: Record<string, string> = {
  office: '#eef2ff', meeting: '#ecfeff', booth: '#f0f9ff', open: '#f8fafc', lounge: '#f0fdf4', lobby: '#fff7ed', pantry: '#fefce8',
};
const DEPT: Record<string, string> = { BGD: '#7c3aed', HCNS: '#db2777', KT: '#0891b2', KD: '#ea580c', KTH: '#2563eb', LT: '#16a34a' };
const out: string[] = [];
out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Inter, Arial, sans-serif">`);
out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
out.push(`<text x="${M}" y="30" font-size="18" font-weight="700" fill="#0f172a">${esc(map.name)}</text>`);
out.push(`<text x="${M}" y="48" font-size="12" fill="#64748b">${map.floor.x1 - map.floor.x0} × ${map.floor.z1 - map.floor.z0} m · lưới ${map.grid} m · ${map.seats.length} chỗ ngồi · bắc ở trên</text>`);

// sàn + lưới
out.push(`<rect x="${X(map.floor.x0)}" y="${Z(map.floor.z0)}" width="${(map.floor.x1 - map.floor.x0) * S}" height="${(map.floor.z1 - map.floor.z0) * S}" fill="#f8fafc"/>`);
for (const r of map.rooms) out.push(`<rect x="${X(r.x0)}" y="${Z(r.z0)}" width="${(r.x1 - r.x0) * S}" height="${(r.z1 - r.z0) * S}" fill="${FILL[r.kind] ?? '#fff'}"/>`);
for (let x = map.floor.x0; x <= map.floor.x1 + 1e-9; x += map.grid)
  out.push(`<line x1="${X(x)}" y1="${Z(map.floor.z0)}" x2="${X(x)}" y2="${Z(map.floor.z1)}" stroke="#e2e8f0" stroke-width="${Number.isInteger(x) ? 0.8 : 0.3}"/>`);
for (let z = map.floor.z0; z <= map.floor.z1 + 1e-9; z += map.grid)
  out.push(`<line x1="${X(map.floor.x0)}" y1="${Z(z)}" x2="${X(map.floor.x1)}" y2="${Z(z)}" stroke="#e2e8f0" stroke-width="${Number.isInteger(z) ? 0.8 : 0.3}"/>`);
for (let x = map.floor.x0; x <= map.floor.x1; x += 2) out.push(`<text x="${X(x)}" y="${Z(map.floor.z0) - 6}" font-size="9" fill="#94a3b8" text-anchor="middle">${x}</text>`);
for (let z = map.floor.z0; z <= map.floor.z1; z += 2) out.push(`<text x="${X(map.floor.x0) - 8}" y="${Z(z) + 3}" font-size="9" fill="#94a3b8" text-anchor="end">${z}</text>`);

// ô bị chặn (lưới va chạm)
for (let j = 0; j < nav.rows; j++) for (let i = 0; i < nav.cols; i++)
  if (!nav.freeCell(i, j)) out.push(`<rect x="${X(map.floor.x0 + i * map.grid)}" y="${Z(map.floor.z0 + j * map.grid)}" width="${map.grid * S}" height="${map.grid * S}" fill="#ef4444" fill-opacity="0.07"/>`);

// khu phòng ban trong khu mở
for (const a of map.areas) {
  out.push(`<rect x="${X(a.x0)}" y="${Z(a.z0)}" width="${(a.x1 - a.x0) * S}" height="${(a.z1 - a.z0) * S}" fill="${DEPT[a.dept]}" fill-opacity="0.06" stroke="${DEPT[a.dept]}" stroke-dasharray="5 4" rx="6"/>`);
  out.push(`<text x="${X(a.x0) + 6}" y="${Z(a.z1) - 6}" font-size="11" font-weight="600" fill="${DEPT[a.dept]}">${esc(a.name)}</text>`);
}

// tường: vẽ từng cạnh, chừa khoảng cửa
const wallSegs = (r: Rect, doors: Door[]) => {
  const segs: [number, number, number, number][] = [];
  for (const side of ['n', 's', 'w', 'e'] as const) {
    const len = sideLen(r, side);
    const gaps = doors.filter((d) => d.side === side).map((d) => [d.at, d.at + d.w]).sort((a, b) => a[0] - b[0]);
    let t = 0;
    for (const [a, b] of [...gaps, [len, len]]) {
      if (a > t) {
        const p = (u: number): [number, number] => side === 'n' ? [r.x0 + u, r.z0] : side === 's' ? [r.x0 + u, r.z1] : side === 'w' ? [r.x0, r.z0 + u] : [r.x1, r.z0 + u];
        const [x1, z1] = p(t), [x2, z2] = p(a);
        segs.push([x1, z1, x2, z2]);
      }
      t = b;
    }
  }
  return segs;
};
const door = (r: Rect, d: Door, color: string) => {
  const [x, z] = doorPoint(r, d);
  const half = (d.w / 2) * S;
  const horiz = d.side === 'n' || d.side === 's';
  out.push(horiz
    ? `<line x1="${X(x) - half}" y1="${Z(z)}" x2="${X(x) + half}" y2="${Z(z)}" stroke="${color}" stroke-width="2" stroke-dasharray="3 3"/>`
    : `<line x1="${X(x)}" y1="${Z(z) - half}" x2="${X(x)}" y2="${Z(z) + half}" stroke="${color}" stroke-width="2" stroke-dasharray="3 3"/>`);
};
for (const r of map.rooms.filter((r) => r.walls)) {
  for (const [x1, z1, x2, z2] of wallSegs(r, r.doors ?? []))
    out.push(`<line x1="${X(x1)}" y1="${Z(z1)}" x2="${X(x2)}" y2="${Z(z2)}" stroke="${r.glass ? '#38bdf8' : '#334155'}" stroke-width="${r.glass ? 4 : 6}" stroke-linecap="square"/>`);
  for (const d of r.doors ?? []) door(r, d, '#f59e0b');
}
for (const [x1, z1, x2, z2] of wallSegs(map.floor, map.outerDoors))
  out.push(`<line x1="${X(x1)}" y1="${Z(z1)}" x2="${X(x2)}" y2="${Z(z2)}" stroke="#0f172a" stroke-width="9" stroke-linecap="square"/>`);
for (const d of map.outerDoors) {
  door(map.floor, d, '#16a34a');
  const [x, z] = doorPoint(map.floor, d);
  out.push(`<text x="${X(x)}" y="${Z(z) + 22}" font-size="11" font-weight="600" fill="#16a34a" text-anchor="middle">▲ ${esc(d.name ?? 'Cửa')}</text>`);
}

// đồ vật
for (const o of map.objects) {
  const f = footprint(o);
  const special = o.action ? '#16a34a' : o.interact ? '#a855f7' : null;
  const fill = special ?? (o.solid ? '#cbd5e1' : '#e2e8f0');
  out.push(`<rect x="${X(f.x0)}" y="${Z(f.z0)}" width="${(f.x1 - f.x0) * S}" height="${(f.z1 - f.z0) * S}" fill="${fill}" fill-opacity="${special ? 0.85 : 1}" stroke="${o.solid ? '#64748b' : '#94a3b8'}" stroke-width="${o.solid ? 1 : 0.6}" rx="${o.prefab.includes('chair') || o.prefab.includes('beanbag') ? 6 : 2}"/>`);
  if (o.action) out.push(`<text x="${X(o.x)}" y="${Z(o.z) - 12}" font-size="10" font-weight="700" fill="#16a34a" text-anchor="middle">Máy chấm công</text>`);
}

// chỗ ngồi
const arrow: Record<Seat['facing'], [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };
for (const s of map.seats) {
  const [dx, dz] = arrow[s.facing];
  out.push(`<circle cx="${X(s.x)}" cy="${Z(s.z)}" r="9" fill="${DEPT[s.dept]}" fill-opacity="0.9"/>`);
  out.push(`<line x1="${X(s.x)}" y1="${Z(s.z)}" x2="${X(s.x) + dx * 13}" y2="${Z(s.z) + dz * 13}" stroke="${DEPT[s.dept]}" stroke-width="2"/>`);
  out.push(`<text x="${X(s.x)}" y="${Z(s.z) + 3}" font-size="7" font-weight="700" fill="#fff" text-anchor="middle">${s.id.split('-')[1]}</text>`);
}

// tên phòng
for (const r of map.rooms) {
  const cx = (r.x0 + r.x1) / 2;
  const label = r.kind === 'open' ? null : `${r.name}${r.capacity ? ` · ${r.capacity} người` : ''}`;
  if (!label) continue;
  const y = r.kind === 'booth' ? Z(r.z0) + 14 : ['lounge', 'lobby', 'pantry'].includes(r.kind) ? Z(r.z0) + 16 : Z(r.z1) - 10;
  out.push(`<text x="${X(cx)}" y="${y}" font-size="${r.kind === 'booth' ? 10 : 12}" font-weight="700" fill="#0f172a" text-anchor="middle">${esc(label)}${r.voice ? ' 🎙' : ''}</text>`);
}
out.push(`<text x="${X(10.5)}" y="${Z(5.5) + 16}" font-size="12" font-weight="700" fill="#0f172a" text-anchor="middle">Khu làm việc chung</text>`);

// điểm xuất hiện
out.push(`<circle cx="${X(map.spawn.x)}" cy="${Z(map.spawn.z)}" r="6" fill="none" stroke="#16a34a" stroke-width="2"/><text x="${X(map.spawn.x) + 10}" y="${Z(map.spawn.z) + 4}" font-size="10" fill="#16a34a">vào đây</text>`);

// chú thích
let ly = Z(map.floor.z1) + 46;
const legend = (x: number, svg: string, label: string) => out.push(`<g transform="translate(${x},${ly})">${svg}<text x="22" y="4" font-size="11" fill="#334155">${esc(label)}</text></g>`);
legend(M, `<line x1="0" y1="0" x2="16" y2="0" stroke="#334155" stroke-width="6"/>`, 'Tường');
legend(M + 90, `<line x1="0" y1="0" x2="16" y2="0" stroke="#38bdf8" stroke-width="4"/>`, 'Vách kính');
legend(M + 190, `<line x1="0" y1="0" x2="16" y2="0" stroke="#f59e0b" stroke-width="2" stroke-dasharray="3 3"/>`, 'Cửa');
legend(M + 260, `<rect x="0" y="-6" width="16" height="12" fill="#cbd5e1" stroke="#64748b"/>`, 'Đồ vật (cản đường)');
legend(M + 400, `<rect x="0" y="-6" width="16" height="12" fill="#e2e8f0" stroke="#94a3b8" rx="4"/>`, 'Ghế / đồ đi xuyên được');
legend(M + 570, `<rect x="0" y="-6" width="16" height="12" fill="#a855f7" fill-opacity="0.85"/>`, 'Tương tác (màn hình, cà phê…)');
legend(M + 770, `<text x="0" y="5" font-size="13">🎙</text>`, 'Phòng voice riêng');
legend(M + 900, `<rect x="0" y="-6" width="12" height="12" fill="#ef4444" fill-opacity="0.15"/>`, 'Ô không đi được');
ly += 26;
let lx = M;
for (const [dept, color] of Object.entries(DEPT)) {
  const n = map.seats.filter((s) => s.dept === dept).length;
  legend(lx, `<circle cx="8" cy="0" r="8" fill="${color}"/>`, `${dept} · ${n} chỗ`);
  lx += 110;
}
legend(lx + 10, `<line x1="0" y1="0" x2="16" y2="0" stroke="#0f172a" stroke-width="2"/><polygon points="16,-4 22,0 16,4" fill="#0f172a"/>`, 'Hướng ngồi');
ly += 26;
out.push(`<text x="${M}" y="${ly}" font-size="10" fill="#94a3b8">Sinh tự động từ shared/office-map.json bằng design/tools/render-plan.ts — đừng sửa tay file SVG.</text>`);
out.push('</svg>');

writeFileSync(outPath, out.join('\n'));
console.log(`✔ ${outPath} (${map.rooms.length} phòng, ${map.seats.length} chỗ ngồi, ${map.objects.length} đồ vật)`);
console.log(`✔ ${gridPath} (${nav.cols}×${nav.rows} ô)`);
if (errors.length) {
  console.error(`✖ ${errors.length} lỗi dữ liệu:\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log('✔ Dữ liệu hợp lệ');
