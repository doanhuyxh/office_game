import * as THREE from 'three';
import { textTexture } from './world';
import { AVATAR_CATALOG, DEFAULT_LOOK, sameLook, type AvatarLook } from './avatarLook';
import { applySitPose, buildCharacter, loadBody, type CharacterRig, type ClipName } from './character';

/** Mã animation gửi qua hub (byte `anim`): khớp server (chỉ chuyển tiếp, không diễn giải). */
export const ANIM = { idle: 0, walk: 1, sit: 2 } as const;
export type AnimCode = (typeof ANIM)[keyof typeof ANIM];

const PANTS = 0x334155;
const m = (color: THREE.ColorRepresentation) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true });

/** Màu cho nhân vật khối dự phòng: theo bảng màu đã chọn, null = màu gần giống model gốc. */
function blockColors(look: AvatarLook) {
  const p = AVATAR_CATALOG.palettes;
  return {
    skin: look.skin !== null ? p.skin[look.skin] : '#f1c7a0',
    hair: look.hair !== null ? p.hair[look.hair] : '#3b2418',
    shirt: look.topColor !== null ? p.cloth[look.topColor] : '#2563eb',
    pants: look.bottomColor !== null ? p.cloth[look.bottomColor] : PANTS,
  };
}

/** Nhân vật khối low-poly (dùng khi model GLB chưa tải xong / lỗi). Trả về nhóm + các khớp. */
function buildBlocks(look: AvatarLook) {
  const c = blockColors(look);
  const body = new THREE.Group(), legL = new THREE.Group(), legR = new THREE.Group(), armL = new THREE.Group(), armR = new THREE.Group();
  const shirt = m(c.shirt), hair = m(c.hair), skin = m(c.skin), pants = m(c.pants), dark = m(0x1f2937);
  const part = (g: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(g, mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    return mesh;
  };
  for (const [leg, x] of [[legL, -0.09], [legR, 0.09]] as const) {
    leg.position.set(x, 0.52, 0);
    leg.add(part(new THREE.BoxGeometry(0.13, 0.5, 0.15), pants, 0, -0.25, 0));
    leg.add(part(new THREE.BoxGeometry(0.14, 0.06, 0.2), dark, 0, -0.49, 0.03));
  }
  for (const [arm, x] of [[armL, -0.25], [armR, 0.25]] as const) {
    arm.position.set(x, 0.98, 0);
    arm.add(part(new THREE.BoxGeometry(0.1, 0.42, 0.11), shirt, 0, -0.2, 0));
    arm.add(part(new THREE.BoxGeometry(0.09, 0.08, 0.09), skin, 0, -0.44, 0));
  }
  body.add(legL, legR, armL, armR);
  body.add(part(new THREE.BoxGeometry(0.4, 0.5, 0.22), shirt, 0, 0.78, 0));
  body.add(part(new THREE.IcosahedronGeometry(0.17, 1), skin, 0, 1.2, 0));
  body.add(part(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), hair, 0, 1.23, -0.01));
  body.add(part(new THREE.BoxGeometry(0.05, 0.04, 0.02), dark, -0.06, 1.22, 0.16), part(new THREE.BoxGeometry(0.05, 0.04, 0.02), dark, 0.06, 1.22, 0.16));
  return { body, legL, legR, armL, armR };
}

const disposeOwned = (root: THREE.Object3D) => root.traverse((o) => {
  if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
});

/**
 * Nhân vật trong văn phòng: model GLB theo ngoại hình (character.ts) hoặc khối dự phòng, nhãn tên, vòng dưới chân
 * (mình: xanh dương; đang nói: xanh lá). `setLook` đổi ngoại hình tại chỗ (người khác đổi → `LookChanged`).
 */
export class Avatar {
  readonly root = new THREE.Group();
  private blocks: ReturnType<typeof buildBlocks> | null = null;
  private rig: CharacterRig | null = null;
  private clip: ClipName | null = null;
  private sitBlend = 0;
  private look: AvatarLook = DEFAULT_LOOK;
  private lookToken = 0;
  private label: THREE.Sprite;
  private t = Math.random() * 10;
  private talk: THREE.Mesh;
  private ring: THREE.Mesh | null = null;
  /** Dòng "đang làm gì" phía trên nhãn tên (bot đang làm việc qua MCP); null = không hiện. */
  private status: THREE.Sprite | null = null;
  private statusText: string | null = null;
  private disposed = false;
  anim: AnimCode = ANIM.idle;
  /** Đang nói (voice) → vòng xanh lá nhấp nháy dưới chân. */
  speaking = false;

