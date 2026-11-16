// Public API của module Tin nhắn (chat).
export { ChatProvider } from './components/chat-provider';
export { ChatButton } from './components/chat-button';
export { useChatUnread, useConversations, useMessages } from './hooks/useChatData';
export { useChat } from './hooks/useChat';
export type { IConversation, IMessage, ConversationType } from './types/chat.types';
