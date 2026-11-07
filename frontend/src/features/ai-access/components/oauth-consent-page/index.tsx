import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, ExternalLink, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Spinner } from '@/components/feedback/Spinner';
import { AuthShell, useMe } from '@/features/auth';
import { ApiError } from '@/services/api-client';
import { errorMessage } from '@/utils/errors';
import { accessTokenApi, type OAuthParams } from '../../api/accessToken.api';
import type { IAuthorizeError } from '../../types/accessToken.types';

const PARAM_NAMES = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'scope', 'state', 'resource'];

const asAuthorizeError = (err: unknown): IAuthorizeError | null =>
  err instanceof ApiError && typeof (err.problem as Partial<IAuthorizeError>).error === 'string'
    ? (err.problem as unknown as IAuthorizeError) : null;

/**
 * Trang đồng ý OAuth (/oauth/authorize): ứng dụng AI (claude.ai, Cursor, Codex…) chuyển người dùng tới đây.
 * Back-end kiểm tra client / redirect_uri / PKCE; FE chỉ hiển thị và chuyển về địa chỉ back-end trả.
 */
export function OAuthConsentPage() {
  const me = useMe();
  const params = useMemo<OAuthParams>(() => {
    const q = new URLSearchParams(window.location.search);
    return Object.fromEntries(PARAM_NAMES.flatMap((k) => (q.has(k) ? [[k, q.get(k) ?? '']] : [])));
  }, []);
  const info = useQuery({ queryKey: ['oauth', 'authorize', params], queryFn: () => accessTokenApi.authorizeInfo(params), retry: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decide = async (approve: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const r = await accessTokenApi.authorize(params, approve);
      window.location.assign(r.redirectTo);
    } catch (err) {
      const e = asAuthorizeError(err);
      if (e?.redirectTo) window.location.assign(e.redirectTo);
      else { setError(e?.message ?? errorMessage(err)); setBusy(false); }
    }
  };

  if (info.isLoading) return <div className="grid min-h-svh place-items-center"><Spinner /></div>;

  const infoError = info.error ? asAuthorizeError(info.error) : null;
  if (info.isError || !info.data) {
    return (
      <AuthShell title="Không kết nối được ứng dụng" description={infoError?.message ?? errorMessage(info.error)}>
        <div className="grid gap-3 text-sm text-muted-foreground">
          <p>Hãy quay lại ứng dụng AI và kết nối lại. Nếu vẫn lỗi, gửi ảnh màn hình này cho quản trị hệ thống.</p>
          {infoError?.redirectTo && (
            <Button variant="outline" onClick={() => window.location.assign(infoError.redirectTo!)}>Quay lại ứng dụng</Button>
          )}
        </div>
      </AuthShell>
    );
  }

  const app = info.data;
  return (
    <AuthShell title={`Cho phép "${app.clientName}" truy cập OfficeHub?`}
      description={`Đăng nhập với tài khoản ${me.data?.fullName ?? ''} (${me.data?.userName ?? ''}).`}>
      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <p className="font-medium">Ứng dụng sẽ được thay bạn:</p>
          <ul className="grid gap-1.5">
            {['Xem chấm công, bảng công, quỹ phép, thông báo, danh bạ', 'Chấm công (tính là làm từ xa), gửi / huỷ đơn nghỉ, tăng ca, giải trình',
              'Duyệt / từ chối đơn nếu bạn là quản lý hoặc HR'].map((t) => (
              <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-success" />{t}</li>
            ))}
            <li className="flex gap-2"><X className="mt-0.5 size-4 shrink-0 text-destructive" />Không xem được hợp đồng, lương; không đổi được mật khẩu</li>
          </ul>
        </div>
        <div className="flex gap-2 rounded-md bg-muted p-3 text-xs text-muted-foreground">
          <ExternalLink className="mt-0.5 size-3.5 shrink-0" />
          <span>Sau khi chọn, bạn được chuyển về <span className="font-medium text-foreground">{app.redirectHost}</span>.
            Chỉ cho phép nếu chính bạn vừa bấm kết nối trong ứng dụng này. Thu hồi bất cứ lúc nào ở trang Kết nối AI.</span>
        </div>
        {error && (
          <div className="flex gap-2 rounded-md bg-destructive/10 p-3 text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />{error}
          </div>
        )}
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={busy} onClick={() => decide(false)}>Từ chối</Button>
          <Button disabled={busy} onClick={() => decide(true)}>{busy ? 'Đang chuyển…' : 'Cho phép'}</Button>
        </div>
      </div>
    </AuthShell>
  );
}
