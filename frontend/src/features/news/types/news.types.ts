export type PostAudience = 'Company' | 'Departments' | 'Custom' | 'Private';
export type MediaKind = 'Image' | 'Video' | 'File';
export type TargetKind = 'Department' | 'User';
export type ReactionType = 'Like' | 'Love' | 'Haha' | 'Wow' | 'Sad' | 'Angry';

export interface IAuthor { userId: string; employeeId: string | null; name: string; departmentName: string | null }
export interface IMedia { id: string; kind: MediaKind; fileName: string; contentType: string; size: number; url: string | null }
export interface IAudienceTarget { kind: TargetKind; id: string; name: string }

export interface IPost {
  id: string; seq: number; author: IAuthor; contentHtml: string | null; plainText: string; audience: PostAudience;
  targets: IAudienceTarget[]; commentsDisabled: boolean; pinned: boolean; createdAt: string; editedAt: string | null;
  hidden: boolean; hiddenReason: string | null; media: IMedia[]; reactionCount: number; reactions: Partial<Record<ReactionType, number>>;
  myReaction: ReactionType | null; commentCount: number; emailSent: boolean; canEdit: boolean; canDelete: boolean; canHide: boolean;
  /** Giờ hẹn đăng (bài chưa đăng — chỉ tác giả thấy). */
  publishAt?: string | null;
  /** Số người đã xem — chỉ tác giả / HR (người khác null). */
  viewCount?: number | null;
  /** Bài gốc được chia sẻ; sharedPost null = người xem không xem được bài gốc / bài gốc đã xoá. */
  sharedPostId?: string | null;
  sharedPost?: IPost | null;
}

export interface IViewer { userId: string; name: string; code: string | null; departmentName: string | null; viewedAt: string }
export interface IViewers { count: number; audienceCount: number; items: IViewer[] }

export interface IFeed { pinned: IPost[]; items: IPost[]; nextCursor: number | null }

export interface IComment {
  id: string; seq: number; postId: string; parentId: string | null; author: IAuthor; text: string | null; imageUrl: string | null;
  createdAt: string; editedAt: string | null; hidden: boolean; hiddenReason: string | null; deleted: boolean; reactionCount: number;
  myReaction: ReactionType | null; canEdit: boolean; canDelete: boolean; canHide: boolean;
}
export interface ICommentPage { items: IComment[]; hasMore: boolean }

export interface IReactionSummary { total: number; counts: Partial<Record<ReactionType, number>>; mine: ReactionType | null }
export interface IReactor { userId: string; name: string; type: ReactionType }

export interface ITargetRequest { kind: TargetKind; id: string }
export interface IPostRequest {
  contentHtml: string; audience: PostAudience; targets: ITargetRequest[]; uploadIds: string[]; sendEmail: boolean; commentsDisabled: boolean;
  publishAt?: string | null; sharedPostId?: string | null;
}
export interface IEditPostRequest {
  contentHtml: string; audience: PostAudience; targets: ITargetRequest[]; uploadIds: string[]; removeMediaIds: string[]; commentsDisabled: boolean;
  /** Chỉ với bài đang hẹn giờ: đổi giờ hẹn / đăng ngay. */
  publishAt?: string | null; publishNow?: boolean;
}

export interface IUploadTicket { id: string; url: string; contentType: string; kind: MediaKind; expiresAt: string }
export interface IPerson { userId: string; fullName: string; code: string; departmentName: string | null }
export interface IDepartment { id: string; name: string; parentId: string | null }
