import type { AgentMeetingEndReason, IAgentMeeting } from '../types/meeting.types';

/** Dòng tóm tắt lý do kết thúc phiên họp agent (khớp AgentMeetingTurnRules.EndNotice ở back-end). */
export function endReasonText(m: IAgentMeeting): string {
  const reasons: Record<AgentMeetingEndReason, string> = {
    Stopped: `${m.endedByName ?? 'người mở'} dừng cuộc họp`,
    TurnLimit: `đã dùng hết ${m.maxTurns} lượt phát biểu`,
    TimeLimit: `hết ${m.maxMinutes} phút`,
    AllPassed: 'không còn ai phát biểu',
  };
  return m.endReason ? reasons[m.endReason] : 'đã đóng';
}

/** Còn lại "m:ss" (hoặc "h:mm:ss"); âm → 0:00. */
export function remaining(untilIso: string, now: number): string {
  const s = Math.max(0, Math.floor((new Date(untilIso).getTime() - now) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
