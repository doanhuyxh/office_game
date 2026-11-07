import { useState } from 'react';
import { Search } from 'lucide-react';
import { Input } from '@/components/common/input';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDate, todayVn } from '@/utils/date';
import { formatMoney } from '@/utils/money';
import { useCategories, useDevices } from '../../hooks/useAssets';
import type { DeviceStatus } from '../../types/asset.types';
import { DEVICE_STATUS, DEVICE_STATUS_OPTIONS } from '../../utils/labels';
import { DeviceFormDialog } from '../device-form-dialog';
import { DeviceSheet } from '../device-sheet';

/** Tab Thiết bị (HR): bảng + bộ lọc, bấm dòng mở chi tiết. `creating` bật hộp thoại thêm (nút ở thanh tab). */
export function DevicesTab({ creating, onCreatedClose }: { creating: boolean; onCreatedClose: () => void }) {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [status, setStatus] = useState<DeviceStatus | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const q = useDebounce(search, 300);
  const { data: categories = [] } = useCategories();
  const filter = { search: q, categoryId, status };
  const pg = usePageState('assets-devices', JSON.stringify(filter));
  const { data, isLoading } = useDevices(filter, pg.query);
  const today = todayVn();
  return (
    <div className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-8" placeholder="Tìm mã, tên, serial, người giữ…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm thiết bị" />
        </div>
        <div className="w-44"><SelectField id="dv-f-cat" label="" value={categoryId} onChange={setCategoryId} allowEmpty emptyLabel="Mọi loại" placeholder="Mọi loại"
          options={categories.map((c) => ({ value: c.id, label: c.name }))} /></div>
        <div className="w-44"><SelectField id="dv-f-status" label="" value={status} onChange={(v) => setStatus(v as DeviceStatus | null)} allowEmpty emptyLabel="Mọi trạng thái" placeholder="Mọi trạng thái"
          options={DEVICE_STATUS_OPTIONS} /></div>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Thiết bị</TableHead><TableHead className="hidden sm:table-cell">Loại</TableHead><TableHead>Trạng thái</TableHead>
              <TableHead className="hidden md:table-cell">Người giữ</TableHead><TableHead className="hidden lg:table-cell">Bảo hành</TableHead>
              <TableHead className="hidden text-right lg:table-cell">Giá mua</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && <TableRow><TableCell colSpan={6}><Spinner /></TableCell></TableRow>}
            {!isLoading && (data?.items.length ?? 0) === 0 && <TableRow><TableCell colSpan={6} className="py-8 text-center text-muted-foreground">Chưa có thiết bị.</TableCell></TableRow>}
            {data?.items.map((d) => {
              const st = DEVICE_STATUS[d.status];
              const expired = d.warrantyUntil != null && d.warrantyUntil < today;
              return (
                <TableRow key={d.id} className="cursor-pointer" onClick={() => setOpenId(d.id)} data-testid="device-row">
                  <TableCell className="max-w-[20rem]">
                    <div className="truncate font-medium">{d.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{d.code}{d.serialNumber ? ` · SN ${d.serialNumber}` : ''}</div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{d.categoryName}</TableCell>
                  <TableCell><StatusBadge tone={st.tone}>{st.label}</StatusBadge></TableCell>
                  <TableCell className="hidden md:table-cell">{d.holderName ?? '—'}</TableCell>
                  <TableCell className={`hidden lg:table-cell ${expired ? 'text-destructive' : ''}`}>{d.warrantyUntil ? formatDate(d.warrantyUntil) : '—'}</TableCell>
                  <TableCell className="hidden text-right tabular-nums lg:table-cell">{formatMoney(d.purchasePrice)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <TablePagination state={pg} total={data?.total} unit="thiết bị" />
      </div>
      <DeviceSheet id={openId} onClose={() => setOpenId(null)} />
      <DeviceFormDialog open={creating} onOpenChange={(o) => !o && onCreatedClose()} />
    </div>
  );
}
