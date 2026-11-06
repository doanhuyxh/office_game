import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildPrefab, chair, type Part } from './furniture';
import type { OfficeMapV2, Rect } from './mapTypes';
import { wallRect, wallSegments } from './navGrid';
import { FACING_ANGLE } from './officeMap';
import { placeModel, type FurnitureModels } from './models';
import { chairAngle } from './sitSpots';
import { P } from './palette';

/** Tường thấp (cắt ngang) để camera chéo nhìn được vào phòng; vách kính cao hơn vì trong suốt. */
const WALL_H = 1.1;
const GLASS_H = 2.2;

/** Chữ vẽ lên canvas → texture (tên phòng trên sàn, nhãn tên avatar). */
export function textTexture(text: string, opts: { font?: string; color?: string; bg?: string; pad?: number; width?: number } = {}) {
  const font = opts.font ?? 'bold 44px Inter, system-ui, sans-serif';
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  ctx.font = font;
  const pad = opts.pad ?? 16;
  c.width = opts.width ?? Math.ceil(ctx.measureText(text).width + pad * 2);
  c.height = 72;
  ctx.font = font;
  if (opts.bg) {
    ctx.fillStyle = opts.bg;
    ctx.beginPath();
    ctx.roundRect(0, 6, c.width, c.height - 12, (c.height - 12) / 2);
    ctx.fill();
  }
  ctx.fillStyle = opts.color ?? '#334155';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: c.width / c.height };
}

const materials = new Map<string, THREE.Material>();
function mat(color: number, glow = false) {
  const key = `${color}:${glow}`;
  let m = materials.get(key);
  if (!m) {
    m = glow
      ? new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, roughness: 0.4 })
      : new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
    materials.set(key, m);
  }
  return m;
}

/** Gom các khối cùng vật liệu thành một mesh (ít draw call). */
class Batch {
  private groups = new Map<string, { color: number; glow: boolean; geos: THREE.BufferGeometry[] }>();
  add(parts: Part[], x: number, z: number, rotY: number) {
    for (const p of parts) {
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
      g.rotateY(rotY).translate(x, 0, z);
      const key = `${p.color}:${!!p.glow}`;
      let grp = this.groups.get(key);
      if (!grp) this.groups.set(key, (grp = { color: p.color, glow: !!p.glow, geos: [] }));
      grp.geos.push(g);
    }
  }
  build(target: THREE.Group) {
    for (const { color, glow, geos } of this.groups.values()) {
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const mesh = new THREE.Mesh(merged, mat(color, glow));
      mesh.castShadow = !glow;
      mesh.receiveShadow = true;
      target.add(mesh);
    }
  }
}

