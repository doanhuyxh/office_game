import type { MapObject, OfficeMapV2 } from './mapTypes';
import { FACING_ANGLE } from './officeMap';

/**
 * Chỗ ngồi được: bàn làm việc (`seats[]`) + đồ ngồi trong `objects[]` (ghế phòng họp / phòng gọi / pantry, ghế lười, sofa).
 * ⚠ Danh sách prefab khớp `OfficeMap.Sittable` ở server (backend/src/OfficeHub.Realtime/Simulation/OfficeMap.cs): server cho đứng
 * trong footprint của các đồ này (sofa là vật cản nên ô của nó bị chặn trong lưới).
 */
export const SITTABLE_PREFABS = ['chair', 'beanbag', 'loungeSofa', 'loungeSofaCorner'] as const;

export interface SitSpot {
  /** id ghế: `KTH-02` (bàn làm việc) hoặc `<id đồ vật>#<chỗ>` */
  id: string;
  x: number;
  z: number;
  /** góc quay quanh trục Y khi ngồi (model nhìn về +z) */
  angle: number;
  /** "bàn KTH-02", "ghế · Phòng gọi 1", "sofa · Khu nghỉ" */
  label: string;
}

/** Hướng ghế rời: quay mặt về bàn / quầy gần nhất (≤ 2,5 m). Dùng chung cho vẽ ghế (world.ts) và tư thế ngồi. */
export function chairAngle(o: MapObject, all: MapObject[]) {
  let best: MapObject | null = null, bd = 2.5;
  for (const t of all) {
    if (t === o || !/^(table|desk|kitchenCounter)/.test(t.prefab)) continue;
    const dist = Math.hypot(t.x - o.x, t.z - o.z);
    if (dist < bd) { bd = dist; best = t; }
  }
  return best ? Math.atan2(best.x - o.x, best.z - o.z) : 0;
}

/**
 * Màn hình / bàn làm việc: giữ trục của `rot` trên bản đồ nhưng lật 180° nếu cần để mặt trước hướng về chỗ ngồi gần nhất (≤ 1,3 m).
 * Bản đồ đặt mọi màn hình rot 0 → dãy bàn quay mặt bắc từng thấy lưng màn hình. `frontZ`: mặt trước ở +z (1) hay −z (−1) khi chưa xoay.
 */
export function faceSeatAngle(o: MapObject, seats: OfficeMapV2['seats'], frontZ: 1 | -1) {
  const rot = (o.rot * Math.PI) / 180;
  let best: { x: number; z: number } | null = null, bd = 1.3;
  for (const s of seats) { const d = Math.hypot(s.x - o.x, s.z - o.z); if (d < bd) { bd = d; best = s; } }
  if (!best) return rot;
  const dot = frontZ * (Math.sin(rot) * (best.x - o.x) + Math.cos(rot) * (best.z - o.z));
  return dot < 0 ? rot + Math.PI : rot;
}

/** Điểm (lx, lz) trong hệ toạ độ đồ vật (chưa xoay) → toạ độ bản đồ, xoay `rot` quanh Y như THREE.rotateY. */
const local = (o: MapObject, lx: number, lz: number, rot: number) =>
  ({ x: o.x + lx * Math.cos(rot) + lz * Math.sin(rot), z: o.z - lx * Math.sin(rot) + lz * Math.cos(rot) });

export function buildSitSpots(map: OfficeMapV2): SitSpot[] {
  const roomName = (x: number, z: number) => {
    const inR = (r: { x0: number; x1: number; z0: number; z1: number }) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
    return (map.rooms.find((r) => r.walls && inR(r)) ?? map.rooms.find(inR))?.name;
  };
  const named = (kind: string, x: number, z: number) => { const n = roomName(x, z); return n ? `${kind} · ${n}` : kind; };

  const spots: SitSpot[] = map.seats.map((s) => ({ id: s.id, x: s.x, z: s.z, angle: FACING_ANGLE[s.facing], label: `bàn ${s.id}` }));
  for (const o of map.objects) {
    switch (o.prefab) {
      case 'chair':
        spots.push({ id: o.id, x: o.x, z: o.z, angle: chairAngle(o, map.objects), label: named('ghế', o.x, o.z) });
        break;
      case 'beanbag':
        spots.push({ id: o.id, x: o.x, z: o.z, angle: chairAngle(o, map.objects), label: named('ghế lười', o.x, o.z) });
        break;
      case 'loungeSofa':
      case 'loungeSofaCorner': {
        // Sofa nhìn về +z (lưng ở -z); chỗ ngồi dàn theo chiều rộng w, mỗi chỗ ~0,8 m. Sofa góc: chỉ phần thẳng (sâu 0,9 m ở phía -z).
        const rot = (o.rot * Math.PI) / 180;
        const n = Math.max(1, Math.floor(o.w / 0.8));
        const lz = o.prefab === 'loungeSofaCorner' ? -o.d / 2 + 0.5 : 0.1;
        for (let i = 0; i < n; i++) {
          const p = local(o, -o.w / 2 + (o.w / n) * (i + 0.5), lz, rot);
          spots.push({ id: `${o.id}#${i + 1}`, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, angle: rot, label: named('sofa', p.x, p.z) });
        }
        break;
      }
    }
  }
  return spots;
}
