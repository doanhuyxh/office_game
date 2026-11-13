import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { hubErrorMessage, type OfficeConnection } from '../api/officeHub';
import type { ConnState } from '../store/office.store';
import type { BotActivityDto, BotWatchDto, BotWatchEventDto } from '../types/office.types';

/** Giữ tối đa bấy nhiêu sự kiện — bằng đệm phiên ở server (`BotActivityFeedRoute.BufferSize`). */
export const BOT_WATCH_MAX_EVENTS = 200;
/** Lý do server kết thúc phiên xem (`BotWatchEnded`) → câu ngắn cho HUD. */
export const BOT_WATCH_END_REASON: Record<string, string> = {
  range: 'Bạn đã đi ra xa', offline: 'Bot đã offline', left: 'Bạn đã rời văn phòng',
};
/** Chờ bấy nhiêu ms sau khi nối lại hub rồi mới gọi lại WatchBot (Welcome + vị trí kịp tới server — như GetScreen ở OfficeView); thử lại một lần. */
const REWATCH_DELAY = 600, REWATCH_RETRY = 1200;

/** Trạng thái "đang xem bot" cho HUD — chỉ trong RAM (chủ dự án: không lưu lịch sử, không localStorage). */
export interface BotWatchView {
  botId: string;
  name: string;
  /** Đang gọi WatchBot (mở bảng / nối lại sau mất kết nối). */
  connecting: boolean;
  /** Bot đang làm (true) / rảnh (false) / chưa rõ (null) + việc đang làm "MÃ · tên". */
  busy: boolean | null;
  task: string | null;
  /** Từ session_start / session_end gần nhất của phiên. */
  model: string | null;
  turns: number | null;
  costUsd: number | null;
  /** Thời điểm (ISO UTC) `session_start` / `session_end` gần nhất của phiên — đầu bảng tính "đã chạy"; phiên chưa xong → `endedAt` null. */
  startedAt: string | null;
  endedAt: string | null;
  /** Sự kiện phiên hiện tại: gộp theo `id` (cùng id = cập nhật), xếp theo `seq`, ≤ BOT_WATCH_MAX_EVENTS. */
  events: BotWatchEventDto[];
}

const fresh = (botId: string, name: string): BotWatchView =>
  ({ botId, name, connecting: true, busy: null, task: null, model: null, turns: null, costUsd: null, startedAt: null, endedAt: null, events: [] });

/**
 * Gộp lô mới vào danh sách: cùng `id` → thay (server đã trộn trường null = giữ cũ, giữ `seq`); có `session_start` → bỏ mọi sự kiện có
 * `seq` nhỏ hơn (server xoá đệm khi phiên mới bắt đầu); xếp theo `seq`; quá 200 → bỏ đầu.
 */
export function mergeEvents(list: BotWatchEventDto[], incoming: BotWatchEventDto[]): BotWatchEventDto[] {
  if (!incoming.length) return list;
  const byId = new Map(list.map((e) => [e.id, e]));
  let from = 0;
  for (const e of incoming) {
    byId.set(e.id, e);
    if (e.kind === 'session_start' && e.seq > from) from = e.seq;
  }
  const out = [...byId.values()].filter((e) => e.seq >= from).sort((a, b) => a.seq - b.seq);
  return out.length > BOT_WATCH_MAX_EVENTS ? out.slice(out.length - BOT_WATCH_MAX_EVENTS) : out;
}

/** Áp một lô (snapshot của WatchBot hoặc lô BotActivity) vào trạng thái; `cleared` = server xoá đệm → bảng trống, chờ phiên mới. */
function apply(v: BotWatchView, events: BotWatchEventDto[], busy: boolean | null | undefined, task: string | null | undefined, cleared = false): BotWatchView {
  const next: BotWatchView = { ...v, busy: busy ?? null, task: task ?? null, events: cleared ? [] : mergeEvents(v.events, events) };
  if (cleared) Object.assign(next, { startedAt: null, endedAt: null });
  for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
    if (e.kind === 'session_start') Object.assign(next, { model: null, turns: null, costUsd: null, startedAt: e.at, endedAt: null });
    if (e.kind === 'session_end') next.endedAt = e.at;
    if (e.model != null) next.model = e.model;
    if (e.turns != null) next.turns = e.turns;
    if (e.costUsd != null) next.costUsd = e.costUsd;
  }
  return next;
}

const applySnapshot = (v: BotWatchView, dto: BotWatchDto): BotWatchView =>
  ({ ...apply(v, dto.events ?? [], dto.busy, dto.task), name: dto.name || v.name, connecting: false });

