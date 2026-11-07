import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { Input } from '@/components/common/input';
import { formatDate } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useCreateHoliday, useDeleteHoliday, useHolidays } from '../../hooks/useAttendance';

export function HolidaysPanel() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data: holidays = [] } = useHolidays(year);
  const create = useCreateHoliday();
  const remove = useDeleteHoliday();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const add = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ date, name }, { onSuccess: () => { setDate(''); setName(''); toast.success('Đã thêm ngày lễ'); }, onError: (err) => toast.error(errorMessage(err)) });
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Ngày lễ {year}</h3>
        <div className="flex gap-1">
          <Button variant="outline" size="sm" onClick={() => setYear(year - 1)}>←</Button>
          <Button variant="outline" size="sm" onClick={() => setYear(year + 1)}>→</Button>
        </div>
      </div>
      <form onSubmit={add} className="flex flex-wrap gap-2">
        <Input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className="w-44" aria-label="Ngày" />
        <Input required placeholder="Tên ngày lễ (vd: Quốc khánh)" value={name} onChange={(e) => setName(e.target.value)} className="min-w-56 flex-1" />
        <Button type="submit" disabled={create.isPending}>Thêm</Button>
      </form>
      <ul className="divide-y rounded-xl border bg-card">
        {holidays.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">Chưa có ngày lễ</li>}
        {holidays.map((h) => (
          <li key={h.id} className="flex items-center justify-between px-4 py-2 text-sm">
            <span><span className="mr-3 font-mono">{formatDate(h.date)}</span>{h.name}</span>
            <Button variant="ghost" size="icon" aria-label="Xoá" onClick={() => remove.mutate(h.id)}><Trash2 /></Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
