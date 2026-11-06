// Khớp với OfficeHub.Realtime/Hubs/OfficeRoomHub.cs (IOfficeClient + các record DTO).
// Sau này sinh tự động bằng TypedSignalR.Client.TypeScript.
export interface PlayerDto { id: string; name: string; x: number; z: number; r: number; anim: number }
export interface PositionDto { id: string; x: number; z: number; r: number; anim: number }
export interface WelcomeDto { selfId: string; mapName: string; players: PlayerDto[] }
/** at = ISO 8601 UTC "…Z" (server). */
export interface ChatDto { id: string; name: string; text: string; at: string }
