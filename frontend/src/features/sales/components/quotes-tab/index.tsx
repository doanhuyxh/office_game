import { useState } from 'react';
import { Settings } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { fmtDate } from '@/features/finance';
import { useDebounce } from '@/hooks/useDebounce';
import { formatMoney } from '@/utils/money';
import { useQuotes, useSalesSettings } from '../../hooks/useSales';
import type { QuoteStatus } from '../../types/sales.types';
import { QUOTE_STATUS } from '../../utils/labels';
import { QuoteFormDialog } from '../quote-form-dialog';
import { QuoteSettingsDialog } from '../quote-settings-dialog';

/** Danh sách báo giá (bản mới nhất; lọc trạng thái để xem bản đã thay / huỷ). Cấu hình: ngưỡng chiết khấu + mẫu Word. */
export function QuotesTab({ creating, onCreatedClose, onOpen }: { creating: boolean; onCreatedClose: () => void; onOpen: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<QuoteStatus | null>(null);
  const [settings, setSettings] = useState(false);
  const q = useDebounce(search, 300);
  const pg = usePageState('sales-quotes', `${q}|${status}`);
  const { data, isLoading } = useQuotes(q, status ?? undefined, undefined, pg.query);
  const s = useSalesSettings().data;
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <Input placeholder="Tìm tên báo giá, khách…" className="w-64" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm" />
        <div className="w-52"><SelectField id="q-status" label="Trạng thái" allowEmpty emptyLabel="Đang hiệu lực" value={status} onChange={(v) => setStatus(v as QuoteStatus | null)}
          options={(Object.keys(QUOTE_STATUS) as QuoteStatus[]).map((k) => ({ value: k, label: QUOTE_STATUS[k].label }))} /></div>
        <div className="flex-1" />
        <Button size="sm" variant="outline" className="mb-1" onClick={() => setSettings(true)}><Settings /> Cấu hình{s ? ` (ngưỡng CK ${s.quoteDiscountLimitPercent}%)` : ''}</Button>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Số</TableHead><TableHead>Khách · Báo giá</TableHead><TableHead className="text-right">Tổng (sau thuế)</TableHead>
            <TableHead className="text-right">CK</TableHead><TableHead>Hiệu lực</TableHead><TableHead>Trạng thái</TableHead><TableHead>Phụ trách</TableHead></TableRow></TableHeader>
          <TableBody>
            {!isLoading && data?.items.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">Chưa có báo giá</TableCell></TableRow>}
            {data?.items.map((x) => (
              <TableRow key={x.id} className="cursor-pointer" onClick={() => onOpen(x.id)} data-testid="quote-row">
                <TableCell className="whitespace-nowrap font-medium">{x.code}</TableCell>
                <TableCell className="text-sm"><div>{x.customerName}</div><div className="text-xs text-muted-foreground">{x.title}</div></TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(x.total)}</TableCell>
                <TableCell className="text-right tabular-nums">{x.discountPercent ? `${x.discountPercent}%` : '—'}</TableCell>
                <TableCell className={`whitespace-nowrap ${x.expired ? 'text-rose-600' : ''}`}>{fmtDate(x.validUntil)}</TableCell>
                <TableCell><StatusBadge tone={QUOTE_STATUS[x.status].tone}>{QUOTE_STATUS[x.status].label}</StatusBadge></TableCell>
                <TableCell className="text-sm text-muted-foreground">{x.ownerName}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="báo giá" />
      </div>
      <QuoteFormDialog open={creating} onClose={onCreatedClose} onCreated={onOpen} />
      <QuoteSettingsDialog open={settings} onClose={() => setSettings(false)} />
    </div>
  );
}
