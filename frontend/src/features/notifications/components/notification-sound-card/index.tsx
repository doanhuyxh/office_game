import { BellRing, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Label } from '@/components/common/label';
import { useNotificationSound } from '../../hooks/useNotificationSound';
import { usePush } from '../../hooks/usePush';
import { playNotificationSound } from '../../utils/sound';

/** Tùy chọn âm thanh chuông + thông báo đẩy (lưu trên trình duyệt này). Hiện ở trang hồ sơ cho mọi tài khoản. */
export function NotificationSoundCard() {
  const [soundOn, setSoundOn] = useNotificationSound();
  const push = usePush();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tùy chọn thông báo</CardTitle>
        <CardDescription>Áp dụng cho trình duyệt này.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-start gap-3">
          <Checkbox id="notif-sound" checked={soundOn} data-testid="notification-sound-pref"
            onCheckedChange={(c) => { const on = c === true; setSoundOn(on); if (on) playNotificationSound(); }} />
          <div className="grid gap-0.5">
            <Label htmlFor="notif-sound" className="flex items-center gap-1.5"><Volume2 className="size-4" /> Phát âm thanh khi có thông báo mới</Label>
            <span className="text-xs text-muted-foreground">Nghe một tiếng chuông ngắn khi có thông báo mới trong lúc đang mở OfficeHub.</span>
          </div>
        </div>
        {push.supported && (
          <div className="flex items-start gap-3">
            <Checkbox id="notif-push" checked={push.enabled} data-testid="notification-push-pref"
              onCheckedChange={async (c) => {
                if (c === true) {
                  const ok = await push.enable();
                  if (!ok) toast.error('Trình duyệt chặn quyền thông báo — vào cài đặt trình duyệt để cho phép');
                } else await push.disable();
              }} />
            <div className="grid gap-0.5">
              <Label htmlFor="notif-push" className="flex items-center gap-1.5"><BellRing className="size-4" /> Nhận thông báo đẩy</Label>
              <span className="text-xs text-muted-foreground">Báo ngay cả khi không mở OfficeHub (đơn chờ duyệt, tin nhắn, bảng tin…).</span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
