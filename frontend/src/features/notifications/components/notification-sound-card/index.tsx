import { BellRing, Mail, Volume2 } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Checkbox } from '@/components/common/checkbox';
import { Label } from '@/components/common/label';
import { useNotificationPreferences, useSaveNotificationPreferences } from '../../hooks/useNotifications';
import { useNotificationSound } from '../../hooks/useNotificationSound';
import { usePush } from '../../hooks/usePush';
import { playNotificationSound } from '../../utils/sound';
import { errorMessage } from '@/utils/errors';

/** Tùy chọn âm thanh chuông + thông báo đẩy (lưu trên trình duyệt này) + email (lưu theo tài khoản). Hiện ở trang hồ sơ cho mọi tài khoản. */
export function NotificationSoundCard() {
  const [soundOn, setSoundOn] = useNotificationSound();
  const push = usePush();
  const prefs = useNotificationPreferences();
  const savePrefs = useSaveNotificationPreferences();
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Tùy chọn thông báo</CardTitle>
        <CardDescription>Âm thanh và thông báo đẩy áp dụng cho trình duyệt này; email áp dụng cho tài khoản.</CardDescription>
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
        <div className="flex items-start gap-3">
          <Checkbox id="notif-email" checked={prefs.data?.emailEnabled ?? true} disabled={!prefs.data || savePrefs.isPending} data-testid="notification-email-pref"
            onCheckedChange={(c) => savePrefs.mutate({ emailEnabled: c === true }, {
              onSuccess: (d) => toast.success(d.emailEnabled ? 'Đã bật thông báo qua email' : 'Đã tắt thông báo qua email'),
              onError: (e) => toast.error(errorMessage(e)),
            })} />
          <div className="grid gap-0.5">
            <Label htmlFor="notif-email" className="flex items-center gap-1.5"><Mail className="size-4" /> Nhận thông báo qua email</Label>
            <span className="text-xs text-muted-foreground">Gửi email khi có đơn chờ duyệt, kết quả duyệt, nhắc việc… Tắt thì chỉ còn chuông và thông báo đẩy (email bảo mật tài khoản vẫn gửi).</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
