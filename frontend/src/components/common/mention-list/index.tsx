import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { BotBadge } from '@/components/common/bot-badge';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { cn } from '@/utils/cn';
import { highlightMatches } from '@/utils/mention';

export interface IMentionOption { key: string; name: string; hint?: string | null; avatarUrl?: string | null; isBot?: boolean }

/** Server trả tối đa 20 gợi ý — đủ 20 thì nhắc gõ thêm để thu hẹp. */
const SERVER_LIMIT = 20;

/**
 * Danh sách gợi ý @nhắc (Bảng tin, bình luận việc, chat). Cao ~8 dòng, cuộn được; ↑↓ (do `useMentionNav` ở ô nhập điều khiển) cuộn theo dòng đang chọn.
 * Tô phần chữ khớp `query` (không dấu); dòng phụ `hint` = mã · phòng ban · chức danh để phân biệt người trùng tên.
 * Bấm chuột chọn (onMouseDown + preventDefault để ô nhập không mất focus). Vị trí (absolute…) truyền qua `className`.
 * `open` (gợi ý đang mở) → hiện cả trạng thái đang tải / "Không tìm thấy ai" khi chưa có kết quả; không truyền thì rỗng = ẩn.
 */
export function MentionList({ options, active, onPick, onHover, className, query = '', loading, open }: {
  options: IMentionOption[]; active: number; onPick: (o: IMentionOption) => void; onHover?: (i: number) => void; className?: string;
  query?: string; loading?: boolean; open?: boolean;
}) {
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, options]);

  if (options.length === 0) {
    if (!open) return null;
    return (
      <div className={cn('z-20 flex w-72 items-center gap-2 rounded-md border bg-popover px-3 py-2 text-sm text-muted-foreground shadow-md', className)}
        data-testid="mention-list-empty">
        {loading ? <><Loader2 className="size-4 animate-spin" /> Đang tìm…</> : 'Không tìm thấy ai'}
      </div>
    );
  }
  return (
    <div className={cn('z-20 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md', className)}>
      <ul ref={list} className="max-h-[22rem] overflow-y-auto overscroll-contain py-1" role="listbox" data-testid="mention-list">
        {options.map((o, i) => (
          <li key={o.key} role="option" aria-selected={i === active} data-index={i}>
            <button type="button" className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent', i === active && 'bg-accent')}
              onMouseDown={(e) => { e.preventDefault(); onPick(o); }} onMouseEnter={() => onHover?.(i)}>
              {o.avatarUrl !== undefined && <PersonAvatar name={o.name} url={o.avatarUrl} className="size-7" fallbackClassName="text-[10px]" />}
              <span className="flex min-w-0 flex-col">
                <span className="flex min-w-0 items-center gap-1">
                  <span className="truncate font-medium"><Highlight text={o.name} query={query} /></span>
                  {o.isBot && <BotBadge />}
                </span>
                {o.hint && <span className="truncate text-xs text-muted-foreground"><Highlight text={o.hint} query={query} /></span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {options.length >= SERVER_LIMIT && (
        <p className="border-t px-3 py-1 text-[11px] text-muted-foreground">Gõ thêm họ tên, mã hoặc phòng ban để thu hẹp</p>
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return text;
  return highlightMatches(text, query).map(([part, hit], i) => (hit ? <mark key={i} className="bg-transparent font-semibold text-primary">{part}</mark> : part));
}
