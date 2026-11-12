import { Checkbox } from '@/components/common/checkbox';
import { Input } from '@/components/common/input';
import { Label } from '@/components/common/label';

export interface IScheduleValue { on: boolean; date: string; time: string }

/** Hẹn giờ đăng (giờ Việt Nam): bật → chọn ngày + giờ; server kiểm tra 1 phút – 60 ngày. */
export function ScheduleField({ value, onChange, disabled, error }: { value: IScheduleValue; onChange: (v: IScheduleValue) => void; disabled?: boolean; error?: string }) {
  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        <Checkbox id="news-schedule" checked={value.on} disabled={disabled} onCheckedChange={(c) => onChange({ ...value, on: c === true })} data-testid="schedule-toggle" />
        <Label htmlFor="news-schedule" className="font-normal">Hẹn giờ đăng</Label>
      </div>
      {value.on && (
        <div className="flex flex-wrap items-center gap-2 ps-6">
          <Input type="date" className="w-40" value={value.date} disabled={disabled} onChange={(e) => onChange({ ...value, date: e.target.value })} aria-label="Ngày đăng" data-testid="schedule-date" />
          <Input type="time" className="w-28" value={value.time} disabled={disabled} onChange={(e) => onChange({ ...value, time: e.target.value })} aria-label="Giờ đăng" data-testid="schedule-time" />
          <span className="text-xs text-muted-foreground">giờ Việt Nam · email / @nhắc gửi lúc đăng</span>
        </div>
      )}
      {error && <p className="ps-6 text-xs text-destructive">{error}</p>}
    </div>
  );
}
