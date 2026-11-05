import { useEffect, useRef } from 'react';
import { wallRect, wallSegments } from '../engine/navGrid';
import { OFFICE_MAP } from '../engine/officeMap';
import type { OfficeScene } from '../engine/OfficeScene';

const SCALE = 9; // px / m
const FLOOR: Record<string, string> = { office: '#e8dfd0', meeting: '#dbe7f5', booth: '#e0eef8', open: '#f1f5f9', lounge: '#d9efdf', lobby: '#f6ead2', pantry: '#f5efcf' };

/** Vẽ lớp tĩnh (sàn, tường, bàn ghế) một lần. */
function drawStatic(ctx: CanvasRenderingContext2D) {
  const m = OFFICE_MAP, f = m.floor;
  const X = (x: number) => (x - f.x0) * SCALE, Z = (z: number) => (z - f.z0) * SCALE;
  ctx.fillStyle = '#f1f5f9';
  ctx.fillRect(0, 0, X(f.x1), Z(f.z1));
  for (const r of m.rooms) { ctx.fillStyle = FLOOR[r.kind] ?? '#f1f5f9'; ctx.fillRect(X(r.x0), Z(r.z0), (r.x1 - r.x0) * SCALE, (r.z1 - r.z0) * SCALE); }
  ctx.fillStyle = '#94a3b8';
  for (const o of m.objects) if (o.solid) {
    const [w, d] = o.rot % 180 === 0 ? [o.w, o.d] : [o.d, o.w];
    ctx.fillRect(X(o.x - w / 2), Z(o.z - d / 2), w * SCALE, d * SCALE);
  }
  const wall = (r: typeof f, glass: boolean, doors: Parameters<typeof wallSegments>[1]) => {
    ctx.fillStyle = glass ? '#38bdf8' : '#334155';
    for (const s of wallSegments(r, doors)) { const w = wallRect(r, s); ctx.fillRect(X(w.x0), Z(w.z0), Math.max(2, (w.x1 - w.x0) * SCALE), Math.max(2, (w.z1 - w.z0) * SCALE)); }
  };
  for (const r of m.rooms) if (r.walls) wall(r, !!r.glass, r.doors);
  wall(f, false, m.outerDoors);
}

/** Bản đồ nhỏ góc phải: mình (xanh, có hướng), người khác (cam), điểm đang đi tới. Bấm vào bản đồ → đi tới đó. */
export function Minimap({ scene }: { scene: OfficeScene | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const f = OFFICE_MAP.floor;
  const w = (f.x1 - f.x0) * SCALE, h = (f.z1 - f.z0) * SCALE;

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext('2d')!;
    const base = document.createElement('canvas');
    base.width = w; base.height = h;
    drawStatic(base.getContext('2d')!);
    let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 150) return; // ~7 lần/giây là đủ
      last = t;
      const s = scene.snapshot();
      ctx.drawImage(base, 0, 0);
      const X = (x: number) => (x - f.x0) * SCALE, Z = (z: number) => (z - f.z0) * SCALE;
      ctx.fillStyle = '#f97316';
      for (const o of s.others) { ctx.beginPath(); ctx.arc(X(o.x), Z(o.z), 3.5, 0, Math.PI * 2); ctx.fill(); }
      if (s.target) { ctx.strokeStyle = '#2563eb'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(s.target[0]), Z(s.target[1]), 4, 0, Math.PI * 2); ctx.stroke(); }
      if (s.me) {
        const { x, z, r } = s.me;
        ctx.save();
        ctx.translate(X(x), Z(z));
        ctx.rotate(-r);
        ctx.fillStyle = '#2563eb';
        ctx.beginPath(); ctx.moveTo(0, 7); ctx.lineTo(-4.5, -4); ctx.lineTo(4.5, -4); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [scene, w, h, f.x0, f.z0]);

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    scene?.walkTo(f.x0 + ((e.clientX - rect.left) / rect.width) * (f.x1 - f.x0), f.z0 + ((e.clientY - rect.top) / rect.height) * (f.z1 - f.z0));
  };

  return <canvas ref={ref} width={w} height={h} className="card minimap" onClick={click} title="Bấm để đi tới" data-testid="office-minimap" />;
}
