import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { formatMoney } from '@/utils/money';
import { useForecast } from '../../hooks/useFinance';
import type { IForecast, IForecastWeek } from '../../types/finance.types';
import { fmtDate, type IForecastLineDef } from '../../utils/labels';
import { BlockCard } from '../block-card';
import { BlockState } from '../block-state';
import { ForecastCellSheet } from '../forecast-cell-sheet';
import { ForecastChart } from '../forecast-chart';
import { ForecastSettingsDialog } from '../forecast-settings-dialog';
import { ForecastTable } from '../forecast-table';
import { RecurringItemsDialog } from '../recurring-items-dialog';

/** "Thận trọng: âm tiền từ tuần 5 (từ 15/12/2026)". */
function negativeText(label: string, data: IForecast, week: number | null) {
  if (week == null) return null;
  const w = data.weeks.find((x) => x.week === week);
  return `${label}: âm tiền từ tuần ${week}${w ? ` (${fmtDate(w.from)} – ${fmtDate(w.to)})` : ''}`;
}

/**
 * Dự báo dòng tiền 13 tuần (`?tab=forecast`, quyền Xem tài chính): cảnh báo tuần âm, biểu đồ hai đường số dư, bảng 13 tuần (bấm ô → khoản chi tiết),
 * ghi chú giả định. Nút "Cấu hình dự báo" / "Khoản định kỳ" nằm trên hàng tab (chỉ Quản trị tài chính) — trang cha giữ trạng thái mở.
 * Mọi số do API tính (`/api/finance/forecast`); lưu cấu hình / khoản định kỳ → làm mới ['finance'] → dự báo tự cập nhật.
 */
export function ForecastTab({ dialog, onDialogClose }: { dialog: 'settings' | 'recurring' | null; onDialogClose: () => void }) {
  const q = useForecast();
  const d = q.data;
  const [cell, setCell] = useState<{ week: IForecastWeek; def: IForecastLineDef } | null>(null);
  const warnings = d ? [negativeText('Thận trọng', d, d.firstNegativeConservative), negativeText('Kỳ vọng', d, d.firstNegativeExpected)].filter(Boolean) : [];
  return (
    <div className="grid grid-cols-1 gap-4">
      {q.isLoading || q.error || !d
        ? <div className="rounded-xl border bg-card"><BlockState loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} rows={8} /></div>
        : <>
          {warnings.length > 0 && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" data-testid="forecast-negative-alert">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" />
              <div className="grid gap-0.5">{warnings.map((w) => <span key={w}>{w}</span>)}</div>
            </div>
          )}
          <BlockCard testId="forecast-chart-card" title="Số dư cuối tuần — 13 tuần tới"
            hint={<>Từ hôm nay {fmtDate(d.today)} đến {fmtDate(d.to)} · số dư đầu {formatMoney(d.opening)}</>}>
            <ForecastChart weeks={d.weeks} />
          </BlockCard>
          <BlockCard testId="forecast-table-card" title="Chi tiết theo tuần" hint="Bấm vào một ô để xem các khoản tạo nên số đó">
            <div className="pt-2"><ForecastTable data={d} onPick={(week, def) => setCell({ week, def })} /></div>
          </BlockCard>
          <ul className="grid list-disc gap-1 ps-5 text-xs text-muted-foreground" data-testid="forecast-notes">
            <li><b>Thận trọng</b> = đợt thu chưa quá hạn + khoản định kỳ thu − mọi khoản chi. <b>Kỳ vọng</b> = Thận trọng + công nợ quá hạn (dồn tuần 1) + cơ hội × xác suất.</li>
            <li>Lương dự kiến {formatMoney(d.payroll.monthlyCost)}/tháng{d.payroll.estimated ? ' (ước tính đủ công — kỳ lương tháng này chưa chốt)' : ''}, trả ngày {d.settings.payrollPayDay} tháng sau. Kỳ lương đã qua ngày trả coi như đã chi (sổ chưa nối bảng lương).</li>
            <li>Tiền cơ hội về sau ngày dự kiến chốt {d.settings.pipelineDelayDays} ngày; ngày về đã qua → tuần 1.</li>
            {d.undatedOpportunities > 0 && (
              <li data-testid="forecast-undated">{d.undatedOpportunities} cơ hội chưa có ngày dự kiến chốt ({formatMoney(d.undatedValue)}, có trọng số {formatMoney(d.undatedWeighted)}) không vào dự báo.</li>
            )}
            <li>Khoản có ngày đã qua (đợt thu quá hạn, dịch vụ quá ngày gia hạn, đề nghị chi quá ngày cần) dồn vào tuần 1.</li>
          </ul>
          <ForecastCellSheet data={d} cell={cell} onClose={() => setCell(null)} />
        </>}
      <ForecastSettingsDialog open={dialog === 'settings' && !!d} settings={d?.settings} onClose={onDialogClose} />
      <RecurringItemsDialog open={dialog === 'recurring'} onClose={onDialogClose} />
    </div>
  );
}
