import type { IMe } from '../types/auth.types';

/** Kiểm tra vai trò ở client (ẩn/hiện menu). Server mới là nơi kiểm tra quyền thật. */
export const hasRole = (me: IMe | null | undefined, ...roles: string[]) => !!me && roles.some((r) => me.roles.includes(r));
