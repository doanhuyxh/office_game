import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { AVATAR_CATALOG, partOf, type AvatarLook, type BodyType, type Slot } from './avatarLook';

/**
 * Nhân vật GLB (Quaternius, CC0): mỗi dáng người 1 file `public/models/characters/<body>.glb` chứa 1 bộ xương + mọi phần
 * (node `part-<slot>-<id>`) + clip Idle / Walk / Run / Wave. Mỗi nhân vật = clone bộ xương, chỉ giữ 4 phần đã chọn,
 * tô màu theo vật liệu. Geometry dùng chung với file gốc; vật liệu tô màu dùng chung theo (vật liệu, màu) → không dispose.
 * File lỗi / chưa nhập → `loadBody` trả null, Avatar giữ nhân vật khối (avatar.ts).
 */
const BASE = '/models/characters/';
/** Model cao ~1,83 m → thu nhỏ một chút cho hợp đồ đạc low-poly. */
export const CHARACTER_SCALE = 0.9;

const loader = new GLTFLoader();
const bodies = new Map<BodyType, Promise<GLTF | null>>();

export function loadBody(body: BodyType): Promise<GLTF | null> {
  let p = bodies.get(body);
  if (!p) {
    p = loader.loadAsync(BASE + AVATAR_CATALOG.bodies[body].file).then((g) => {
      g.scene.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = flat((o as THREE.Mesh).material as THREE.MeshStandardMaterial); });
      return g;
    }).catch(() => null);
    bodies.set(body, p);
  }
  return p;
}

/** Vật liệu gốc → bản flatShading + nhám như cảnh (dùng chung). */
const flatCache = new Map<string, THREE.MeshStandardMaterial>();
function flat(m: THREE.MeshStandardMaterial) {
  let r = flatCache.get(m.uuid);
  if (!r) {
    r = m.clone();
    r.flatShading = true;
    r.roughness = 0.85;
    r.metalness = 0;
    flatCache.set(m.uuid, r);
  }
  return r;
}

const tintCache = new Map<string, THREE.MeshStandardMaterial>();
function tinted(src: THREE.MeshStandardMaterial, hex: string, k = 1) {
  const key = `${src.uuid}|${hex}|${k}`;
  let m = tintCache.get(key);
  if (!m) {
    m = src.clone();
    m.color.set(hex).multiplyScalar(k);
    tintCache.set(key, m);
  }
  return m;
}

export type ClipName = 'idle' | 'walk' | 'run' | 'wave';
type BoneKey = 'upperL' | 'upperR' | 'lowerL' | 'lowerR' | 'footL' | 'footR' | 'armL' | 'armR' | 'foreL' | 'foreR';
export interface CharacterRig {
  /** Gốc nhân vật (đã scale) — thêm vào Avatar. */
  root: THREE.Object3D;
  /** Model clone (con của root) — hạ xuống khi ngồi. */
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  actions: Partial<Record<ClipName, THREE.AnimationAction>>;
  bones: Partial<Record<BoneKey, THREE.Bone>>;
  /** Độ dài cẳng chân (gối → xương bàn chân) ở tư thế bind, đơn vị model. */
  shin: number;
  /** Vị trí xương bàn chân trước khi applySitPose ghi đè (clip không có track vị trí bàn chân → phải tự khôi phục). */
  feet: { L: { base: THREE.Vector3; wrote: THREE.Vector3 | null }; R: { base: THREE.Vector3; wrote: THREE.Vector3 | null } };
}

/** Độ cao khớp hông khi ngồi (mặt ghế ~0,5 m — furniture.ts). */
const SEAT_HIP = 0.56;
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _knee = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _qa = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _rx = new THREE.Vector3(), _pq = new THREE.Quaternion();

