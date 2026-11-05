/** Màu hex dùng ở nơi không dùng được class Tailwind (canvas, Three.js, chart). */
export const THEME_COLORS = {
  primary: '#2563eb',
  success: '#22c55e',
  warning: '#f59e0b',
  danger: '#ef4444',
  muted: '#94a3b8',
  /** Màu khu vực trên bản đồ văn phòng 3D (id zone trong shared/office-map.json) */
  zones: { work: 0x334155, meeting: 0x1e3a8a, pantry: 0x713f12, lounge: 0x14532d, reception: 0x581c87 } as Record<string, number>,
  avatarSelf: 0x3b82f6,
  avatarOther: 0x22c55e,
} as const;
