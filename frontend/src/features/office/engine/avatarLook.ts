import raw from '@shared/avatar-catalog.json';

/**
 * Ngoại hình nhân vật (lưu theo tài khoản ở Identity, gửi qua hub dạng chuỗi JSON). Danh mục `shared/avatar-catalog.json`
 * sinh bởi `scripts/dev/import-characters.ts`, dùng chung với BE (Identity AvatarCatalog kiểm tra khi lưu).
 * Màu = chỉ số trong bảng màu, null = màu gốc của model. Không phụ thuộc Three.js (editor + engine dùng chung).
 */
export type BodyType = 'male' | 'female';
export const SLOTS = ['head', 'top', 'bottom', 'shoes'] as const;
export type Slot = (typeof SLOTS)[number];
export type ColorKey = 'skin' | 'hair' | 'eyes' | 'topColor' | 'bottomColor' | 'shoesColor';

export interface AvatarLook {
  v: 1;
  body: BodyType;
  head: string;
  top: string;
  bottom: string;
  shoes: string;
  skin: number | null;
  hair: number | null;
  eyes: number | null;
  topColor: number | null;
  bottomColor: number | null;
  shoesColor: number | null;
}

export interface PartInfo { id: string; label: string; tint?: string[]; hair?: string[]; eyes?: string[] }
interface BodyInfo { label: string; file: string; parts: Record<Slot, PartInfo[]> }
export interface AvatarCatalog {
  version: number;
  palettes: { skin: string[]; hair: string[]; eyes: string[]; cloth: string[] };
  default: AvatarLook;
  bodies: Record<BodyType, BodyInfo>;
}

export const AVATAR_CATALOG = raw as unknown as AvatarCatalog;
export const DEFAULT_LOOK: AvatarLook = AVATAR_CATALOG.default;

/** Bảng màu dùng cho từng ô màu. */
export const paletteOf = (k: ColorKey): string[] => {
  const p = AVATAR_CATALOG.palettes;
  return k === 'skin' ? p.skin : k === 'hair' ? p.hair : k === 'eyes' ? p.eyes : p.cloth;
};

export const partsOf = (body: BodyType, slot: Slot) => AVATAR_CATALOG.bodies[body].parts[slot];
export const partOf = (look: AvatarLook, slot: Slot) => partsOf(look.body, slot).find((p) => p.id === look[slot]);

const COLOR_KEYS: ColorKey[] = ['skin', 'hair', 'eyes', 'topColor', 'bottomColor', 'shoesColor'];

/** Kiểm tra theo danh mục (giống BE). Sai → null. */
export function validLook(x: unknown): AvatarLook | null {
  if (!x || typeof x !== 'object') return null;
  const o = x as Record<string, unknown>;
  if (o.v !== 1 || (o.body !== 'male' && o.body !== 'female')) return null;
  const body = o.body as BodyType;
  for (const s of SLOTS) if (!partsOf(body, s).some((p) => p.id === o[s])) return null;
  for (const k of COLOR_KEYS) {
    const c = o[k];
    if (c === null || c === undefined) continue;
    if (!Number.isInteger(c) || (c as number) < 0 || (c as number) >= paletteOf(k).length) return null;
  }
  const look = { v: 1, body } as AvatarLook;
  for (const s of SLOTS) look[s] = o[s] as string;
  for (const k of COLOR_KEYS) look[k] = (o[k] as number | null | undefined) ?? null;
  return look;
}

/** Chuỗi JSON từ hub / API → ngoại hình; null / lỗi / không còn trong danh mục → nhân vật mặc định. */
export function parseLook(json: string | null | undefined): AvatarLook {
  if (!json) return DEFAULT_LOOK;
  try { return validLook(JSON.parse(json)) ?? DEFAULT_LOOK; } catch { return DEFAULT_LOOK; }
}

/** Đổi dáng người: phần không có ở dáng mới → phần đầu tiên của dáng đó. */
export function withBody(look: AvatarLook, body: BodyType): AvatarLook {
  if (look.body === body) return look;
  const next = { ...look, body };
  for (const s of SLOTS) next[s] = partsOf(body, s).find((p) => p.id === look[s])?.id ?? partsOf(body, s)[0].id;
  return next;
}

export function randomLook(): AvatarLook {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  const body: BodyType = Math.random() < 0.5 ? 'male' : 'female';
  const look = { v: 1, body } as AvatarLook;
  for (const s of SLOTS) look[s] = pick(partsOf(body, s)).id;
  for (const k of COLOR_KEYS) look[k] = Math.floor(Math.random() * paletteOf(k).length);
  return look;
}

export const sameLook = (a: AvatarLook, b: AvatarLook) =>
  a.body === b.body && SLOTS.every((s) => a[s] === b[s]) && COLOR_KEYS.every((k) => a[k] === b[k]);
