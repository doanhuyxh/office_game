/** Khớp với MeResponse trong backend/src/Modules/Identity/Features/Auth/AuthEndpoints.cs */
export interface IMe {
  id: string;
  userName: string;
  email: string | null;
  fullName: string;
  roles: string[];
  mustChangePassword: boolean;
  /** Ngoại hình nhân vật văn phòng 3D (xem features/office/engine/avatarLook.ts); null = nhân vật mặc định. */
  avatar?: unknown;
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
