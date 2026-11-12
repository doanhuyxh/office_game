import { Network, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { SettingsCardShell } from '../settings-card-shell';
import type { ISettingsGroup, ISettingsIpRange } from '../../types/system.types';

/** Danh sách IP / CIDR văn phòng (chấm công trong dải = tại văn phòng, ngoài = Remote). Server kiểm tra định dạng. */
export function OfficeIpsCard({ group }: { group: ISettingsGroup }) {
  const initial = (group.values.ranges as ISettingsIpRange[] | undefined) ?? [];
  const [rows, setRows] = useState<ISettingsIpRange[]>(initial);
  useEffect(() => { setRows((group.values.ranges as ISettingsIpRange[] | undefined) ?? []); }, [group]);
  const dirty = JSON.stringify(rows.map((r) => ({ cidr: r.cidr, note: r.note || null }))) !== JSON.stringify(initial.map((r) => ({ cidr: r.cidr, note: r.note || null })));
  const update = (i: number, patch: Partial<ISettingsIpRange>) => setRows((x) => x.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  return (
    <SettingsCardShell group={group} icon={Network} dirty={dirty}
      description="IP public của văn phòng (một IP hoặc dải CIDR). Chấm công từ IP trong danh sách = tại văn phòng; danh sách trống = mọi lần chấm công là Remote. Kiểm tra = so với IP của bạn."
      build={() => ({ values: { ranges: rows.map((r) => ({ cidr: r.cidr.trim(), note: r.note?.trim() || null })) } })}
      onSaved={() => undefined}>
      {(errors) => (
        <div className="grid gap-2">
          {rows.length === 0 && <p className="text-sm text-muted-foreground">Chưa có dải IP nào.</p>}
          {rows.map((r, i) => (
            <div key={i} className="grid gap-1">
              <div className="flex flex-wrap gap-2 sm:flex-nowrap">
                <Input className="sm:w-56" placeholder="203.0.113.10 hoặc 203.0.113.0/24" value={r.cidr} aria-label={`IP / CIDR dòng ${i + 1}`}
                  aria-invalid={!!errors[`ranges[${i}].cidr`]} onChange={(e) => update(i, { cidr: e.target.value })} data-testid={`office-ip-${i}`} />
                <Input className="min-w-0 flex-1" placeholder="Ghi chú (vd Cáp quang VNPT tầng 3)" value={r.note ?? ''} aria-label={`Ghi chú dòng ${i + 1}`}
                  onChange={(e) => update(i, { note: e.target.value })} />
                <Button type="button" variant="ghost" size="icon" aria-label="Xoá dòng" onClick={() => setRows((x) => x.filter((_, k) => k !== i))}><Trash2 /></Button>
              </div>
              {(errors[`ranges[${i}].cidr`] || errors[`ranges[${i}].note`]) && (
                <p className="text-xs text-destructive">{errors[`ranges[${i}].cidr`] ?? errors[`ranges[${i}].note`]}</p>
              )}
            </div>
          ))}
          {errors.ranges && <p className="text-xs text-destructive">{errors.ranges}</p>}
          <div><Button type="button" variant="outline" size="sm" onClick={() => setRows((x) => [...x, { cidr: '', note: null }])}><Plus /> Thêm IP</Button></div>
        </div>
      )}
    </SettingsCardShell>
  );
}
