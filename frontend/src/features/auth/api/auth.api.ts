import { ApiError, http, httpPost } from '@/services/api-client';
import type {
  IChangePasswordRequest, ILoginRequest, ILoginTwoFactorRequest, IMe, IRecoveryCodes, IResetPasswordRequest, ITwoFactorSetup, ITwoFactorStatus,
} from '../types/auth.types';

/** Query key của module auth (dùng để invalidate). */
export const authKeys = {
  me: ['auth', 'me'] as const,
  twoFactor: ['auth', '2fa'] as const,
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
  /** Bước 2: mã 6 số từ ứng dụng xác thực hoặc mã dự phòng (cookie tạm do bước 1 cấp, hạn 5 phút). */
  loginTwoFactor: (body: ILoginTwoFactorRequest) => httpPost<IMe>('/api/auth/login/2fa', { rememberMe: true, ...body }),
  logout: () => httpPost<void>('/api/auth/logout'),
  changePassword: (body: IChangePasswordRequest) => httpPost<void>('/api/auth/change-password', body),
  /** Luôn thành công (server không tiết lộ email có tồn tại hay không). */
  forgotPassword: (email: string) => httpPost<void>('/api/auth/forgot-password', { email }),
  /** Đặt mật khẩu qua link trong email (lời mời hoặc quên mật khẩu). */
  resetPassword: (body: IResetPasswordRequest) => httpPost<void>('/api/auth/reset-password', body),
};

/** Xác thực 2 lớp (TOTP) của chính mình. */
export const twoFactorApi = {
  status: () => http<ITwoFactorStatus>('/api/auth/2fa/status'),
  /** Lấy khoá đang chờ xác nhận (tạo nếu chưa có); reset = tạo khoá mới. */
  setup: (reset = false) => httpPost<ITwoFactorSetup>('/api/auth/2fa/setup', { reset }),
  enable: (code: string) => httpPost<IRecoveryCodes>('/api/auth/2fa/enable', { code }),
  disable: (currentPassword: string, code: string) => httpPost<void>('/api/auth/2fa/disable', { currentPassword, code }),
  regenerateRecoveryCodes: (code: string) => httpPost<IRecoveryCodes>('/api/auth/2fa/recovery-codes', { code }),
};
