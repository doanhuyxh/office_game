import { Avatar, AvatarFallback, AvatarImage } from '@/components/common/avatar';
import { cn } from '@/utils/cn';

/** "Nguyễn Văn An" → "NA". */
export const nameInitials = (name?: string | null) => {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return ((parts.length > 1 ? parts[0][0] : '') + parts[parts.length - 1][0]).toUpperCase();
};

/** Ảnh đại diện nhân viên (url từ API: /api/org/profile/avatars/{id}?v=…) — không có ảnh / lỗi tải → chữ viết tắt. */
export function PersonAvatar({ name, url, className, fallbackClassName }: { name?: string | null; url?: string | null; className?: string; fallbackClassName?: string }) {
  return (
    <Avatar className={cn('size-8', className)}>
      {url && <AvatarImage src={url} alt={name ?? ''} className="object-cover" />}
      <AvatarFallback className={fallbackClassName}>{nameInitials(name)}</AvatarFallback>
    </Avatar>
  );
}
