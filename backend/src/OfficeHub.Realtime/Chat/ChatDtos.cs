namespace OfficeHub.Realtime.Chat;

// ---- Phản hồi của OfficeHub.Api (JSON camelCase) ----
public sealed record ApiAttachmentDto(Guid Id, string FileName, string ContentType, long Size, bool IsImage, string Url);
public sealed record ApiMessageDto(Guid Id, long Seq, Guid ConversationId, Guid SenderId, string SenderName, string? Text, string CreatedAt,
    bool Deleted, ApiAttachmentDto[]? Attachments, string? ClientId);
/// <summary>Recipients null = kênh Office (mọi người đang online).</summary>
public sealed record SendResultDto(ApiMessageDto Message, string ConversationType, string? RoomId, string? RoomName, Guid[]? Recipients);
public sealed record DeleteResultDto(Guid ConversationId, Guid MessageId, string ConversationType, string? RoomId, Guid[]? Recipients);

// ---- Dữ liệu gửi qua SignalR (MessagePack) cho client chat ----
public sealed record ChatAttachmentDto(string Id, string FileName, string ContentType, long Size, bool IsImage, string Url);

/// <summary>ConversationType = "Office" | "Room" | "Direct" (RoomId / RoomName chỉ có với "Room"). CreatedAt = ISO 8601 UTC 'Z'.</summary>
public sealed record ChatMessageDto(string Id, long Seq, string ConversationId, string ConversationType, string? RoomId, string? RoomName,
    string SenderId, string SenderName, string? Text, string CreatedAt, bool Deleted, ChatAttachmentDto[] Attachments, string? ClientId);

/// <summary>Các hàm server gọi xuống client chat.</summary>
public interface IChatClient
{
    Task Message(ChatMessageDto message);
    Task MessageDeleted(string conversationId, string messageId);
    Task Kicked(string reason);
}
