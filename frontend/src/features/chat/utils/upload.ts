import type { IUploadTicket } from '../types/chat.types';

/** PUT file thẳng lên S3 bằng presigned URL (XHR để có tiến độ). Bucket phải bật CORS cho PUT từ domain app; không gửi cookie. */
export function putToS3(ticket: IUploadTicket, file: File, onProgress: (ratio: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', ticket.url);
    xhr.setRequestHeader('Content-Type', ticket.contentType);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Kho S3 từ chối file (HTTP ${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Không gửi được file lên kho S3 (mạng lỗi hoặc bucket chưa bật CORS)'));
    xhr.send(file);
  });
}
