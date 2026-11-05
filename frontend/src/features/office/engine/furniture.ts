import * as THREE from 'three';
import { P } from './palette';

/** Một khối của đồ vật, toạ độ theo tâm đồ vật (chưa xoay). `glow` = vật liệu tự phát sáng (màn hình máy chấm công). */
export interface Part { geo: THREE.BufferGeometry; color: number; glow?: boolean }

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: number, glow = false): Part =>
  ({ geo: new THREE.BoxGeometry(w, h, d).translate(x, y, z), color, glow });
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, color: number, seg = 8): Part =>
  ({ geo: new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), color });
const ball = (r: number, x: number, y: number, z: number, color: number, sy = 1): Part =>
  ({ geo: new THREE.IcosahedronGeometry(r, 0).scale(1, sy, 1).translate(x, y, z), color });

/** Mặt bàn + 4 chân. */
function table(w: number, d: number, h: number, top: number, legs = P.metal): Part[] {
  const ix = w / 2 - 0.06, iz = d / 2 - 0.06;
  return [
    box(w, 0.04, d, 0, h - 0.02, 0, top),
    ...[[-ix, -iz], [ix, -iz], [-ix, iz], [ix, iz]].map(([x, z]) => cyl(0.025, 0.025, h - 0.04, x, (h - 0.04) / 2, z, legs, 6)),
  ];
}

/** Ghế: lưng ghế về phía -z (người ngồi nhìn về +z). Xoay bằng `rot` của nơi gọi. */
export function chair(color = P.dark): Part[] {
  return [
    box(0.46, 0.07, 0.44, 0, 0.46, 0, color),
    box(0.46, 0.46, 0.06, 0, 0.76, -0.2, color),
    cyl(0.03, 0.03, 0.42, 0, 0.21, 0, P.metal, 6),
    cyl(0.22, 0.22, 0.03, 0, 0.02, 0, P.metal, 10),
  ];
}

function sofa(w: number, d: number, color: number): Part[] {
  return [
    box(w, 0.42, d, 0, 0.21, 0, color),
    box(w, 0.42, 0.2, 0, 0.62, -d / 2 + 0.1, color),
    box(0.18, 0.25, d, -w / 2 + 0.09, 0.55, 0, color),
    box(0.18, 0.25, d, w / 2 - 0.09, 0.55, 0, color),
  ];
}

function plant(scale: number): Part[] {
  return [
    cyl(0.17 * scale, 0.13 * scale, 0.36 * scale, 0, 0.18 * scale, 0, P.pot, 8),
    ball(0.32 * scale, 0, 0.62 * scale, 0, P.leaf),
    ball(0.22 * scale, 0.12 * scale, 0.9 * scale, 0.05 * scale, P.leafDark),
  ];
}

