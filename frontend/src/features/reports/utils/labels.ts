export const OT_KIND: Record<string, string> = { Weekday: 'Ngày thường · 150%', RestDay: 'Nghỉ tuần · 200%', Holiday: 'Ngày lễ · 300%' };

/** 135 phút → "2,25" giờ. */
export const hours = (minutes: number) => (minutes / 60).toLocaleString('vi-VN', { maximumFractionDigits: 2 });

/** Số ngày (phép): 11.9166 → "11,92". */
export const days = (n: number) => n.toLocaleString('vi-VN', { maximumFractionDigits: 2 });
