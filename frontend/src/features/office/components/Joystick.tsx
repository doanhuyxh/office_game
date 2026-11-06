import { useRef, useState } from 'react';

const R = 52; // bán kính vùng kéo (px)

/**
 * Joystick ảo cho màn hình cảm ứng: kéo núm trong vòng tròn → onChange(x, y) với x phải +, y xuống +, độ lớn ≤ 1.
 * Thả tay → (0, 0). Dùng Pointer Events + setPointerCapture (kéo ra ngoài vòng vẫn theo ngón tay).
 */
export function Joystick({ onChange }: { onChange: (x: number, y: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const move = (e: React.PointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    setKnob({ x: dx, y: dy });
    onChange(dx / R, dy / R);
  };
  const end = () => { setKnob({ x: 0, y: 0 }); onChange(0, 0); };

  return (
    <div ref={base} className="joystick" data-testid="office-joystick"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e); }}
      onPointerMove={(e) => { if (e.currentTarget.hasPointerCapture(e.pointerId)) move(e); }}
      onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
      <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
