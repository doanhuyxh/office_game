import * as THREE from 'three';
import { ANIM, Avatar, type AnimCode } from './avatar';
import { buildSitSpots, type SitSpot } from './sitSpots';
import { NavGrid } from './navGrid';
import { OFFICE_MAP } from './officeMap';
import { P } from './palette';
import { buildWorld, textTexture } from './world';
import { loadFurnitureModels } from './models';
import { voiceChannelAt, type VoiceChannelInfo } from './voiceChannel';

/**
 * Engine văn phòng 3D (Three.js thuần, không phụ thuộc React — React chỉ vẽ HUD trong OfficeView).
 *  - Camera chéo cố định, xoay từng 90° (Q / R), cuộn để zoom.
 *  - WASD / mũi tên: đi theo hướng màn hình, trượt theo tường (lưới va chạm NavGrid — giống server).
 *  - Bấm chuột lên sàn: tự tìm đường (A*). Bấm vào ghế: đi tới rồi ngồi.
 *  - `toggleSit()` (phím E ở OfficeView): ngồi ghế gần nhất còn trống / đứng dậy.
 */
const SPEED = 4.2; // m/s — server cho tối đa 7 m/s
const RADIUS = 0.22; // bán kính va chạm của avatar
const SEAT_REACH = 1.2;
const ACTION_REACH = 1.8;

type Other = { avatar: Avatar; tx: number; tz: number; tr: number; name: string };
export interface MinimapSnapshot { me: { x: number; z: number; r: number } | null; others: { x: number; z: number; name: string; anim: number }[]; target: [number, number] | null }