  /** `bot` = tài khoản bot đang làm việc qua MCP: nhãn tím "AI · tên". */
  constructor(readonly id: string, name: string, isMe: boolean, look: AvatarLook = DEFAULT_LOOK, labelVisible = true, readonly bot = false) {
    if (isMe) {
      this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 32), new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.8 }));
      this.ring.rotation.x = -Math.PI / 2;
      this.ring.position.y = 0.015;
      this.root.add(this.ring);
    }
    this.talk = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.52, 32), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: 0.9, depthWrite: false }));
    this.talk.rotation.x = -Math.PI / 2;
    this.talk.position.y = 0.02;
    this.talk.visible = false;
    this.root.add(this.talk);
    const shown = name.length > 22 ? name.slice(0, 21) + '…' : name;
    const { tex, aspect } = textTexture(bot ? `AI · ${shown}` : shown, {
      color: '#ffffff', bg: isMe ? 'rgba(37,99,235,.92)' : bot ? 'rgba(124,58,237,.92)' : 'rgba(15,23,42,.78)',
      font: 'bold 34px Inter, system-ui, sans-serif', pad: 22,
    });
    this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.label.scale.set(0.3 * aspect, 0.3, 1);
    this.label.position.y = 1.95;
    this.label.renderOrder = 10;
    this.label.visible = labelVisible;
    this.root.add(this.label);
    this.applyLook(look, true);
  }

  get currentLook() { return this.look; }

  /** Bot đang làm gì ("Chuyển trạng thái việc · WEB-12") — bong bóng tím phía trên tên; null = gỡ. */
  setStatus(text: string | null) {
    if (text === this.statusText) return;
    this.statusText = text;
    if (this.status) {
      this.root.remove(this.status);
      this.status.material.map?.dispose();
      this.status.material.dispose();
      this.status = null;
    }
    if (!text) return;
    const { tex, aspect } = textTexture(text.length > 40 ? `${text.slice(0, 39)}…` : text, {
      color: '#ffffff', bg: 'rgba(124,58,237,.8)', font: '500 30px Inter, system-ui, sans-serif', pad: 18,
    });
    this.status = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    this.status.scale.set(0.24 * aspect, 0.24, 1);
    this.status.position.y = 2.25;
    this.status.renderOrder = 10;
    this.status.visible = this.label.visible;
    this.root.add(this.status);
  }

  /** Đổi ngoại hình: hiện khối theo màu mới ngay (nếu chưa có model), tải model GLB rồi thay. */
  setLook(look: AvatarLook) {
    if (sameLook(look, this.look)) return;
    this.applyLook(look, false);
  }

  private applyLook(look: AvatarLook, first: boolean) {
    this.look = look;
    const token = ++this.lookToken;
    if (first || !this.rig) this.showBlocks(look);
    void loadBody(look.body).then((gltf) => {
      if (!gltf || this.disposed || token !== this.lookToken) return;
      this.showRig(buildCharacter(gltf, look));
    });
  }

  private showBlocks(look: AvatarLook) {
    if (this.blocks) { this.root.remove(this.blocks.body); disposeOwned(this.blocks.body); }
    this.blocks = buildBlocks(look);
    this.root.add(this.blocks.body);
  }

  private showRig(rig: CharacterRig) {
    if (this.blocks) { this.root.remove(this.blocks.body); disposeOwned(this.blocks.body); this.blocks = null; }
    if (this.rig) { this.rig.mixer.stopAllAction(); this.root.remove(this.rig.root); }
    this.rig = rig;
    this.clip = null;
    this.root.add(rig.root);
  }

  /** Vẫy tay một lần (editor xem trước). */
  wave() {
    const a = this.rig?.actions.wave;
    if (!a) return;
    a.reset().setLoop(THREE.LoopOnce, 1).fadeIn(0.2).play();
    a.clampWhenFinished = false;
    const mixer = this.rig!.mixer;
    const done = (e: { action: THREE.AnimationAction }) => { if (e.action === a) { a.fadeOut(0.3); mixer.removeEventListener('finished', done); } };
    mixer.addEventListener('finished', done);
  }

  /** Cập nhật dáng theo anim (gọi mỗi frame). */
  update(dt: number) {
    this.t += dt;
    this.talk.visible = this.speaking;
    if (this.speaking) this.talk.scale.setScalar(1 + Math.sin(this.t * 9) * 0.07);
    if (this.rig) return this.updateRig(dt);
    if (!this.blocks) return;
    const { body, legL, legR, armL, armR } = this.blocks;
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
    legL.rotation.x += (legFwd + legs - legL.rotation.x) * lerp;
    legR.rotation.x += (legFwd - legs - legR.rotation.x) * lerp;
    armL.rotation.x += (armFwd + arms - armL.rotation.x) * lerp;
    armR.rotation.x += (armFwd - arms - armR.rotation.x) * lerp;
    body.position.y += (bodyY - body.position.y) * lerp;
  }

  private updateRig(dt: number) {
    const rig = this.rig!;
    const want: ClipName = this.anim === ANIM.walk ? 'run' : 'idle';
    if (want !== this.clip) {
      const next = rig.actions[want] ?? rig.actions.idle;
      const prev = this.clip ? rig.actions[this.clip] : undefined;
      if (next) {
        next.reset().setEffectiveWeight(1).play();
        if (prev && prev !== next) next.crossFadeFrom(prev, 0.2, false);
      }
      this.clip = want;
    }
    rig.mixer.update(dt);
    const target = this.anim === ANIM.sit ? 1 : 0;
    this.sitBlend += (target - this.sitBlend) * (1 - Math.exp(-12 * dt));
    if (Math.abs(this.sitBlend - target) < 0.002) this.sitBlend = target;
    applySitPose(rig, this.sitBlend);
  }

  dispose() {
    this.disposed = true;
    if (this.blocks) disposeOwned(this.blocks.body);
    // Model GLB: geometry + vật liệu dùng chung (cache trong character.ts) → không dispose; chỉ dừng animation.
    if (this.rig) { this.rig.mixer.stopAllAction(); this.rig.mixer.uncacheRoot(this.rig.model); }
    for (const o of [this.talk, this.ring]) { o?.geometry.dispose(); (o?.material as THREE.Material | undefined)?.dispose(); }
    this.label.material.map?.dispose();
    this.label.material.dispose();
    this.setStatus(null);
  }
}
