import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Model đồ đạc GLB (tuỳ chọn): public/models/furniture/manifest.json do scripts/dev/import-furniture.ts sinh ra từ bộ
 * Kenney Furniture Kit (CC0). Không có manifest / lỗi tải → trả Map rỗng, world dùng khối dựng tay (furniture.ts).
 *   { "models": { "<prefab>": { "file": "desk.glb", "rotY": 0 } } }   rotY (độ): bù hướng mặt trước của model.
 */
export interface FurnitureModel { object: THREE.Object3D; size: THREE.Vector3; center: THREE.Vector3 }
export type FurnitureModels = Map<string, FurnitureModel>;

const BASE = '/models/furniture/';

export async function loadFurnitureModels(): Promise<FurnitureModels> {
  const result: FurnitureModels = new Map();
  let manifest: { models?: Record<string, { file: string; rotY?: number }> };
  try {
    const res = await fetch(BASE + 'manifest.json', { cache: 'no-cache' });
    if (!res.ok) return result;
    manifest = await res.json();
  } catch { return result; }

  const loader = new GLTFLoader();
  await Promise.all(Object.entries(manifest.models ?? {}).map(async ([prefab, m]) => {
    try {
      const gltf = await loader.loadAsync(BASE + m.file);
      const obj = gltf.scene;
      obj.rotation.y = ((m.rotY ?? 0) * Math.PI) / 180;
      obj.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(obj);
      obj.traverse((c) => { if ((c as THREE.Mesh).isMesh) { c.castShadow = true; c.receiveShadow = true; } });
      result.set(prefab, { object: obj, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) });
    } catch { /* model lỗi → prefab này dùng khối dựng tay */ }
  }));
  return result;
}

/**
 * Bản sao model vừa khít ô w × d (trục x / z, chưa xoay), đáy chạm sàn; chiều cao theo tỉ lệ trung bình của 2 trục ngang.
 * Bản sao dùng chung geometry / material với model gốc (nhẹ bộ nhớ).
 */
export function placeModel(m: FurnitureModel, w: number, d: number, x: number, z: number, rotY: number): THREE.Object3D {
  const sx = w / Math.max(m.size.x, 1e-3), sz = d / Math.max(m.size.z, 1e-3), sy = (sx + sz) / 2;
  const inner = m.object.clone();
  inner.position.set(-m.center.x * sx, -(m.center.y - m.size.y / 2) * sy, -m.center.z * sz);
  inner.scale.set(sx * inner.scale.x, sy * inner.scale.y, sz * inner.scale.z);
  // inner.rotation (rotY của manifest) nằm trong scale → bọc thêm một group để xoay theo bản đồ
  const holder = new THREE.Group();
  holder.add(inner);
  holder.position.set(x, 0, z);
  holder.rotation.y = rotY;
  holder.name = 'glb';
  return holder;
}
