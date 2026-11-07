import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/common/card';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { formatMoney } from '@/utils/money';
import { useMyPayslips } from '../../hooks/usePayroll';
import { PayslipView } from '../payslip-view';

/** Phiếu lương của tôi — chỉ các kỳ HR đã chốt. */
export function PayslipsPage() {
  const my = useMyPayslips();
  const [sel, setSel] = useState<string | null>(null);
  const list = my.data ?? [];
  const current = list.find((p) => p.periodId === sel) ?? list[0];
  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Phiếu lương" />
      {my.isLoading ? <Spinner /> : list.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-sm text-muted-foreground"><Wallet className="size-8" />Chưa có phiếu lương nào.</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {list.map((p) => (
              <Button key={p.periodId} variant={p.periodId === current?.periodId ? 'default' : 'outline'} size="sm" onClick={() => setSel(p.periodId)}>
                {p.month.slice(5)}/{p.month.slice(0, 4)} · {formatMoney(p.data.net)}
              </Button>
            ))}
          </div>
          {current && (
            <Card>
              <CardHeader><CardTitle className="text-base">Tháng {current.month.slice(5)}/{current.month.slice(0, 4)}</CardTitle></CardHeader>
              <CardContent><PayslipView d={current.data} /></CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
