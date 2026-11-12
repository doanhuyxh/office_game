import { useState } from 'react';
import { Check, Search } from 'lucide-react';
import { Input } from '@/components/common/input';
import { PersonAvatar } from '@/components/common/PersonAvatar';
import { Spinner } from '@/components/feedback/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { cn } from '@/utils/cn';
import { usePeople } from '../../hooks/useChatData';
import type { IPerson } from '../../types/chat.types';

/** Chọn nhiều đồng nghiệp (tạo nhóm / thêm thành viên). `exclude` = người đã ở trong nhóm. */
export function PeoplePicker({ selected, onChange, exclude, enabled }: {
  selected: IPerson[];
  onChange: (people: IPerson[]) => void;
  exclude?: Set<string>;
  enabled: boolean;
}) {
  const [q, setQ] = useState('');
  const search = useDebounce(q.trim(), 300);
  const people = usePeople(search, enabled);
  const ids = new Set(selected.map((p) => p.userId));
  const toggle = (p: IPerson) => onChange(ids.has(p.userId) ? selected.filter((x) => x.userId !== p.userId) : [...selected, p]);
  const shown = (people.data ?? []).filter((p) => !exclude?.has(p.userId));

  return (
    <div className="grid gap-2">
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selected.map((p) => (
            <button key={p.userId} type="button" onClick={() => toggle(p)} className="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary hover:bg-primary/20" title="Bỏ chọn">
              {p.fullName} ×
            </button>
          ))}
        </div>
      )}
      <div className="relative">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="pl-9" placeholder="Tìm theo tên hoặc mã nhân viên…" value={q} onChange={(e) => setQ(e.target.value)} data-testid="chat-picker-search" />
      </div>
      <div className="max-h-64 min-h-24 overflow-y-auto">
        {people.isLoading && <Spinner />}
        {people.data && shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy ai.</p>}
        {shown.map((p) => {
          const on = ids.has(p.userId);
          return (
            <button key={p.userId} type="button" onClick={() => toggle(p)} aria-pressed={on}
              className={cn('flex w-full items-center gap-3 rounded-lg p-2 text-start hover:bg-accent', on && 'bg-accent')} data-testid="chat-picker-person">
              <PersonAvatar name={p.fullName} className="size-8" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{p.fullName}</span>
                <span className="block truncate text-xs text-muted-foreground">{[p.code, p.departmentName].filter(Boolean).join(' · ')}</span>
              </span>
              {on && <Check className="size-4 text-primary" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
