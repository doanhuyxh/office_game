import { toast } from 'sonner';
import { errorMessage } from '@/utils/errors';
import { chatApi } from '../api/chat.api';
import type { IAttachment } from '../types/chat.types';

/** Đính kèm hiện như ảnh (có link xem): ô ảnh trong tin + danh sách ảnh của trình xem (`MessagePane`). */
export const isImage = (a: IAttachment) => a.isImage && !!a.url;

/** Tải tệp đính kèm: xin link presigned mới (`?download=true` → `attachment`) rồi bấm link ẩn. Lỗi → toast. */
export async function downloadAttachment(id: string) {
  try {
    const { url } = await chatApi.attachmentUrl(id, true);
    const link = document.createElement('a');
    link.href = url;
    link.rel = 'noopener';
    link.click();
  } catch (e) {
    toast.error(errorMessage(e, 'Không tải được tệp'));
  }
}
