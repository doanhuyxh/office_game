import { documentApi } from '../api/document.api';
import type { IAssetDetail, IUploadTicket } from '../types/document.types';

/** PUT file thẳng lên S3 bằng presigned URL (XHR để có tiến độ). Bucket phải bật CORS cho PUT từ domain app. */
export function putToS3(ticket: IUploadTicket, file: File, onProgress: (ratio: number) => void, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.url);
    xhr.setRequestHeader('Content-Type', ticket.contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Kho S3 từ chối file (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Không gửi được file lên kho S3 (mạng lỗi hoặc bucket chưa bật CORS)'));
    xhr.onabort = () => reject(new DOMException('Đã huỷ', 'AbortError'));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}

/** Vé + PUT S3; trả ticketId để đăng ký tài liệu / phiên bản. */
export async function uploadToStorage(file: File, onProgress: (ratio: number) => void, signal?: AbortSignal) {
  const ticket = await documentApi.upload(file);
  await putToS3(ticket, file, onProgress, signal);
  return ticket.ticketId;
}

/** Tải phiên bản mới cho tài liệu có sẵn. */
export async function uploadNewVersion(assetId: string, file: File, note: string | null, onProgress: (r: number) => void): Promise<IAssetDetail> {
  const ticketId = await uploadToStorage(file, onProgress);
  return documentApi.addVersion(assetId, ticketId, note);
}

/** Đường dẫn thư mục tương đối của file khi chọn / kéo cả thư mục ("a/b/c.pdf" → "a/b"); file lẻ → "". */
export const relativeDir = (file: File & { relPath?: string }) => {
  const p = file.relPath ?? (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : '';
};

/** Đọc mọi file trong các mục kéo thả (gồm thư mục con) — gắn relPath để giữ cấu trúc. */
export async function filesFromDrop(items: DataTransferItemList): Promise<(File & { relPath?: string })[]> {
  const entries = [...items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  const out: (File & { relPath?: string })[] = [];
  const walk = async (entry: FileSystemEntry, path: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(Object.assign(file, { relPath: path + file.name }));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e, `${path}${entry.name}/`);
      }
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}