export class OfficeScene {
  readonly nav = new NavGrid(OFFICE_MAP);
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 300);
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  /** Joystick cảm ứng (điện thoại): x phải +, y xuống + (giống S), độ lớn 0..1. */
  private stick = { x: 0, y: 0 };
  private others = new Map<string, Other>();
  private me: Avatar | null = null;
  private raf = 0;
  private disposed = false;
  /** Số loại đồ đạc đang dùng model GLB (0 = khối dựng tay) — để test / chẩn đoán. */
  furnitureModels = 0;
  private sendAcc = 0;
  private path: [number, number][] = [];
  private sitOnArrive: SitSpot | null = null;
  private seat: SitSpot | null = null;
  /** Bàn làm việc + ghế / ghế lười / sofa trong objects (sitSpots.ts). */
  private readonly spots = buildSitSpots(OFFICE_MAP);
  private marker: THREE.Mesh;
  // Camera: góc phương vị (bội số 90°), khoảng cách, góc ngẩng
  private azimuthStep = 0;
  private azimuth = 0;
  private distance = 17;
  private readonly elevation = THREE.MathUtils.degToRad(52);
  private camTarget = new THREE.Vector3(OFFICE_MAP.spawn.x, 0, OFFICE_MAP.spawn.z);
  private sun: THREE.DirectionalLight;
  private ray = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private downAt: { x: number; y: number } | null = null;

  onMove?: (x: number, z: number, r: number, anim: number) => void;
  onZone?: (zone: string | null) => void;
  private lastZone: string | null = null;
  /** Đứng gần đồ vật có hành động (máy chấm công) → action; đi xa → null. */
  onNearAction?: (action: string | null) => void;
  private lastAction: string | null = null;
  /** Ghế gần nhất có thể ngồi (hoặc ghế đang ngồi, kèm `sitting`). */
  onSeat?: (info: { seat: SitSpot; sitting: boolean } | null) => void;
  private lastSeatKey = '';
  /** Thông báo ngắn cho HUD (vd "Ghế đã có người ngồi"). */
  onHint?: (text: string) => void;
  /** Kênh voice tại vị trí của mình đổi (đi qua cửa phòng có tường). */
  onVoiceChannel?: (ch: VoiceChannelInfo) => void;
  private lastVoice = '';

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(P.sky);
    this.scene.fog = new THREE.Fog(P.sky, 45, 90);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 2.0));
    // Nắng + khung bóng đổ ±16 × ±12 m đi theo người chơi (sàn 68 × 30 m quá lớn cho một khung bóng cố định)
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 12, bottom: -12, near: 1, far: 50 });
    sun.shadow.bias = -0.0008;
    this.sun = sun;
    this.moveSun();
    this.scene.add(sun, sun.target);
    // Hiện ngay bằng khối dựng tay; có model GLB (public/models/furniture) thì thay khi tải xong.
    let world = buildWorld(OFFICE_MAP);
    this.scene.add(world);
    void loadFurnitureModels().then((models) => {
      if (this.disposed || models.size === 0) return;
      const next = buildWorld(OFFICE_MAP, models);
      this.scene.remove(world);
      disposeMeshes(world);
      world = next;
      this.scene.add(world);
      this.furnitureModels = models.size;
    });

    this.marker = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.3, 24), new THREE.MeshBasicMaterial({ color: 0x2563eb, transparent: true, opacity: 0.9, depthWrite: false }));
    this.marker.rotation.x = -Math.PI / 2;
    this.marker.position.y = 0.03;
    this.marker.visible = false;
    this.scene.add(this.marker);

    addEventListener('resize', this.resize);
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    addEventListener('blur', this.clearKeys);
    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.pointerDown);
    el.addEventListener('pointerup', this.pointerUp);
    el.addEventListener('wheel', this.wheel, { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.resize();
    this.loop();
  }

  // ---------- người chơi ----------

  spawnMe(id: string, name: string, x: number, z: number) {
    if (!this.me) {
      this.me = new Avatar(id, name, true);
      this.scene.add(this.me.root);
    }
    this.me.root.position.set(x, 0, z);
    this.camTarget.set(x, 0, z);
  }

  teleportMe(x: number, z: number) {
    this.me?.root.position.set(x, 0, z);
    this.path = [];
    this.seat = null;
    if (this.me) this.me.anim = ANIM.idle;
  }

  upsertOther(id: string, name: string, x: number, z: number, r: number, anim = 0) {
    let o = this.others.get(id);
    if (!o) {
      o = { avatar: new Avatar(id, name, false), tx: x, tz: z, tr: r, name };
      o.avatar.root.position.set(x, 0, z);
      this.scene.add(o.avatar.root);
      this.others.set(id, o);
    }
    Object.assign(o, { tx: x, tz: z, tr: r });
    o.avatar.anim = anim as AnimCode;
  }

  moveOther(id: string, x: number, z: number, r: number, anim = 0) {
    const o = this.others.get(id);
    if (!o) return;
    Object.assign(o, { tx: x, tz: z, tr: r });
    o.avatar.anim = anim as AnimCode;
  }

  removeOther(id: string) {
    const o = this.others.get(id);
    if (!o) return;
    this.scene.remove(o.avatar.root);
    o.avatar.dispose();
    this.others.delete(id);
  }

  /** Đi tới điểm (x, z) bằng tìm đường (bản đồ nhỏ / bấm chuột). */
  walkTo(x: number, z: number, sitAt: SitSpot | null = null) {
    if (!this.me) return;
    this.standUp();
    const p = this.me.root.position;
    this.path = this.nav.findPath(p.x, p.z, x, z, RADIUS);
    this.sitOnArrive = sitAt;
    if (!this.path.length) { this.marker.visible = false; return this.onHint?.('Không có đường tới chỗ đó'); }
    const [tx, tz] = this.path[this.path.length - 1];
    this.marker.position.set(tx, 0.03, tz);
    this.marker.visible = true;
  }

  // ---------- ngồi ----------

  private seatTaken(s: SitSpot) {
    for (const o of this.others.values()) if (o.avatar.anim === ANIM.sit && Math.hypot(o.tx - s.x, o.tz - s.z) < 0.15) return true;
    return false;
  }

  private nearestSeat(x: number, z: number, reach: number) {
    let best: SitSpot | null = null, bd = reach;
    for (const s of this.spots) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < bd && !this.seatTaken(s)) { bd = d; best = s; }
    }
    return best;
  }

  private sit(s: SitSpot) {
    if (!this.me) return;
    if (this.seatTaken(s)) return this.onHint?.(`${s.label.charAt(0).toUpperCase()}${s.label.slice(1)} đã có người ngồi`);
    this.path = [];
    this.marker.visible = false;
    this.seat = s;
    this.me.root.position.set(s.x, 0, s.z);
    this.me.root.rotation.y = s.angle;
    this.me.anim = ANIM.sit;
    this.sendNow();
  }

  /** Đứng dậy: bước ra ô trống gần nhất (ghế có thể chạm cạnh bàn). */
  private standUp() {
    if (!this.me || !this.seat) return;
    const p = this.me.root.position;
    const free = this.nav.nearestFree(p.x, p.z);
    if (free) { const [x, z] = this.nav.center(free[0], free[1]); p.set(x, 0, z); }
    this.seat = null;
    this.me.anim = ANIM.idle;
    this.sendNow();
  }

  /** Phím E: đang ngồi → đứng; đứng gần ghế trống → ngồi. Trả false nếu không có gì để làm. */
  toggleSit(): boolean {
    if (!this.me) return false;
    if (this.seat) { this.standUp(); return true; }
    const s = this.nearestSeat(this.me.root.position.x, this.me.root.position.z, SEAT_REACH);
    if (!s) return false;
    this.sit(s);
    return true;
  }

  snapshot(): MinimapSnapshot {
    const p = this.me?.root.position;
    return {
      me: p ? { x: p.x, z: p.z, r: this.me!.root.rotation.y } : null,
      others: [...this.others.values()].map((o) => ({ x: o.avatar.root.position.x, z: o.avatar.root.position.z, name: o.name, anim: o.avatar.anim })),
      target: this.marker.visible ? [this.marker.position.x, this.marker.position.z] : null,
    };
  }

  /** Vị trí của mình / người khác (cho voice theo khoảng cách). */
  myPosition() {
    const p = this.me?.root.position;
    return p ? { x: p.x, z: p.z } : null;
  }
  positionOf(id: string) {
    const o = this.others.get(id);
    return o ? { x: o.avatar.root.position.x, z: o.avatar.root.position.z } : null;
  }

  /** Người đang nói (identity LiveKit = id người chơi) → vòng xanh dưới chân. */
  setSpeaking(ids: Set<string>) {
    if (this.me) this.me.speaking = ids.has(this.me.id);
    for (const [id, o] of this.others) o.avatar.speaking = ids.has(id);
  }

  private roomSigns = new Map<string, THREE.Sprite>();

  /**
   * Bảng nổi phía trên phòng họp: "Đang họp · …" (đỏ) / lịch kế tiếp (xám); null = gỡ bảng.
   * Dữ liệu từ /api/meetings/bookings/now (OfficeView hỏi lại mỗi phút).
   */
  setRoomStatus(roomId: string, text: string | null, busy: boolean) {
    const old = this.roomSigns.get(roomId);
    if (old) {
      this.scene.remove(old);
      old.material.map?.dispose();
      old.material.dispose();
      this.roomSigns.delete(roomId);
    }
    const room = OFFICE_MAP.rooms.find((r) => r.id === roomId);
    if (!text || !room) return;
    const label = text.length > 48 ? `${text.slice(0, 47)}…` : text;
    const { tex, aspect } = textTexture(label, {
      color: '#ffffff', bg: busy ? '#dc2626' : '#475569', font: 'bold 36px Inter, system-ui, sans-serif', pad: 22,
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
    const h = 0.42;
    sprite.scale.set(h * aspect, h, 1);
    sprite.position.set((room.x0 + room.x1) / 2, 2.7, (room.z0 + room.z1) / 2);
    sprite.renderOrder = 10;
    this.scene.add(sprite);
    this.roomSigns.set(roomId, sprite);
  }

  /** Xoay camera 90° (dir = 1 / -1). */
  rotateCamera(dir: 1 | -1) { this.azimuthStep += dir; }

  /** Joystick ảo (OfficeView → Joystick). (0, 0) = thả tay. */
  setStick(x: number, y: number) { this.stick = { x, y }; }

  /** Phóng to (-1) / thu nhỏ (1) — nút trên màn hình cảm ứng (máy tính dùng cuộn chuột). */
  zoom(dir: 1 | -1) { this.distance = THREE.MathUtils.clamp(this.distance * (1 + dir * 0.15), 8, 40); }

  /** Đặt nắng lệch đông-nam so với điểm camera đang nhìn → bóng luôn có quanh người chơi. */
  private moveSun() {
    const t = this.camTarget;
    this.sun.position.set(t.x + 8, 18, t.z + 10);
    this.sun.target.position.set(t.x, 0, t.z);
  }

  // ---------- input ----------

  private isTyping = (e: Event) => ['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);

  private keyDown = (e: KeyboardEvent) => {
    if (this.isTyping(e)) return;
    const k = e.key.toLowerCase();
    if (k === 'q') this.rotateCamera(-1);
    else if (k === 'r') this.rotateCamera(1);
    this.keys.add(k);
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());
  private clearKeys = () => this.keys.clear();

  private pointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.downAt = { x: e.clientX, y: e.clientY };
  };
  private pointerUp = (e: PointerEvent) => {
    const d = this.downAt;
    this.downAt = null;
    if (!d || e.button !== 0 || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), this.camera);
    const hit = this.ray.ray.intersectPlane(this.groundPlane, new THREE.Vector3());
    if (!hit) return;
    // Bấm sát một ghế → đi tới cạnh ghế rồi ngồi
    const seat = this.nearestSeat(hit.x, hit.z, 0.45);
    this.walkTo(hit.x, hit.z, seat);
  };
  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.distance = THREE.MathUtils.clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.1), 8, 40);
  };

  private resize = () => {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private sendNow() {
    this.sendAcc = 1;
  }

  // ---------- vòng lặp ----------

  private tryMove(dx: number, dz: number) {
    const p = this.me!.root.position;
    let moved = false;
    if (dx && this.nav.fits(p.x + dx, p.z, RADIUS)) { p.x += dx; moved = true; }
    if (dz && this.nav.fits(p.x, p.z + dz, RADIUS)) { p.z += dz; moved = true; }
    return moved;
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.azimuth += (this.azimuthStep * (Math.PI / 2) - this.azimuth) * (1 - Math.exp(-8 * dt));

    if (this.me) {
      const me = this.me, p = me.root.position, k = this.keys;
      const st = this.stick, stickLen = Math.hypot(st.x, st.y);
      const useStick = stickLen > 0.15; // vùng chết: chạm nhẹ không làm nhân vật trôi
      const ix = useStick ? st.x : (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      const iz = useStick ? st.y : (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
      const speedScale = useStick ? Math.min(1, stickLen) : 1;
      let walking = false;
      if (ix || iz) {
        this.path = [];
        this.marker.visible = false;
        this.standUp();
        // Đổi hướng phím theo góc camera: "W" luôn là đi lên màn hình
        const len = Math.hypot(ix, iz), c = Math.cos(this.azimuth), s = Math.sin(this.azimuth);
        const dx = ((ix * c + iz * s) / len) * SPEED * speedScale * dt, dz = ((-ix * s + iz * c) / len) * SPEED * speedScale * dt;
        walking = this.tryMove(dx, dz);
        if (walking) me.root.rotation.y = Math.atan2(dx, dz);
      } else if (this.path.length) {
        const [tx, tz] = this.path[0];
        const ddx = tx - p.x, ddz = tz - p.z, dist = Math.hypot(ddx, ddz), step = SPEED * dt;
        if (dist <= step) {
          p.x = tx; p.z = tz;
          this.path.shift();
          if (!this.path.length) {
            this.marker.visible = false;
            if (this.sitOnArrive) { const st = this.sitOnArrive; this.sitOnArrive = null; if (Math.hypot(st.x - p.x, st.z - p.z) < SEAT_REACH + 0.3) this.sit(st); }
          }
        } else {
          p.x += (ddx / dist) * step; p.z += (ddz / dist) * step;
        }
        if (dist > 1e-3) me.root.rotation.y = Math.atan2(ddx, ddz);
        walking = true;
      }
      if (!this.seat) me.anim = walking ? ANIM.walk : ANIM.idle;

      this.sendAcc += dt;
      if (this.sendAcc >= 0.1) {
        this.sendAcc = 0;
        this.onMove?.(p.x, p.z, me.root.rotation.y, me.anim);
      }
      const zone = this.nav.zoneAt(p.x, p.z)?.name ?? null;
      if (zone !== this.lastZone) { this.lastZone = zone; this.onZone?.(zone); }
      const voice = voiceChannelAt(OFFICE_MAP, p.x, p.z);
      if (voice.id !== this.lastVoice) { this.lastVoice = voice.id; this.onVoiceChannel?.(voice); }
      const near = OFFICE_MAP.objects.find((o) => o.action && Math.hypot(o.x - p.x, o.z - p.z) < ACTION_REACH)?.action ?? null;
      if (near !== this.lastAction) { this.lastAction = near; this.onNearAction?.(near); }
      const seatInfo = this.seat ? { seat: this.seat, sitting: true } : (() => { const s = this.nearestSeat(p.x, p.z, SEAT_REACH); return s ? { seat: s, sitting: false } : null; })();
      const seatKey = seatInfo ? `${seatInfo.seat.id}:${seatInfo.sitting}` : '';
      if (seatKey !== this.lastSeatKey) { this.lastSeatKey = seatKey; this.onSeat?.(seatInfo); }
      this.camTarget.lerp(new THREE.Vector3(p.x, 0, p.z), 1 - Math.exp(-6 * dt));
      me.update(dt);
    }

    const t = 1 - Math.exp(-12 * dt);
    for (const o of this.others.values()) {
      const r = o.avatar.root;
      r.position.x += (o.tx - r.position.x) * t;
      r.position.z += (o.tz - r.position.z) * t;
      let dr = o.tr - r.rotation.y;
      dr = Math.atan2(Math.sin(dr), Math.cos(dr));
      r.rotation.y += dr * t;
      o.avatar.update(dt);
    }

    this.moveSun();
    const flat = this.distance * Math.cos(this.elevation);
    this.camera.position.set(this.camTarget.x + Math.sin(this.azimuth) * flat, this.distance * Math.sin(this.elevation), this.camTarget.z + Math.cos(this.azimuth) * flat);
    this.camera.lookAt(this.camTarget.x, 0.6, this.camTarget.z);
    this.marker.scale.setScalar(1 + Math.sin(this.clock.elapsedTime * 6) * 0.08);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    removeEventListener('blur', this.clearKeys);
    for (const id of [...this.others.keys()]) this.removeOther(id);
    for (const id of [...this.roomSigns.keys()]) this.setRoomStatus(id, null, false);
    this.me?.dispose();
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach((m) => { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); });
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

/** Giải phóng geometry / material của một cây đối tượng (bỏ qua model GLB dùng chung — được giữ trong cache models). */
function disposeMeshes(root: THREE.Object3D) {
  root.traverse((o) => {
    if (o.name === 'glb') return;
    if (o instanceof THREE.Mesh && !o.parent?.name?.startsWith('glb')) {
      o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { (m as THREE.MeshBasicMaterial).map?.dispose(); m.dispose(); });
    }
  });
}
