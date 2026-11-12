import type { IProjectAppendix } from '../../types/project.types';

/** Phụ lục — quyền khác không gắn với danh sách thành viên: HR / admin, quyền Xem tài chính, chức vụ "Quản lý trạng thái công việc". */
export function AppendixOtherAccess({ a, labels }: { a: IProjectAppendix; labels: (keys: string[]) => string[] }) {
  return (
    <ul className="grid gap-2" data-testid="appendix-other">
      {a.personas.filter((p) => p.key === 'hr' || p.key === 'finance' || p.key === 'columns').map((p) => (
        <li key={p.key} className="rounded-lg border p-3 text-sm">
          <div className="font-medium">{p.label}</div>
          <div className="text-xs text-muted-foreground">{p.who}</div>
          <div className="mt-1 text-xs">{labels(p.allowed).join(' · ')}</div>
        </li>))}
    </ul>
  );
}
