import { Volume2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Label } from '@/components/common/label';
import { useNotificationSound } from '../../hooks/useNotificationSound';
import { playNotificationSound } from '../../utils/sound';

/** Tùy chọn âm thanh chuông (lưu trên trình duyệt này). Hiện ở trang hồ sơ cho mọi tài khoản. */
export function NotificationSoundCard() {
  const [soundOn, setSoundOn] = useNotificationSound();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tùy chọn thông báo</CardTitle>
        <CardDescription>Áp dụng cho trình duyệt này.</CardDescription>
      </CardHeader>
      <CardContent className="flex items-start gap-3">
        <Checkbox id="notif-sound" checked={soundOn} data-testid="notification-sound-pref"
          onCheckedChange={(c) => { const on = c === true; setSoundOn(on); if (on) playNotificationSound(); }} />
        <div className="grid gap-0.5">
          <Label htmlFor="notif-sound" className="flex items-center gap-1.5"><Volume2 className="size-4" /> Phát âm thanh khi có thông báo mới</Label>
          <span className="text-xs text-muted-foreground">Nghe một tiếng chuông ngắn khi có thông báo mới trong lúc đang mở OfficeHub.</span>
        </div>
      </CardContent>
    </Card>
  );
}
