// Khớp DTO `/api/agent-transcripts` (backend Modules/Audit/Features/AgentTranscriptEndpoints.cs — TEST-144 / TEST-145).

export type AgentTranscriptKind = 'task' | 'chat' | 'meeting';

export interface IAgentTranscriptFilter {
  /** Id tài khoản bot; null = mọi bot. */
  userId: string | null;
  kind: AgentTranscriptKind | null;
}

/** Một transcript phiên agent (không có nội dung — tải bằng /download). */
export interface IAgentTranscript {
  id: string;
  userId: string;
  userName: string | null;
  fullName: string | null;
  /** Mã việc / id hội thoại / id phiên họp. */
  key: string;
  kind: AgentTranscriptKind;
  sessionId: string;
  branch: string | null;
  /** Bản bàn giao (câu cuối của agent), đã giải mã. */
  summary: string | null;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}
