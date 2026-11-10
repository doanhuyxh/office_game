/**
 * Ngày giờ theo giờ Việt Nam (khớp Office__TimeZone ở back-end).
 *
 * Hợp đồng với API (backend Http/Instants.cs):
 * - Thời điểm (instant): ISO 8601 LUÔN kèm múi giờ. BE trả UTC "…Z" → hiển thị qua formatDate / formatTime (đổi sang giờ VN).
 *   Gửi lên: `toApiInstant(date)` ("…Z"). BE từ chối chuỗi thiếu múi giờ.
 * - Ngày "yyyy-MM-dd" và giờ trong ngày "HH:mm" (ngày công, giờ ca, giờ giải trình…) là lịch / giờ đồng hồ TẠI VĂN PHÒNG,
 *   không phải thời điểm → gửi đúng dạng đó, lấy "hôm nay" bằng `todayVn()` (không dùng giờ máy người dùng).
 */
export const TZ = 'Asia/Ho_Chi_Minh';

const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Chuỗi có giờ nhưng thiếu múi giờ, vd "2026-11-06T09:00:00" — JS sẽ hiểu theo giờ máy người dùng (sai). */
const DATETIME_NO_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * Đọc thời điểm từ API. Chuỗi ngày "yyyy-MM-dd" vẫn nhận (dùng cho formatDate của cột ngày).
 * Chuỗi có giờ mà thiếu múi giờ → coi là UTC và cảnh báo trong console (API không bao giờ được trả dạng này).
 */
export function parseInstant(v: Date | string | number): Date {
  if (v instanceof Date || typeof v === 'number') return new Date(v);
  if (DATETIME_NO_ZONE.test(v)) {
    console.warn(`[date] Thời gian thiếu múi giờ từ API: "${v}" — coi là UTC`);
    return new Date(`${v}Z`);
  }
  return new Date(v);
}

/**
 * Ngày + giờ đồng hồ tại văn phòng → thời điểm gửi API, kèm múi giờ VN: ("2026-11-07", "09:30") → "2026-11-07T09:30:00+07:00".
 * Việt Nam không đổi giờ mùa hè nên offset cố định +07:00.
 */
export const vnInstant = (date: string, time: string) => `${date}T${time.length === 5 ? `${time}:00` : time}+07:00`;

/** Thời điểm → "HH:mm" theo giờ VN (cho ô input type="time"). */
export const toVnTime = (v: Date | string) => formatTime(v);

/** Thời điểm → "yyyy-MM-dd" theo giờ VN. */
export const toVnDate = (v: Date | string) => parseInstant(v).toLocaleDateString('sv-SE', { timeZone: TZ });

/** Cộng n ngày vào ngày "yyyy-MM-dd" (tính theo lịch, không theo múi giờ máy). */
export const addDays = (date: string, n: number) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};

/** Gửi thời điểm lên API: ISO 8601 UTC "2026-11-06T02:14:39.000Z". */
export const toApiInstant = (v: Date) => v.toISOString();

/** "Hôm nay" theo giờ Việt Nam, dạng yyyy-MM-dd. */
export const todayVn = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
/** Tháng hiện tại theo giờ Việt Nam, dạng yyyy-MM. */
export const currentMonthVn = () => todayVn().slice(0, 7);

/** 05/11/2026 */
export const formatDate = (v: Date | string | number) => dateFmt.format(parseInstant(v));
/** 08:02 */
export const formatTime = (v: Date | string | number) => timeFmt.format(parseInstant(v));
/** 05/11/2026 08:02 */
export const formatDateTime = (v: Date | string | number) => `${formatDate(v)} ${formatTime(v)}`;
/** Nhãn múi giờ hiển thị của TZ, vd "GMT+7". */
export const TZ_LABEL = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'shortOffset' })
  .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+7';
/** 05/11/2026 08:02 GMT+7 — dùng khi cần nói rõ múi giờ (trang vận hành…). */
export const formatDateTimeTz = (v: Date | string | number) => `${formatDateTime(v)} ${TZ_LABEL}`;
/** 485 phút → "8 giờ 5 phút" */
export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h && r ? `${h} giờ ${r} phút` : h ? `${h} giờ` : `${r} phút`;
};
