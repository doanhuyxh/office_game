import type { ITaskColumn } from '../types/project.types';

/** Id phần hướng dẫn của một cột ở tab Hướng dẫn (mục lục cuộn tới) — TEST-186. */
export const columnGuideId = (columnId: string) => `guide-col-${columnId}`;

/** Cột có hướng dẫn riêng đang hiệu lực (bật "Đánh thức bot theo dõi" + có nội dung), theo thứ tự cột. */
export const guidedColumns = (columns: ITaskColumn[]) => columns.filter((c) => c.hasGuide && c.guide);
