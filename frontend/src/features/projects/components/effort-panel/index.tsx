import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { projectApi } from '../../api/project.api';
import { useEffort, useProjectMutation } from '../../hooks/useProjects';
import type { IProjectDetail } from '../../types/project.types';
import { fmtMonth } from '../../utils/labels';

const n = (v: number) => v.toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/**
 * Ngày công = ngày có mặt (chấm công) × % phân bổ. % chưa đặt → mặc định (1 dự án 100 %, n dự án chia đều).
 * Quản lý dự án sửa % của tháng đang chọn; tổng % đặt tay của một người ở mọi dự án ≤ 100. Không có tiền ở đây.
 * Tháng đã chốt (đầu tháng sau, 🔒): % mặc định đã ghi cố định — chỉ HR / Quản trị tài chính sửa.
 */
export function EffortPanel({ d }: { d: IProjectDetail }) {
  const p = d.project;
  const { data, isLoading, error } = useEffort(p.id, true);
  const [month, setMonth] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const save = useProjectMutation((items: { employeeId: string; percent: number | null }[]) => projectApi.setAllocations(p.id, month!, items));
  useEffect(() => { if (data?.months.length && !month) setMonth(data.months.at(-1)!); }, [data, month]);
  useEffect(() => { setDraft({}); save.reset(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [month]);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const cell = (eid: string, m: string) => data.cells.find((c) => c.employeeId === eid && c.month === m);
  const used = data.totalManDays, budget = data.budgetManDays;
  const errs = fieldErrors(save.error);
  const frozen = (m: string) => data.frozenMonths.includes(m);
  const canEditMonth = !!month && (frozen(month) ? data.canEditFrozen : p.canManage && p.status === 'Active');
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>Đã dùng <b className="tabular-nums">{n(used)}</b> ngày công{budget != null && <> / ngân sách <b>{n(budget)}</b> ({budget ? Math.round((used / budget) * 100) : 0}%)</>}</span>
        {budget != null && used > budget && <span className="text-rose-600">Vượt ngân sách {n(used - budget)} ngày</span>}
      </div>
      {budget != null && budget > 0 && <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full ${used > budget ? 'bg-rose-500' : 'bg-primary'}`} style={{ width: `${Math.min(100, (used / budget) * 100)}%` }} /></div>}
      <div className="overflow-x-auto rounded-xl border bg-card">
        <Table>
          <TableHeader><TableRow><TableHead>Thành viên</TableHead>
            {data.months.map((m) => <TableHead key={m} className={`cursor-pointer text-right ${m === month ? 'text-primary underline' : ''}`} onClick={() => setMonth(m)} title={frozen(m) ? 'Đã chốt phân bổ' : undefined}>{frozen(m) && '🔒 '}{fmtMonth(m)}</TableHead>)}
            <TableHead className="text-right">Tổng</TableHead></TableRow></TableHeader>
          <TableBody>
            {data.members.map((mb) => (
              <TableRow key={mb.employeeId}>
                <TableCell className="whitespace-nowrap">{mb.fullName}</TableCell>
                {data.months.map((m) => { const c = cell(mb.employeeId, m); return (
                  <TableCell key={m} className="text-right tabular-nums" title={c ? `${n(c.presentDays)} ngày có mặt × ${n(c.percent)}%${c.explicit ? ' (đặt tay)' : ' (mặc định)'}` : ''}>
                    {c ? <>{n(c.manDays)}<div className={`text-xs ${c.explicit ? 'text-primary' : 'text-muted-foreground'}`}>{n(c.percent)}%</div></> : '—'}
                  </TableCell>); })}
                <TableCell className="text-right font-medium tabular-nums">{n(data.cells.filter((c) => c.employeeId === mb.employeeId).reduce((t, c) => t + c.manDays, 0))}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {p.canManage && month && frozen(month) && !canEditMonth && (
        <p className="text-sm text-muted-foreground">Tháng {fmtMonth(month)} đã chốt phân bổ — muốn sửa, nhờ HR hoặc người có quyền Quản trị tài chính.</p>
      )}
      {month && canEditMonth && (
        <div className="grid gap-2 rounded-xl border bg-card p-3">
          <div className="text-sm font-medium">Phân bổ tháng {fmtMonth(month)} <span className="font-normal text-muted-foreground">{frozen(month) ? '— tháng đã chốt, để trống = không tính' : '— để trống = mặc định'}</span></div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 @7xl/content:grid-cols-4 @min-[112rem]/content:grid-cols-6">
            {data.members.map((mb) => { const c = cell(mb.employeeId, month); return (
              <label key={mb.employeeId} className="flex items-center justify-between gap-2 text-sm">{mb.fullName}
                <span className="flex items-center gap-1"><Input className="w-20 text-right" type="number" min={0} max={100} step="0.01" aria-label={`% ${mb.fullName}`}
                  placeholder={c && !c.explicit ? String(c.percent) : ''} value={draft[mb.employeeId] ?? (c?.explicit ? String(c.percent) : '')}
                  onChange={(e) => setDraft({ ...draft, [mb.employeeId]: e.target.value })} />%</span>
              </label>); })}
          </div>
          {Object.values(errs).map((m) => <p key={m} className="text-xs text-destructive">{m}</p>)}
          <div className="flex justify-end"><Button size="sm" disabled={save.isPending || Object.keys(draft).length === 0} onClick={() => save.mutate(
            Object.entries(draft).map(([employeeId, v]) => ({ employeeId, percent: v === '' ? null : Number(v) })),
            { onSuccess: () => { toast.success('Đã lưu phân bổ'); setDraft({}); }, onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)) })}>Lưu phân bổ</Button></div>
        </div>
      )}
    </div>
  );
}
