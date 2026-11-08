import { useState } from 'react';
import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { fmtDate, todayVn } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { useCustomers, useUpcoming } from '../../hooks/useSales';
import { CUSTOMER_KIND } from '../../utils/labels';
import { CustomerFormDialog } from '../customer-form-dialog';

/** Danh sách khách (của tôi + cấp dưới; Ban giám đốc / kế toán thấy tất cả) + việc chăm sóc đã hẹn. */
export function CustomersTab({ creating, onCreatedClose, onOpen }: { creating: boolean; onCreatedClose: () => void; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [inactive, setInactive] = useState(false);
  const q = useDebounce(search, 300);
  const pg = usePageState('sales-customers', `${q}-${inactive}`);
  const { data, isLoading } = useCustomers(q, inactive, pg.query);
  const followUps = useUpcoming().data ?? [];
  const today = todayVn();
  const upcoming = followUps.filter((a) => a.nextActionOn && a.nextActionOn >= today).slice(0, 5);
  const overdue = followUps.filter((a) => a.nextActionOn && a.nextActionOn < today);
  return (
    <div className="grid grid-cols-1 gap-3">
      {(upcoming.length > 0 || overdue.length > 0) && (
        <div className="rounded-xl border bg-card p-3">
          <div className="mb-2 text-sm font-medium">Việc chăm sóc đã hẹn {overdue.length > 0 && <StatusBadge tone="danger">{overdue.length} việc quá hẹn</StatusBadge>}</div>
          <ul className="grid gap-1 text-sm">
            {[...overdue, ...upcoming].map((a) => (
              <li key={a.id}><button type="button" className="text-left hover:underline" onClick={() => onOpen(a.customerId)}>
                <span className={a.nextActionOn! < today ? 'text-rose-600' : 'text-muted-foreground'}>{fmtDate(a.nextActionOn)}</span> · <b>{a.customerName}</b>: {a.nextAction}
              </button></li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Input placeholder="Tìm tên, MST, điện thoại, người liên hệ…" className="w-72" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm khách" />
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={inactive} onCheckedChange={(c) => setInactive(c === true)} /> Hiện khách đã ngừng</label>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow><TableHead>Mã</TableHead><TableHead>Khách hàng</TableHead><TableHead>Liên lạc</TableHead><TableHead>Phụ trách</TableHead>
              <TableHead className="text-right">Cơ hội mở</TableHead><TableHead className="text-right">HĐ hiệu lực</TableHead></TableRow>
          </TableHeader>
          <TableBody>
            {!isLoading && data?.items.length === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có khách hàng</TableCell></TableRow>}
            {data?.items.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => onOpen(c.id)} data-testid="customer-row">
                <TableCell className="whitespace-nowrap text-muted-foreground">{c.code}</TableCell>
                <TableCell><div className="font-medium">{c.name}{!c.isActive && <StatusBadge tone="muted" className="ml-2">Ngừng</StatusBadge>}</div>
                  <div className="text-xs text-muted-foreground">{CUSTOMER_KIND[c.kind]}{c.taxCode && ` · MST ${c.taxCode}`}</div></TableCell>
                <TableCell className="text-sm">{[c.phone, c.email].filter(Boolean).join(' · ') || '—'}</TableCell>
                <TableCell className="text-sm">{c.ownerName}</TableCell>
                <TableCell className="text-right tabular-nums">{c.openOpportunities || '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{c.activeContracts || '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="khách" />
      </div>
      <CustomerFormDialog open={creating} onClose={onCreatedClose} onCreated={onOpen} />
    </div>
  );
}
