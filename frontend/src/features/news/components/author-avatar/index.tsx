import { PersonAvatar } from '@/components/common/PersonAvatar';
import type { IAuthor } from '../../types/news.types';

/** Ảnh đại diện tác giả (tài khoản không có hồ sơ nhân viên → chữ viết tắt). */
export function AuthorAvatar({ author, className }: { author: IAuthor; className?: string }) {
  return <PersonAvatar name={author.name} url={author.employeeId ? `/api/org/profile/avatars/${author.employeeId}` : null} className={className} />;
}
