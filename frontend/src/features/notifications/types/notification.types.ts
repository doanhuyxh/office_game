import type { IPaged } from '@/types/api';

// Khớp DTO ở backend/src/Modules/Notification/.../Features/NotificationEndpoints.cs

/** NotificationCategories ở Notification.Contracts */
export type NotificationCategory = 'approval_requested' | 'approval_approved' | 'approval_rejected' | 'approval_cancelled' | 'approval_delegation' | 'contract_expiring' | 'probation_ending' | 'meeting_invited' | 'meeting_cancelled' | 'attendance_reminder' | 'payslip_ready' | 'contract_sign_requested' | 'contract_signed' | 'profile_change_requested' | 'profile_change_approved' | 'profile_change_rejected' | 'document_retention' | 'document_handover' | 'project_member_added' | 'account_security' | 'ai_alert';

/** Loại đối tượng (BE `NotificationTargetTypes`) — đặt theo tên đối tượng, không theo màn hình. */
export type NotificationTargetType = 'project_task' | 'project' | 'wiki_share' | 'approval_request' | 'approval_delegation' | 'chat_conversation' | 'news_post' | 'meeting_booking' | 'labor_contract' | 'payslip' | 'asset_device' | 'asset_service' | 'asset_review' | 'asset_handover' | 'employee' | 'social_account' | 'social_post' | 'document_asset' | 'expense_request' | 'sales_customer' | 'sales_contract' | 'sales_receivable' | 'profile_change_request' | 'page';

/** Đối tượng thông báo trỏ tới (TEST-237): client tự định tuyến (`utils/target.ts`); `page` có `params.key` = trang. */
export interface INotificationTarget {
  type: NotificationTargetType | string;
  id: string | null;
  params: Record<string, string> | null;
}

export interface INotification {
  id: string;
  category: NotificationCategory | string;
  title: string;
  body: string;
  /** Đường dẫn trong app, vd "/approvals" — G1 (TEST-237) giữ song song với `target`, chỉ dùng khi thiếu target. */
  link: string | null;
  target?: INotificationTarget | null;
  createdAt: string;
  read: boolean;
}

/** Một trang thông báo (BE `NotificationPage`); unreadCount = tổng chưa đọc, không phụ thuộc bộ lọc. */
export interface INotificationPage extends IPaged<INotification> {
  unreadCount: number;
}

export interface INotificationList {
  unreadCount: number;
  items: INotification[];
}

/** Tuỳ chọn nhận thông báo lưu ở server (theo tài khoản, mọi thiết bị). */
export interface INotificationPreferences {
  emailEnabled: boolean;
}
