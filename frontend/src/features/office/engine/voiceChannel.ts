import type { OfficeMapV2 } from './mapTypes';

/** Kênh voice: id phòng có tường (kênh riêng) hoặc "open" (khu mở, nghe theo khoảng cách). */
export interface VoiceChannelInfo { id: string; name: string; meeting: boolean }

export const OPEN_CHANNEL = 'open';

/**
 * ⚠ Giống OfficeMap.VoiceAt ở server (backend/src/OfficeHub.Realtime/Simulation/OfficeMap.cs) — server mới là nơi quyết định
 * room LiveKit; FE chỉ dùng để biết lúc nào cần đổi kênh và hiện tên kênh.
 */
export function voiceChannelAt(map: OfficeMapV2, x: number, z: number): VoiceChannelInfo {
  const room = map.rooms.find((r) => r.walls && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  return room ? { id: room.id, name: room.name, meeting: room.voice === 'room' } : { id: OPEN_CHANNEL, name: 'Khu mở', meeting: false };
}

/** Âm lượng theo khoảng cách ở kênh không phải phòng họp: ≤ 2 m nghe rõ, giảm dần, ≥ 6 m tắt. */
export const VOICE_NEAR = 2;
export const VOICE_FAR = 6;
export function voiceVolume(dist: number) {
  if (dist <= VOICE_NEAR) return 1;
  if (dist >= VOICE_FAR) return 0;
  const t = (dist - VOICE_NEAR) / (VOICE_FAR - VOICE_NEAR);
  return (1 - t) * (1 - t); // giảm nhanh lúc đầu, nghe tự nhiên hơn tuyến tính
}
