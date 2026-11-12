import { useState } from 'react';
import { LogOut, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { useAddMembers, useGroupMembers, useLeaveGroup } from '../../hooks/useChatData';
import type { IConversation, IPerson } from '../../types/chat.types';
import { PeoplePicker } from '../people-picker';

/** Thành viên nhóm chat: xem danh sách, thêm người (thành viên nào cũng thêm được), rời nhóm. */
export function GroupMembersDialog({ conversation, open, onOpenChange, onLeft }: {
  conversation: IConversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeft: () => void;
}) {
  const members = useGroupMembers(conversation.id, open);
  const add = useAddMembers(conversation.id);
  const leave = useLeaveGroup(conversation.id);
  const [adding, setAdding] = useState(false);
  const [picked, setPicked] = useState<IPerson[]>([]);

  const submitAdd = () =>
    add.mutate(picked.map((p) => p.userId), {
      onSuccess: () => { setPicked([]); setAdding(false); toast.success('Đã thêm vào nhóm'); },
      onError: (e) => toast.error(errorMessage(e, 'Không thêm được thành viên')),
    });

  const doLeave = async () => {
    const ok = await confirmDialog({
      title: 'Rời nhóm?',
      description: 'Bạn sẽ không xem / nhận tin của nhóm này nữa. Muốn quay lại phải nhờ một thành viên thêm vào.',
      confirmText: 'Rời nhóm',
      destructive: true,
    });
    if (!ok) return;
    leave.mutate(undefined, {
      onSuccess: () => { onOpenChange(false); onLeft(); toast.success('Đã rời nhóm'); },
      onError: (e) => toast.error(errorMessage(e, 'Không rời nhóm được')),
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) { setAdding(false); setPicked([]); } }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{conversation.title}</DialogTitle>
            <DialogDescription>{members.data ? `${members.data.length} thành viên` : 'Thành viên nhóm'}</DialogDescription>
          </DialogHeader>
          {adding ? (
            <div className="grid gap-3">
              <PeoplePicker selected={picked} onChange={setPicked} exclude={new Set(members.data?.map((m) => m.userId))} enabled={open && adding} />
              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={() => { setAdding(false); setPicked([]); }}>Huỷ</Button>
                <Button disabled={picked.length === 0 || add.isPending} onClick={submitAdd} data-testid="chat-group-add-submit">Thêm {picked.length || ''}</Button>
              </div>
            </div>
          ) : (
            <>
              <div className="max-h-72 overflow-y-auto" data-testid="chat-group-member-list">
                {members.isLoading && <Spinner />}
                {members.data?.map((m) => (
                  <div key={m.userId} className="flex items-center gap-3 rounded-lg p-2">
                    <PersonAvatar name={m.fullName} className="size-8" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[m.code, m.isCreator ? 'Người tạo nhóm' : null].filter(Boolean).join(' · ')}</span>
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" className="text-destructive" onClick={() => void doLeave()} data-testid="chat-group-leave"><LogOut /> Rời nhóm</Button>
                <Button onClick={() => setAdding(true)} data-testid="chat-group-add"><UserPlus /> Thêm người</Button>
              </div>
            </>
          )}
        </DialogContent>
    </Dialog>
  );
}
