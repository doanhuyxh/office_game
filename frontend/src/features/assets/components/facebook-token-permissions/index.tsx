import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { StatusBadge } from '@/components/common/StatusBadge';
import type { IFacebookAccount } from '../../types/facebook.types';

const STATUS_LABEL: Record<string, string> = { granted: 'đã cấp', declined: 'bị từ chối', expired: 'hết hạn' };

/**
 * Khối "Quyền của token" dưới mục Token System User: mỗi quyền một badge (đã cấp xanh, bị từ chối / hết hạn đỏ),
 * quyền OfficeHub cần mà token không có → cảnh báo riêng. Chỉ hiện khi token hợp lệ (đã kiểm tra thành công).
 */
export function FacebookTokenPermissions({ account: a }: { account: IFacebookAccount }) {
  if (a.tokenStatus !== 'Valid') return null;
  const perms = a.tokenPermissions;

  return (
    <div className="grid gap-2" data-testid="social-token-permissions">
      <h5 className="flex items-center gap-2 text-sm font-medium"><ShieldCheck className="size-4" /> Quyền của token</h5>
      {perms === null ? (
        <p className="text-sm text-muted-foreground">{a.tokenPermissionsError ?? 'Chưa lấy được danh sách quyền — bấm "Đồng bộ trang" để kiểm tra lại.'}</p>
      ) : perms.length === 0 ? (
        <p className="text-sm text-muted-foreground">Facebook không trả về quyền nào cho token này.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {perms.map((p) => (
            <li key={p.permission} title={p.required ? 'OfficeHub cần quyền này' : undefined}>
              <StatusBadge tone={p.status === 'granted' ? 'success' : 'danger'} className={p.required ? 'font-semibold' : 'font-normal'}>
                <span className="font-mono">{p.permission}</span>
                {p.status !== 'granted' && <span className="ml-1">· {STATUS_LABEL[p.status] ?? p.status}</span>}
              </StatusBadge>
            </li>
          ))}
        </ul>
      )}
      {a.missingPermissions.length > 0 && (
        <div className="grid gap-1 rounded-md border border-warning/40 bg-warning/10 p-2 text-sm" role="alert" data-testid="social-missing-permissions">
          <p className="flex items-center gap-2 font-medium text-warning"><ShieldAlert className="size-4 shrink-0" /> Token thiếu quyền OfficeHub cần</p>
          <ul className="grid gap-0.5 pl-6">
            {a.missingPermissions.map((m) => (
              <li key={m.permission}>Thiếu quyền <code className="font-mono text-xs">{m.permission}</code>: {m.impact}.</li>
            ))}
          </ul>
          <p className="pl-6 text-xs text-muted-foreground">
            Tạo lại token với đủ quyền (xem "Cách lấy token System User" bên dưới) rồi dán vào ô Thay token.
          </p>
        </div>
      )}
    </div>
  );
}
