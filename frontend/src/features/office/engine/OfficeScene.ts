import * as THREE from 'three';
import map from '@shared/office-map.json';
import { THEME_COLORS } from '@/config/theme';

/**
 * Engine 3D tối giản (khung). Không phụ thuộc React.
 * Bước tiếp theo: port world.js / office.js / avatar.js từ legacy-mvp/public/js sang đây.
 */
type Avatar = { mesh: THREE.Group; tx: number; tz: number; tr: number };

const SPEED = 4.2;

export class OfficeScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 200);
  private clock = new THREE.Clock();
  private keys = new Set<string>();
  private others = new Map<string, Avatar>();
  private me: THREE.Group | null = null;
  private raf = 0;
  private sendAcc = 0;

  onMove?: (x: number, z: number, r: number, anim: number) => void;
  onZone?: (zone: string | null) => void;
  private lastZone: string | null = null;
  /** Đứng gần đồ vật có hành động (vd máy chấm công ở lễ tân) → action, đi xa → null. */
  onNearAction?: (action: string | null) => void;
  private lastAction: string | null = null;

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x0f172a);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(10, 20, 8);
    this.scene.add(sun);
    this.buildFloor();
    addEventListener('resize', this.resize);
    addEventListener('keydown', this.keyDown);
    addEventListener('keyup', this.keyUp);
    this.resize();
    this.loop();
  }

  private buildFloor() {
    const f = map.floor;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(f.x1 - f.x0, f.z1 - f.z0), new THREE.MeshStandardMaterial({ color: 0x1e293b }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set((f.x0 + f.x1) / 2, 0, (f.z0 + f.z1) / 2);
    this.scene.add(floor);
    for (const z of map.zones) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(z.x1 - z.x0 - 0.2, z.z1 - z.z0 - 0.2),
        new THREE.MeshStandardMaterial({ color: THEME_COLORS.zones[z.id] ?? 0x475569 }),
      );
      m.rotation.x = -Math.PI / 2;
      m.position.set((z.x0 + z.x1) / 2, 0.01, (z.z0 + z.z1) / 2);
      this.scene.add(m);
    }
    for (const o of map.objects ?? []) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.4, 0.4), new THREE.MeshStandardMaterial({ color: 0xf59e0b }));
      box.position.set(o.x, 0.7, o.z);
      this.scene.add(box);
    }
  }

  private makeAvatar(name: string, color: number) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 12), new THREE.MeshStandardMaterial({ color }));
    body.position.y = 0.7;
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.25), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    nose.position.set(0, 1.1, 0.3);
    g.add(body, nose, this.label(name));
    this.scene.add(g);
    return g;
  }

  private label(text: string) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = 'rgba(15,23,42,.75)';
    ctx.roundRect(0, 8, 256, 48, 24);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 26px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(text.slice(0, 18), 128, 42);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false }));
    s.scale.set(1.6, 0.4, 1);
    s.position.y = 1.9;
    return s;
  }

  spawnMe(name: string, x: number, z: number) {
    this.me ??= this.makeAvatar(name, THEME_COLORS.avatarSelf);
    this.me.position.set(x, 0, z);
  }

  teleportMe(x: number, z: number) {
    this.me?.position.set(x, 0, z);
  }

  upsertOther(id: string, name: string, x: number, z: number, r: number) {
    let a = this.others.get(id);
    if (!a) {
      a = { mesh: this.makeAvatar(name, THEME_COLORS.avatarOther), tx: x, tz: z, tr: r };
      a.mesh.position.set(x, 0, z);
      this.others.set(id, a);
    }
    a.tx = x; a.tz = z; a.tr = r;
  }

  moveOther(id: string, x: number, z: number, r: number) {
    const a = this.others.get(id);
    if (a) { a.tx = x; a.tz = z; a.tr = r; }
  }

  removeOther(id: string) {
    const a = this.others.get(id);
    if (a) { this.scene.remove(a.mesh); this.others.delete(id); }
  }

  private keyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    this.keys.add(e.key.toLowerCase());
  };
  private keyUp = (e: KeyboardEvent) => this.keys.delete(e.key.toLowerCase());

  private resize = () => {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.1);

    if (this.me) {
      const k = this.keys;
      const dx = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('arrowleft') ? 1 : 0);
      const dz = (k.has('s') || k.has('arrowdown') ? 1 : 0) - (k.has('w') || k.has('arrowup') ? 1 : 0);
      const moving = dx !== 0 || dz !== 0;
      if (moving) {
        const len = Math.hypot(dx, dz);
        const f = map.floor;
        this.me.position.x = THREE.MathUtils.clamp(this.me.position.x + (dx / len) * SPEED * dt, f.x0 + 0.4, f.x1 - 0.4);
        this.me.position.z = THREE.MathUtils.clamp(this.me.position.z + (dz / len) * SPEED * dt, f.z0 + 0.4, f.z1 - 0.4);
        this.me.rotation.y = Math.atan2(dx, dz);
      }
      this.sendAcc += dt;
      if (this.sendAcc >= 0.1) {
        this.sendAcc = 0;
        this.onMove?.(this.me.position.x, this.me.position.z, this.me.rotation.y, moving ? 1 : 0);
      }
      const p = this.me.position;
      const zone = map.zones.find((z) => p.x >= z.x0 && p.x <= z.x1 && p.z >= z.z0 && p.z <= z.z1)?.name ?? null;
      if (zone !== this.lastZone) { this.lastZone = zone; this.onZone?.(zone); }
      const near = (map.objects ?? []).find((o) => o.action && Math.hypot(o.x - p.x, o.z - p.z) < 1.8)?.action ?? null;
      if (near !== this.lastAction) { this.lastAction = near; this.onNearAction?.(near); }
      this.camera.position.lerp(new THREE.Vector3(p.x, 11, p.z + 10), 1 - Math.exp(-6 * dt));
      this.camera.lookAt(p.x, 0.8, p.z);
    }

    const t = 1 - Math.exp(-12 * dt);
    for (const a of this.others.values()) {
      a.mesh.position.x += (a.tx - a.mesh.position.x) * t;
      a.mesh.position.z += (a.tz - a.mesh.position.z) * t;
      a.mesh.rotation.y = a.tr;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    cancelAnimationFrame(this.raf);
    removeEventListener('resize', this.resize);
    removeEventListener('keydown', this.keyDown);
    removeEventListener('keyup', this.keyUp);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
