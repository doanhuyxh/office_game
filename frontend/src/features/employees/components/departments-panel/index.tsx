import { useEffect, useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, MoreHorizontal, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/common/alert-dialog';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/common/dropdown-menu';
import { Input } from '@/components/common/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/common/dialog';
import { FormField } from '@/components/common/FormField';
import { SelectField } from '@/components/common/SelectField';
import { SearchSelectField, fold } from '@/components/common/SearchSelectField';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { errorMessage, fieldErrors } from '@/utils/errors';
import { useDeleteDepartment, useDepartments, useEmployees, useSaveDepartment } from '../../hooks/useOrg';
import type { IDepartment, IUpsertDepartment } from '../../types/employee.types';
import { MAP_ZONES, mapZoneName } from '../../utils/mapZones';
import { departmentOptions, departmentRollup, departmentTree, descendantIds } from '../../utils/orgTree';
import { GuideDialog, type GuideTarget } from '../guide-dialog';

/** dept = null → thêm mới (parentId = phòng cha chọn sẵn khi "Thêm phòng con"). */
function DepartmentDialog({ open, onOpenChange, dept, parentId }: { open: boolean; onOpenChange: (o: boolean) => void; dept: IDepartment | null; parentId?: string | null }) {
  const save = useSaveDepartment();
  const { data: departments = [] } = useDepartments();
  const { data: employees = [] } = useEmployees();
  const [form, setForm] = useState<IUpsertDepartment>({ name: '' });
  useEffect(() => {
    if (!open) return;
    save.reset();
    setForm(dept ? { name: dept.name, code: dept.code, parentId: dept.parentId, headEmployeeId: dept.headEmployeeId, mapZone: dept.mapZone, sortOrder: dept.sortOrder } : { name: '', parentId: parentId ?? null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, dept?.id, parentId]);
  const errors = fieldErrors(save.error);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    save.mutate({ id: dept?.id, body: form }, {
      onSuccess: () => { toast.success('Đã lưu phòng ban'); onOpenChange(false); },
      onError: (err) => !Object.keys(fieldErrors(err)).length && toast.error(errorMessage(err)),
    });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{dept ? 'Sửa phòng ban' : 'Thêm phòng ban'}</DialogTitle></DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <FormField id="d-name" label="Tên phòng ban *" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} />
          <FormField id="d-code" label="Mã" value={form.code ?? ''} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <SelectField id="d-parent" label="Thuộc phòng ban" allowEmpty emptyLabel="— Cấp cao nhất —" value={form.parentId}
            onChange={(v) => setForm({ ...form, parentId: v })} error={errors.parentId}
            options={departmentOptions(departments, (d) => !!dept && (d.id === dept.id || descendantIds(departments, dept.id).has(d.id)))} />
          <SearchSelectField id="d-head" label="Trưởng phòng" allowEmpty value={form.headEmployeeId} onChange={(v) => setForm({ ...form, headEmployeeId: v })}
            error={errors.headEmployeeId} options={employees.map((e) => ({ value: e.id, label: `${e.code} · ${e.fullName}`, hint: e.departmentName ?? undefined }))} />
          <SelectField id="d-zone" label="Khu vực trong văn phòng 3D" allowEmpty value={form.mapZone} onChange={(v) => setForm({ ...form, mapZone: v })}
            options={MAP_ZONES.map((z) => ({ value: z.id, label: z.name }))} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
            <Button type="submit" loading={save.isPending} loadingText="Đang lưu…">Lưu</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const EXPANDED_KEY = 'officehub.departments.expanded';

/** Khối đang mở (lưu theo trình duyệt); lỗi / chưa có → rỗng = chỉ hiện cấp 1. */
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_KEY);
    const ids: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  } catch { return new Set(); }
}

function saveExpanded(ids: Set<string>) {
  try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...ids])); } catch { /* chế độ riêng tư / hết chỗ → bỏ qua */ }
}

type Editing = { dept: IDepartment | null; parentId?: string | null } | undefined; // undefined = đóng, dept null = thêm mới

