import type { IPaged } from '@/types/api';

// Khớp DTO ở backend/src/Modules/Notification/.../Features/NotificationEndpoints.cs

/** NotificationCategories ở Notification.Contracts */
export type NotificationCategory = 'approval_requested' | 'approval_approved' | 'approval_rejected' | 'approval_cancelled' | 'approval_delegation' | 'contract_expiring' | 'probation_ending' | 'meeting_invited' | 'meeting_cancelled' | 'attendance_reminder' | 'payslip_ready' | 'contract_sign_requested' | 'contract_signed' | 'profile_change_requested' | 'profile_change_approved' | 'profile_change_rejected' | 'document_retention' | 'document_handover' | 'project_member_added';

export interface INotification {
  id: string;
  category: NotificationCategory | string;
  title: string;
  body: string;
  /** Đường dẫn trong app, vd "/approvals" */
  link: string | null;
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
