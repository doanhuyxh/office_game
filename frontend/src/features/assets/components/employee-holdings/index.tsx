import { Laptop, KeyRound } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate } from '@/utils/date';
import { useHoldings } from '../../hooks/useAssets';

/**
 * Thiết bị + tài khoản dịch vụ nhân viên đang giữ (HR, quản lý của người đó). Không đủ quyền / lỗi → không hiện gì (im lặng).
 * `warn` = dạng cảnh báo gọn (hộp thoại cho nghỉ việc): chỉ hiện khi còn giữ tài sản.
 */
export function EmployeeHoldings({ employeeId, warn }: { employeeId: string | null; warn?: boolean }) {
  const { data, isLoading, isError } = useHoldings(employeeId);
  if (!employeeId || isError) return null;
  if (isLoading) return warn ? null : <Spinner />;
  if (!data) return null;
  const empty = data.devices.length === 0 && data.seats.length === 0;
  if (warn && empty) return null;
  return (
    <div className={warn ? 'grid gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm' : 'grid gap-3 text-sm'} data-testid="employee-holdings">
      {warn && (
        <p className="font-medium text-warning">
          Còn giữ {data.devices.length} thiết bị và {data.seats.length} tài khoản dịch vụ — nhớ thu hồi (HR sẽ nhận thông báo sau khi nghỉ việc).
        </p>
      )}
      {empty && <p className="text-muted-foreground">Không giữ thiết bị hay tài khoản dịch vụ nào.</p>}
      {data.devices.length > 0 && (
        <ul className="grid gap-1">
          {data.devices.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <Laptop className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate"><b>{d.code}</b> · {d.name}{d.serialNumber ? ` · SN ${d.serialNumber}` : ''}</span>
              <span className="shrink-0 text-xs text-muted-foreground">từ {formatDate(d.assignedAt)}</span>
            </li>
          ))}
        </ul>
      )}
      {data.seats.length > 0 && (
        <ul className="grid gap-1">
          {data.seats.map((s) => (
            <li key={s.id} className="flex items-center gap-2">
              <KeyRound className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate"><b>{s.serviceName}</b> · {s.accountLogin}{s.role ? ` · ${s.role}` : ''}</span>
              <span className="shrink-0 text-xs text-muted-foreground">từ {formatDate(s.grantedAt)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Hộp thoại "Tài sản đang giữ" của một nhân viên (menu nhân viên). */
export function EmployeeHoldingsDialog({ employeeId, name, onClose }: { employeeId: string | null; name?: string; onClose: () => void }) {
  return (
    <Dialog open={!!employeeId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Tài sản đang giữ · {name}</DialogTitle>
          <DialogDescription>Thiết bị và tài khoản dịch vụ của công ty đang cấp cho người này. Cấp / thu hồi ở menu Tài sản.</DialogDescription>
        </DialogHeader>
        <EmployeeHoldings employeeId={employeeId} />
      </DialogContent>
    </Dialog>
  );
}
