import { ExternalLink } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate } from '@/utils/date';
import { useMyAssets, useMyHandovers } from '../../hooks/useAssets';
import { HandoverList } from '../handover-list';
import { PendingReviewsCard } from '../pending-reviews-card';

/** Tab "Của tôi": biên bản chờ xác nhận, thiết bị + tài khoản dịch vụ mình đang giữ, các ghế cần mình rà soát (nếu có), biên bản đã có. */
export function MyAssetsTab() {
  const { data, isLoading } = useMyAssets();
  const handovers = useMyHandovers().data ?? [];
  const pending = handovers.filter((h) => h.requiresConfirmation && !h.confirmedAt);
  const done = handovers.filter((h) => !(h.requiresConfirmation && !h.confirmedAt));
  if (isLoading) return <Spinner />;
  const devices = data?.devices ?? [];
  const seats = data?.seats ?? [];
  return (
    <div className="grid grid-cols-1 gap-4">
      {pending.length > 0 && (
        <section className="grid gap-2 rounded-xl border border-warning/40 bg-warning/5 p-4" data-testid="pending-handovers">
          <h3 className="text-sm font-semibold">Biên bản cần bạn xác nhận ({pending.length})</h3>
          <p className="text-xs text-muted-foreground">Kiểm tra đúng thiết bị, số serial rồi bấm "Xác nhận". Hệ thống ghi thời điểm và địa chỉ IP vào biên bản.</p>
          <HandoverList items={pending} show="employee" canConfirm />
        </section>
      )}
      <PendingReviewsCard />
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Thiết bị đang giữ</h3>
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Mã</TableHead><TableHead>Thiết bị</TableHead><TableHead className="hidden sm:table-cell">Loại</TableHead>
                <TableHead className="hidden md:table-cell">Serial</TableHead><TableHead>Nhận từ</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {devices.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Bạn chưa được cấp thiết bị nào.</TableCell></TableRow>}
              {devices.map((d) => (
                <TableRow key={d.id} data-testid="my-device">
                  <TableCell className="font-medium">{d.code}</TableCell>
                  <TableCell>{d.name}</TableCell>
                  <TableCell className="hidden sm:table-cell">{d.categoryName}</TableCell>
                  <TableCell className="hidden md:table-cell">{d.serialNumber ?? '—'}</TableCell>
                  <TableCell>{formatDate(d.assignedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
      <section className="grid gap-2">
        <h3 className="text-sm font-semibold">Tài khoản dịch vụ</h3>
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Dịch vụ</TableHead><TableHead>Tài khoản</TableHead><TableHead className="hidden sm:table-cell">Vai trò</TableHead><TableHead>Cấp từ</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {seats.length === 0 && <TableRow><TableCell colSpan={4} className="py-8 text-center text-muted-foreground">Bạn chưa được cấp tài khoản dịch vụ nào.</TableCell></TableRow>}
              {seats.map((s) => (
                <TableRow key={s.id} data-testid="my-seat">
                  <TableCell className="font-medium">
                    {s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">{s.serviceName}<ExternalLink className="size-3" /></a> : s.serviceName}
                  </TableCell>
                  <TableCell>{s.accountLogin}</TableCell>
                  <TableCell className="hidden sm:table-cell">{s.role ?? '—'}</TableCell>
                  <TableCell>{formatDate(s.grantedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">Mật khẩu không lưu trong hệ thống — liên hệ người quản trị dịch vụ nếu cần cấp lại.</p>
      </section>
      {done.length > 0 && (
        <section className="grid gap-2">
          <h3 className="text-sm font-semibold">Biên bản giao nhận</h3>
          <HandoverList items={done} show="employee" />
        </section>
      )}
    </div>
  );
}
