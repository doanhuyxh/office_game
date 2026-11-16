import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useMe } from '@/features/auth';
import { playNotificationSound } from '@/features/notifications';
import { ApiError } from '@/services/api-client';
import { errorMessage } from '@/utils/errors';
import { chatApi, chatKeys } from '../../api/chat.api';
import { ChatConnection } from '../../api/chatHub';
import { ChatContext, type IChatContext } from '../../context/chat-context';
import { useChatUnread } from '../../hooks/useChatData';
import type { ChatLinkState, IChatMessage, IConversation, IMessage } from '../../types/chat.types';
import { addLocal, adjustUnread, bumpUnreadEpoch, markDeleted, mentionsUser, patchLocal, removeLocal, touchConversation, upsertMessage } from '../../utils/cache';
import { isImageFile } from '../../utils/labels';
import { putToS3 } from '../../utils/upload';

interface Pending {
  conversationId: string;
  text: string;
  files: File[];
  /** Id vé tải lên của từng tệp (null = chưa tải) — gửi lại không tải lại tệp đã lên kho. */
  uploadIds: (string | null)[];
  /** Blob URL xem trước ảnh đang gửi (thu hồi khi xong). */
  urls: string[];
}

const STARTUP_SOUND_KEY = 'officehub.chat-startup-sound';

