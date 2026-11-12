import { Check, Minus } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/common/table';
import { Spinner } from '@/components/feedback/Spinner';
import { errorMessage } from '@/utils/errors';
import { useNotificationEvents } from '../../hooks/useSystem';
import type { INotificationEvent, NotificationChannelKey } from '../../types/system.types';

const COLUMNS: { key: NotificationChannelKey; label: string }[] = [
  { key: 'bell', label: 'Chuông' }, { key: 'email', label: 'Email' }, { key: 'push', label: 'Push (FCM)' },
  { key: 'webhook', label: 'Webhook AI' }, { key: 'telegram', label: 'Telegram' },
];

function ChannelCell({ e, channel }: { e: INotificationEvent; channel: NotificationChannelKey }) {
  const c = e.channels.find((x) => x.channel === channel);
  if (!c) return <Minus className="mx-auto size-4 text-muted-foreground/40" aria-label="Không gửi" />;
  return (
    <div className="grid justify-items-center gap-0.5" title={c.note ?? undefined}>
      <Check className="size-4 text-success" aria-label="Có gửi" />
      {c.note && <span className="max-w-36 text-center text-[11px] leading-tight text-muted-foreground">{c.note}</span>}
    </div>
  );
}

/**
 * Danh mục sự kiện thông báo theo nhóm (TEST-59): mỗi sự kiện — ai nhận, khi nào, đi qua kênh nào. Dữ liệu từ danh mục duy nhất ở back-end
 * (NotificationCatalog, có test đối chiếu với code) — FE chỉ hiển thị.
 */
export function NotificationEventsCard({ active }: { active: boolean }) {
  const { data, isLoading, error } = useNotificationEvents(active);
  if (isLoading) return <Spinner />;
  if (error || !data) return <p className="text-sm text-destructive">{errorMessage(error)}</p>;
  const total = data.reduce((n, g) => n + g.events.length, 0);
  return (
    <section className="grid gap-2" data-testid="notification-events">
      <div>
        <h3 className="text-sm font-semibold">Danh mục sự kiện thông báo</h3>
        <p className="text-xs text-muted-foreground">
          {total} sự kiện. Email: người nhận tắt được ở hồ sơ (trừ khi ghi khác) · Push: chỉ thiết bị đã bật thông báo đẩy · Webhook AI: sự kiện
          "notification" cho mọi thông báo chuông, tới người đã cài webhook · Telegram: chỉ khi người làm là tài khoản bot có "Bot Telegram" và kênh đang bật.
        </p>
      </div>
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-80">Sự kiện</TableHead>
              {COLUMNS.map((c) => <TableHead key={c.key} className="w-28 text-center">{c.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((g) => [
              <TableRow key={g.key} className="bg-muted/50 hover:bg-muted/50" data-testid={`event-group-${g.key}`}>
                <TableCell colSpan={COLUMNS.length + 1} className="py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {g.name} · {g.events.length}
                </TableCell>
              </TableRow>,
              ...g.events.map((e) => (
                <TableRow key={e.key} data-testid={`event-${e.key}`} className="align-top">
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{e.title}</div>
                    <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">{e.description}</p>
                    <code className="text-[11px] text-muted-foreground/80">{e.key}</code>
                  </TableCell>
                  {COLUMNS.map((c) => <TableCell key={c.key} className="whitespace-normal"><ChannelCell e={e} channel={c.key} /></TableCell>)}
                </TableRow>
              )),
            ])}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}
