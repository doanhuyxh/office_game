import { useMemo } from 'react';
import { Link } from '@tanstack/react-router';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/common/card';
import { currentMonthVn, todayVn } from '@/utils/date';
import { formatNumber } from '@/utils/number';
import { useAiUsageSummary } from '../../hooks/useAiUsage';
import { formatTokensShort, formatUsd, totalTokens } from '../../utils/aiUsage';

/**
 * Hồ sơ → thẻ "AI tháng này" (TEST-136): mức dùng AI của chính tài khoản trong tháng hiện tại (giờ VN).
 * Chỉ hiện khi tài khoản có phiên trong tháng (thường là tài khoản bot chạy qua agent-runner).
 */
export function AiMonthCard() {
  const month = currentMonthVn();
  const filter = useMemo(() => ({ group: 'month' as const, from: `${month}-01`, to: todayVn() }), [month]);
  const { data } = useAiUsageSummary(filter);
  const top = useMemo(() => {
    const sum = new Map<string, number>();
    for (const g of data?.groups ?? []) sum.set(g.model, (sum.get(g.model) ?? 0) + totalTokens(g));
    return [...sum.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }, [data]);
  if (!data || data.total.sessions === 0) return null;
  const t = data.total;
  const tokens = totalTokens(t);
  const allMissing = t.costMissing === t.sessions;
  return (
    <Card data-testid="ai-month-card">
      <CardHeader>
        <CardTitle className="text-base">AI tháng này</CardTitle>
        <CardDescription>Token / chi phí các phiên agent tháng {month.slice(5, 7)}/{month.slice(0, 4)}.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="grid gap-0.5"><span className="text-xs text-muted-foreground">Tổng token</span>
            <span className="text-lg font-semibold tabular-nums" title={`${formatNumber(tokens, 0)} token`} data-testid="ai-month-tokens">{formatTokensShort(tokens)}</span></div>
          <div className="grid gap-0.5"><span className="text-xs text-muted-foreground">Chi phí</span>
            <span className="text-lg font-semibold tabular-nums" data-testid="ai-month-cost">{allMissing ? '—' : formatUsd(t.costUsd)}</span>
            {t.costMissing > 0 && !allMissing && <span className="text-[11px] text-warning">{t.costMissing} phiên không có chi phí</span>}</div>
          <div className="grid min-w-0 gap-0.5"><span className="text-xs text-muted-foreground">Model dùng nhiều nhất</span>
            <span className="truncate text-sm font-medium" title={top ?? undefined}>{top ?? '—'}</span></div>
          <div className="grid gap-0.5"><span className="text-xs text-muted-foreground">Số phiên</span>
            <span className="text-lg font-semibold tabular-nums" data-testid="ai-month-sessions">{formatNumber(t.sessions, 0)}</span></div>
        </div>
        <Link to="/ai-access" search={{ tab: 'usage', usage: 'month' } as never} className="text-sm text-primary hover:underline">Xem chi tiết</Link>
      </CardContent>
    </Card>
  );
}