/** Dựng đồ vật theo `prefab` với kích thước w (trục x) × d (trục z). Prefab lạ → hộp xám (không chặn tiến độ khi thêm loại mới). */
export function buildPrefab(prefab: string, w: number, d: number): Part[] {
  switch (prefab) {
    case 'desk': return table(w, d, 0.74, P.wood);
    case 'deskLarge': return [...table(w, d, 0.76, P.woodDark, P.dark), box(w - 0.1, 0.4, 0.03, 0, 0.45, d / 2 - 0.08, P.woodDark)];
    case 'computerScreen': return [box(0.52, 0.32, 0.03, 0, 0.98, 0.12, P.dark), box(0.48, 0.28, 0.005, 0, 0.98, 0.104, 0x3b82f6, true), cyl(0.02, 0.02, 0.16, 0, 0.82, 0.14, P.metal, 6), box(0.18, 0.015, 0.12, 0, 0.765, 0.14, P.metal)];
    case 'chair': return chair();
    case 'tableMeeting': return table(w, d, 0.74, P.woodDark, P.dark);
    case 'tableSmall': return table(w, d, 0.74, P.wood);
    case 'tableDining': return table(w, d, 0.74, P.white, P.metal);
    case 'tableCoffee': return table(w, d, 0.42, P.woodDark, P.dark);
    case 'tableGame': return [...table(w, d, 0.78, P.felt, P.woodDark), box(w + 0.06, 0.06, d + 0.06, 0, 0.75, 0, P.woodDark)];
    case 'loungeSofa': return sofa(w, d, P.fabric);
    case 'loungeSofaCorner': return [...sofa(w, 0.9, P.fabricTeal).map((p) => ({ ...p, geo: p.geo.translate(0, 0, -d / 2 + 0.45) })), ...sofa(0.9, d - 0.9, P.fabricTeal).map((p) => ({ ...p, geo: p.geo.rotateY(Math.PI / 2).translate(-w / 2 + 0.45, 0, 0.45) }))];
    case 'beanbag': return [ball(0.4, 0, 0.26, 0, P.orange, 0.65)];
    case 'bookcaseOpen': {
      // Dựng theo chiều dài L dọc trục x, sách nhìn ra +z; tủ đặt dọc (d > w) thì xoay 90°.
      const L = Math.max(w, d), D = Math.min(w, d);
      const colors = [0xef4444, 0x3b82f6, 0xeab308, 0x22c55e, 0xa855f7];
      const parts: Part[] = [box(L, 1.8, D, 0, 0.9, 0, P.woodDark)];
      for (let s = 0; s < 4; s++) for (let k = 0; k < 5; k++)
        parts.push(box(L * 0.14, 0.28, 0.06, (k - 2) * L * 0.18, 0.25 + s * 0.42, D / 2 + 0.01, colors[(s + k) % colors.length]));
      return d > w ? parts.map((p) => ({ ...p, geo: p.geo.rotateY(Math.PI / 2) })) : parts;
    }
    case 'cabinetFiles': return [box(w, 1.2, d, 0, 0.6, 0, P.metalLight), ...[0.3, 0.6, 0.9].map((y) => box(w * 0.9, 0.02, 0.01, 0, y, d / 2 + 0.005, P.metal))];
    case 'safe': return [box(w, 0.8, d, 0, 0.4, 0, P.dark), cyl(0.06, 0.06, 0.03, 0, 0.45, d / 2, P.metalLight, 10)];
    case 'pottedPlant': return plant(1);
    case 'pottedPlantLarge': return plant(1.7);
    case 'televisionWall': return [box(w, 0.75, Math.max(d, 0.05), 0, 1.45, 0, P.dark), box(w * 0.94, 0.66, 0.01, 0, 1.45, Math.max(d, 0.05) / 2, 0x0f172a, true)];
    case 'whiteboard': return [box(w, 1.0, d, 0, 1.3, 0, P.white), box(w + 0.04, 0.04, d + 0.02, 0, 0.8, 0, P.metal)];
    case 'noticeBoard': return [box(w, 0.9, d, 0, 1.4, 0, P.cork)];
    case 'printer': return [box(w, 0.45, d, 0, 0.62, 0, P.white), box(w * 0.9, 0.4, d * 0.9, 0, 0.2, 0, P.metal), box(w * 0.6, 0.02, 0.18, 0, 0.86, 0, P.dark)];
    case 'lockers': return [box(w, 1.9, d, 0, 0.95, 0, 0x60a5fa), ...[-0.6, 0, 0.6].map((z) => box(0.01, 1.8, 0.02, w / 2, 0.95, z * (d / 1.8), P.brand))];
    case 'deskReception': return [box(w, 1.05, d, 0, 0.525, 0, P.white), box(w + 0.06, 0.05, d + 0.1, 0, 1.07, 0, P.woodDark), box(w * 0.98, 0.12, 0.01, 0, 0.75, d / 2 + 0.005, P.brand)];
    case 'timeclock': return [box(w, 1.25, d, 0, 0.625, 0, P.dark), box(w * 0.75, 0.22, 0.01, 0, 1.1, d / 2 + 0.006, 0x22c55e, true), box(w * 0.5, 0.06, 0.01, 0, 0.8, d / 2 + 0.006, 0x86efac, true)];
    case 'logoWall': return [box(w, 1.5, 0.08, 0, 0.75, 0, P.brand)];
    case 'kitchenCounter': return [box(w, 0.88, d, 0, 0.44, 0, P.white), box(w, 0.04, d + 0.02, 0, 0.9, 0, P.dark)];
    case 'kitchenFridge': return [box(w, 1.85, d, 0, 0.925, 0, P.metalLight), box(0.03, 0.5, 0.04, w / 2 - 0.1, 1.3, d / 2 + 0.02, P.dark)];
    case 'coffeeMachine': return [box(0.32, 0.4, 0.3, 0, 1.12, 0, P.dark), box(0.12, 0.08, 0.1, 0, 1.0, 0.14, 0x78350f)];
    case 'waterDispenser': return [box(0.34, 0.95, 0.34, 0, 0.475, 0, P.white), cyl(0.14, 0.14, 0.4, 0, 1.15, 0, 0x7dd3fc, 10)];
    default: return [box(w, 0.8, d, 0, 0.4, 0, P.metalLight)];
  }
}
