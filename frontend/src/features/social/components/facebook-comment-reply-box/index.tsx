import { useState } from 'react';
import { toast } from 'sonner';
import { MessageInput } from '@/components/common/message-input';
import { errorMessage } from '@/utils/errors';
import { useFacebookReply } from '../../hooks/useFacebook';

/** Giới hạn của back-end (`SocialRules.MaxReplyLength`). */
const MAX_REPLY = 8000;

/**
 * Ô trả lời bình luận dưới tên Trang (TEST-212): một dòng tự giãn, Enter gửi / Shift+Enter xuống dòng, nút Gửi có `loading`. Back-end kiểm tra nội
 * dung, quyền, token và chặn bấm trùng 30 giây; lỗi → toast kèm lý do (giữ nguyên chữ đã gõ).
 */
export function FacebookCommentReplyBox({ pageId, postId, commentId, replyTo, onSent }: {
  pageId: string; postId: string; commentId: string; replyTo: string; onSent?: () => void;
}) {
  const [text, setText] = useState('');
  const send = useFacebookReply(pageId, postId, commentId);
  const submit = async () => {
    try {
      await send.mutateAsync(text.trim());
      setText('');
      onSent?.();
    } catch (e) { toast.error(errorMessage(e)); }
  };
  return (
    <MessageInput value={text} onChange={setText} onSubmit={() => void submit()} pending={send.isPending} maxLength={MAX_REPLY} autoFocus
      placeholder={`Trả lời ${replyTo} dưới tên Trang…`} ariaLabel={`Trả lời ${replyTo}`} sendLabel="Gửi trả lời"
      inputTestId="comment-reply-input" sendTestId="comment-reply-send" />
  );
}
