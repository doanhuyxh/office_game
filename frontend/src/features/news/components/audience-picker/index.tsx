import { useState } from 'react';
import { X } from 'lucide-react';
import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/common/select';
import { useDebounce } from '@/hooks/useDebounce';
import { useDepartments, usePeople } from '../../hooks/useNews';
import type { PostAudience } from '../../types/news.types';
import { AUDIENCE } from '../../utils/labels';

export interface IAudienceValue {
  audience: PostAudience;
  departmentIds: string[];
  people: { id: string; name: string }[];
}

/** Chọn ai xem bài (như Facebook): toàn công ty / phòng ban (nhiều) / danh sách người / chỉ mình. Phòng cha gồm cả phòng con. */
export function AudiencePicker({ value, onChange, error }: { value: IAudienceValue; onChange: (v: IAudienceValue) => void; error?: string }) {
  const Icon = AUDIENCE[value.audience].icon;
  return (
    <div className="grid gap-2">
      <Label htmlFor="news-audience">Ai xem được bài này?</Label>
      <Select value={value.audience} onValueChange={(a) => onChange({ ...value, audience: a as PostAudience })}>
        <SelectTrigger id="news-audience" className="w-full" data-testid="audience-select">
          <span className="flex items-center gap-2"><Icon className="size-4" /><SelectValue /></span>
        </SelectTrigger>
        <SelectContent>
          {(Object.keys(AUDIENCE) as PostAudience[]).map((a) => {
            const I = AUDIENCE[a].icon;
            return (
              <SelectItem key={a} value={a}>
                <span className="flex items-center gap-2"><I className="size-4" />{AUDIENCE[a].label}<span className="text-xs text-muted-foreground">— {AUDIENCE[a].hint}</span></span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {value.audience === 'Departments' && <DepartmentList value={value} onChange={onChange} />}
      {value.audience === 'Custom' && <PeopleList value={value} onChange={onChange} />}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

function DepartmentList({ value, onChange }: { value: IAudienceValue; onChange: (v: IAudienceValue) => void }) {
  const { data } = useDepartments();
  const toggle = (id: string, on: boolean) =>
    onChange({ ...value, departmentIds: on ? [...value.departmentIds, id] : value.departmentIds.filter((d) => d !== id) });
  return (
    <div className="max-h-44 overflow-y-auto rounded-md border p-2" data-testid="department-list">
      {(data ?? []).map((d) => (
        <label key={d.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent">
          <Checkbox checked={value.departmentIds.includes(d.id)} onCheckedChange={(c) => toggle(d.id, c === true)} />
          {d.name}
        </label>
      ))}
      {data?.length === 0 && <p className="p-2 text-sm text-muted-foreground">Chưa có phòng ban</p>}
    </div>
  );
}

function PeopleList({ value, onChange }: { value: IAudienceValue; onChange: (v: IAudienceValue) => void }) {
  const [search, setSearch] = useState('');
  const term = useDebounce(search.trim(), 250);
  const { data } = usePeople(term, term.length > 0);
  const results = (data ?? []).filter((p) => !value.people.some((x) => x.id === p.userId)).slice(0, 5);
  return (
    <div className="grid gap-2">
      {value.people.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.people.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs">
              {p.name}
              <button type="button" aria-label={`Bỏ ${p.name}`} onClick={() => onChange({ ...value, people: value.people.filter((x) => x.id !== p.id) })}><X className="size-3" /></button>
            </span>
          ))}
        </div>
      )}
      <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm đồng nghiệp theo tên hoặc mã…" data-testid="people-search" />
      {results.length > 0 && (
        <ul className="rounded-md border">
          {results.map((p) => (
            <li key={p.userId}>
              <button type="button" className="flex w-full flex-col px-3 py-1.5 text-left text-sm hover:bg-accent"
                onClick={() => { onChange({ ...value, people: [...value.people, { id: p.userId, name: p.fullName }] }); setSearch(''); }}>
                <span className="font-medium">{p.fullName}</span>
                <span className="text-xs text-muted-foreground">{p.code}{p.departmentName ? ` · ${p.departmentName}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
