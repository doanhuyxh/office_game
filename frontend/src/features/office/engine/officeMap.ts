import raw from '@shared/office-map.json';
import type { OfficeMapV2, Side } from './mapTypes';

/** Bản đồ v2 dùng chung với server (shared/office-map.json). Sửa bản đồ → chạy `bun design/tools/render-plan.ts`. */
export const OFFICE_MAP = raw as unknown as OfficeMapV2;

/** Hướng mặt → góc quay quanh trục Y (model nhìn về +z). */
export const FACING_ANGLE: Record<Side, number> = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
