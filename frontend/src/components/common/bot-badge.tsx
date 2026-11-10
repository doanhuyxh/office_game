import { Bot } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * Nhãn "BOT": dữ liệu được tạo / sửa qua token AI (MCP) — chủ dự án chốt 2026-11-10: mọi thay đổi qua MCP đều là BOT.
 * Gắn cạnh tên người (bình luận, lịch sử, người tạo…). Back-end quyết định cờ (ByBot / CreatedByBot), FE chỉ hiển thị.
 */
export function BotBadge({ className }: { className?: string }) {
  return (
    <span title="Thực hiện qua trợ lý AI (MCP)" data-testid="bot-badge"
      className={cn('inline-flex items-center gap-0.5 rounded bg-info/15 px-1 py-px align-middle text-[10px] font-semibold leading-none text-info', className)}>
      <Bot className="size-3" /> BOT
    </span>
  );
}
