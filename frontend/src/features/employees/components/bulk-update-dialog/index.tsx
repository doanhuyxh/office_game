import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { Label } from '@/components/common/label';
import { SearchSelectField } from '@/components/common/SearchSelectField';
import { SelectField } from '@/components/common/SelectField';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useBulkUpdateEmployees, useDepartments, useEmployees, usePositions } from '../../hooks/useOrg';
import type { IBulkUpdateEmployees } from '../../types/employee.types';
import { departmentOptions, positionLabel } from '../../utils/orgTree';

type Field = 'department' | 'position' | 'manager';
const EMPTY = { department: null, position: null, manager: null } as Record<Field, string | null>;

/** Đổi phòng ban / chức vụ / quản lý cho nhiều nhân viên. Chỉ trường được tích mới đổi; để "— Không —" = bỏ trống trường đó. */
export function BulkUpdateDialog({ ids, open, onOpenChange, onDone }: {
  ids: string[]; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void;
}) {
  const save = useBulkUpdateEmployees();
  const { data: departments = [] } = useDepartments();
  const { data: positions = [] } = usePositions();
  const { data: employees = [] } = useEmployees();
  const [on, setOn] = useState<Record<Field, boolean>>({ department: false, position: false, manager: false });
  const [val, setVal] = useState(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (open) { setOn({ department: false, position: false, manager: false }); setVal(EMPTY); setErrors({}); }
  }, [open]);

  const selected = new Set(ids);
  const row = (f: Field, label: string, field: React.ReactNode) => (
    <div className="grid gap-2 rounded-lg border p-3">
      <Label className="font-normal">
        <Checkbox checked={on[f]} onCheckedChange={(c) => setOn((o) => ({ ...o, [f]: c === true }))} />
        Đổi {label}
      </Label>
      {on[f] && field}
    </div>
  );
  const submit = () => {
    const body: IBulkUpdateEmployees = {
      ids, setDepartment: on.department, departmentId: val.department, setPosition: on.position, positionId: val.position,
      setManager: on.manager, managerId: val.manager,
    };
    save.mutate(body, {
      onSuccess: (r) => { toast.success(`Đã cập nhật ${r.affected} nhân viên`); onDone(); onOpenChange(false); },
      onError: (err) => { setErrors(fieldErrors(err)); toast.error(errorMessage(err)); },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Đổi thông tin {ids.length} nhân viên</DialogTitle>
          <DialogDescription>Tích mục cần đổi. Chọn "— Không —" để bỏ trống mục đó. Mục không tích giữ nguyên.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          {row('department', 'phòng ban', (
            <SelectField id="bulk-dept" label="" allowEmpty value={val.department} onChange={(v) => setVal((s) => ({ ...s, department: v }))}
              options={departmentOptions(departments)} error={errors.departmentId} />
          ))}
          {row('position', 'chức vụ', (
            <SelectField id="bulk-pos" label="" allowEmpty value={val.position} onChange={(v) => setVal((s) => ({ ...s, position: v }))}
              options={positions.map((p) => ({ value: p.id, label: positionLabel(p) }))} error={errors.positionId} />
          ))}
          {row('manager', 'quản lý trực tiếp', (
            <SearchSelectField id="bulk-manager" label="" allowEmpty value={val.manager} onChange={(v) => setVal((s) => ({ ...s, manager: v }))}
              options={employees.filter((x) => !selected.has(x.id)).map((x) => ({ value: x.id, label: `${x.code} · ${x.fullName}`, hint: x.departmentName ?? undefined }))}
              error={errors.managerId} />
          ))}
          {errors.ids && <p className="text-xs text-destructive">{errors.ids}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button disabled={save.isPending || !(on.department || on.position || on.manager)} onClick={submit}>Lưu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
