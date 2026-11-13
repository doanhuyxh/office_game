import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { BotBadge } from '@/components/common/bot-badge';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useAgentBots, useMeetingRooms, useOpenAgentMeeting } from '../../hooks/useMeetings';
import type { IAgentMeeting } from '../../types/meeting.types';

/** Khớp AgentMeetingRules (back-end kiểm tra lại). */
const MIN_BOTS = 2, MAX_BOTS = 8;

export interface AgentMeetingDraft { roomId?: string | null }

/**
 * "Họp với AI" (TEST-83): chọn phòng họp, chủ đề, bot dự (tài khoản bot) và bot chủ trì trong số đó. Mọi quy tắc (số bot, bot còn hoạt động,
 * phòng đang có phiên → 409) do back-end kiểm tra — form chỉ chặn những lỗi hiển nhiên.
 */
export function AgentMeetingDialog({ draft, onClose, onOpened }: {
  draft: AgentMeetingDraft | null;
  onClose: () => void;
  onOpened?: (m: IAgentMeeting) => void;
}) {
  const rooms = useMeetingRooms();
  const bots = useAgentBots(!!draft);
  const open = useOpenAgentMeeting();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [topic, setTopic] = useState('');
  const [search, setSearch] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [chairId, setChairId] = useState<string | null>(null);
  const errors = fieldErrors(open.error);

  useEffect(() => {
    if (!draft) return;
    setRoomId(draft.roomId ?? rooms.data?.[0]?.id ?? null);
    setTopic(''); setSearch(''); setPicked([]); setChairId(null);
    open.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (bots.data ?? []).filter((b) => !q || [b.name, b.code, b.departmentName ?? '', b.positionName ?? ''].some((x) => x.toLowerCase().includes(q)));
  }, [bots.data, search]);
  const pickedBots = (bots.data ?? []).filter((b) => picked.includes(b.employeeId));

  const toggle = (id: string, on: boolean) => {
    const next = on ? [...picked, id] : picked.filter((x) => x !== id);
    setPicked(next);
    // Bot chủ trì phải nằm trong danh sách: bỏ chọn → bỏ luôn chủ trì; chọn bot đầu tiên → mặc định làm chủ trì
    if (chairId && !next.includes(chairId)) setChairId(next[0] ?? null);
    else if (!chairId && next.length) setChairId(next[0]);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId || !chairId) return;
    open.mutate({ roomId, topic: topic.trim(), chairEmployeeId: chairId, botIds: picked }, {
      onSuccess: (m) => { toast.success(`Đã mở cuộc họp ở ${m.roomName} — ${m.bots[0]?.name ?? 'bot chủ trì'} nói trước`); onOpened?.(m); onClose(); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  const tooFew = picked.length < MIN_BOTS, tooMany = picked.length > MAX_BOTS;
  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-testid="agent-meeting-dialog">
        <DialogHeader>
          <DialogTitle>Họp với AI</DialogTitle>
          <DialogDescription>
            Các bot trao đổi trong kênh chat của phòng họp; bot chủ trì nói trước và chỉ định người nói tiếp. Bạn theo dõi, nhắn xen và dừng bất kỳ lúc nào.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <SelectField id="am-room" label="Phòng họp *" value={roomId} onChange={setRoomId} error={errors.roomId}
            options={(rooms.data ?? []).map((r) => ({ value: r.id, label: r.name }))} />
          <FormField id="am-topic" label="Chủ đề *" required maxLength={300} value={topic} onChange={(e) => setTopic(e.target.value)}
            placeholder="Vd: Lên kế hoạch ra mắt tính năng X" error={errors.topic} />
          <div className="grid gap-2">
            <Label htmlFor="am-search">
              Bot dự họp * <span className="text-muted-foreground">({picked.length} / tối đa {MAX_BOTS}, ít nhất {MIN_BOTS})</span>
            </Label>
            <Input id="am-search" placeholder="Tìm tên, mã, phòng ban, chức vụ…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-52 overflow-y-auto rounded-md border p-1">
              {bots.isLoading && <Spinner />}
              {shown.map((b) => (
                <label key={b.employeeId} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={picked.includes(b.employeeId)} onCheckedChange={(c) => toggle(b.employeeId, c === true)} />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1">{b.name} <BotBadge /></span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {[b.code, b.departmentName, b.positionName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </label>
              ))}
              {!bots.isLoading && shown.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">
                  {bots.data?.length ? 'Không có bot phù hợp.' : 'Chưa có tài khoản bot nào (HR đánh dấu ở Nhân viên → "Đánh dấu là bot").'}
                </p>
              )}
              {bots.error && <p className="p-2 text-sm text-destructive">{errorMessage(bots.error)}</p>}
            </div>
            {(errors.botIds || tooMany) && <p className="text-xs text-destructive">{errors.botIds ?? `Tối đa ${MAX_BOTS} bot mỗi cuộc họp`}</p>}
          </div>
          <SelectField id="am-chair" label="Bot chủ trì *" value={chairId} onChange={setChairId} error={errors.chairEmployeeId}
            disabled={!pickedBots.length} placeholder="Chọn bot dự họp trước"
            options={pickedBots.map((b) => ({ value: b.employeeId, label: `${b.name} · ${b.code}` }))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={open.isPending || !roomId || !topic.trim() || !chairId || tooFew || tooMany}>
              {open.isPending ? 'Đang mở…' : 'Bắt đầu họp'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