/** Xoay xương để trục +Y (dọc xương, quy ước Blender) chỉ theo `dir` (thế giới), trộn với tư thế animation theo `s`. */
function aim(bone: THREE.Bone, dir: THREE.Vector3, s: number) {
  _qa.copy(bone.quaternion);
  const wq = bone.getWorldQuaternion(_q);
  const cur = _v2.set(0, 1, 0).applyQuaternion(wq);
  const target = _q2.setFromUnitVectors(cur, dir).multiply(wq);
  const parent = bone.parent!.getWorldQuaternion(_pq).invert();
  bone.quaternion.copy(parent.multiply(target));
  if (s < 1) bone.quaternion.copy(_qa.slerp(bone.quaternion, s));
  bone.updateMatrixWorld(true);
}

/**
 * Tư thế ngồi (bộ Quaternius không có clip ngồi): gọi SAU `mixer.update`. Hạ người để hông ở SEAT_HIP, đùi ra trước,
 * cẳng chân xuống sàn (nghiêng ra trước nếu dài hơn khoảng cách tới sàn), bàn chân là xương IK con của Root → dời theo.
 * Tay đưa ra trước như đang gõ bàn phím. `s` 0..1 để chuyển mượt đứng ↔ ngồi.
 */
export function applySitPose(rig: CharacterRig, s: number) {
  const b = rig.bones;
  rig.model.position.y = 0;
  // Khôi phục vị trí bàn chân frame trước (nếu clip không ghi lại) để không cộng dồn
  for (const side of ['L', 'R'] as const) {
    const foot = b[`foot${side}`], f = rig.feet[side];
    if (!foot) continue;
    if (f.wrote && foot.position.equals(f.wrote)) foot.position.copy(f.base);
    else f.base.copy(foot.position);
    f.wrote = null;
  }
  if (s <= 0.001 || !b.upperL || !b.upperR || !b.lowerL || !b.lowerR) return;
  rig.root.updateMatrixWorld(true);
  const hipY = b.upperL.getWorldPosition(_v).y;
  const scale = rig.root.getWorldScale(_v2).y;
  rig.model.position.y = ((SEAT_HIP - hipY) / scale) * s;
  rig.root.updateMatrixWorld(true);
  const rootQ = rig.model.getWorldQuaternion(_rq);
  _fwd.set(0, 0, 1).applyQuaternion(rootQ);
  _up.set(0, 1, 0);
  for (const side of ['L', 'R'] as const) {
    const upper = b[`upper${side}`]!, lower = b[`lower${side}`]!, foot = b[`foot${side}`];
    const footY0 = foot ? foot.getWorldPosition(_v).y : 0;
    const shin = rig.shin * scale;
    aim(upper, _v.copy(_fwd).multiplyScalar(0.98).addScaledVector(_up, -0.2).normalize(), s);
    lower.getWorldPosition(_knee);
    const h = _knee.y - Math.max(footY0 - (SEAT_HIP - hipY) * s, 0.01);
    const cos = Math.min(1, h / shin), sin = Math.sqrt(1 - cos * cos);
    const dir = _v.copy(_fwd).multiplyScalar(sin).addScaledVector(_up, -cos).normalize();
    aim(lower, dir, s);
    if (foot?.parent) {
      const target = _v2.copy(_knee).addScaledVector(dir, shin);
      const local = foot.parent.worldToLocal(target);
      foot.position.lerp(local, s);
      rig.feet[side].wrote = foot.position.clone();
    }
  }
  // Tay: cánh tay xuống-trước, cẳng tay ra trước
  for (const side of ['L', 'R'] as const) {
    const arm = b[`arm${side}`], fore = b[`fore${side}`];
    const out = side === 'L' ? 1 : -1;
    const rootX = _rx.set(1, 0, 0).applyQuaternion(rootQ);
    if (arm) aim(arm, _v.copy(_fwd).multiplyScalar(0.45).addScaledVector(_up, -0.85).addScaledVector(rootX, 0.12 * out).normalize(), s);
    if (fore) aim(fore, _v.copy(_fwd).multiplyScalar(0.95).addScaledVector(_up, 0.1).addScaledVector(rootX, -0.12 * out).normalize(), s);
  }
}

