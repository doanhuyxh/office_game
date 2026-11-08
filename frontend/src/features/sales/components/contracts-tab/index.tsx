import { useState } from 'react';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { fmtDate } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { formatMoney } from '@/utils/money';
import { useContracts } from '../../hooks/useSales';
import type { ContractStatus } from '../../types/sales.types';
import { BILLING, CONTRACT_STATUS } from '../../utils/labels';
import { ContractFormDialog } from '../contract-form-dialog';

export function ContractsTab({ creating, onCreatedClose, onOpen }: { creating: boolean; onCreatedClose: () => void; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ContractStatus | null>('Active');
  const q = useDebounce(search, 300);
  const pg = usePageState('sales-contracts', `${q}-${status}`);
  const { data, isLoading } = useContracts(q, status ?? undefined, pg.query);
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Input placeholder="Tìm số / tên hợp đồng, khách hàng…" className="w-72" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm hợp đồng" />
        <div className="w-48"><SelectField id="k-filter" label="Trạng thái" allowEmpty emptyLabel="Tất cả" value={status} onChange={(v) => setStatus(v as ContractStatus | null)}
          options={(Object.keys(CONTRACT_STATUS) as ContractStatus[]).map((s) => ({ value: s, label: CONTRACT_STATUS[s].label }))} /></div>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Số HĐ</TableHead><TableHead>Khách · Tên</TableHead><TableHead>Ký</TableHead><TableHead className="text-right">Giá trị</TableHead>
            <TableHead className="text-right">Đã thu</TableHead><TableHead className="text-right">Còn nợ</TableHead><TableHead>Trạng thái</TableHead></TableRow></TableHeader>
          <TableBody>
            {!isLoading && data?.items.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có hợp đồng</TableCell></TableRow>}
            {data?.items.map((k) => (
              <TableRow key={k.id} className="cursor-pointer" onClick={() => onOpen(k.id)} data-testid="contract-row">
                <TableCell className="font-medium whitespace-nowrap">{k.code}</TableCell>
                <TableCell><div>{k.customerName}</div><div className="text-xs text-muted-foreground">{k.title} · {BILLING[k.billing]} · {k.ownerName}</div></TableCell>
                <TableCell className="whitespace-nowrap">{fmtDate(k.signedOn)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(k.totalValue)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(k.collected)}</TableCell>
                <TableCell className={`text-right tabular-nums ${k.overdue ? 'text-rose-600' : ''}`}>{formatMoney(k.outstanding)}{k.overdue > 0 && <div className="text-xs">quá hạn {formatMoney(k.overdue)}</div>}</TableCell>
                <TableCell><StatusBadge tone={CONTRACT_STATUS[k.status].tone}>{CONTRACT_STATUS[k.status].label}</StatusBadge></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="hợp đồng" />
      </div>
      <ContractFormDialog open={creating} onClose={onCreatedClose} onCreated={onOpen} />
    </div>
  );
}
