import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { useSystemInfo } from '../../hooks/useSystem';
import { HealthRow, InfoRow } from '../service-info';

/**
 * SMTP đang có hiệu lực + tình trạng kết nối (TEST-235, trước là tab "Email (SMTP)"): đặt trên form cấu hình ở mục
 * Hệ thống → Cấu hình → Email (SMTP). Dữ liệu `useSystemInfo()` (`/api/system/info`, không có mật khẩu).
 */
export function SmtpStatusCard() {
  const { data, isLoading, isFetching, error, refetch } = useSystemInfo();
  return (
    <Card data-testid="system-smtp-status">
      <CardHeader>
        <CardTitle className="text-base">Đang dùng</CardTitle>
        <CardDescription>Cấu hình gửi mail đang có hiệu lực (lưu ở dưới, chưa lưu thì lấy từ <code className="rounded bg-muted px-1 text-xs">.env</code>) và tình trạng kết nối. Mật khẩu không hiển thị.</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} /> Kiểm tra lại
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isLoading ? <Spinner /> : error || !data ? <p className="text-sm text-destructive">{errorMessage(error)}</p> : (
          <>
            <InfoRow label="Máy chủ">{data.smtp.host}:{data.smtp.port} · {data.smtp.useSsl ? 'SSL' : 'STARTTLS / không mã hoá'}</InfoRow>
            <InfoRow label="Tài khoản">{data.smtp.username ?? '—'}</InfoRow>
            <InfoRow label="Gửi từ">{data.smtp.fromName} &lt;{data.smtp.fromEmail}&gt;</InfoRow>
            {data.health.filter((h) => h.name === 'smtp').map((h) => <HealthRow key={h.name} h={h} />)}
          </>
        )}
      </CardContent>
    </Card>
  );
}
