import { ApiError, http, httpPost } from '@/services/api-client';
import type { IChangePasswordRequest, ILoginRequest, IMe, IResetPasswordRequest } from '../types/auth.types';

/** Query key của module auth (dùng để invalidate). */
export const authKeys = {
  me: ['auth', 'me'] as const,
};

export const authApi = {
  /** null = chưa đăng nhập */
  me: async (): Promise<IMe | null> => {
    try {
      return await http<IMe>('/api/auth/me');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  login: (body: ILoginRequest) => httpPost<IMe>('/api/auth/login', { rememberMe: true, ...body }),
  logout: () => httpPost<void>('/api/auth/logout'),
  changePassword: (body: IChangePasswordRequest) => httpPost<void>('/api/auth/change-password', body),
  /** Luôn thành công (server không tiết lộ email có tồn tại hay không). */
  forgotPassword: (email: string) => httpPost<void>('/api/auth/forgot-password', { email }),
  /** Đặt mật khẩu qua link trong email (lời mời hoặc quên mật khẩu). */
  resetPassword: (body: IResetPasswordRequest) => httpPost<void>('/api/auth/reset-password', body),
};
