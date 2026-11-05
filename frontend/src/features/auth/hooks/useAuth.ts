import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authApi, authKeys } from '../api/auth.api';
import type { IChangePasswordRequest, ILoginRequest, IResetPasswordRequest } from '../types/auth.types';

/** Dùng được cả trong component (useMe) lẫn route guard (queryClient.fetchQuery(meQuery)). */
export const meQuery = queryOptions({ queryKey: authKeys.me, queryFn: authApi.me, staleTime: 60_000 });

export const useMe = () => useQuery(meQuery);

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ILoginRequest) => authApi.login(body),
    onSuccess: (me) => qc.setQueryData(authKeys.me, me),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IChangePasswordRequest) => authApi.changePassword(body),
    onSuccess: () => qc.invalidateQueries({ queryKey: authKeys.me }),
  });
}

export const useForgotPassword = () => useMutation({ mutationFn: (email: string) => authApi.forgotPassword(email) });

export const useResetPassword = () => useMutation({ mutationFn: (body: IResetPasswordRequest) => authApi.resetPassword(body) });
