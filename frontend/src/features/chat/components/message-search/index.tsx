import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate, formatTime } from '@/utils/date';
import { chatApi, chatKeys } from '../../api/chat.api';

const MIN = 2;

/** Tìm tin trong hội thoại đang mở (chứa chuỗi, không phân biệt hoa thường; tối đa 50 tin mới nhất khớp). */
export function MessageSearch({ conversationId, onClose }: { conversationId: string; onClose: () => void }) {
  const [q, setQ] = useState('');
  const term = useDebounce(q.trim(), 300);
  const enabled = term.length >= MIN;
  const { data, isFetching, isError } = useQuery({
    queryKey: chatKeys.search(conversationId, term),
    queryFn: () => chatApi.search(conversationId, term),
    enabled,
    staleTime: 15_000,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="chat-search">
      <div className="flex items-center gap-2 border-b p-2">
        <div className="relative flex-1">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-9" placeholder="Tìm trong tin nhắn…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && onClose()} data-testid="chat-search-input" />
        </div>
        <Button variant="ghost" size="icon" aria-label="Đóng tìm kiếm" onClick={onClose}><X /></Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!enabled && <p className="py-8 text-center text-sm text-muted-foreground">Nhập ít nhất {MIN} ký tự để tìm.</p>}
        {enabled && isFetching && !data && <Spinner />}
        {enabled && isError && <p className="py-8 text-center text-sm text-muted-foreground">Không tìm được, thử lại sau.</p>}
        {enabled && data?.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Không có tin nào khớp.</p>}
        {enabled && data?.map((m) => (
          <div key={m.id} className="rounded-lg p-2 hover:bg-accent" data-testid="chat-search-result">
            <div className="flex items-baseline gap-2 text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/80">{m.senderName}</span>
              <span>{formatDate(m.createdAt)} {formatTime(m.createdAt)}</span>
            </div>
            <p className="text-sm break-words whitespace-pre-wrap">{m.text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
