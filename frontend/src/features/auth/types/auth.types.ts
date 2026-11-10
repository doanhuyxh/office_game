/** Khớp với MeResponse trong backend/src/Modules/Identity/Features/Auth/AuthEndpoints.cs */
export interface IMe {
  id: string;
  userName: string;
  email: string | null;
  fullName: string;
  roles: string[];
  mustChangePassword: boolean;
  /** Đã bật xác thực 2 lớp (TOTP). */
  twoFactorEnabled: boolean;
  /** Admin / HR chưa bật 2FA → phải bật trước (BE chặn API khác bằng 403 `2fa_setup_required`). */
  mustSetupTwoFactor: boolean;
  /** Ngoại hình nhân vật văn phòng 3D (xem features/office/engine/avatarLook.ts); null = nhân vật mặc định. */
  avatar?: unknown;
  /** Tài khoản do bot / agent AI vận hành (HR đánh dấu). */
  isBot?: boolean;
}

export interface ILoginRequest {
  login: string;
  password: string;
  rememberMe?: boolean;
}

export interface IResetPasswordRequest {
  userId: string;
  token: string;
  newPassword: string;
}

export interface IChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

/** Bước 2 đăng nhập (sau khi /login trả 403 `2fa_required`). */
export interface ILoginTwoFactorRequest {
  code: string;
  isRecoveryCode?: boolean;
  rememberMe?: boolean;
}

export interface ITwoFactorStatus {
  enabled: boolean;
  /** Admin / HR: bắt buộc, không tự tắt được. */
  required: boolean;
  recoveryCodesLeft: number;
}

export interface ITwoFactorSetup {
  /** Khoá base32 nhóm 4 ký tự (nhập tay). */
  sharedKey: string;
  /** otpauth://totp/… → mã QR */
  authenticatorUri: string;
}

export interface IRecoveryCodes {
  recoveryCodes: string[];
}
