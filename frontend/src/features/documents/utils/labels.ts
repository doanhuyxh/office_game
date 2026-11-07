import type { LucideIcon } from 'lucide-react';
import { Archive, File, FileAudio, FileImage, FileText, FileVideo } from 'lucide-react';
import type { StatusTone } from '@/components/common/StatusBadge';
import type { AssetKind, AssetStatus, ISpace, ISpaceRef, SpaceKind } from '../types/document.types';

export const STATUS: Record<AssetStatus, { label: string; tone: StatusTone }> = {
  Draft: { label: 'Nháp', tone: 'muted' },
  PendingApproval: { label: 'Chờ duyệt', tone: 'warning' },
  Published: { label: 'Ban hành', tone: 'success' },
  Archived: { label: 'Lưu trữ', tone: 'info' },
  Destroyed: { label: 'Đã huỷ', tone: 'danger' },
};

export const KIND: Record<AssetKind, { label: string; icon: LucideIcon; className: string }> = {
  Document: { label: 'Văn bản', icon: FileText, className: 'text-primary' },
  Image: { label: 'Hình ảnh', icon: FileImage, className: 'text-success' },
  Video: { label: 'Video', icon: FileVideo, className: 'text-destructive' },
  Audio: { label: 'Âm thanh', icon: FileAudio, className: 'text-info' },
  Archive: { label: 'File nén', icon: Archive, className: 'text-warning' },
  Other: { label: 'Khác', icon: File, className: 'text-muted-foreground' },
};

export const SPACE_KIND: Record<SpaceKind, string> = { Company: 'Công ty', Department: 'Phòng ban', Project: 'Dự án' };

/** 1 234 567 → "1,2 MB" */
export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toLocaleString('vi-VN', { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`;
}

export const spaceKey = (s: ISpaceRef) => `${s.kind}:${s.id ?? ''}`;
export const parseSpaceKey = (k: string): ISpaceRef => {
  const [kind, id] = k.split(':');
  return { kind: kind as SpaceKind, id: id || null };
};
export const sameSpace = (a: ISpaceRef | null | undefined, b: ISpaceRef | null | undefined) =>
  !!a && !!b && a.kind === b.kind && (a.id ?? null) === (b.id ?? null);
export const findSpace = (list: ISpace[] | undefined, s: ISpaceRef | null) => list?.find((x) => sameSpace(x, s));
