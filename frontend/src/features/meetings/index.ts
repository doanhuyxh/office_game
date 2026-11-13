// Public API của module Phòng họp (đặt phòng, trạng thái phòng cho văn phòng 3D, họp với AI).
export { MeetingsPage } from './components/meetings-page';
export { AgentMeetingDialog, type AgentMeetingDraft } from './components/agent-meeting-dialog';
export { AgentMeetingBar } from './components/agent-meeting-bar';
export { AgentMeetingSettingsCard } from './components/agent-meeting-settings-card';
export { useRoomsNow, useMeetingRooms, useActiveAgentSessions } from './hooks/useMeetings';
export type { IRoomNow, IBooking } from './types/meeting.types';
