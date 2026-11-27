import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { BellRing, Bot, Building, FileCheck2, Gauge, HardDrive, KeyRound, Mail, Network, Send, ShieldCheck, Timer, Video } from 'lucide-react';
import { DocumentSettingsCard } from '@/features/documents';
import { AgentMeetingSettingsCard } from '@/features/meetings';
import { AgentLimitsCard } from '@/features/projects';
import { AiAlertSettingsCard } from '@/features/reports';
import { CompanySettingsSection } from '../components/company-settings-section';
import { DbSettingsSection } from '../components/db-settings-section';
import { FcmSettingsSection } from '../components/fcm-settings-section';
import { OfficeIpsCard } from '../components/office-ips-card';
import { PasswordPolicySection } from '../components/password-policy-section';
import { S3SettingsSection } from '../components/s3-settings-section';
import { SmtpSettingsSection } from '../components/smtp-settings-section';
import { SessionSettingsSection } from '../components/session-settings-section';
import { TelegramSettingsSection } from '../components/telegram-settings-section';
import { TwoFactorPolicySection } from '../components/two-factor-policy-section';
import type { SettingsGroupKey } from '../types/system.types';

/** Nhóm của menu trái tab Cấu hình (thứ tự hiển thị). */
export const CONFIG_GROUPS = ['Chung', 'Hạ tầng', 'Bảo mật', 'Thông báo', 'Chấm công', 'Trợ lý AI', 'Tài liệu'] as const;
export type ConfigGroup = (typeof CONFIG_GROUPS)[number];

export interface IConfigSection {
  /** Giá trị `?section=` trên URL. */
  id: string;
  group: ConfigGroup;
  label: string;
  icon: LucideIcon;
  /** Chỉ gọi khi mục đang mở → API của mục chỉ tải khi mở. */
  render: () => ReactNode;
  /** Nhóm `/api/system/settings` của mục (tab Kênh thông báo dẫn sang đúng mục). */
  settingsGroup?: SettingsGroupKey;
}

/**
 * Danh mục mục cấu hình của trang Hệ thống → Cấu hình (TEST-234). Thêm cấu hình mới = thêm một dòng ở đây + component của nó
 * (khung của module khác import qua `@/features/<x>`), không sửa layout. Mục đầu tiên là mặc định.
 */
export const CONFIG_SECTIONS: readonly IConfigSection[] = [
  { id: 's3', group: 'Hạ tầng', label: 'Lưu trữ (S3)', icon: HardDrive, settingsGroup: 's3', render: () => <S3SettingsSection /> },
  { id: 'company', group: 'Chung', label: 'Thông tin công ty', icon: Building, settingsGroup: 'company', render: () => <CompanySettingsSection /> },
  { id: 'smtp', group: 'Hạ tầng', label: 'Email (SMTP)', icon: Mail, settingsGroup: 'smtp', render: () => <SmtpSettingsSection /> },
  { id: 'two-factor', group: 'Bảo mật', label: 'Xác thực 2 lớp', icon: ShieldCheck, settingsGroup: 'two_factor', render: () => <TwoFactorPolicySection /> },
  { id: 'session', group: 'Bảo mật', label: 'Phiên đăng nhập', icon: Timer, settingsGroup: 'session', render: () => <SessionSettingsSection /> },
  { id: 'password', group: 'Bảo mật', label: 'Mật khẩu & đăng nhập sai', icon: KeyRound, settingsGroup: 'password', render: () => <PasswordPolicySection /> },
  { id: 'fcm', group: 'Thông báo', label: 'Thông báo đẩy (FCM)', icon: BellRing, settingsGroup: 'fcm', render: () => <FcmSettingsSection /> },
  { id: 'telegram', group: 'Thông báo', label: 'Telegram', icon: Send, settingsGroup: 'telegram', render: () => <TelegramSettingsSection /> },
  { id: 'office-ips', group: 'Chấm công', label: 'IP văn phòng', icon: Network, settingsGroup: 'office_ips',
    render: () => <DbSettingsSection group="office_ips">{(g) => <OfficeIpsCard group={g} />}</DbSettingsSection> },
  { id: 'ai-limits', group: 'Trợ lý AI', label: 'Giới hạn bot', icon: Bot, render: () => <AgentLimitsCard /> },
  { id: 'ai-alerts', group: 'Trợ lý AI', label: 'Ngưỡng cảnh báo', icon: Gauge, render: () => <AiAlertSettingsCard /> },
  { id: 'ai-meetings', group: 'Trợ lý AI', label: 'Họp với AI', icon: Video, render: () => <AgentMeetingSettingsCard /> },
  { id: 'documents', group: 'Tài liệu', label: 'Ban hành tài liệu', icon: FileCheck2, render: () => <DocumentSettingsCard /> },
];

export const DEFAULT_CONFIG_SECTION = CONFIG_SECTIONS[0].id;
export const CONFIG_SECTION_IDS = CONFIG_SECTIONS.map((s) => s.id);

/** Mục chứa nhóm cấu hình DB (vd `office_ips` → `office-ips`). */
export const sectionOfSettingsGroup = (g: SettingsGroupKey) => CONFIG_SECTIONS.find((s) => s.settingsGroup === g)?.id ?? DEFAULT_CONFIG_SECTION;
