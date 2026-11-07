import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { SelectField } from '@/components/common/SelectField';
import { Textarea } from '@/components/common/textarea';
import { useMe } from '@/features/auth';
import { useEmployees } from '@/features/employees';
import { vnInstant } from '@/utils/date';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useCreateBooking, useMeetingRooms } from '../../hooks/useMeetings';

export interface BookingDraft { roomId?: string; date: string; start?: string; end?: string }

/** Đặt phòng: giờ nhập theo giờ VN, gửi lên kèm múi giờ (+07:00). Trùng giờ → back-end trả 409 kèm lịch đang chiếm. */
export function BookingDialog({ draft, onClose }: { draft: BookingDraft | null; onClose: () => void }) {
  const rooms = useMeetingRooms();
  const me = useMe();
  const employees = useEmployees();
  const create = useCreateBooking();
  const [roomId, setRoomId] = useState<string | null>(null);
  const [date, setDate] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('10:00');
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const errors = fieldErrors(create.error);

  useEffect(() => {
    if (!draft) return;
    setRoomId(draft.roomId ?? rooms.data?.[0]?.id ?? null);
    setDate(draft.date);
    setStart(draft.start ?? '09:00');
    setEnd(draft.end ?? '10:00');
    setTitle(''); setNote(''); setSearch(''); setInvited(new Set());
    create.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const people = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (employees.data ?? [])
      .filter((e) => e.userId && e.userId !== me.data?.id && e.status !== 'Resigned')
      .filter((e) => !q || e.fullName.toLowerCase().includes(q) || e.code.toLowerCase().includes(q) || (e.departmentName ?? '').toLowerCase().includes(q));
  }, [employees.data, search, me.data?.id]);
  const room = rooms.data?.find((r) => r.id === roomId);

  const toggle = (id: string, on: boolean) => setInvited((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!roomId) return;
    create.mutate({
      roomId, title: title.trim(), note: note.trim() || null, attendeeIds: [...invited],
      startAt: vnInstant(date, start), endAt: vnInstant(date, end),
    }, {
      onSuccess: (r) => {
        toast.success(`Đã đặt ${r.booking.roomName}${invited.size ? ` và gửi lời mời cho ${invited.size} người` : ''}`);
        r.warnings.forEach((w) => toast.warning(w));
        onClose();
      },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };

  return (
    <Dialog open={!!draft} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đặt phòng họp</DialogTitle>
          <DialogDescription>Người được mời nhận thông báo trên chuông và email. Giờ theo giờ Việt Nam.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <SelectField id="bk-room" label="Phòng *" value={roomId} onChange={setRoomId} error={errors.roomId}
            options={(rooms.data ?? []).map((r) => ({ value: r.id, label: `${r.name} · ${r.capacity} chỗ` }))} />
          <FormField id="bk-title" label="Tiêu đề *" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Vd: Họp kế hoạch tuần" error={errors.title} />
          <div className="grid grid-cols-3 gap-3">
            <FormField id="bk-date" label="Ngày *" type="date" required value={date} onChange={(e) => setDate(e.target.value)} error={errors.startAt} />
            <FormField id="bk-start" label="Từ *" type="time" step={900} required value={start} onChange={(e) => setStart(e.target.value)} />
            <FormField id="bk-end" label="Đến *" type="time" step={900} required value={end} onChange={(e) => setEnd(e.target.value)} error={errors.endAt} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bk-search">Mời tham gia {invited.size > 0 && <span className="text-muted-foreground">({invited.size} người{room && invited.size + 1 > room.capacity ? ` — vượt ${room.capacity} chỗ` : ''})</span>}</Label>
            <Input id="bk-search" placeholder="Tìm tên, mã, phòng ban…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="max-h-44 overflow-y-auto rounded-md border p-1">
              {people.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <Checkbox checked={invited.has(p.id)} onCheckedChange={(c) => toggle(p.id, c === true)} />
                  <span>{p.fullName}</span>
                  <span className="text-xs text-muted-foreground">{p.code}{p.departmentName ? ` · ${p.departmentName}` : ''}</span>
                </label>
              ))}
              {people.length === 0 && <p className="p-2 text-sm text-muted-foreground">Không có ai phù hợp.</p>}
            </div>
            {errors.attendeeIds && <p className="text-xs text-destructive">{errors.attendeeIds}</p>}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="bk-note">Ghi chú</Label>
            <Textarea id="bk-note" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Nội dung, tài liệu cần chuẩn bị…" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Huỷ</Button>
            <Button type="submit" disabled={create.isPending || !roomId || !title.trim()}>{create.isPending ? 'Đang đặt…' : 'Đặt phòng'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
