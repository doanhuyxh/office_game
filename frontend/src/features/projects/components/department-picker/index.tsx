import { Star, X } from 'lucide-react';
import { Button } from '@/components/common/button';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { departmentAncestors, departmentTree, type IDepartment } from '@/features/employees';
import { cn } from '@/utils/cn';

/**
 * Chọn phòng ban tham gia dự án (TEST-40) + đánh dấu tối đa một phòng chủ trì. Nhân viên các phòng này xem được dự án (chỉ đọc) —
 * back-end kiểm tra (≤ 20 phòng, phòng phải tồn tại, chủ trì nằm trong danh sách).
 * Lựa chọn hiện theo cây cha – con (TEST-68); chọn phòng cha không kéo theo phòng con (mỗi phòng chọn độc lập).
 */
export function DepartmentPicker({ departments, value, lead, onChange, error, leadError }: {
  departments: IDepartment[];
  value: string[];
  lead: string | null;
  onChange: (ids: string[], lead: string | null) => void;
  error?: string;
  leadError?: string;
}) {
  const name = (id: string) => departments.find((d) => d.id === id)?.name ?? '(phòng ban đã xoá)';
  const path = (id: string) => departmentAncestors(departments, id).join(' › ');
  const ordered = [...value].sort((a, b) => Number(b === lead) - Number(a === lead) || name(a).localeCompare(name(b), 'vi'));
  return (
    <div className="grid grid-cols-1 gap-2" data-testid="pj-departments">
      <SearchSelectField id="pj-dept" label="Phòng ban tham gia" allowEmpty emptyLabel="— Chọn để thêm —" value={null} searchPlaceholder="Gõ tên phòng ban…"
        onChange={(v) => v && !value.includes(v) && onChange([...value, v], lead ?? (value.length === 0 ? v : null))}
        limit={departments.length} error={error}
        options={departmentTree(departments).filter(({ dept }) => !value.includes(dept.id))
          .map(({ dept, depth }) => ({ value: dept.id, label: dept.name, depth, path: path(dept.id) }))} />
      {ordered.length > 0
        ? <ul className="grid gap-1">
            {ordered.map((id) => (
              <li key={id} className="flex items-center gap-2 rounded-md border px-2 py-1 text-sm" data-testid="pj-department">
                <span className="min-w-0 flex-1 truncate" title={[path(id), name(id)].filter(Boolean).join(' › ')}>
                  {path(id) && <span className="text-muted-foreground">{path(id)} › </span>}{name(id)}
                </span>
                <Button type="button" size="sm" variant={id === lead ? 'secondary' : 'ghost'} aria-pressed={id === lead} className={cn('h-7 gap-1', id !== lead && 'text-muted-foreground')}
                  onClick={() => onChange(value, id === lead ? null : id)} aria-label={id === lead ? `Bỏ chủ trì ${name(id)}` : `Đặt ${name(id)} chủ trì`}>
                  <Star className={cn('size-3.5', id === lead && 'fill-current')} /> {id === lead ? 'Chủ trì' : 'Đặt chủ trì'}
                </Button>
                <Button type="button" size="icon" variant="ghost" className="size-7" aria-label={`Bỏ ${name(id)}`}
                  onClick={() => onChange(value.filter((x) => x !== id), lead === id ? null : lead)}><X /></Button>
              </li>))}
          </ul>
        : <p className="text-xs text-muted-foreground">Chưa chọn — chỉ thành viên thấy dự án. Nhân viên thuộc phòng ban tham gia được xem dự án (chỉ đọc).</p>}
      {leadError && <p className="text-xs text-destructive">{leadError}</p>}
    </div>
  );
}