/**
 * Lớp dữ liệu "xem bot đang làm gì" trong văn phòng 3D (TEST-97). `watch(botId)` → hub `WatchBot` (server kiểm phạm vi nghe được, lỗi →
 * `hint`); `onActivity` / `onEnded` nối vào `OfficeConnection` (hàm ổn định, dùng được trong closure của effect kết nối); `BotWatchEnded`
 * → đóng + gợi ý lý do ngắn; mất kết nối hub rồi nối lại → gọi lại `WatchBot` nếu bảng còn mở; `close` / rời trang → `UnwatchBot`.
 * Không ghi gì vào localStorage / cache.
 */
export function useBotWatch(connRef: RefObject<OfficeConnection | null>, conn: ConnState, hint: (text: string) => void) {
  const [view, setView] = useState<BotWatchView | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const hintRef = useRef(hint);
  hintRef.current = hint;

  const watch = useCallback(async (botId: string, name: string) => {
    const c = connRef.current;
    if (!c) return;
    setView((v) => (v?.botId === botId ? { ...v, name, connecting: true } : fresh(botId, name)));
    try {
      const dto = await c.watchBot(botId);
      // Người dùng đã đóng / đổi bot trong lúc chờ → bỏ kết quả. Lô BotActivity tới trước kết quả thì gộp cùng id, không trùng dòng.
      setView((v) => (v?.botId === botId ? applySnapshot(v, dto) : v));
    } catch (err) {
      setView((v) => (v?.botId === botId ? null : v));
      hintRef.current(hubErrorMessage(err, 'Chưa xem được bot này'));
    }
  }, [connRef]);

  const close = useCallback(() => {
    if (!viewRef.current) return;
    setView(null);
    void connRef.current?.unwatchBot().catch(() => { /* đã ngắt kết nối thì server tự thôi xem */ });
  }, [connRef]);

  // Lô BotActivity dồn dập (server gộp ≤ 4 lô / giây, nối lại có thể tới liền nhau) → xếp hàng, áp MỘT lần mỗi khung hình (TEST-98) để
  // React không vẽ lại bảng nhiều lần trong một khung của cảnh 3D. Tab ẩn (rAF không chạy) → áp ngay, hàng đợi không phình.
  const pending = useRef<BotActivityDto[]>([]);
  const raf = useRef(0);
  const flush = useCallback(() => {
    raf.current = 0;
    const batches = pending.current;
    pending.current = [];
    if (!batches.length) return;
    setView((v) => batches.reduce<BotWatchView | null>(
      (x, b) => (x && x.botId === b.botId ? apply(x, b.events ?? [], b.busy, b.task, !!b.cleared) : x), v));
  }, []);
  const onActivity = useCallback((b: BotActivityDto) => {
    pending.current.push(b);
    if (document.visibilityState === 'hidden') { cancelAnimationFrame(raf.current); flush(); return; }
    if (!raf.current) raf.current = requestAnimationFrame(flush);
  }, [flush]);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const onEnded = useCallback((botId: string, reason: string) => {
    if (viewRef.current?.botId !== botId) return;
    setView(null);
    hintRef.current(BOT_WATCH_END_REASON[reason] ?? 'Đã dừng xem bot');
  }, []);

  // Mất kết nối hub rồi nối lại → server đã quên phiên xem (kết nối cũ đóng) → gọi lại WatchBot nếu bảng còn mở; thất bại cả lần thử lại → đóng + lý do.
  const prevConn = useRef(conn);
  useEffect(() => {
    const was = prevConn.current;
    prevConn.current = conn;
    const v = viewRef.current;
    if (!v) return;
    if (conn === 'kicked') { setView(null); return; }
    if (conn === 'reconnecting') { setView((x) => (x ? { ...x, connecting: true } : x)); return; }
    if (conn !== 'online' || was !== 'reconnecting') return;
    let alive = true, timer = 0;
    const again = (retriesLeft: number) => {
      const c = connRef.current;
      if (!alive || !c || viewRef.current?.botId !== v.botId) return;
      c.watchBot(v.botId)
        .then((dto) => { if (alive) setView((x) => (x?.botId === v.botId ? applySnapshot(x, dto) : x)); })
        .catch((err: unknown) => {
          if (!alive) return;
          if (retriesLeft > 0) { timer = window.setTimeout(() => again(retriesLeft - 1), REWATCH_RETRY); return; }
          setView((x) => (x?.botId === v.botId ? null : x));
          hintRef.current(hubErrorMessage(err, 'Chưa xem lại được bot này'));
        });
    };
    timer = window.setTimeout(() => again(1), REWATCH_DELAY);
    return () => { alive = false; clearTimeout(timer); };
  }, [conn, connRef]);

  // Rời trang văn phòng → thôi xem (kết nối còn mở thì báo server; đã đóng thì server tự dọn).
  useEffect(() => () => { void connRef.current?.unwatchBot().catch(() => { /* bỏ qua */ }); }, [connRef]);

  return { view, watch, close, onActivity, onEnded };
}
