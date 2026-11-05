import { useEffect, useState } from 'react';
import { LogIn, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { errorMessage } from '@/utils/errors';
import { formatMinutes, formatTime } from '@/utils/date';
import { cn } from '@/utils/cn';
import { useCheck, useToday } from '../hooks/useAttendance';
import { WORK_MODE } from '../utils/labels';
import { StatusBadge } from './StatusBadge';

/** Đồng hồ theo giờ server (tránh máy người dùng lệch giờ). */
function useServerClock(serverTime?: string) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { if (serverTime) setOffset(new Date(serverTime).getTime() - Date.now()); }, [serverTime]);
  useEffect(() => { const t = setInterval(() => setNow(new Date(Date.now() + offset)), 1000); return () => clearInterval(t); }, [offset]);
  return now;
}

/** Thẻ chấm công hôm nay: đồng hồ, ca, các phiên vào/ra, nút chấm công. Dùng ở Tổng quan và trang Chấm công. */
export function CheckInCard({ className }: { className?: string }) {
  const { data: today, isLoading, noProfile, error } = useToday();
  const check = useCheck();
  const now = useServerClock(today?.serverTime);

  if (noProfile) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardDescription>Chấm công</CardDescription>
          <CardTitle className="text-base">Tài khoản chưa gắn hồ sơ nhân viên</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">Tài khoản quản trị hệ thống không chấm công. Nhân viên cần được HR cấp tài khoản từ hồ sơ.</CardContent>
      </Card>
    );
  }

  const day = today?.day;
  const onCheck = () =>
    check.mutate('web', {
      onSuccess: (t) => toast.success(t.checkedIn ? `Đã chấm công vào lúc ${formatTime(t.serverTime)}` : `Đã chấm công ra lúc ${formatTime(t.serverTime)}`),
      onError: (err) => toast.error(errorMessage(err)),
    });

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardDescription>Hôm nay · {now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit' })}</CardDescription>
          <CardTitle className="mt-1 font-mono text-3xl tabular-nums" aria-label="Giờ hiện tại">
            {now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}
          </CardTitle>
          {today && (
            <p className="mt-1 text-xs text-muted-foreground">
              {today.shift ? `Ca ${today.shift.name}${today.shift.startTime ? ` ${today.shift.startTime}–${today.shift.endTime}` : ` · ${formatMinutes(today.shift.plannedMinutes)}`}` : 'Hôm nay không có ca'}
              {day?.holidayName && ` · ${day.holidayName}`}
            </p>
          )}
        </div>
        {day && <StatusBadge status={day.status} />}
      </CardHeader>
      <CardContent className="grid gap-4">
        {isLoading && <p className="text-sm text-muted-foreground">Đang tải…</p>}
        {error && !noProfile && <p className="text-sm text-destructive">{errorMessage(error)}</p>}
        {today && (
          <>
            <Button size="lg" onClick={onCheck} disabled={check.isPending} data-testid="check-button"
              className={cn('h-12 text-base', today.checkedIn && 'bg-amber-600 hover:bg-amber-600/90')}>
              {today.checkedIn ? <LogOut /> : <LogIn />}
              {check.isPending ? 'Đang chấm…' : today.checkedIn ? 'Chấm công ra' : 'Chấm công vào'}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Sẽ ghi nhận: {WORK_MODE[today.currentWorkMode]} (theo mạng đang dùng)
            </p>
            {day && day.sessions.length > 0 && (
              <div className="grid gap-1 rounded-lg bg-muted p-3 text-sm">
                {day.sessions.map((s, i) => (
                  <div key={i} className="flex justify-between font-mono tabular-nums">
                    <span>Vào {formatTime(s.in)}</span>
                    <span>{s.out ? `Ra ${formatTime(s.out)}` : 'đang làm…'}</span>
                  </div>
                ))}
                <div className="mt-1 flex justify-between border-t pt-1 text-xs text-muted-foreground">
                  <span>Đã làm {formatMinutes(day.workedMinutes)}{day.requiredMinutes > 0 && ` / ${formatMinutes(day.requiredMinutes)}`}</span>
                  {day.lateMinutes > 0 && <span className="text-red-600">Muộn {day.lateMinutes} phút</span>}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
