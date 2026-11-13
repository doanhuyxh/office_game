export interface IMeetingRoom {
  id: string;
  name: string;
  capacity: number;
}

export interface IAttendee {
  employeeId: string;
  name: string;
}

/** Khớp BookingDto. startAt / endAt: ISO 8601 UTC "…Z". */
export interface IBooking {
  id: string;
  roomId: string;
  roomName: string;
  title: string;
  startAt: string;
  endAt: string;
  organizerEmployeeId: string;
  organizerName: string;
  note: string | null;
  attendees: IAttendee[];
  isMine: boolean;
  canCancel: boolean;
}

/** startAt / endAt: ISO 8601 KÈM múi giờ (vnInstant). */
export interface ICreateBooking {
  roomId: string;
  title: string;
  startAt: string;
  endAt: string;
  attendeeIds: string[];
  note: string | null;
}

export interface IRoomNow {
  roomId: string;
  roomName: string;
  capacity: number;
  current: IBooking | null;
  next: IBooking | null;
}

// ── Phiên họp agent (TEST-74/75/83) ──
export type AgentMeetingStatus = 'Active' | 'Ended';
/** Stopped = người dừng · TurnLimit = hết lượt · TimeLimit = hết giờ · AllPassed = không còn ai phát biểu. */
export type AgentMeetingEndReason = 'Stopped' | 'TurnLimit' | 'TimeLimit' | 'AllPassed';

export interface IAgentMeetingBot {
  employeeId: string;
  name: string;
  isChair: boolean;
  isSpeaking: boolean;
  /** Thứ tự chờ lượt (1 = kế tiếp), null = không chờ. */
  queuePosition: number | null;
}

/** Khớp AgentMeetingDto. Thời điểm: ISO 8601 UTC "…Z". */
export interface IAgentMeeting {
  id: string;
  roomId: string;
  roomName: string;
  topic: string;
  status: AgentMeetingStatus;
  endReason: AgentMeetingEndReason | null;
  openedByEmployeeId: string;
  openedByName: string;
  chairEmployeeId: string;
  /** Bot chủ trì đứng đầu. */
  bots: IAgentMeetingBot[];
  turnsUsed: number;
  maxTurns: number;
  maxMinutes: number;
  startedAt: string;
  expiresAt: string;
  endedAt: string | null;
  endedByName: string | null;
  /** Người mở hoặc HR / admin, phiên đang họp (back-end quyết định). */
  canStop: boolean;
  currentSpeakerEmployeeId: string | null;
  turnDeadline: string | null;
}

export interface IOpenAgentMeeting {
  roomId: string;
  topic: string;
  chairEmployeeId: string;
  botIds: string[];
}

/** Tài khoản bot chọn được khi mở họp (GET /agent-bots). */
export interface IAgentBotOption {
  employeeId: string;
  code: string;
  name: string;
  departmentName: string | null;
  positionName: string | null;
  avatarUrl: string | null;
}

/** Trần lượt / phút (chỉ admin). */
export interface IAgentMeetingSettings {
  maxTurns: number;
  maxMinutes: number;
  isDefault: boolean;
  updatedAt: string | null;
  updatedByName: string | null;
  defaultMaxTurns: number;
  defaultMaxMinutes: number;
  turnsMin: number;
  turnsMax: number;
  minutesMin: number;
  minutesMax: number;
}
