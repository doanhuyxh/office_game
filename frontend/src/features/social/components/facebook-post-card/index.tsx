import { useState } from 'react';
import { CalendarClock, ExternalLink, Pencil, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { StatusBadge } from '@/components/common/StatusBadge';
import { formatDateTime } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { facebookApi } from '../../api/facebook.api';
import { useFacebookMutation } from '../../hooks/useFacebook';
import type { IFacebookPost } from '../../types/facebook.types';
import { POST_STATUS, TARGET_STATUS } from '../../utils/facebook-labels';
import { FacebookMediaThumb } from '../facebook-media-thumb';
import { FacebookPostEditDialog } from '../facebook-post-edit-dialog';

/** Một bài đã gửi: nội dung, ảnh / video, kết quả từng trang (link bài, lỗi, đăng lại), sửa bài còn chờ (TEST-208), huỷ phần chưa đăng. */
export function FacebookPostCard({ post }: { post: IFacebookPost }) {
  const cancel = useFacebookMutation(() => facebookApi.cancel(post.id));
  const retry = useFacebookMutation((targetId: string) => facebookApi.retry(targetId));
  const [editing, setEditing] = useState(false);
  const s = POST_STATUS[post.status];
  return (
    <article className="grid gap-3 rounded-xl border bg-card p-4" data-testid="social-post">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 text-sm">
          <span className="font-medium">{post.authorName}</span>
          <span className="text-muted-foreground"> · {formatDateTime(post.createdAt)}</span>
          {post.scheduledAt && (
            <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="size-3.5" /> Hẹn đăng {formatDateTime(post.scheduledAt)}</div>
          )}
          {post.editedAt && (
            <div className="mt-0.5 text-xs text-muted-foreground" data-testid="post-edited">Đã sửa lúc {formatDateTime(post.editedAt)}{post.editedByName ? ` bởi ${post.editedByName}` : ''}</div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge tone={s.tone}>{s.label}</StatusBadge>
          {post.canEdit && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} data-testid="post-edit"><Pencil /> Sửa</Button>
          )}
          {post.canCancel && (
            <Button size="sm" variant="ghost" loading={cancel.isPending} onClick={async () => {
              if (await confirmDialog({ title: 'Huỷ đăng bài?', description: 'Các trang chưa đăng sẽ không đăng nữa. Trang đã đăng giữ nguyên.', confirmText: 'Huỷ đăng', destructive: true,
                onConfirm: () => cancel.mutateAsync(undefined) })) toast.success('Đã huỷ');
            }}><XCircle /> Huỷ</Button>
          )}
        </div>
      </header>
      {post.message && <p className="text-sm break-words whitespace-pre-line">{post.message}</p>}
      {post.link && <a href={post.link} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-primary hover:underline">{post.link}</a>}
      {post.media.length > 0 && (
        <div className={post.media[0].kind === 'Video' ? '' : 'grid grid-cols-3 gap-2 sm:grid-cols-4'}>
          {post.media.map((m) => <FacebookMediaThumb key={m.id} media={m} />)}
        </div>
      )}
      <ul className="grid gap-2 border-t pt-3">
        {post.targets.map((t) => {
          const ts = TARGET_STATUS[t.status];
          return (
            <li key={t.id} className="flex flex-wrap items-center gap-2 text-sm" data-testid="social-target">
              {t.pagePictureUrl ? <img src={t.pagePictureUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                : <div className="size-6 shrink-0 rounded-full bg-muted" />}
              <span className="min-w-0 flex-1 truncate font-medium">{t.pageName}</span>
              <StatusBadge tone={ts.tone}>{ts.label}</StatusBadge>
              {t.deletedOnFacebookAt && (
                <span data-testid="social-target-deleted" title={`Xoá lúc ${formatDateTime(t.deletedOnFacebookAt)}`}>
                  <StatusBadge tone="muted">Đã xoá trên Facebook</StatusBadge>
                </span>
              )}
              {t.permalink && !t.deletedOnFacebookAt && (
                <a href={t.permalink} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Xem bài <ExternalLink className="size-3" />
                </a>
              )}
              {t.canRetry && (
                <Button size="sm" variant="outline" loading={retry.isPending && retry.variables === t.id} disabled={retry.isPending}
                  onClick={() => retry.mutate(t.id, { onSuccess: () => toast.success('Đang đăng lại'), onError: (x) => toast.error(errorMessage(x)) })}>
                  <RotateCcw /> Đăng lại
                </Button>
              )}
              {t.error && t.status !== 'Published' && (
                <p className={`basis-full pl-8 text-xs ${t.status === 'Failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{t.error}</p>
              )}
            </li>
          );
        })}
      </ul>
      {editing && <FacebookPostEditDialog post={post} open={editing} onOpenChange={setEditing} />}
    </article>
  );
}
