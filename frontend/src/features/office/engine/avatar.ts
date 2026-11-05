import * as THREE from 'three';
import { textTexture } from './world';

/** Mã animation gửi qua hub (byte `anim`): khớp server (chỉ chuyển tiếp, không diễn giải). */
export const ANIM = { idle: 0, walk: 1, sit: 2 } as const;
export type AnimCode = (typeof ANIM)[keyof typeof ANIM];

const SHIRTS = [0x2563eb, 0xdb2777, 0x0891b2, 0xea580c, 0x7c3aed, 0x16a34a, 0xca8a04, 0xdc2626, 0x0d9488, 0x4f46e5];
const HAIRS = [0x1f2937, 0x3f2a1d, 0x7c4a1e, 0x111827, 0x57534e];
const SKIN = 0xf1c7a0;
const PANTS = 0x334155;

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7);
const m = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });

/** Nhân vật low-poly: chân / tay có khớp để đi, ngồi. Màu áo / tóc suy ra từ id (ổn định giữa các lần vào). */
export class Avatar {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private legL = new THREE.Group();
  private legR = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private label: THREE.Sprite;
  private t = Math.random() * 10;
  anim: AnimCode = ANIM.idle;

  constructor(id: string, name: string, isMe: boolean) {
    const h = Math.abs(hash(id));
    const shirt = m(SHIRTS[h % SHIRTS.length]), hair = m(HAIRS[(h >> 3) % HAIRS.length]), skin = m(SKIN), pants = m(PANTS);
    const part = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      return mesh;
    };
    // Chân: khớp hông ở y 0.52
    for (const [leg, x] of [[this.legL, -0.09], [this.legR, 0.09]] as const) {
      leg.position.set(x, 0.52, 0);
      leg.add(part(new THREE.BoxGeometry(0.13, 0.5, 0.15), pants, 0, -0.25, 0));
      leg.add(part(new THREE.BoxGeometry(0.14, 0.06, 0.2), m(0x1f2937), 0, -0.49, 0.03));
    }
    // Tay: khớp vai ở y 0.98
    for (const [arm, x] of [[this.armL, -0.25], [this.armR, 0.25]] as const) {
      arm.position.set(x, 0.98, 0);
      arm.add(part(new THREE.BoxGeometry(0.1, 0.42, 0.11), shirt, 0, -0.2, 0));
      arm.add(part(new THREE.BoxGeometry(0.09, 0.08, 0.09), skin, 0, -0.44, 0));
    }
    this.body.add(this.legL, this.legR, this.armL, this.armR);
    this.body.add(part(new THREE.BoxGeometry(0.4, 0.5, 0.22), shirt, 0, 0.78, 0));
    this.body.add(part(new THREE.IcosahedronGeometry(0.17, 1), skin, 0, 1.2, 0));
    this.body.add(part(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.23, -0.01));
    this.body.add(part(new THREE.BoxGeometry(0.05, 0.04, 0.02), m(0x1f2937), -0.06, 1.22, 0.16), part(new THREE.BoxGeometry(0.05, 0.04, 0.02), m(0x1f2937), 0.06, 1.22, 0.16));
    this.root.add(this.body);

    if (isMe) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.8 }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.015;
      this.root.add(ring);
    }
    const { tex, aspect } = textTexture(name.length > 22 ? name.slice(0, 21) + '…' : name, {
      color: '#ffffff', bg: isMe ? 'rgba(37,99,235,.92)' : 'rgba(15,23,42,.78)', font: 'bold 34px Inter, system-ui, sans-serif', pad: 22,
    });
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.label.scale.set(0.3 * aspect, 0.3, 1);
    this.label.position.y = 1.75;
    this.label.renderOrder = 10;
    this.root.add(this.label);
  }

  /** Cập nhật dáng theo anim (gọi mỗi frame). */
  update(dt: number) {
    this.t += dt;
    const lerp = 1 - Math.exp(-14 * dt);
    let legs = 0, arms = 0, bodyY = 0, legFwd = 0, armFwd = 0;
    if (this.anim === ANIM.walk) {
      const s = Math.sin(this.t * 10);
      legs = s * 0.6; arms = -s * 0.5; bodyY = Math.abs(Math.cos(this.t * 10)) * 0.04;
    } else if (this.anim === ANIM.sit) {
      bodyY = -0.06; legFwd = -Math.PI / 2; armFwd = -0.5;
    } else {
      bodyY = Math.sin(this.t * 2) * 0.01;
    }
    this.legL.rotation.x += (legFwd + legs - this.legL.rotation.x) * lerp;
    this.legR.rotation.x += (legFwd - legs - this.legR.rotation.x) * lerp;
    this.armL.rotation.x += (armFwd + arms - this.armL.rotation.x) * lerp;
    this.armR.rotation.x += (armFwd - arms - this.armR.rotation.x) * lerp;
    this.body.position.y += (bodyY - this.body.position.y) * lerp;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      if (o instanceof THREE.Sprite) { o.material.map?.dispose(); o.material.dispose(); }
    });
  }
}
