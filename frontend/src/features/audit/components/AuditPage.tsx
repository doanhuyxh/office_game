import { useMemo, useState } from 'react';
import { ArrowRight, History } from 'lucide-react';
import { Card, CardContent } from '@/components/common/card';
import { Input } from '@/components/common/input';
import { TablePagination, usePageState } from '@/components/common/pagination';
import { SelectField } from '@/components/common/SelectField';
import { StatusBadge } from '@/components/common/StatusBadge';
import { Spinner } from '@/components/feedback/Spinner';
import { PageHeader } from '@/components/layout/PageHeader';
import { useDepartments, useEmployees, usePositions } from '@/features/employees';
import { useDebounce } from '@/hooks/useDebounce';
import { formatDateTime } from '@/utils/date';
import { useChangesPage } from '../hooks/useAudit';
import type { IChange } from '../types/audit.types';
import { ACTION, ENTITY_LABEL, fieldLabel, formatValue, SOURCE_LABEL } from '../utils/labels';

const ENTITY_OPTIONS = Object.entries(ENTITY_LABEL).map(([value, label]) => ({ value, label }));

function ChangeItem({ c, names }: { c: IChange; names: Map<string, string> }) {
  const softDelete = c.action === 'Modified' && c.changes.some((f) => f.field === 'DeletedAt' && f.old == null && f.new != null);
  const action = softDelete ? ACTION.Deleted : ACTION[c.action];
  const shown = c.changes.filter((f) => !(softDelete && f.field === 'DeletedAt'));
  return (
    <div className="grid gap-2 border-b py-3 last:border-0 sm:grid-cols-[180px_1fr]">
      <div className="text-sm">
        <div className="text-muted-foreground">{formatDateTime(c.occurredAt)}</div>
        <div className="font-medium">{c.userName ?? SOURCE_LABEL.system}</div>
        {c.source === 'ai' && <div className="text-xs text-info">{SOURCE_LABEL.ai}</div>}
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StatusBadge tone={action.tone}>{action.label}</StatusBadge>
          <span className="text-muted-foreground">{ENTITY_LABEL[c.entity] ?? c.entity}</span>
          {c.entityLabel && <span className="font-medium">{c.entityLabel}</span>}
        </div>
        {shown.length > 0 && (
          <ul className="grid gap-0.5 text-xs">
            {shown.map((f) => (
              <li key={f.field} className="flex flex-wrap items-center gap-1">
                <span className="text-muted-foreground">{fieldLabel(f.field)}:</span>
                {f.masked ? <span className="italic text-muted-foreground">{c.action === 'Added' ? 'đã nhập' : 'đã thay đổi'} (ẩn giá trị)</span> : (
                  c.action === 'Modified'
                    ? <><span className="line-through decoration-destructive/60">{formatValue(f.field, f.old, names)}</span><ArrowRight className="size-3" /><span className="font-medium">{formatValue(f.field, f.new, names)}</span></>
                    : <span>{formatValue(f.field, c.action === 'Deleted' ? f.old : f.new, names)}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Lịch sử sửa dữ liệu nhân sự (HR): ai sửa gì, lúc nào, từ giá trị nào sang giá trị nào. Lương chỉ hiện "đã thay đổi". */
export function AuditPage() {
  const [entity, setEntity] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search, 300);
  const pg = usePageState('audit-changes', `${entity ?? ''}|${debounced}`);
  const changes = useChangesPage({ entity, search: debounced }, pg.query);
  const employees = useEmployees({ includeResigned: true });
  const departments = useDepartments();
  const positions = usePositions();
  const names = useMemo(() => {
    const m = new Map<string, string>();
    employees.data?.forEach((e) => { m.set(e.id, `${e.fullName} (${e.code})`); if (e.userId) m.set(e.userId, e.fullName); });
    departments.data?.forEach((d) => m.set(d.id, d.name));
    positions.data?.forEach((p) => m.set(p.id, p.name));
    return m;
  }, [employees.data, departments.data, positions.data]);
  const rows = changes.data?.items ?? [];

  return (
    <div className="grid grid-cols-1 gap-6">
      <PageHeader title="Lịch sử thay đổi" />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-56"><SelectField id="au-entity" label="Loại dữ liệu" value={entity} onChange={setEntity} options={ENTITY_OPTIONS} allowEmpty emptyLabel="— Tất cả —" /></div>
        <Input className="w-72" placeholder="Tìm theo tên đối tượng hoặc người sửa…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Tìm" />
      </div>
      <Card>
        <CardContent>
          {changes.isLoading ? <Spinner /> : rows.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-sm text-muted-foreground"><History className="size-8" />Chưa có thay đổi nào.</div>
          ) : rows.map((c) => <ChangeItem key={c.id} c={c} names={names} />)}
          <TablePagination state={pg} total={changes.data?.total} unit="thay đổi" className="mt-1 px-0 pb-0" />
        </CardContent>
      </Card>
    </div>
  );
}
