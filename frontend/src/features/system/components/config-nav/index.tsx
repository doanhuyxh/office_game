import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/common/select';
import { cn } from '@/utils/cn';
import { CONFIG_GROUPS, CONFIG_SECTIONS } from '../../utils/config-sections';

/**
 * Menu mục của tab Cấu hình: vùng nội dung rộng (≥ 48rem) → danh sách dọc bên trái có tiêu đề nhóm, mục đang mở được tô;
 * hẹp (điện thoại) → `Select` có nhóm ở đầu nội dung, không cuộn ngang.
 */
export function ConfigNav({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const groups = CONFIG_GROUPS.map((g) => ({ group: g, items: CONFIG_SECTIONS.filter((s) => s.group === g) })).filter((g) => g.items.length);
  return (
    <>
      <div className="@3xl/content:hidden">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger className="w-full" aria-label="Mục cấu hình" data-testid="config-nav-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            {groups.map(({ group, items }) => (
              <SelectGroup key={group}>
                <SelectLabel>{group}</SelectLabel>
                {items.map((s) => <SelectItem key={s.id} value={s.id}><s.icon /> {s.label}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
      <nav aria-label="Mục cấu hình" className="hidden @3xl/content:block" data-testid="config-nav">
        <div className="sticky top-4 grid gap-4">
          {groups.map(({ group, items }) => (
            <div key={group} className="grid gap-0.5">
              <p className="px-2.5 pb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">{group}</p>
              {items.map((s) => {
                const on = s.id === value;
                return (
                  <button key={s.id} type="button" onClick={() => onChange(s.id)} aria-current={on ? 'page' : undefined} data-testid={`config-nav-${s.id}`}
                    className={cn('flex min-h-9 w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-start text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                      on ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground')}>
                    <s.icon className="size-4 shrink-0" /><span className="min-w-0 truncate">{s.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
