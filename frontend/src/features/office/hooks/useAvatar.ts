import { useMutation, useQueryClient } from '@tanstack/react-query';
import { authKeys, useMe, type IMe } from '@/features/auth';
import { avatarApi } from '../api/avatar.api';
import { parseLook, validLook, type AvatarLook } from '../engine/avatarLook';

/** Ngoại hình đã lưu của mình (null = chưa chọn → nhân vật mặc định). */
export function useMyLook(): { look: AvatarLook; saved: boolean } {
  const { data: me } = useMe();
  const saved = validLook(me?.avatar);
  return { look: saved ?? parseLook(null), saved: saved !== null };
}

/** Lưu (look) hoặc về mặc định (null); cập nhật luôn cache /api/auth/me. */
export function useSaveAvatar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (look: AvatarLook | null) => (look ? await avatarApi.save(look) : (await avatarApi.reset(), null)),
    onSuccess: (avatar) => qc.setQueryData<IMe | null>(authKeys.me, (me) => (me ? { ...me, avatar } : me)),
  });
}
