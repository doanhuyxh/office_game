/** Định dạng ngày giờ theo giờ Việt Nam (khớp Office__TimeZone ở back-end). */
const TZ = 'Asia/Ho_Chi_Minh';

const dateFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('vi-VN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

const toDate = (v: Date | string | number) => (v instanceof Date ? v : new Date(v));

/** 05/11/2026 */
export const formatDate = (v: Date | string | number) => dateFmt.format(toDate(v));
/** 08:02 */
export const formatTime = (v: Date | string | number) => timeFmt.format(toDate(v));
/** 05/11/2026 08:02 */
export const formatDateTime = (v: Date | string | number) => `${formatDate(v)} ${formatTime(v)}`;
/** 485 phút → "8 giờ 5 phút" */
export const formatMinutes = (m: number) => {
  const h = Math.floor(m / 60), r = Math.round(m % 60);
  return h && r ? `${h} giờ ${r} phút` : h ? `${h} giờ` : `${r} phút`;
};
