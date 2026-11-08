import { confirmDialog } from '@/components/common/confirm-dialog';
import { useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, Plus, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { StatusBadge } from '@/components/common/StatusBadge';
import { PageHeader } from '@/components/layout/PageHeader';
import { addDays, formatDate, formatTime, parseInstant, todayVn, toVnDate } from '@/utils/date';
import { cn } from '@/utils/cn';
import { errorMessage } from '@/utils/errors';
import { useCancelBooking, useDayBookings, useMeetingRooms, useMyBookings } from '../../hooks/useMeetings';
import type { IBooking } from '../../types/meeting.types';
import { BookingDialog, type BookingDraft } from '../booking-dialog';

/** Khung giờ hiển thị trên dòng thời gian (giờ VN). */
const DAY_START = 7, DAY_END = 21;
const SPAN = (DAY_END - DAY_START) * 60;

/** Phút kể từ 00:00 giờ VN của một thời điểm (trong ngày đang xem). */
const vnMinutes = (iso: string) => { const [h, m] = formatTime(iso).split(':').map(Number); return h * 60 + m; };
const pad = (n: number) => String(n).padStart(2, '0');

function BookingCard({ b, onCancel, now }: { b: IBooking; onCancel: (b: IBooking) => void; now: number }) {
  const live = parseInstant(b.startAt).getTime() <= now && now < parseInstant(b.endAt).getTime();
  return (
    <div className={cn('rounded-lg border p-3 text-sm', b.isMine && 'border-primary/50 bg-primary/5')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-medium">{b.title} {live && <StatusBadge tone="danger" className="ml-1">Đang họp</StatusBadge>}</div>
          <div className="text-muted-foreground">
            {formatTime(b.startAt)}–{formatTime(b.endAt)} · {b.roomName} · {b.organizerName}
          </div>
          {b.attendees.length > 0 && (
            <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Users className="size-3.5" />{b.attendees.map((a) => a.name).join(', ')}</div>
          )}
          {b.note && <div className="mt-1 text-xs whitespace-pre-line text-muted-foreground">{b.note}</div>}
        </div>
        {b.canCancel && <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => onCancel(b)}>Huỷ</Button>}
      </div>
    </div>
  );
}

/** Đặt phòng họp: dòng thời gian theo ngày cho từng phòng (bấm chỗ trống để đặt) + lịch của tôi. */
export function MeetingsPage() {
  const today = todayVn();
  const [date, setDate] = useState(today);
  const rooms = useMeetingRooms();
  const day = useDayBookings(date);
  const mine = useMyBookings(today);
  const cancel = useCancelBooking();
  const [draft, setDraft] = useState<BookingDraft | null>(null);
  const now = Date.now();
  const hours = Array.from({ length: DAY_END - DAY_START + 1 }, (_, i) => DAY_START + i);

  const askCancel = async (b: IBooking) => {
    if (!(await confirmDialog({ title: `Huỷ lịch "${b.title}" (${formatTime(b.startAt)}–${formatTime(b.endAt)})?`, description: 'Người được mời sẽ nhận thông báo.', confirmText: 'Huỷ lịch', cancelText: 'Không', destructive: true }))) return;
    cancel.mutate(b.id, { onSuccess: () => toast.success('Đã huỷ lịch'), onError: (e) => toast.error(errorMessage(e)) });
  };

  /** Bấm vào dòng thời gian → mở form đặt từ giờ tròn gần nhất (1 tiếng). */
  const pickSlot = (roomId: string, e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = DAY_START * 60 + Math.floor(((e.clientX - rect.left) / rect.width) * SPAN / 30) * 30;
    const h = Math.min(Math.floor(minute / 60), DAY_END - 1), m = minute % 60;
    setDraft({ roomId, date, start: `${pad(h)}:${pad(m)}`, end: `${pad(Math.min(h + 1, 23))}:${pad(m)}` });
  };

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Phòng họp" />

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Lịch ngày {formatDate(date)}</CardTitle>
            <CardDescription>Bấm vào chỗ trống trên dòng thời gian để đặt nhanh.</CardDescription>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="outline" aria-label="Ngày trước" onClick={() => setDate(addDays(date, -1))}><ChevronLeft className="size-4" /></Button>
            <Input type="date" required className="w-40" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} aria-label="Chọn ngày" />
            <Button size="icon" variant="outline" aria-label="Ngày sau" onClick={() => setDate(addDays(date, 1))}><ChevronRight className="size-4" /></Button>
            {date !== today && <Button variant="ghost" onClick={() => setDate(today)}>Hôm nay</Button>}
            <Button className="ms-1" onClick={() => setDraft({ date })}><Plus className="size-4" /> Đặt phòng</Button>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="relative ml-36 h-5 text-xs text-muted-foreground">
                {hours.map((h) => (
                  <span key={h} className="absolute -translate-x-1/2" style={{ left: `${((h - DAY_START) * 60 / SPAN) * 100}%` }}>{h}h</span>
                ))}
              </div>
              {(rooms.data ?? []).map((r) => {
                const items = (day.data ?? []).filter((b) => b.roomId === r.id);
                return (
                  <div key={r.id} className="flex items-center gap-2 border-t py-2">
                    <div className="w-34 shrink-0 text-sm">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">{r.capacity} chỗ</div>
                    </div>
                    <div className="relative h-12 flex-1 cursor-pointer rounded-md bg-muted/50" onClick={(e) => pickSlot(r.id, e)}>
                      {hours.slice(1, -1).map((h) => (
                        <div key={h} className="absolute inset-y-0 border-l border-border/60" style={{ left: `${((h - DAY_START) * 60 / SPAN) * 100}%` }} />
                      ))}
                      {date === today && vnMinutes(new Date(now).toISOString()) > DAY_START * 60 && vnMinutes(new Date(now).toISOString()) < DAY_END * 60 && (
                        <div className="absolute inset-y-0 z-10 w-0.5 bg-destructive" style={{ left: `${((vnMinutes(new Date(now).toISOString()) - DAY_START * 60) / SPAN) * 100}%` }} />
                      )}
                      {items.map((b) => {
                        const s = toVnDate(b.startAt) < date ? DAY_START * 60 : Math.max(DAY_START * 60, vnMinutes(b.startAt));
                        const e = toVnDate(b.endAt) > date ? DAY_END * 60 : Math.min(DAY_END * 60, vnMinutes(b.endAt));
                        if (e <= s) return null;
                        return (
                          <div key={b.id} onClick={(ev) => ev.stopPropagation()}
                            title={`${b.title} · ${formatTime(b.startAt)}–${formatTime(b.endAt)} · ${b.organizerName}`}
                            className={cn('absolute inset-y-1 overflow-hidden rounded px-1.5 py-0.5 text-xs text-primary-foreground',
                              b.isMine ? 'bg-primary' : 'bg-muted-foreground/70')}
                            style={{ left: `${((s - DAY_START * 60) / SPAN) * 100}%`, width: `${((e - s) / SPAN) * 100}%` }}>
                            <div className="truncate font-medium">{b.title}</div>
                            <div className="truncate opacity-90">{formatTime(b.startAt)}–{formatTime(b.endAt)}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="grid gap-2">
            {(day.data ?? []).map((b) => <BookingCard key={b.id} b={b} onCancel={askCancel} now={now} />)}
            {day.data?.length === 0 && <p className="text-sm text-muted-foreground">Chưa có lịch nào trong ngày.</p>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><CalendarClock className="size-4" /> Lịch của tôi (14 ngày tới)</CardTitle>
          <CardDescription>Cuộc họp bạn tổ chức hoặc được mời.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {(mine.data ?? []).map((b) => (
            <div key={b.id} className="grid gap-1">
              <div className="text-xs font-medium text-muted-foreground">{formatDate(b.startAt)}</div>
              <BookingCard b={b} onCancel={askCancel} now={now} />
            </div>
          ))}
          {mine.data?.length === 0 && <p className="text-sm text-muted-foreground">Không có cuộc họp nào.</p>}
        </CardContent>
      </Card>

      <BookingDialog draft={draft} onClose={() => setDraft(null)} />
    </div>
  );
}