/** Bảng cây phòng ban: thu / mở từng khối (nhớ localStorage), tìm (tự mở khối cha), lọc phòng có người, số người cả khối, menu ⋯. */
export function DepartmentsPanel({ canEdit }: { canEdit: boolean }) {
  const { data: departments = [], isLoading } = useDepartments();
  const remove = useDeleteDepartment();
  const [editing, setEditing] = useState<Editing>(undefined);
  const [deleting, setDeleting] = useState<IDepartment | null>(null);
  const [guide, setGuide] = useState<GuideTarget>(null);
  const [expanded, setExpanded] = useState<Set<string>>(loadExpanded);
  const [search, setSearch] = useState('');
  const [onlyStaffed, setOnlyStaffed] = useState(false);
  // Khi đang tìm: thu / mở tạm (không ghi đè trạng thái đã lưu) — xoá từ khoá là về lại như trước.
  const [searchToggle, setSearchToggle] = useState<Map<string, boolean>>(new Map());

  const rows = useMemo(() => departmentTree(departments), [departments]);
  const { children, total, ancestors } = useMemo(() => departmentRollup(departments), [departments]);
  const query = fold(search.trim());

  const { visible, autoOpen } = useMemo(() => {
    if (!query) return { visible: null, autoOpen: new Set<string>() };
    const vis = new Set<string>();
    const open = new Set<string>();
    for (const d of departments) {
      if (!fold(d.name).includes(query) && !fold(d.code ?? '').includes(query)) continue;
      vis.add(d.id);
      for (const a of ancestors(d.id)) { vis.add(a); open.add(a); }
      for (const c of descendantIds(departments, d.id)) vis.add(c); // phòng khớp → vẫn mở ra xem được phòng con
    }
    return { visible: vis, autoOpen: open };
  }, [departments, query, ancestors]);

  const isOpen = (id: string) => (query ? searchToggle.get(id) ?? (autoOpen.has(id) || expanded.has(id)) : expanded.has(id));
  const toggle = (id: string) => {
    if (query) { setSearchToggle(new Map(searchToggle).set(id, !isOpen(id))); return; }
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
    saveExpanded(next);
  };
  const setAll = (open: boolean) => {
    const next = open ? new Set(children.keys()) : new Set<string>();
    setExpanded(next);
    saveExpanded(next);
    setSearchToggle(new Map());
  };
  const onSearch = (v: string) => { setSearch(v); setSearchToggle(new Map()); };

  // Dòng hiển thị theo thứ tự cây: bỏ phòng con của khối đang thu, phòng không khớp tìm, phòng 0 người (khi lọc).
  const shown: typeof rows = [];
  const skipDeeper: number[] = [];
  for (const r of rows) {
    while (skipDeeper.length && r.depth <= skipDeeper[skipDeeper.length - 1]) skipDeeper.pop();
    if (skipDeeper.length) continue;
    const hide = (visible && !visible.has(r.dept.id)) || (onlyStaffed && !(total.get(r.dept.id) ?? 0));
    if (!hide) shown.push(r);
    if (hide || (children.has(r.dept.id) && !isOpen(r.dept.id))) skipDeeper.push(r.depth);
  }

  const grandTotal = rows.reduce((n, r) => n + (r.depth === 0 ? total.get(r.dept.id) ?? 0 : 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 flex-1 sm:max-w-sm">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input placeholder="Tìm theo tên, mã phòng…" aria-label="Tìm phòng ban" className="pl-8" value={search} onChange={(e) => onSearch(e.target.value)} />
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Checkbox checked={onlyStaffed} onCheckedChange={(v) => setOnlyStaffed(v === true)} /> Chỉ phòng có nhân viên
        </label>
        <div className="ms-auto flex flex-wrap items-center gap-2">
          {children.size > 0 && (
            <>
              <Button variant="outline" size="sm" onClick={() => setAll(true)}><ChevronsUpDown /> Mở hết</Button>
              <Button variant="outline" size="sm" onClick={() => setAll(false)}><ChevronsDownUp /> Thu hết</Button>
            </>
          )}
          {canEdit && <Button onClick={() => setEditing({ dept: null })}><Plus /> Thêm phòng ban</Button>}
        </div>
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Phòng ban</TableHead><TableHead className="hidden sm:table-cell">Trưởng phòng</TableHead>
              <TableHead className="hidden md:table-cell">Khu vực 3D</TableHead><TableHead className="text-right">Nhân viên</TableHead><TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Đang tải…</TableCell></TableRow>
            )}
            {!isLoading && departments.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Chưa có phòng ban</TableCell></TableRow>
            )}
            {!isLoading && departments.length > 0 && shown.length === 0 && (
              <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Không có phòng ban phù hợp</TableCell></TableRow>
            )}
            {shown.map(({ dept: d, depth }) => {
              const kids = children.get(d.id)?.length ?? 0;
              const open = kids > 0 && isOpen(d.id);
              const sum = total.get(d.id) ?? d.employeeCount;
              return (
                <TableRow key={d.id} data-testid={`dept-row-${d.id}`}>
                  <TableCell className="whitespace-normal">
                    <div className="flex items-start gap-1" style={{ paddingLeft: `${depth * 1.25}rem` }}>
                      {kids > 0 ? (
                        <button type="button" onClick={() => toggle(d.id)} aria-expanded={open} aria-label={`${open ? 'Thu' : 'Mở'} ${d.name}`}
                          className="mt-0.5 shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                        </button>
                      ) : <span className="w-5 shrink-0" />}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-x-1.5">
                          {kids > 0
                            ? <button type="button" className="text-left font-medium hover:underline" onClick={() => toggle(d.id)}>{d.name}</button>
                            : <span className="font-medium">{d.name}</span>}
                          {kids > 0 && <span className="text-xs text-muted-foreground" title={`${kids} phòng con trực tiếp`}>({kids})</span>}
                          {d.code && <span className="text-xs text-muted-foreground">{d.code}</span>}
                          {d.hasGuide && <span title="Đã có hướng dẫn" className="inline-flex"><BookOpen className="size-3.5 text-primary" aria-label="Đã có hướng dẫn" /></span>}
                        </div>
                        {d.headName && <div className="text-xs text-muted-foreground sm:hidden">Trưởng phòng: {d.headName}</div>}
                        {d.description && <div className="line-clamp-1 max-w-2xl text-xs text-muted-foreground" title={d.description}>{d.description}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">{d.headName ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">{mapZoneName(d.mapZone) ?? d.mapZone ?? '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {kids > 0
                      ? <span className="cursor-help underline decoration-dotted underline-offset-4" title={`${d.employeeCount} trực thuộc · ${sum} cả khối`}>{sum}</span>
                      : d.employeeCount}
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Thao tác ${d.name}`}><MoreHorizontal /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuLabel className="max-w-56 truncate">{d.name}</DropdownMenuLabel>
                        <DropdownMenuItem onClick={() => setGuide({ kind: 'department', id: d.id, name: d.name })}>
                          <BookOpen className={d.hasGuide ? 'text-primary' : undefined} /> Mô tả & hướng dẫn
                        </DropdownMenuItem>
                        {canEdit && (
                          <>
                            <DropdownMenuItem onClick={() => setEditing({ dept: d })}><Pencil /> Sửa</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setEditing({ dept: null, parentId: d.id })}><Plus /> Thêm phòng con</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(d)}><Trash2 /> Xoá</DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {!isLoading && departments.length > 0 && (
        <p className="text-xs text-muted-foreground">{departments.length} phòng ban · {grandTotal} nhân viên</p>
      )}
      <GuideDialog target={guide} onClose={() => setGuide(null)} />
      <DepartmentDialog open={editing !== undefined} onOpenChange={() => setEditing(undefined)} dept={editing?.dept ?? null} parentId={editing?.parentId} />
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá phòng ban "{deleting?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>Chỉ xoá được khi phòng ban không còn nhân viên và không có phòng ban con.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Huỷ</AlertDialogCancel>
            <Button variant="destructive" loading={remove.isPending} loadingText="Đang xử lý…" onClick={() => deleting && remove.mutate(deleting.id, {
              onSuccess: () => { toast.success('Đã xoá phòng ban'); setDeleting(null); }, onError: (err) => toast.error(errorMessage(err)),
            })}>Xoá</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

