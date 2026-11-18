import { useEffect, useState } from 'react';
import type { FpsStats, OfficeScene } from '../../engine/OfficeScene';

const HIDDEN_KEY = 'officehub.office.fps-hidden';
const readHidden = () => { try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch { return false; } };

/** Ngưỡng màu: ≥ 50 tốt (xanh), 30–49 tạm (vàng), < 30 giật (đỏ). */
const tone = (fps: number) => (fps >= 50 ? 'good' : fps >= 30 ? 'mid' : 'bad');

/**
 * Ô FPS thật đang render (TEST-176), góc phải dưới cụm camera. Engine đo theo cửa sổ ~0,5 s (`scene.onFps`) nên HUD chỉ cập nhật
 * 2 lần / giây, không setState mỗi khung. Bấm để thu gọn còn chữ "FPS" (thôi đo) / mở lại; lựa chọn nhớ ở localStorage.
 * Tab bị ẩn → engine báo null → hiện "–" tới khi đo xong cửa sổ đầu tiên.
 */
export function FpsMeter({ scene }: { scene: OfficeScene | null }) {
  const [hidden, setHidden] = useState(readHidden);
  const [stats, setStats] = useState<FpsStats | null>(null);

  useEffect(() => {
    if (!scene || hidden) return;
    scene.onFps = setStats;
    return () => { scene.onFps = undefined; setStats(null); };
  }, [scene, hidden]);

  const toggle = () => {
    const v = !hidden;
    setHidden(v);
    try { localStorage.setItem(HIDDEN_KEY, v ? '1' : '0'); } catch { /* bỏ qua */ }
  };

  const fps = stats ? Math.round(stats.fps) : null;
  return (
    <button type="button" className={`card fps-meter ${hidden ? 'collapsed' : fps === null ? '' : tone(fps)}`} onClick={toggle}
      aria-pressed={!hidden} data-testid="office-fps"
      title={hidden ? 'Hiện số khung hình / giây (FPS)' : `Khung hình / giây đang render${stats ? ` · ${stats.ms.toFixed(1)} ms / khung` : ''} — bấm để ẩn`}>
      {hidden ? 'FPS' : <><b>{fps ?? '–'}</b> FPS{stats && <small>{stats.ms.toFixed(1)} ms</small>}</>}
    </button>
  );
}
