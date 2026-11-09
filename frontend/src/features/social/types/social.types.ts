// Khớp DTO back-end `OfficeHub.Modules.Assets/Features/SocialDtos.cs` (camelCase; enum = chuỗi; thời điểm = ISO UTC).
export type SocialMediaKind = 'Image' | 'Video';
export type SocialTargetStatus = 'Pending' | 'Publishing' | 'Published' | 'Failed' | 'Cancelled';
export type SocialPostStatus = 'Scheduled' | 'Publishing' | 'Published' | 'PartiallyFailed' | 'Failed' | 'Cancelled';

/** Fanpage được đăng (HR: mọi trang; nhân viên: trang của BM đang giữ). `canPost` = có page token. */
export interface ISocialPage {
  id: string; accountId: string; accountName: string; externalId: string; name: string; category: string | null; link: string | null;
  pictureUrl: string | null; isActive: boolean; canPost: boolean; syncedAt: string;
}
export interface ISocialMedia { id: string; kind: SocialMediaKind; fileName: string; contentType: string; size: number }
export interface ISocialTarget {
  id: string; pageId: string; pageName: string; pagePictureUrl: string | null; status: SocialTargetStatus; dueAt: string; attempts: number;
  publishedAt: string | null; permalink: string | null; error: string | null; cancelledAt: string | null; cancelledByName: string | null; canRetry: boolean;
}
export interface ISocialPost {
  id: string; message: string; link: string | null; scheduledAt: string | null; createdAt: string; authorName: string; status: SocialPostStatus;
  targets: ISocialTarget[]; media: ISocialMedia[]; canCancel: boolean;
}
/** `scheduledAt` null = đăng ngay. */
export interface ISocialPostRequest { message: string; link: string | null; pageIds: string[]; mediaIds: string[]; scheduledAt: string | null }
