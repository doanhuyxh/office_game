import { http } from '@/services/api-client';
import type { AvatarLook } from '../engine/avatarLook';

/** Nhân vật văn phòng 3D của chính mình (Identity: PUT/DELETE /api/auth/avatar; đọc qua /api/auth/me → avatar). */
export const avatarApi = {
  /** Server kiểm tra theo shared/avatar-catalog.json, trả bản đã chuẩn hoá. */
  save: (look: AvatarLook) => http<AvatarLook>('/api/auth/avatar', { method: 'PUT', body: JSON.stringify(look) }),
  /** Về nhân vật mặc định chung. */
  reset: () => http<void>('/api/auth/avatar', { method: 'DELETE' }),
};
