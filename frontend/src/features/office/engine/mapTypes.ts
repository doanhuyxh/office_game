// Kiểu dữ liệu bản đồ v2 (shared/office-map.json, schema shared/schemas/office-map.schema.json).
// File này KHÔNG import gì để design/tools dùng lại được.

export type Side = 'n' | 's' | 'e' | 'w';
export interface Rect { x0: number; x1: number; z0: number; z1: number }
export interface Door { side: Side; at: number; w: number; id?: string; name?: string }
export type RoomKind = 'office' | 'meeting' | 'booth' | 'open' | 'lounge' | 'lobby' | 'pantry';
export interface Room extends Rect {
  id: string; name: string; kind: RoomKind; zone: string; walls: boolean; glass?: boolean; capacity?: number; voice?: string; doors?: Door[];
}
export interface Area extends Rect { id: string; name: string; dept: string }
export interface Seat { id: string; dept: string; zone: string; x: number; z: number; facing: Side }
export interface MapObject {
  id: string; prefab: string; x: number; z: number; w: number; d: number; rot: number; solid: boolean; action?: string; interact?: string;
}
export interface OfficeMapV2 {
  version: number; name: string; unit: 'm'; grid: number; floor: Rect; wallHeight: number;
  outerDoors: Door[]; spawn: { x: number; z: number }; rooms: Room[]; areas: Area[]; seats: Seat[]; objects: MapObject[];
}
