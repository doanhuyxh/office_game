import type { ReactNode } from 'react';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { formatDate } from '@/utils/date';
import type { IAssetRow } from '../../types/document.types';
import { formatSize, KIND, STATUS } from '../../utils/labels';

/** Bảng tài liệu dùng chung (kho, tìm kiếm, thùng rác, hạn lưu trữ). Bấm dòng → mở chi tiết. `extra` = cột thêm ở cuối. */
export function AssetTable({ rows, loading, onOpen, empty = 'Chưa có tài liệu.', extra, extraHead, showLocation }: {
  rows: IAssetRow[];
  loading?: boolean;
  onOpen: (r: IAssetRow) => void;
  empty?: ReactNode;
  extra?: (r: IAssetRow) => ReactNode;
  extraHead?: string;
  showLocation?: (r: IAssetRow) => string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Tài liệu</TableHead>
          <TableHead className="hidden md:table-cell">Loại</TableHead>
          <TableHead>Trạng thái</TableHead>
          <TableHead className="hidden text-right sm:table-cell">Dung lượng</TableHead>
          <TableHead className="hidden lg:table-cell">Phụ trách</TableHead>
          <TableHead className="hidden lg:table-cell">Cập nhật</TableHead>
          {extra && <TableHead>{extraHead}</TableHead>}
        </TableRow>
      </TableHeader>
      <TableBody>
        {loading && <TableRow><TableCell colSpan={7}><Spinner /></TableCell></TableRow>}
        {!loading && rows.length === 0 && <TableRow><TableCell colSpan={7} className="py-8 text-center text-muted-foreground">{empty}</TableCell></TableRow>}
        {rows.map((r) => {
          const k = KIND[r.kind];
          return (
            <TableRow key={r.id} className="cursor-pointer" onClick={() => onOpen(r)} data-testid="asset-row">
              <TableCell className="max-w-[22rem]">
                <div className="flex items-start gap-2">
                  <k.icon className={`mt-0.5 size-4 shrink-0 ${k.className}`} />
                  <div className="min-w-0">
                    <div className="truncate font-medium">{r.classification !== 'Internal' && <span title="Hạn chế / Mật" aria-label="Hạn chế / Mật">🔒 </span>}{r.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {r.code}{r.documentNumber ? ` · Số ${r.documentNumber}` : ''}{r.currentVersion > 1 ? ` · v${r.currentVersion}` : ''}
                      {showLocation ? ` · ${showLocation(r)}` : ''}
                    </div>
                    {r.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">{r.tags.slice(0, 4).map((t) => <span key={t} className="rounded bg-muted px-1.5 text-[11px]">{t}</span>)}</div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell className="hidden md:table-cell">{r.docTypeName}</TableCell>
              <TableCell><StatusBadge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</StatusBadge></TableCell>
              <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatSize(r.totalSize)}</TableCell>
              <TableCell className="hidden lg:table-cell">{r.custodianName ?? '—'}</TableCell>
              <TableCell className="hidden lg:table-cell">{formatDate(r.updatedAt ?? r.createdAt)}</TableCell>
              {extra && <TableCell onClick={(e) => e.stopPropagation()}>{extra(r)}</TableCell>}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