function floorPlane(r: Rect, y: number, color: number, opacity = 1) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0),
    new THREE.MeshStandardMaterial({ color, roughness: 0.95, transparent: opacity < 1, opacity }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.set((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  m.receiveShadow = true;
  return m;
}

function floorLabel(text: string, x: number, z: number, size: number, color: string) {
  const { tex, aspect } = textTexture(text, { color });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(size * aspect, size), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.03, z);
  return m;
}

/** Ghế không có hướng trong bản đồ → quay về phía bàn gần nhất. */

/**
 * Dựng phần tĩnh của văn phòng (sàn, tường, đồ đạc, chữ). Trả về group để add vào scene.
 * `models` (tuỳ chọn): prefab có model GLB thì dùng model, còn lại khối dựng tay.
 */
export function buildWorld(map: OfficeMapV2, models: FurnitureModels = new Map()): THREE.Group {
  const root = new THREE.Group();
  const f = map.floor;

  // Nền ngoài + sàn từng khu
  const ground = floorPlane({ x0: f.x0 - 40, x1: f.x1 + 40, z0: f.z0 - 40, z1: f.z1 + 40 }, -0.02, P.ground);
  root.add(ground, floorPlane(f, -0.005, P.floor.open));
  for (const r of map.rooms) root.add(floorPlane(r, 0.002, P.floor[r.kind] ?? P.floor.open));
  for (const a of map.areas) root.add(floorPlane({ x0: a.x0 + 0.1, x1: a.x1 - 0.1, z0: a.z0 + 0.1, z1: a.z1 - 0.1 }, 0.006, P.dept[a.dept] ?? 0x94a3b8, 0.12));

  // Tường: đặc (thấp) + kính (cao, trong suốt)
  const solid = new Batch(), glassFrames = new Batch();
  const glassGeos: THREE.BufferGeometry[] = [];
  const wallParts = (r: Rect, glass: boolean, doors: Parameters<typeof wallSegments>[1]) => {
    for (const s of wallSegments(r, doors)) {
      const w = wallRect(r, s);
      const sx = w.x1 - w.x0, sz = w.z1 - w.z0, cx = (w.x0 + w.x1) / 2, cz = (w.z0 + w.z1) / 2;
      if (glass) {
        glassGeos.push(new THREE.BoxGeometry(sx, GLASS_H, sz).toNonIndexed().translate(cx, GLASS_H / 2, cz));
        glassFrames.add([{ geo: new THREE.BoxGeometry(sx + 0.02, 0.06, sz + 0.02).translate(0, GLASS_H, 0), color: P.glassFrame },
          { geo: new THREE.BoxGeometry(sx + 0.02, 0.08, sz + 0.02).translate(0, 0.04, 0), color: P.glassFrame }], cx, cz, 0);
      } else {
        solid.add([{ geo: new THREE.BoxGeometry(sx, WALL_H, sz).translate(0, WALL_H / 2, 0), color: P.wall },
          { geo: new THREE.BoxGeometry(sx + 0.01, 0.05, sz + 0.01).translate(0, WALL_H + 0.025, 0), color: P.wallCap }], cx, cz, 0);
      }
    }
  };
  for (const r of map.rooms) if (r.walls) wallParts(r, !!r.glass, r.doors);
  wallParts(f, false, map.outerDoors);
  solid.build(root);
  glassFrames.build(root);
  if (glassGeos.length) {
    const glass = new THREE.Mesh(mergeGeometries(glassGeos, false)!, new THREE.MeshStandardMaterial({ color: P.glass, transparent: true, opacity: 0.22, roughness: 0.1, depthWrite: false }));
    glass.renderOrder = 2;
    root.add(glass);
  }

  // Đồ đạc + ghế ở chỗ ngồi
  const furniture = new Batch();
  for (const o of map.objects) {
    const rot = o.prefab === 'chair' ? chairAngle(o, map.objects) : (o.rot * Math.PI) / 180;
    const model = models.get(o.prefab);
    if (model) root.add(placeModel(model, o.w, o.d, o.x, o.z, rot));
    else furniture.add(buildPrefab(o.prefab, o.w, o.d), o.x, o.z, rot);
  }
  const chairModel = models.get('chair');
  for (const s of map.seats) {
    if (chairModel) root.add(placeModel(chairModel, 0.5, 0.5, s.x, s.z, FACING_ANGLE[s.facing]));
    else furniture.add(chair(P.dark), s.x, s.z, FACING_ANGLE[s.facing]);
  }
  furniture.build(root);

  // Logo sảnh (mặt nam tấm vách)
  const logo = map.objects.find((o) => o.prefab === 'logoWall');
  if (logo) {
    const { tex, aspect } = textTexture('OfficeHub', { color: '#ffffff', font: 'bold 52px Inter, system-ui, sans-serif' });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.2 * aspect * 0.5, 0.6), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
    m.position.set(logo.x, 1.05, logo.z + 0.045);
    root.add(m);
  }

  // Tên phòng / khu trên sàn
  for (const r of map.rooms) {
    if (r.kind === 'open') continue;
    const z = r.kind === 'booth' ? r.z0 + 0.45 : ['lounge', 'lobby', 'pantry'].includes(r.kind) ? r.z0 + 0.5 : r.z1 - 0.45;
    root.add(floorLabel(r.name.toUpperCase(), (r.x0 + r.x1) / 2, z, r.kind === 'booth' ? 0.28 : 0.42, '#475569'));
  }
  for (const a of map.areas) root.add(floorLabel(a.name.toUpperCase(), (a.x0 + a.x1) / 2, a.z1 - 0.3, 0.32, `#${(P.dept[a.dept] ?? 0x64748b).toString(16).padStart(6, '0')}`));
  return root;
}
