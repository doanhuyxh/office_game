import type { OfficeMapV2 } from './mapTypes';

/**
 * Kênh voice: id phòng có tường (kênh riêng) hoặc "open" (khu mở, nghe theo khoảng cách).
 * `meeting` = phòng họp (cả phòng nghe rõ); `screen` = được chia sẻ màn hình (mọi phòng có tường, người cùng phòng xem).
 */
export interface VoiceChannelInfo { id: string; name: string; meeting: boolean; screen: boolean }

export const OPEN_CHANNEL = 'open';

/**
 * ⚠ Giống OfficeMap.VoiceAt ở server (backend/src/OfficeHub.Realtime/Simulation/OfficeMap.cs) — server mới là nơi quyết định
 * room LiveKit; FE chỉ dùng để biết lúc nào cần đổi kênh và hiện tên kênh.
 */
export function voiceChannelAt(map: OfficeMapV2, x: number, z: number): VoiceChannelInfo {
  const room = map.rooms.find((r) => r.walls && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1);
  return room ? { id: room.id, name: room.name, meeting: room.voice === 'room', screen: true }
    : { id: OPEN_CHANNEL, name: 'Khu mở', meeting: false, screen: false };
}

/** Âm lượng theo khoảng cách ở kênh không phải phòng họp: ≤ 2 m nghe rõ, giảm dần, ≥ 6 m tắt. */
export const VOICE_NEAR = 2;
/** ⚠ PHẢI khớp OfficeMap.HearRange ở server (phạm vi xem bot — TEST-95). */
export const VOICE_FAR = 6;
export function voiceVolume(dist: number) {
  if (dist <= VOICE_NEAR) return 1;
  if (dist >= VOICE_FAR) return 0;
  const t = (dist - VOICE_NEAR) / (VOICE_FAR - VOICE_NEAR);
  return (1 - t) * (1 - t); // giảm nhanh lúc đầu, nghe tự nhiên hơn tuyến tính
}

/**
 * Hai vị trí nghe được nhau (⚠ giống OfficeMap.CanHear ở server — dùng cho phạm vi "bấm vào bot để xem", TEST-97): cùng kênh voice;
 * phòng họp (`voice: "room"`) → cả phòng; còn lại → cách nhau ≤ VOICE_FAR (+ `slack`). FE chỉ dùng để gợi ý "lại gần hơn" trước khi gọi
 * WatchBot — server mới là nơi quyết định (kiểm lại khi bắt đầu xem và mỗi giây khi đang xem, nới +1 m).
 */
export function canHear(map: OfficeMapV2, x1: number, z1: number, x2: number, z2: number, slack = 0): boolean {
  const a = voiceChannelAt(map, x1, z1);
  if (a.id !== voiceChannelAt(map, x2, z2).id) return false;
  if (a.meeting) return true;
  const range = VOICE_FAR + slack, dx = x1 - x2, dz = z1 - z2;
  return dx * dx + dz * dz <= range * range;
}
