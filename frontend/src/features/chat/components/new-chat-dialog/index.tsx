import { useState } from 'react';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Input } from '@/components/common/input';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { useOpenDirect, usePeople } from '../../hooks/useChatData';
import type { IConversation } from '../../types/chat.types';

/** Chọn đồng nghiệp để nhắn riêng (1-1): mở lại cuộc trò chuyện đã có hoặc tạo mới. */
export function NewChatDialog({ open, onOpenChange, onOpened }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (c: IConversation) => void;
}) {
  const [q, setQ] = useState('');
  const search = useDebounce(q.trim(), 300);
  const people = usePeople(search, open);
  const openDirect = useOpenDirect();

  const pick = (userId: string) =>
    openDirect.mutate(userId, {
      onSuccess: (c) => { setQ(''); onOpenChange(false); onOpened(c); },
      onError: (e) => toast.error(errorMessage(e, 'Không mở được cuộc trò chuyện')),
    });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tin nhắn mới</DialogTitle>
          <DialogDescription>Chọn đồng nghiệp để nhắn riêng.</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus className="pl-9" placeholder="Tìm theo tên hoặc mã nhân viên…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="chat-people-search" />
        </div>
        <div className="max-h-80 min-h-24 overflow-y-auto" data-testid="chat-people">
          {people.isLoading && <Spinner />}
          {people.isError && <p className="py-6 text-center text-sm text-muted-foreground">Không tải được danh sách đồng nghiệp.</p>}
          {people.data?.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy ai.</p>}
          {people.data?.map((p) => (
            <button key={p.userId} type="button" disabled={openDirect.isPending} onClick={() => pick(p.userId)}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-accent disabled:opacity-60" data-testid="chat-person">
              <PersonAvatar name={p.fullName} className="size-9" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.fullName}</span>
                <span className="block truncate text-xs text-muted-foreground">{[p.code, p.departmentName].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
