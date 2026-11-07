import { useState } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate, todayVn } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import { useServices } from '../../hooks/useAssets';
import { BILLING, SERVICE_STATUS } from '../../utils/labels';
import { SeatsSheet } from '../seats-sheet';
import { ServiceFormDialog } from '../service-form-dialog';

/** Tab Dịch vụ (HR): bảng dịch vụ + số ghế; bấm dòng mở danh sách ghế. */
export function ServicesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const { data = [], isLoading } = useServices();
  const [openId, setOpenId] = useState<string | null>(null);
  const today = todayVn();
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dịch vụ</TableHead><TableHead>Ghế</TableHead><TableHead>Trạng thái</TableHead>
              <TableHead className="hidden md:table-cell">Chu kỳ</TableHead><TableHead className="hidden text-right md:table-cell">Chi phí</TableHead>
              <TableHead className="hidden lg:table-cell">Gia hạn</TableHead><TableHead className="hidden lg:table-cell">Quản trị</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={7}><Spinner /></TableCell></TableRow>}
            {!isLoading && data.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có dịch vụ.</TableCell></TableRow>}
            {data.map((s) => {
              const full = s.seatLimit != null && s.seatsUsed >= s.seatLimit;
              const due = s.renewalDate != null && s.status === 'Active' && s.renewalDate < today;
              return (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => setOpenId(s.id)} data-testid="service-row">
                  <TableCell className="max-w-[18rem]">
                    <div className="truncate font-medium">{s.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{[s.vendor, s.plan].filter(Boolean).join(' · ') || '—'}</div>
                  </TableCell>
                  <TableCell className={`tabular-nums ${full ? 'text-warning' : ''}`}>{s.seatsUsed}{s.seatLimit != null ? `/${s.seatLimit}` : ''}</TableCell>
                  <TableCell><StatusBadge tone={SERVICE_STATUS[s.status].tone}>{SERVICE_STATUS[s.status].label}</StatusBadge></TableCell>
                  <TableCell className="hidden md:table-cell">{BILLING[s.billingCycle]}</TableCell>
                  <TableCell className="hidden text-right tabular-nums md:table-cell">{formatMoney(s.cost)}</TableCell>
                  <TableCell className={`hidden lg:table-cell ${due ? 'text-destructive' : ''}`}>{s.renewalDate ? formatDate(s.renewalDate) : '—'}</TableCell>
                  <TableCell className="hidden lg:table-cell">{s.adminName ?? '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <SeatsSheet serviceId={openId} onClose={() => setOpenId(null)} />
      <ServiceFormDialog open={creating} onOpenChange={(o) => !o && onCreatedClose()} />
    </div>
  );
}
