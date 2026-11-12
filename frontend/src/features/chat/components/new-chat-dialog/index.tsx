import { useState } from 'react';
import { Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { errorMessage } from '@/utils/errors';
import { useCreateGroup, useOpenDirect, usePeople } from '../../hooks/useChatData';
import type { IConversation, IPerson } from '../../types/chat.types';
import { PeoplePicker } from '../people-picker';

/** Chọn đồng nghiệp để nhắn riêng (1-1: mở lại cuộc trò chuyện đã có hoặc tạo mới), hoặc tạo nhóm chat (ai cũng tạo được). */
export function NewChatDialog({ open, onOpenChange, onOpened }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpened: (c: IConversation) => void;
}) {
  const [q, setQ] = useState('');
  const search = useDebounce(q.trim(), 300);
  const people = usePeople(search, open);
  const openDirect = useOpenDirect();
  const createGroup = useCreateGroup();
  const [mode, setMode] = useState<'direct' | 'group'>('direct');
  const [title, setTitle] = useState('');
  const [picked, setPicked] = useState<IPerson[]>([]);
  const reset = () => { setQ(''); setTitle(''); setPicked([]); setMode('direct'); };

  const submitGroup = () =>
    createGroup.mutate({ title: title.trim(), userIds: picked.map((p) => p.userId) }, {
      onSuccess: (c) => { reset(); onOpenChange(false); onOpened(c); },
      onError: (e) => toast.error(errorMessage(e, 'Không tạo được nhóm')),
    });

  const pick = (userId: string) =>
    openDirect.mutate(userId, {
      onSuccess: (c) => { reset(); onOpenChange(false); onOpened(c); },
      onError: (e) => toast.error(errorMessage(e, 'Không mở được cuộc trò chuyện')),
    });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'group' ? 'Tạo nhóm chat' : 'Tin nhắn mới'}</DialogTitle>
          <DialogDescription>{mode === 'group' ? 'Đặt tên nhóm và chọn đồng nghiệp tham gia.' : 'Chọn đồng nghiệp để nhắn riêng.'}</DialogDescription>
        </DialogHeader>
        {mode === 'group' ? (
          <div className="grid gap-3">
            <Input autoFocus maxLength={100} placeholder="Tên nhóm" value={title} onChange={(e) => setTitle(e.target.value)} data-testid="chat-group-title" />
            <PeoplePicker selected={picked} onChange={setPicked} enabled={open} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setMode('direct')}>Quay lại</Button>
              <Button disabled={!title.trim() || picked.length === 0 || createGroup.isPending} onClick={submitGroup} data-testid="chat-group-create">Tạo nhóm</Button>
            </div>
          </div>
        ) : (
        <>
        <button type="button" onClick={() => setMode('group')} className="flex w-full items-center gap-3 rounded-lg border border-dashed p-2 text-start text-sm font-medium hover:bg-accent" data-testid="chat-new-group">
          <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary"><Users className="size-4" /></span>
          Tạo nhóm chat mới
        </button>
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
        </>
        )}
      </DialogContent>
    </Dialog>
  );
}