/** Node phần: `part-<slot>-<id>` (GLTFLoader có thể thêm hậu tố `_1`; phần nhiều vật liệu → nhóm có mesh con `…_0`, `…_1`). */
const PART_RE = /^part-(head|top|bottom|shoes)-([a-z0-9]+)(?:_\d+)?$/;
const partNode = (o: THREE.Object3D) => (o.parent && PART_RE.test(o.parent.name) ? null : PART_RE.exec(o.name));

const slotOf = (o: THREE.Object3D): Slot | null => {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) {
    const m = PART_RE.exec(p.name);
    if (m) return m[1] as Slot;
  }
  return null;
};

export function buildCharacter(gltf: GLTF, look: AvatarLook): CharacterRig {
  const model = SkeletonUtils.clone(gltf.scene);
  const drop: THREE.Object3D[] = [];
  model.traverse((o) => {
    const m = partNode(o);
    if (m && look[m[1] as Slot] !== m[2]) drop.push(o);
  });
  drop.forEach((o) => o.removeFromParent());

  const pal = AVATAR_CATALOG.palettes;
  const head = partOf(look, 'head');
  const hair = new Set(head?.hair ?? []), eyes = new Set(head?.eyes ?? []);
  const clothColor = { top: look.topColor, bottom: look.bottomColor, shoes: look.shoesColor };
  model.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.frustumCulled = false; // bounding sphere theo tư thế bind → dễ bị cắt nhầm khi đang chạy animation
    const slot = slotOf(mesh);
    const mat = mesh.material as THREE.MeshStandardMaterial;
    const n = mat.name;
    let hex: string | null = null, k = 1;
    if (n === 'Skin' || n === 'Skin_Darker') { if (look.skin !== null) { hex = pal.skin[look.skin]; k = n === 'Skin' ? 1 : 0.85; } }
    else if (slot === 'head') {
      if (hair.has(n) && look.hair !== null) hex = pal.hair[look.hair];
      else if (n === 'Eyebrows' && look.hair !== null) { hex = pal.hair[look.hair]; k = 0.75; }
      else if (eyes.has(n) && look.eyes !== null) hex = pal.eyes[look.eyes];
    } else if (slot) {
      const c = clothColor[slot];
      if (c !== null && partOf(look, slot)?.tint?.includes(n)) hex = pal.cloth[c];
    }
    if (hex) mesh.material = tinted(mat, hex, k);
  });

  const root = new THREE.Group();
  root.add(model);
  root.scale.setScalar(CHARACTER_SCALE);
  const mixer = new THREE.AnimationMixer(model);
  const actions: CharacterRig['actions'] = {};
  for (const clip of gltf.animations) {
    const name = clip.name.toLowerCase() as ClipName;
    if (['idle', 'walk', 'run', 'wave'].includes(name)) actions[name] = mixer.clipAction(clip);
  }
  const bone = (n: string) => model.getObjectByName(n) as THREE.Bone | undefined;
  model.updateMatrixWorld(true);
  const knee = bone('LowerLegL'), footL = bone('FootL');
  const shin = knee && footL ? knee.getWorldPosition(new THREE.Vector3()).distanceTo(footL.getWorldPosition(new THREE.Vector3())) : 0.45;
  return {
    root, model, mixer, actions, shin,
    feet: { L: { base: new THREE.Vector3(), wrote: null }, R: { base: new THREE.Vector3(), wrote: null } },
    bones: {
      upperL: bone('UpperLegL'), upperR: bone('UpperLegR'), lowerL: bone('LowerLegL'), lowerR: bone('LowerLegR'), footL: bone('FootL'), footR: bone('FootR'),
      armL: bone('UpperArmL'), armR: bone('UpperArmR'), foreL: bone('LowerArmL'), foreR: bone('LowerArmR'),
    },
  };
}
