import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, ChevronUp, Expand, Maximize2, Minimize, Minus, Network, Plus, Users } from 'lucide-react';
import { Button } from '@/components/common/button';
import { Checkbox } from '@/components/common/checkbox';
import { Spinner } from '@/components/feedback/Spinner';
import { cn } from '@/utils/cn';
import { useDepartments, useEmployees } from '../../hooks/useOrg';
import type { IDepartment, IEmployee } from '../../types/employee.types';
import { departmentTree } from '../../utils/orgTree';
import './org-chart.css';
import { PersonAvatar } from '@/components/common/PersonAvatar';

type Mode = 'department' | 'manager';
const NO_DEPT = '__none__';

/** Sắp theo cấp bậc (1 = cao nhất, chưa có chức vụ xuống cuối) rồi tên. */
const byRank = (a: IEmployee, b: IEmployee) => (a.positionLevel ?? 99) - (b.positionLevel ?? 99) || a.fullName.localeCompare(b.fullName, 'vi');
const roleLine = (e: IEmployee) => [e.jobTitle, e.positionName].filter(Boolean).join(' · ') || 'Chưa có chức vụ';

function Person({ e, compact, highlight }: { e: IEmployee; compact?: boolean; highlight?: boolean }) {
  return (
    <div className={cn('flex items-center gap-2 text-left', compact ? 'py-0.5' : '')}>
      <PersonAvatar name={e.fullName} url={e.avatarUrl} className={cn('shrink-0', compact ? 'size-6' : 'size-8')}
        fallbackClassName={cn('font-semibold', compact ? 'text-[10px]' : 'text-xs', highlight ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')} />
      <span className="min-w-0">
        <span className={cn('block truncate font-medium', compact ? 'text-xs' : 'text-sm')}>{e.fullName}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{roleLine(e)}{e.status === 'Probation' ? ' · thử việc' : ''}</span>
      </span>
    </div>
  );
}

// ---------------- Theo phòng ban ----------------
// Cấp 1 xếp ngang dưới "Công ty", phòng con xếp DỌC dưới phòng cha (thụt lề + đường kẻ trái)
// → sơ đồ chỉ rộng bằng số phòng cấp 1, đọc được ở 100% thay vì một hàng ngang hàng chục thẻ.

interface DeptNode { dept: IDepartment | null; children: DeptNode[] }
interface DeptCtx { byDept: Map<string, IEmployee[]>; empById: Map<string, IEmployee>; showMembers: boolean; full: boolean }

const ownMembers = (n: DeptNode, c: DeptCtx) => c.byDept.get(n.dept?.id ?? NO_DEPT) ?? [];
/** Số người của phòng, tính cả các phòng con. */
const totalMembers = (n: DeptNode, c: DeptCtx): number => ownMembers(n, c).length + n.children.reduce((s, x) => s + totalMembers(x, c), 0);
const headOf = (n: DeptNode, c: DeptCtx) => (n.dept?.headEmployeeId ? c.empById.get(n.dept.headEmployeeId) : undefined);

function CountBadge({ n }: { n: number }) {
  return <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground">{n} người</span>;
}

function HeadLine({ e }: { e: IEmployee }) {
  return (
    <div className="flex items-center gap-2 text-left">
      <PersonAvatar name={e.fullName} url={e.avatarUrl} className="size-7 shrink-0" fallbackClassName="bg-primary text-[10px] font-semibold text-primary-foreground" />
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{e.fullName}</span>
        <span className="block text-[11px] text-muted-foreground">Trưởng phòng</span>
      </span>
    </div>
  );
}

/** Nhân viên (trừ trưởng phòng): danh sách gọn, hoặc "+ N nhân viên" khi tắt "Hiện nhân viên". */
function MemberList({ members, head, ctx }: { members: IEmployee[]; head?: IEmployee; ctx: DeptCtx }) {
  const others = members.filter((m) => m.id !== head?.id).sort(byRank);
  if (!others.length) return null;
  if (!ctx.showMembers) return <div className="text-left text-[11px] text-muted-foreground">+ {others.length} nhân viên</div>;
  return (
    <div className={cn('space-y-1', !ctx.full && 'max-h-48 overflow-y-auto')}>
      {others.map((m) => (
        <div key={m.id} className="flex items-center gap-1.5 text-left" title={roleLine(m)}>
          <PersonAvatar name={m.fullName} url={m.avatarUrl} className="size-5 shrink-0" fallbackClassName="bg-muted-foreground text-[9px] font-semibold text-background" />
          <span className="truncate text-xs">{m.fullName}{m.status === 'Probation' ? <span className="text-muted-foreground"> · thử việc</span> : null}</span>
        </div>
      ))}
    </div>
  );
}

function ToggleChildren({ count, open, onClick, className }: { count: number; open: boolean; onClick: () => void; className?: string }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex items-center justify-center gap-1 rounded-md bg-muted text-xs text-muted-foreground hover:text-foreground', className)}>
      {count} phòng con {open ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
    </button>
  );
}

/** Phòng con (cấp ≥ 2): thẻ viền trái, các phòng con của nó lại xếp dọc thụt vào trong. */
function SubDept({ node, ctx }: { node: DeptNode; ctx: DeptCtx }) {
  const [open, setOpen] = useState(true);
  const head = headOf(node, ctx);
  const d = node.dept!;
  return (
    <div>
      <div className={cn('rounded-lg border border-l-4 bg-card p-2.5 shadow-xs', head ? 'border-l-primary' : 'border-l-warning')} data-testid="org-dept">
        <div className="text-left text-sm leading-snug font-semibold">{d.name}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
          <span className="truncate">{d.code}</span><span className="shrink-0">{totalMembers(node, ctx)} người</span>
        </div>
        {(head || ownMembers(node, ctx).length > 0) && (
          <div className="mt-2 space-y-1.5">
            {head && <HeadLine e={head} />}
            <MemberList members={ownMembers(node, ctx)} head={head} ctx={ctx} />
          </div>
        )}
        {node.children.length > 0 && <ToggleChildren count={node.children.length} open={open} onClick={() => setOpen(!open)} className="mt-2 w-full py-1" />}
      </div>
      {open && <SubStack nodes={node.children} ctx={ctx} />}
    </div>
  );
}

function SubStack({ nodes, ctx }: { nodes: DeptNode[]; ctx: DeptCtx }) {
  if (!nodes.length) return null;
  return (
    <div className="mt-2 ml-3 flex flex-col gap-2 border-l-2 pl-2.5">
      {nodes.map((c) => <SubDept key={c.dept!.id} node={c} ctx={ctx} />)}
    </div>
  );
}

/** Phòng cấp 1: thẻ có viền trên (đậm = có trưởng phòng, cam = chưa có), phòng con xếp dọc bên dưới. */
function TopDept({ node, ctx }: { node: DeptNode; ctx: DeptCtx }) {
  const [open, setOpen] = useState(true);
  const d = node.dept;
  const head = headOf(node, ctx);
  const members = ownMembers(node, ctx);
  return (
    <li>
      <div className="w-48">
        <div className={cn('rounded-lg border bg-card p-3 shadow-sm', !d ? 'border-dashed' : cn('border-t-4', head ? 'border-t-primary' : 'border-t-warning'))} data-testid="org-dept">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 text-left">
              <div className="text-sm leading-snug font-semibold">{d?.name ?? 'Chưa thuộc phòng ban'}</div>
              {d?.code && <div className="text-[11px] text-muted-foreground">{d.code}</div>}
            </div>
            <CountBadge n={totalMembers(node, ctx)} />
          </div>
          <div className="mt-2 space-y-2 empty:hidden">
            {d && (head ? <HeadLine e={head} /> : <div className="flex items-center gap-1 text-left text-xs text-warning"><AlertTriangle className="size-3.5 shrink-0" /> Chưa có trưởng phòng</div>)}
            <MemberList members={members} head={head} ctx={ctx} />
            {node.children.length > 0 && <ToggleChildren count={node.children.length} open={open} onClick={() => setOpen(!open)} className="w-full py-1.5" />}
          </div>
        </div>
        {open && <SubStack nodes={node.children} ctx={ctx} />}
      </div>
    </li>
  );
}

// ---------------- Theo quản lý trực tiếp ----------------

function PersonCard({ e, lead, dashed }: { e: IEmployee; lead?: boolean; dashed?: boolean }) {
  return (
    <div className={cn('w-52 rounded-lg border bg-card p-2.5 shadow-sm', dashed && 'border-dashed')} data-testid="org-person">
      <Person e={e} highlight={lead} />
      <div className="mt-1 truncate text-left text-[11px] text-muted-foreground">{e.departmentName ?? 'Chưa thuộc phòng ban'}</div>
    </div>
  );
}

/**
 * Một người + cấp dưới. Cấp dưới có người dưới quyền → nhánh ngang như cây; cấp dưới không quản lý ai → xếp thành cột dọc
 * (> 8 người thì 2 cột) dưới quản lý, để sơ đồ không trải thành một hàng ngang dài hàng chục thẻ.
 */
function ManagerBranch({ e, reports, depth }: { e: IEmployee; reports: Map<string, IEmployee[]>; depth: number }) {
  const kids = (reports.get(e.id) ?? []).slice().sort(byRank);
  const leads = kids.filter((k) => reports.get(k.id)?.length);
  const leaves = kids.filter((k) => !reports.get(k.id)?.length);
  const [open, setOpen] = useState(depth < 3);
  return (
    <li>
      <PersonCard e={e} lead={kids.length > 0} dashed={depth === 0 && !kids.length} />
      {kids.length > 0 && (
        <>
          <button type="button" onClick={() => setOpen(!open)} className="relative z-10 -mt-px flex items-center gap-0.5 rounded-b-md border border-t-0 bg-card px-2 text-[11px] text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}{kids.length} cấp dưới
          </button>
          {open && (
            <ul>
              {leads.map((k) => <ManagerBranch key={k.id} e={k} reports={reports} depth={depth + 1} />)}
              {leaves.length > 0 && (
                <li>
                  <div className={cn('org-stack grid gap-1.5', leaves.length > 8 && 'grid-cols-2')}>
                    {leaves.map((k) => <PersonCard key={k.id} e={k} />)}
                  </div>
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </li>
  );
}

/** Sơ đồ tổ chức (HR): theo cây phòng ban (trưởng phòng + nhân viên) hoặc theo quan hệ quản lý trực tiếp. Chỉ hiển thị, dữ liệu từ API sẵn có. */
export function OrgChart() {
  const { data: departments = [], isLoading: l1 } = useDepartments();
  const { data: employees = [], isLoading: l2 } = useEmployees();
  const [mode, setMode] = useState<Mode>('department');
  const [showMembers, setShowMembers] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [full, setFull] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const inner = useRef<HTMLDivElement>(null);
  /**
   * Vừa khung. Thường: vừa chiều ngang (≤ 100%, cuộn dọc). Toàn màn hình: vừa cả ngang lẫn dọc, được phóng tới 150% để lấp màn hình;
   * sơ đồ quá cao (vd hiện đủ nhân viên mọi phòng) → không thu dưới 60% chiều ngang cho vừa, phần còn lại cuộn / kéo.
   */
  const fit = () => {
    if (!box.current || !inner.current) return;
    const current = Number(inner.current.style.zoom) || 1;
    const rect = inner.current.getBoundingClientRect();
    const byWidth = (box.current.clientWidth - 48) / (rect.width / current);
    const byHeight = (box.current.clientHeight - 48) / (rect.height / current);
    const z = full ? Math.min(1.5, byWidth, Math.max(byHeight, Math.min(byWidth, 0.6))) : Math.min(1, byWidth);
    setZoom(Math.max(0.3, +z.toFixed(2)));
  };

  /** Toàn màn hình: phủ cả cửa sổ + Fullscreen API của trình duyệt (không hỗ trợ / bị chặn → vẫn phủ cửa sổ). Esc để thoát. */
  const toggleFull = useCallback(() => {
    if (full) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
      setFull(false);
    } else {
      setFull(true);
      root.current?.requestFullscreen?.().catch(() => {});
    }
  }, [full]);
  useEffect(() => {
    if (!full) return;
    // Trình duyệt đổi kích thước sau khi vào fullscreen (bất đồng bộ) → vừa khung lại theo kích thước mới
    const refit = () => requestAnimationFrame(fit);
    const onFs = () => { if (!document.fullscreenElement) setFull(false); else refit(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFull(false); };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', refit);
    return () => {
      document.removeEventListener('fullscreenchange', onFs);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', refit);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);
  useEffect(() => () => { if (document.fullscreenElement) void document.exitFullscreen().catch(() => {}); }, []);

  /** Kéo nền để di chuyển sơ đồ (bỏ qua nút / ô chọn). */
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !box.current || (e.target as HTMLElement).closest('button, input, label, a')) return;
    drag.current = { x: e.clientX, y: e.clientY, left: box.current.scrollLeft, top: box.current.scrollTop };
    e.preventDefault(); // không bôi đen chữ khi kéo
    window.getSelection()?.removeAllRanges();
    box.current.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !box.current) return;
    box.current.scrollLeft = d.left - (e.clientX - d.x);
    box.current.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => { drag.current = null; setDragging(false); };

  const { deptRoots, byDept, empById, managerRoots, reports, noManager, noHead } = useMemo(() => {
    const active = employees.filter((e) => e.status !== 'Resigned');
    const empById = new Map(active.map((e) => [e.id, e]));
    const byDept = new Map<string, IEmployee[]>();
    for (const e of active) {
      const k = e.departmentId && departments.some((d) => d.id === e.departmentId) ? e.departmentId : NO_DEPT;
      byDept.set(k, [...(byDept.get(k) ?? []), e]);
    }
    // cây phòng ban theo thứ tự departmentTree (đã chống vòng lặp)
    const nodes = new Map<string, DeptNode>();
    const deptRoots: DeptNode[] = [];
    for (const { dept, depth } of departmentTree(departments)) {
      const n: DeptNode = { dept, children: [] };
      nodes.set(dept.id, n);
      const parent = depth > 0 && dept.parentId ? nodes.get(dept.parentId) : undefined;
      (parent ? parent.children : deptRoots).push(n);
    }
    if (byDept.has(NO_DEPT)) deptRoots.push({ dept: null, children: [] });

    const reports = new Map<string, IEmployee[]>();
    const managerRoots: IEmployee[] = [];
    for (const e of active) {
      if (e.managerId && empById.has(e.managerId) && e.managerId !== e.id) reports.set(e.managerId, [...(reports.get(e.managerId) ?? []), e]);
      else managerRoots.push(e);
    }
    managerRoots.sort(byRank);
    // Gốc thật = người cấp cao nhất không có quản lý; người cấp thấp hơn mà chưa có quản lý → nhóm riêng (thiếu dữ liệu)
    const topLevel = managerRoots[0]?.positionLevel ?? 1;
    const noManager = managerRoots.filter((e) => (e.positionLevel ?? 99) > topLevel);
    const noHead = departments.filter((d) => !d.headEmployeeId || !empById.has(d.headEmployeeId));
    return { deptRoots, byDept, empById, managerRoots: managerRoots.filter((e) => !noManager.includes(e)), reports, noManager, noHead };
  }, [employees, departments]);

  const loaded = !l1 && !l2;
  // Tự vừa khung khi mở / đổi chế độ / bật tắt danh sách nhân viên (đợi 1 khung hình để bố cục xong)
  useEffect(() => {
    if (!loaded) return;
    const id = requestAnimationFrame(fit);
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, mode, showMembers, full]);

  if (l1 || l2) return <Spinner />;
  const warnings = mode === 'department'
    ? (noHead.length ? [`${noHead.length} phòng ban chưa có trưởng phòng: ${noHead.map((d) => d.name).join(', ')}`] : [])
    : (noManager.length ? [`${noManager.length} người chưa có quản lý trực tiếp: ${noManager.map((e) => `${e.code} ${e.fullName}`).join(', ')}`] : []);

  return (
    <div ref={root} className={cn(full ? 'fixed inset-0 z-50 flex flex-col gap-3 bg-background p-4' : 'grid grid-cols-1 gap-3')}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-md border p-0.5">
          <Button size="sm" variant={mode === 'department' ? 'default' : 'ghost'} onClick={() => setMode('department')}><Network className="size-4" /> Theo phòng ban</Button>
          <Button size="sm" variant={mode === 'manager' ? 'default' : 'ghost'} onClick={() => setMode('manager')}><Users className="size-4" /> Theo quản lý</Button>
        </div>
        {mode === 'department' && (
          <label className="flex items-center gap-2 text-sm"><Checkbox checked={showMembers} onCheckedChange={(c) => setShowMembers(c === true)} /> Hiện nhân viên</label>
        )}
        <div className="ms-auto flex items-center gap-1">
          <Button size="icon" variant="outline" className="size-8" aria-label="Thu nhỏ" onClick={() => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(1)))}><Minus className="size-4" /></Button>
          <button type="button" className="w-12 text-center text-xs tabular-nums text-muted-foreground" onClick={() => setZoom(1)} title="Về 100%">{Math.round(zoom * 100)}%</button>
          <Button size="icon" variant="outline" className="size-8" aria-label="Phóng to" onClick={() => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(1)))}><Plus className="size-4" /></Button>
          <Button size="sm" variant="outline" onClick={fit}><Maximize2 className="size-4" /> Vừa khung</Button>
          <Button size="sm" variant={full ? 'default' : 'outline'} onClick={toggleFull} title={full ? 'Thoát toàn màn hình (Esc)' : 'Xem toàn màn hình'} data-testid="org-fullscreen">
            {full ? <><Minimize className="size-4" /> Thoát</> : <><Expand className="size-4" /> Toàn màn hình</>}
          </Button>
        </div>
      </div>
      {warnings.map((w) => (
        <div key={w} className="flex gap-2 rounded-md bg-warning/10 p-2.5 text-sm text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" />{w}</div>
      ))}
      <div ref={box} className={cn('overflow-auto rounded-xl border bg-muted/20 p-6', full ? 'min-h-0 flex-1' : 'max-h-[75vh]', 'select-none', dragging ? 'cursor-grabbing' : 'cursor-grab')}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag} data-testid="org-chart">
        {/* CSS zoom (khác transform) đổi cả kích thước bố cục → thanh cuộn đúng khi phóng / thu */}
        <div ref={inner} className="org-tree mx-auto w-max" style={{ zoom }}>
          {mode === 'department' ? (
            deptRoots.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có phòng ban.</p> : (
              <ul className="org-dept-tree">
                <li>
                  <div className="rounded-full bg-primary px-5 py-2 text-sm font-semibold text-primary-foreground shadow-sm">Công ty</div>
                  <ul className="items-start">{deptRoots.map((n) => <TopDept key={n.dept?.id ?? NO_DEPT} node={n} ctx={{ byDept, empById, showMembers, full }} />)}</ul>
                </li>
              </ul>
            )
          ) : (
            managerRoots.length === 0 ? <p className="text-sm text-muted-foreground">Chưa có nhân viên.</p> : (
              <ul>{managerRoots.map((e) => <ManagerBranch key={e.id} e={e} reports={reports} depth={0} />)}</ul>
            )
          )}
          {mode === 'manager' && noManager.length > 0 && (
            <div className="mt-8 rounded-lg border border-dashed border-warning/50 p-3">
              <div className="mb-2 flex items-center gap-1 text-xs font-medium text-warning"><AlertTriangle className="size-3.5" /> Chưa có quản lý trực tiếp — sửa trong hồ sơ nhân viên</div>
              <ul className="!justify-start gap-2 !pt-0">{noManager.map((e) => <ManagerBranch key={e.id} e={e} reports={reports} depth={0} />)}</ul>
            </div>
          )}
        </div>
      </div>
      <p className={cn('text-xs text-muted-foreground', full && 'shrink-0')}>
        {mode === 'department' ? 'Cấp 1 xếp ngang, phòng con xếp dọc dưới phòng cha. Số người tính cả phòng con; trưởng phòng đặt ở tab Phòng ban.' : 'Đường nối theo "Quản lý trực tiếp" trong hồ sơ — đây cũng là người duyệt đơn của nhân viên.'}
        {' '}Không tính người đã nghỉ việc. Kéo nền để di chuyển sơ đồ{full ? ', Esc để thoát toàn màn hình' : ''}.
      </p>
    </div>
  );
}
