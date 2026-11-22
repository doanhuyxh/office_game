import { Link } from '@tanstack/react-router';
import { ChevronRight, ExternalLink } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PATHS } from '@/config/paths';
import type { IFacebookPage } from '../../types/facebook.types';

/** Danh sách Fanpage người xem được đăng (HR / người giữ BM) → bấm mở trang chi tiết (bài viết đồng bộ từ Facebook — TEST-206). */
export function FacebookPageList({ pages }: { pages: IFacebookPage[] }) {
  return (
    <section className="grid gap-2 rounded-xl border bg-card p-3" data-testid="social-page-list">
      <h2 className="px-1 text-sm font-semibold">Fanpage ({pages.length})</h2>
      <ul className="grid gap-1">
        {pages.map((p) => (
          <li key={p.id} className="flex items-center gap-1">
            <Link to={PATHS.socialFacebookPage} params={{ pageId: p.id }} data-testid="social-page-link"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-md p-1.5 text-sm hover:bg-muted">
              {p.pictureUrl ? <img src={p.pictureUrl} alt="" className="size-7 shrink-0 rounded-full object-cover" referrerPolicy="no-referrer" />
                : <div className="size-7 shrink-0 rounded-full bg-muted" />}
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate text-xs text-muted-foreground">{p.accountName}</span>
              </span>
              {!p.canPost && <StatusBadge tone="warning">Thiếu quyền đăng</StatusBadge>}
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            {p.link && (
              <a href={p.link} target="_blank" rel="noopener noreferrer" className="p-1.5 text-muted-foreground hover:text-foreground" aria-label={`Mở ${p.name} trên Facebook`}>
                <ExternalLink className="size-4" />
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
