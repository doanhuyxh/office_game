import { useEffect, useRef, useState } from 'react';
import { Bot, Square } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/common/button';
import { confirmDialog } from '@/components/common/confirm-dialog';
import { useMe } from '@/features/auth';
import { cn } from '@/utils/cn';
import { formatTime, parseInstant } from '@/utils/date';
import { errorMessage } from '@/utils/errors';
import { useMeetingRooms, useRoomAgentSession, useStopAgentMeeting } from '../../hooks/useMeetings';
import { endReasonText, remaining } from '../../utils/labels';

/** Phiên vừa kết thúc trong khoảng này còn hiện dòng tóm tắt. */
const ENDED_VISIBLE_MS = 60 * 60_000;

function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/**
 * Thanh trạng thái họp với AI trong khung chat của phòng họp (trang Tin nhắn + HUD văn phòng 3D) — TEST-83.
 * Đang họp: chủ đề, bot đang nói, lượt x / trần, thời gian còn lại, nút Dừng họp (khi back-end trả canStop). Vừa kết thúc: lý do.
 * Không có phiên: nút "Họp với AI" (khi truyền onOpen; tài khoản bot không mở được nên ẩn). variant "hud": màu cho nền tối của văn phòng 3D.
 * Phòng không phải phòng họp → không hiện gì. onChange: phiên mở / kết thúc (để khung chat tải lại tin hệ thống — tin này chưa phát realtime).
 */
export function AgentMeetingBar({ roomId, onOpen, onChange, variant = 'web', className }: {
  roomId: string | null | undefined;
  onOpen?: () => void;
  onChange?: () => void;
  variant?: 'web' | 'hud';
  className?: string;
}) {
  const rooms = useMeetingRooms();
  const meetingRoom = !!roomId && !!rooms.data?.some((r) => r.id === roomId);
  const { data: session } = useRoomAgentSession(meetingRoom ? roomId : null);
  const stateKey = session ? `${session.id}:${session.status}` : '';
  const seen = useRef<string | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    if (seen.current !== null && seen.current !== stateKey) onChangeRef.current?.();
    seen.current = stateKey;
  }, [stateKey]);
  const { data: me } = useMe();
  const stop = useStopAgentMeeting();
  const active = session?.status === 'Active';
  const now = useTick(active);
  const hud = variant === 'hud';
  const box = cn('flex flex-wrap items-center gap-x-3 gap-y-1 text-xs',
    hud ? 'rounded-md bg-black/35 px-2 py-1.5 text-white' : 'border-b bg-info/10 px-3 py-2', className);

  if (!meetingRoom) return null;

  if (active && session) {
    const speaker = session.bots.find((b) => b.isSpeaking);
    const askStop = async () => {
      if (!(await confirmDialog({ title: `Dừng cuộc họp "${session.topic}"?`, description: 'Các bot ngừng phát biểu ngay; trong kênh phòng có tin báo kết thúc.', confirmText: 'Dừng họp', cancelText: 'Không', destructive: true }))) return;
      stop.mutate(session.id, { onSuccess: () => toast.success('Đã dừng cuộc họp'), onError: (e) => toast.error(errorMessage(e)) });
    };
    return (
      <div className={box} data-testid="agent-meeting-bar" data-status="active">
        <span className="flex min-w-0 items-center gap-1 font-medium"><Bot className="size-3.5 shrink-0" /><span className="truncate">Họp với AI: {session.topic}</span></span>
        <span data-testid="agent-meeting-speaker">Đang nói: <b>{speaker?.name ?? '—'}</b></span>
        <span data-testid="agent-meeting-turns">Lượt {session.turnsUsed} / {session.maxTurns}</span>
        <span title={`Kết thúc lúc ${formatTime(session.expiresAt)}`}>Còn {remaining(session.expiresAt, now)}</span>
        {session.canStop && (
          <Button type="button" size="sm" variant="destructive" className="ms-auto h-6 px-2 text-xs" disabled={stop.isPending} onClick={() => void askStop()}
            data-testid="agent-meeting-stop">
            <Square className="size-3" /> Dừng họp
          </Button>
        )}
      </div>
    );
  }

  const recent = session?.endedAt && now - parseInstant(session.endedAt).getTime() < ENDED_VISIBLE_MS ? session : null;
  const canOpen = !!onOpen && !me?.isBot;
  if (!recent && !canOpen) return null;
  return (
    <div className={box} data-testid="agent-meeting-bar" data-status={recent ? 'ended' : 'idle'}>
      {recent && (
        <span className="min-w-0" data-testid="agent-meeting-ended">
          Cuộc họp AI "{recent.topic}" đã kết thúc lúc {formatTime(recent.endedAt!)}: {endReasonText(recent)}.
        </span>
      )}
      {canOpen && (
        <Button type="button" size="sm" variant={hud ? 'secondary' : 'outline'} className="ms-auto h-6 px-2 text-xs" onClick={onOpen} data-testid="agent-meeting-open">
          <Bot className="size-3" /> Họp với AI
        </Button>
      )}
    </div>
  );
}
