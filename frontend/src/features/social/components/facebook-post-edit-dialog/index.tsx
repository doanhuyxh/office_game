import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { useFacebookPages } from '../../hooks/useFacebook';
import type { IFacebookPost } from '../../types/facebook.types';
import { FacebookPostComposer } from '../facebook-post-composer';

/**
 * Sửa bài đã hẹn còn chờ đăng (TEST-208): khung soạn bài ở chế độ sửa, điền sẵn trang, nội dung, link, ảnh / video, giờ hẹn.
 * Back-end kiểm tra lại quyền + trạng thái (409 khi bài vừa được gửi đi).
 */
export function FacebookPostEditDialog({ post, open, onOpenChange }: { post: IFacebookPost; open: boolean; onOpenChange: (v: boolean) => void }) {
  const pages = useFacebookPages(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Sửa bài đã hẹn</DialogTitle>
          <DialogDescription>Chỉ sửa được khi chưa trang nào được gửi lên Facebook. Bỏ trang hoặc ảnh / video ở đây sẽ xoá khỏi bài.</DialogDescription>
        </DialogHeader>
        {pages.isLoading ? <Spinner /> : (
          <FacebookPostComposer key={post.id} pages={pages.data ?? []} post={post} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  );
}
