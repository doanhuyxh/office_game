/** Khớp với MeResponse trong backend/src/Modules/Identity/Features/Auth/AuthEndpoints.cs */
export interface IMe {
  id: string;
  userName: string;
  email: string | null;
  fullName: string;
  roles: string[];
  mustChangePassword: boolean;
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
