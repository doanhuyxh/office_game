// Facebook Business Manager (BM) ở Tài sản → MXH → Facebook BM — khớp DTO /api/assets/social/facebook/accounts (TEST-207).
import type { SocialAccountStatus, SocialPlatform, SocialTokenStatus } from './asset.types';

/** Token không bao giờ trả về trình duyệt — chỉ `hasToken` + trạng thái. */
export interface IFacebookAccount {
  id: string; platform: SocialPlatform; name: string; externalId: string | null; loginHint: string | null; ownerDepartmentId: string | null;
  ownerDepartmentName: string | null; status: SocialAccountStatus; holderEmployeeId: string | null; holderName: string | null; holderCode: string | null;
  note: string | null; hasToken: boolean; tokenStatus: SocialTokenStatus; tokenError: string | null; tokenCheckedAt: string | null;
  tokenOwnerName: string | null; pagesSyncedAt: string | null; pageCount: number; createdAt: string;
  /** Quyền của token (GET /me/permissions) — null = chưa lấy được. Token lỗi → giữ danh sách của lần kiểm tra thành công trước. */
  tokenPermissions: IFacebookTokenPermission[] | null;
  /** Token hợp lệ nhưng không lấy được danh sách quyền. */
  tokenPermissionsError: string | null;
  /** Quyền OfficeHub cần mà token không có (rỗng khi chưa lấy được danh sách). */
  missingPermissions: IFacebookMissingPermission[];
}
/** status: granted / declined / expired. required = OfficeHub cần quyền này. */
export interface IFacebookTokenPermission { permission: string; status: string; required: boolean }
export interface IFacebookMissingPermission { permission: string; impact: string }
export interface IFacebookPage {
  id: string; accountId: string; accountName: string; externalId: string; name: string; category: string | null; link: string | null;
  pictureUrl: string | null; isActive: boolean; canPost: boolean; syncedAt: string;
}
export interface IFacebookAssignment {
  id: string; employeeId: string; employeeName: string; employeeCode: string; assignedAt: string; assignedByName: string | null;
  assignNote: string | null; returnedAt: string | null; returnedByName: string | null; returnNote: string | null;
}
export interface IFacebookAccountDetail { account: IFacebookAccount; pages: IFacebookPage[]; history: IFacebookAssignment[] }
export interface IFacebookAccountRequest {
  name: string; externalId: string | null; loginHint: string | null; ownerDepartmentId: string | null; note: string | null; token?: string | null;
}
