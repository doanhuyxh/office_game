import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { ANIM, Avatar, type AnimCode } from '../../engine/avatar';
import type { AvatarLook } from '../../engine/avatarLook';
import { chair } from '../../engine/furniture';

export type PreviewPose = 'idle' | 'walk' | 'sit';

/**
 * Xem trước nhân vật (Three.js riêng, không phụ thuộc văn phòng): kéo để xoay, tư thế đứng / đi / ngồi (có ghế).
 * Dùng chung Avatar + model GLB với văn phòng → giống hệt lúc vào văn phòng.
 */
export function AvatarPreview({ look, pose, waveKey, className }: { look: AvatarLook; pose: PreviewPose; waveKey: number; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const ctx = useRef<{ avatar: Avatar; chair: THREE.Object3D } | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    host.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb8c2cc, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(2, 5, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.1, 40), new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const seat = new THREE.Group();
    for (const p of chair()) {
      const m = new THREE.Mesh(p.geo, new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.8, flatShading: true }));
      m.castShadow = true;
      seat.add(m);
    }
    seat.visible = false;
    const turn = new THREE.Group();
    turn.add(seat);
    scene.add(turn);
    const avatar = new Avatar('preview', ' ', false, look, false);
    turn.add(avatar.root);
    ctx.current = { avatar, chair: seat };
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);

    const resize = () => {
      const w = host.clientWidth || 1, h = host.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    // Kéo để xoay; thả ra thì xoay chậm lại
    let drag: { x: number; rot: number } | null = null;
    let spin = 0.35;
    turn.rotation.y = 0.5;
    const el = renderer.domElement;
    el.style.touchAction = 'none';
    el.style.cursor = 'grab';
    const down = (e: PointerEvent) => { drag = { x: e.clientX, rot: turn.rotation.y }; spin = 0; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; };
    const move = (e: PointerEvent) => { if (drag) turn.rotation.y = drag.rot + (e.clientX - drag.x) * 0.012; };
    const up = () => { drag = null; el.style.cursor = 'grab'; };
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    const clock = new THREE.Clock();
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(clock.getDelta(), 0.05);
      if (!drag) turn.rotation.y += spin * dt;
      avatar.update(dt);
      const sitting = avatar.anim === ANIM.sit;
      camera.position.set(0, sitting ? 1.15 : 1.25, 4.1);
      camera.lookAt(0, sitting ? 0.62 : 0.85, 0);
      renderer.render(scene, camera);
    };
    loop();

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      avatar.dispose();
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o as THREE.SkinnedMesh).isSkinnedMesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
      });
      renderer.dispose();
      el.remove();
      ctx.current = null;
    };
    // Dựng một lần; look / pose cập nhật qua effect riêng
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { ctx.current?.avatar.setLook(look); }, [look]);
  useEffect(() => {
    const c = ctx.current;
    if (!c) return;
    const code: AnimCode = pose === 'walk' ? ANIM.walk : pose === 'sit' ? ANIM.sit : ANIM.idle;
    c.avatar.anim = code;
    c.chair.visible = pose === 'sit';
    // Ghế ở sau lưng (lưng ghế -z, người ngồi nhìn +z — giống furniture.chair)
    c.avatar.root.position.set(0, 0, 0);
  }, [pose]);
  useEffect(() => { if (waveKey) ctx.current?.avatar.wave(); }, [waveKey]);

  return <div ref={hostRef} className={className} data-testid="avatar-preview" />;
}
