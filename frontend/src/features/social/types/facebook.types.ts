// Khớp DTO back-end `OfficeHub.Modules.Assets/Features/SocialDtos.cs` (camelCase; enum = chuỗi; thời điểm = ISO UTC).
export type FacebookMediaKind = 'Image' | 'Video';
export type FacebookTargetStatus = 'Pending' | 'Publishing' | 'Published' | 'Failed' | 'Cancelled';
export type FacebookPostStatus = 'Scheduled' | 'Publishing' | 'Published' | 'PartiallyFailed' | 'Failed' | 'Cancelled';

/** Fanpage được đăng (HR: mọi trang; nhân viên: trang của BM đang giữ). `canPost` = có page token. */
export interface IFacebookPage {
  id: string; accountId: string; accountName: string; externalId: string; name: string; category: string | null; link: string | null;
  pictureUrl: string | null; isActive: boolean; canPost: boolean; syncedAt: string;
}
export interface IFacebookMedia { id: string; kind: FacebookMediaKind; fileName: string; contentType: string; size: number }
export interface IFacebookTarget {
  id: string; pageId: string; pageName: string; pagePictureUrl: string | null; status: FacebookTargetStatus; dueAt: string; attempts: number;
  publishedAt: string | null; permalink: string | null; error: string | null; cancelledAt: string | null; cancelledByName: string | null; canRetry: boolean;
}
export interface IFacebookPost {
  id: string; message: string; link: string | null; scheduledAt: string | null; createdAt: string; authorName: string; status: FacebookPostStatus;
  targets: IFacebookTarget[]; media: IFacebookMedia[]; canCancel: boolean;
}
/** `scheduledAt` null = đăng ngay. */
export interface IFacebookPostRequest { message: string; link: string | null; pageIds: string[]; mediaIds: string[]; scheduledAt: string | null }
