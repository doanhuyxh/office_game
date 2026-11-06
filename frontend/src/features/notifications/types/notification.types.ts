// Khớp DTO ở backend/src/Modules/Notification/.../Features/NotificationEndpoints.cs

/** NotificationCategories ở Notification.Contracts */
export type NotificationCategory = 'approval_requested' | 'approval_approved' | 'approval_rejected' | 'approval_cancelled' | 'contract_expiring' | 'meeting_invited' | 'meeting_cancelled' | 'attendance_reminder' | 'payslip_ready' | 'contract_sign_requested' | 'contract_signed';

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

export interface INotificationList {
  unreadCount: number;
  items: INotification[];
}
