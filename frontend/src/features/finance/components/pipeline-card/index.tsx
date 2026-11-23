import { Link } from '@tanstack/react-router';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { PATHS } from '@/config/paths';
import { formatMoney } from '@/utils/money';
import type { IDashboard } from '../../types/finance.types';
import { STAGE_LABEL } from '../../utils/labels';
import { BlockCard } from '../block-card';

/** Pipeline: cơ hội đang mở, giá trị + có trọng số (giá trị × xác suất) theo giai đoạn → tab Cơ hội của Kinh doanh. */
export function PipelineCard({ data }: { data: IDashboard['pipeline'] }) {
  return (
    <BlockCard testId="pipeline-card" title="Pipeline cơ hội" hint={`${data.openCount} cơ hội đang mở · tổng giá trị ${formatMoney(data.openValue)}`}
      action={<Link to={PATHS.sales} search={{ tab: 'opportunities' } as never} className="text-sm text-primary hover:underline" data-testid="pipeline-link">Xem cơ hội</Link>}>
      <div className="px-4 pt-3">
        <span className="text-2xl font-semibold tabular-nums" data-testid="pipeline-weighted">{formatMoney(data.weighted)}</span>
        <span className="ms-2 text-sm text-muted-foreground">có trọng số</span>
      </div>
      <Table>
        <TableHeader><TableRow><TableHead>Giai đoạn</TableHead><TableHead className="text-right">Số</TableHead><TableHead className="text-right">Giá trị</TableHead><TableHead className="text-right">Có trọng số</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.byStage.map((s) => (
            <TableRow key={s.stage}>
              <TableCell>{STAGE_LABEL[s.stage]}</TableCell>
              <TableCell className="text-right tabular-nums">{s.count}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(s.value)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(s.weighted)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </BlockCard>
  );
}
