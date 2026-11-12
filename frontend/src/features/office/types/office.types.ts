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
export interface ChatDto { id: string; name: string; text: string; at: string; channel?: 'office' | 'room'; roomId?: string | null; roomName?: string | null }
