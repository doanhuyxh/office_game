// Khớp với OfficeHub.Realtime/Hubs/OfficeRoomHub.cs (IOfficeClient + các record DTO).
// Sau này sinh tự động bằng TypedSignalR.Client.TypeScript.
/** look = ngoại hình nhân vật (chuỗi JSON, null = mặc định) — parse bằng engine/avatarLook.parseLook. */
/** bot = avatar của tài khoản bot đang làm việc qua MCP (ngồi yên ở bàn); status = bot đang làm gì. */
export interface PlayerDto {
  id: string; name: string; x: number; z: number; r: number; anim: number; look?: string | null; bot?: boolean; status?: string | null;
}
export interface PositionDto { id: string; x: number; z: number; r: number; anim: number }
export interface WelcomeDto { selfId: string; mapName: string; players: PlayerDto[] }
/** at = ISO 8601 UTC "…Z" (server). channel: "office" toàn văn phòng | "room" chỉ người trong phòng roomId. */
/** Tài liệu đang chiếu trên màn hình một phòng có tường (Realtime ScreenDto). url = link qua Realtime /rt/screens/doc/… (chỉ người trong phòng, tự làm mới link S3 30 phút — TEST-30); bot / màn hình live có url riêng. */
export interface ScreenDto {
  roomId: string; roomName: string; assetId: string; title: string; fileName: string; contentType: string;
  kind: 'Document' | 'Image' | 'Video' | 'Audio' | 'Archive' | 'Other' | 'Markdown'; url: string; inline: boolean; byName: string; at: string;
  /** Màn hình bot đang làm việc (ảnh chụp cập nhật liên tục — tool MCP present_screen / trang present_markdown). */
  live?: boolean;
  /** kind = 'Markdown' (bot present_markdown): nội dung trang, url rỗng. */
  markdown?: string | null;
}
/** Loại sự kiện "agent đang làm gì" (BotActivityFeedRoute.Kinds, phân biệt hoa thường). */
export type BotActivityKind = 'session_start' | 'session_end' | 'command' | 'file_edit' | 'file_write' | 'file_read' | 'search' | 'thinking' | 'say' | 'tool';
/**
 * Một sự kiện trong luồng xem bot (Realtime BotWatchEventDto, TEST-95). Gửi lại cùng `id` = cập nhật sự kiện cũ (giữ `seq`, `at`) →
 * FE thay theo id. `seq` tăng dần theo bot; `at` = ISO UTC "…Z". `task` / `model` / `turns` / `costUsd` chỉ ở session_start / session_end.
 */
export interface BotWatchEventDto {
  id: string; kind: BotActivityKind; title?: string | null; text?: string | null; path?: string | null; diff?: string | null; output?: string | null;
  ok?: boolean | null; task?: string | null; model?: string | null; turns?: number | null; costUsd?: number | null; seq: number; at: string;
}
/** Trả về của hub `WatchBot`: đệm phiên hiện tại (≤ 200) + bot đang làm (true) / rảnh (false) / chưa rõ (null) + việc "MÃ · tên". */
export interface BotWatchDto { botId: string; name: string; busy?: boolean | null; task?: string | null; events: BotWatchEventDto[] }
/** Lô đẩy `BotActivity` cho người đang xem (gộp ≤ 4 lần / giây): sự kiện mới / cập nhật + trạng thái hiện tại; `cleared` = đệm bị xoá (rảnh quá lâu) → xoá bảng. */
export interface BotActivityDto { botId: string; events: BotWatchEventDto[]; busy?: boolean | null; task?: string | null; cleared?: boolean }
/** Lý do server kết thúc phiên xem (`BotWatchEnded`): đi ra xa / đổi kênh quá 3 giây · bot offline hoặc người thật của tài khoản vào · người xem rời hub. */
export type BotWatchEndReason = 'range' | 'offline' | 'left';
/** Người được @nhắc trong dòng chat (TEST-70). */
export interface ChatMentionDto { userId: string; code: string; name: string }
export interface ChatDto {
  id: string; name: string; text: string; at: string; channel?: 'office' | 'room'; roomId?: string | null; roomName?: string | null;
  mentions?: ChatMentionDto[] | null;
}
