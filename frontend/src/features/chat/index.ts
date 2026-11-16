// Public API của module Tin nhắn (chat).
export { ChatProvider } from './components/chat-provider';
export { ChatButton } from './components/chat-button';
export { ConversationList, ConversationIcon } from './components/conversation-list';
export { MessagePane, type MessagePaneExtras } from './components/message-pane';
export { NewChatDialog } from './components/new-chat-dialog';
export { useChatPeer, useChatUnread, useConversations, useMessages } from './hooks/useChatData';
export { useChat } from './hooks/useChat';
export type { IncomingListener } from './context/chat-context';
export type { IChatMessage, IConversation, IMessage, ConversationType } from './types/chat.types';
