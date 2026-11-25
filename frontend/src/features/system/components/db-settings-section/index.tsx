import type { ReactNode } from 'react';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { useSystemSettings } from '../../hooks/useSystem';
import type { ISettingsGroup, SettingsGroupKey } from '../../types/system.types';

/**
 * Khung chung của mục cấu hình lưu trong DB (`/api/system/settings`: S3, SMTP, FCM, IP văn phòng, Telegram):
 * dùng chung một query `useSystemSettings()` (các mục khác đọc cache), vẽ trạng thái tải / lỗi + ghi chú "ưu tiên hơn .env".
 */
export function DbSettingsSection({ group, children }: { group: SettingsGroupKey; children: (g: ISettingsGroup) => ReactNode }) {
  const { data, isLoading, error } = useSystemSettings();
  if (isLoading) return <Spinner />;
  const g = data?.find((x) => x.group === group);
  if (error || !g) return <p className="text-sm text-destructive">{error ? errorMessage(error) : 'Không tìm thấy nhóm cấu hình.'}</p>;
  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Lưu ở đây có hiệu lực ngay (không cần khởi động lại) và được ưu tiên hơn <code className="rounded bg-muted px-1 text-xs">.env</code>.
        Giá trị bí mật được mã hoá, không bao giờ hiển thị lại. Nút Kiểm tra dùng cấu hình đang có hiệu lực — lưu trước rồi kiểm tra.
      </p>
      {children(g)}
    </div>
  );
}
