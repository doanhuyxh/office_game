import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, authKeys, twoFactorApi } from '../api/auth.api';
import type { ILoginTwoFactorRequest } from '../types/auth.types';

/** Bước 2 đăng nhập: thành công → lưu `me` như đăng nhập thường. */
export function useLoginTwoFactor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ILoginTwoFactorRequest) => authApi.loginTwoFactor(body),
    onSuccess: (me) => qc.setQueryData(authKeys.me, me),
  });
}

export const useTwoFactorStatus = () => useQuery({ queryKey: authKeys.twoFactor, queryFn: twoFactorApi.status });

/** Khoá + URI cho mã QR. Là mutation (POST) để gọi đúng một lần khi mở trang và khi bấm "Tạo mã mới". */
export const useTwoFactorSetup = () => useMutation({ mutationFn: (reset: boolean) => twoFactorApi.setup(reset) });

/** Bật / tắt đổi security stamp → server cấp lại cookie; làm mới `me` (hết cờ mustSetupTwoFactor) + trạng thái. */
function useInvalidateAuth() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: authKeys.me }), qc.invalidateQueries({ queryKey: authKeys.twoFactor })]);
}

export function useEnableTwoFactor() {
  const invalidate = useInvalidateAuth();
  return useMutation({ mutationFn: (code: string) => twoFactorApi.enable(code), onSuccess: invalidate });
}

export function useDisableTwoFactor() {
  const invalidate = useInvalidateAuth();
  return useMutation({
    mutationFn: (v: { currentPassword: string; code: string }) => twoFactorApi.disable(v.currentPassword, v.code),
    onSuccess: invalidate,
  });
}

export function useRegenerateRecoveryCodes() {
  const invalidate = useInvalidateAuth();
  return useMutation({ mutationFn: (code: string) => twoFactorApi.regenerateRecoveryCodes(code), onSuccess: invalidate });
}
