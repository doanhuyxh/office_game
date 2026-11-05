/** Vai trò — khớp với OfficeHub.BuildingBlocks.Auth.Roles ở back-end. */
export const ROLE = { admin: 'admin', hr: 'hr', manager: 'manager', employee: 'employee' } as const;
export type Role = (typeof ROLE)[keyof typeof ROLE];