/** Đã phát âm "có tin chưa đọc khi mở ứng dụng" trong phiên trình duyệt này chưa (sessionStorage; lỗi → coi như đã phát để khỏi lặp). */
function takeStartupSound(): boolean {
  try {
    if (sessionStorage.getItem(STARTUP_SOUND_KEY)) return false;
    sessionStorage.setItem(STARTUP_SOUND_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** Gửi kênh phòng lỗi → chờ rồi thử lại một lần: thành viên kênh do Realtime cấp nền khi bước vào phòng (OfficeRoomHub.Move), có thể chưa kịp. */
const ROOM_RETRY_MS = 1500;

/**
 * Giữ MỘT kết nối hub chat cho cả ứng dụng: bọc `MainLayout` và trang văn phòng 3D `/office` (toàn màn hình, TEST-125). Đã có
 * ChatProvider ở trên (vd sau này /office vào chung layout) → chỉ trả children, không mở kết nối thứ hai. Nhận tin đẩy → cập nhật cache
 * tin / danh sách hội thoại / số chưa đọc, phát âm khi tin của người khác tới mà hội thoại đó không đang mở. Gửi, thu hồi, đọc đi qua đây.
 */
export function ChatProvider({ children }: { children: ReactNode }) {
  const parent = useContext(ChatContext);
  if (parent) return <>{children}</>;
  return <ChatProviderRoot>{children}</ChatProviderRoot>;
}

function ChatProviderRoot({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [link, setLink] = useState<ChatLinkState>('connecting');
  const conn = useRef<ChatConnection | null>(null);
  const active = useRef<string | null>(null);
  const pending = useRef(new Map<string, Pending>());
  const seen = useRef(new Set<string>());
  const meRef = useRef({ id: me?.id ?? '', name: me?.fullName ?? '' });
  useEffect(() => { meRef.current = { id: me?.id ?? '', name: me?.fullName ?? '' }; }, [me?.id, me?.fullName]);

  const unread = useChatUnread();
  const unreadLoaded = qc.getQueryState(chatKeys.unread)?.status === 'success';
  const startupChecked = useRef(false);
  useEffect(() => {
    // Mở ứng dụng mà còn tin chưa đọc → phát âm đúng một lần cho phiên trình duyệt (badge hiện sẵn nhờ unread-count). Chỉ xét lần tải đầu.
    if (!unreadLoaded || startupChecked.current) return;
    startupChecked.current = true;
    if (unread > 0 && takeStartupSound()) playNotificationSound();
  }, [unreadLoaded, unread]);

  const markRead = useCallback((conversationId: string) => {
    const list = qc.getQueryData<IConversation[]>(chatKeys.conversations);
    const was = list?.find((c) => c.id === conversationId)?.unread ?? 0;
    if (list && was > 0) {
      qc.setQueryData<IConversation[]>(chatKeys.conversations, list.map((c) => (c.id === conversationId ? { ...c, unread: 0, mentionedUnread: 0 } : c)));
      adjustUnread(qc, -was);
    }
    bumpUnreadEpoch();
    const listAt = qc.getQueryState(chatKeys.conversations)?.dataUpdatedAt ?? 0;
    // Luôn lấy lại số tổng từ server sau khi đọc: badge có thể đang lệch (đọc ở tab / thiết bị khác). Danh sách được tải lại trong lúc
    // server chưa ghi "đã đọc" → dòng đó hiện lại số cũ → tải lại danh sách (TEST-110).
    chatApi.markRead(conversationId)
      .then(() => {
        bumpUnreadEpoch();
        void qc.invalidateQueries({ queryKey: chatKeys.unread });
        if ((qc.getQueryState(chatKeys.conversations)?.dataUpdatedAt ?? 0) > listAt) void qc.invalidateQueries({ queryKey: chatKeys.conversations });
      })
      .catch(() => undefined);
  }, [qc]);

  const setActive = useCallback((conversationId: string | null) => {
    active.current = conversationId;
    if (conversationId) markRead(conversationId);
  }, [markRead]);

  // Quay lại tab: đang mở hội thoại → coi như đã đọc các tin tới lúc tab ẩn; làm mới số tổng + danh sách để bắt các lần đọc
  // ở tab / thiết bị khác (không có sự kiện "đã đọc" qua hub) — TEST-110.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (active.current) markRead(active.current);
      void qc.invalidateQueries({ queryKey: chatKeys.unread });
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [markRead, qc]);

  /** Tin do hub đẩy (của người khác, hoặc của chính mình từ tab / thiết bị khác). */
  const onIncoming = useCallback((m: IChatMessage) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    if (seen.current.size > 500) seen.current = new Set([...seen.current].slice(-200));
    upsertMessage(qc, m);
    bumpUnreadEpoch();
    const mine = m.senderId === meRef.current.id;
    const viewing = active.current === m.conversationId && document.visibilityState === 'visible';
    const addUnread = !mine && !viewing;
    if (!touchConversation(qc, m, addUnread, mentionsUser(m, meRef.current.id))) void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    if (mine) return;
    if (viewing) markRead(m.conversationId);
    else {
      adjustUnread(qc, 1);
      playNotificationSound();
    }
  }, [qc, markRead]);

  /** Tin bị sửa / đổi cảm xúc (hub đẩy, hoặc kết quả thao tác của chính mình). */
  const onUpdated = useCallback((m: IMessage) => {
    if (!upsertMessage(qc, m)) return;
    const list = qc.getQueryData<IConversation[]>(chatKeys.conversations);
    // Sửa tin mới nhất → dòng xem trước trong danh sách đổi theo
    if (m.editedAt && list?.some((c) => c.id === m.conversationId && c.lastMessageAt === m.createdAt)) {
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    }
  }, [qc]);

  const onDeleted = useCallback((conversationId: string, messageId: string) => {
    markDeleted(qc, conversationId, messageId);
    void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    void qc.invalidateQueries({ queryKey: chatKeys.unread });
  }, [qc]);

  const onReconnected = useCallback(() => {
    // Có thể đã lỡ tin lúc mất kết nối: làm mới danh sách, số chưa đọc và mọi hội thoại đã tải (queryFn gộp vào cache cũ).
    void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    void qc.invalidateQueries({ queryKey: chatKeys.unread });
    void qc.invalidateQueries({ queryKey: [...chatKeys.all, 'messages'] });
  }, [qc]);

  const meId = me?.id;
  useEffect(() => {
    if (!meId) return;
    const c = new ChatConnection({
      message: onIncoming,
      deleted: onDeleted,
      updated: onUpdated,
      kicked: () => setLink('offline'),
      state: setLink,
      reconnected: onReconnected,
    });
    conn.current = c;
    // Hoãn một nhịp: StrictMode (dev) mount → cleanup → mount liền nhau, dừng giữa lúc bắt tay làm SignalR ghi lỗi giả
    const t = setTimeout(() => void c.start(), 0);
    return () => {
      clearTimeout(t);
      conn.current = null;
      void c.stop();
    };
  }, [meId, onIncoming, onDeleted, onUpdated, onReconnected]);

  const finishPending = useCallback((clientId: string) => {
    const p = pending.current.get(clientId);
    p?.urls.forEach((u) => URL.revokeObjectURL(u));
    pending.current.delete(clientId);
  }, []);

  const isRoom = useCallback((conversationId: string) => conversationId.startsWith('room:')
    || qc.getQueryData<IConversation[]>(chatKeys.conversations)?.find((c) => c.id === conversationId)?.type === 'Room', [qc]);

  const run = useCallback(async (clientId: string, attempt = 0): Promise<boolean> => {
    const p = pending.current.get(clientId);
    if (!p) return false;
    const { conversationId } = p;
    patchLocal(qc, conversationId, clientId, { status: 'sending', progress: 0, error: undefined });
    try {
      for (let i = 0; i < p.files.length; i++) {
        if (p.uploadIds[i]) continue;
        const ticket = await chatApi.upload(conversationId, p.files[i]);
        await putToS3(ticket, p.files[i], (r) => patchLocal(qc, conversationId, clientId, { progress: (i + r) / p.files.length }));
        p.uploadIds[i] = ticket.id;
      }
      const ids = p.uploadIds.filter((x): x is string => !!x);
      const text = p.text || null;
      // Đường chính: hub (server lưu rồi đẩy cho mọi người). Hub chưa kết nối → REST (tin vẫn được lưu, người khác thấy khi tải lại).
      const msg: IMessage = conn.current?.connected
        ? await conn.current.send(conversationId, text, ids, clientId)
        : (await chatApi.send(conversationId, text, ids, clientId)).message;
      seen.current.add(msg.id);
      // Gửi bằng bí danh ("office" / "room:<id>") → tin thật nằm ở cache theo Guid; gỡ bản lạc quan ở cache bí danh
      if (msg.conversationId !== conversationId) removeLocal(qc, conversationId, clientId);
      upsertMessage(qc, { ...msg, clientId: msg.clientId ?? clientId });
      if (!touchConversation(qc, msg, false)) void qc.invalidateQueries({ queryKey: chatKeys.conversations });
      finishPending(clientId);
      return true;
    } catch (e) {
      // Kênh phòng ngay sau khi bước vào: Realtime cấp thành viên chạy nền (OfficeRoomHub.Move) nên có thể chưa kịp → chờ rồi thử lại một lần
      if (attempt === 0 && isRoom(conversationId)) {
        await new Promise((r) => setTimeout(r, ROOM_RETRY_MS));
        if (pending.current.has(clientId)) return run(clientId, 1);
      }
      patchLocal(qc, conversationId, clientId, { status: 'failed', error: e instanceof ApiError ? errorMessage(e) : e instanceof Error ? e.message : 'Gửi không được, thử lại sau' });
      return false;
    }
  }, [qc, finishPending, isRoom]);

  const send = useCallback((conversationId: string, text: string, files: File[]) => {
    const clientId = crypto.randomUUID();
    const urls: string[] = [];
    const attachments = files.map((f, i) => {
      const isImage = isImageFile(f);
      const url = isImage ? URL.createObjectURL(f) : '';
      if (url) urls.push(url);
      return { id: `local-${clientId}-${i}`, fileName: f.name, contentType: f.type, size: f.size, isImage, url };
    });
    pending.current.set(clientId, { conversationId, text, files, uploadIds: files.map(() => null), urls });
    addLocal(qc, {
      id: `local-${clientId}`, seq: Number.MAX_SAFE_INTEGER, conversationId, senderId: meRef.current.id, senderName: meRef.current.name,
      text: text || null, createdAt: new Date().toISOString(), deleted: false, attachments, clientId,
      local: { status: 'sending', progress: 0 },
    });
    return run(clientId);
  }, [qc, run]);

  const retry = useCallback((_conversationId: string, clientId: string) => void run(clientId, 1), [run]);

  const discard = useCallback((conversationId: string, clientId: string) => {
    removeLocal(qc, conversationId, clientId);
    finishPending(clientId);
  }, [qc, finishPending]);

  const recall = useCallback(async (m: IMessage) => {
    try {
      if (conn.current?.connected) await conn.current.remove(m.id);
      else await chatApi.remove(m.id);
      markDeleted(qc, m.conversationId, m.id);
      void qc.invalidateQueries({ queryKey: chatKeys.conversations });
    } catch (e) {
      toast.error(e instanceof ApiError ? errorMessage(e) : e instanceof Error ? e.message : 'Không thu hồi được tin nhắn');
    }
  }, [qc]);

  const edit = useCallback(async (m: IMessage, text: string) => {
    try {
      const saved: IMessage = conn.current?.connected ? await conn.current.edit(m.id, text) : (await chatApi.edit(m.id, text)).message;
      onUpdated(saved);
      return true;
    } catch (e) {
      toast.error(e instanceof ApiError ? errorMessage(e) : e instanceof Error ? e.message : 'Không sửa được tin nhắn');
      return false;
    }
  }, [onUpdated]);

  const react = useCallback((m: IMessage, emoji: string) => {
    void (async () => {
      try {
        const saved: IMessage = conn.current?.connected ? await conn.current.react(m.id, emoji) : (await chatApi.react(m.id, emoji)).message;
        onUpdated(saved);
      } catch (e) {
        toast.error(e instanceof ApiError ? errorMessage(e) : e instanceof Error ? e.message : 'Không thả được cảm xúc');
      }
    })();
  }, [onUpdated]);

  const value = useMemo<IChatContext>(() => ({ link, setActive, send, retry, discard, recall, edit, react, markRead }),
    [link, setActive, send, retry, discard, recall, edit, react, markRead]);
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}
