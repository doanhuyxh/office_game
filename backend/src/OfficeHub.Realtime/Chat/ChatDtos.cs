namespace OfficeHub.Realtime.Chat;

// ---- Phản hồi của OfficeHub.Api (JSON camelCase) ----
public sealed record ApiAttachmentDto(Guid Id, string FileName, string ContentType, long Size, bool IsImage, string Url);
public sealed record ApiReactionDto(string Emoji, Guid[]? UserIds);
public sealed record ApiMentionDto(Guid UserId, string Code, string Name);
public sealed record ApiMessageDto(Guid Id, long Seq, Guid ConversationId, Guid SenderId, string SenderName, string? Text, string CreatedAt,
    bool Deleted, ApiAttachmentDto[]? Attachments, string? ClientId, bool ByBot = false, string? EditedAt = null, ApiReactionDto[]? Reactions = null,
    ApiMentionDto[]? Mentions = null);
/// <summary>Recipients null = kênh Office (mọi người đang online).</summary>
public sealed record SendResultDto(ApiMessageDto Message, string ConversationType, string? RoomId, string? RoomName, Guid[]? Recipients);
public sealed record DeleteResultDto(Guid ConversationId, Guid MessageId, string ConversationType, string? RoomId, Guid[]? Recipients);

// ---- Dữ liệu gửi qua SignalR (MessagePack) cho client chat ----
public sealed record ChatAttachmentDto(string Id, string FileName, string ContentType, long Size, bool IsImage, string Url);

/// <summary>Một loại emoji trên tin + ai đã thả.</summary>
public sealed record ChatReactionDto(string Emoji, string[] UserIds);

/// <summary>Người được @nhắc trong tin (TEST-70): client thay "@Code" bằng tên, tô nổi; UserId = mình → nhấn tin.</summary>
public sealed record ChatMentionDto(string UserId, string Code, string Name);

/// <summary>
/// ConversationType = "Office" | "Room" | "Direct" | "Group" (RoomId / RoomName chỉ có với "Room"). CreatedAt / EditedAt = ISO 8601 UTC 'Z'
/// (EditedAt null = chưa sửa).
/// </summary>
public sealed record ChatMessageDto(string Id, long Seq, string ConversationId, string ConversationType, string? RoomId, string? RoomName,
    string SenderId, string SenderName, string? Text, string CreatedAt, bool Deleted, ChatAttachmentDto[] Attachments, string? ClientId,
    bool ByBot = false, string? EditedAt = null, ChatReactionDto[]? Reactions = null, ChatMentionDto[]? Mentions = null);

/// <summary>Các hàm server gọi xuống client chat.</summary>
public interface IChatClient
{
    Task Message(ChatMessageDto message);
    Task MessageDeleted(string conversationId, string messageId);
    /// <summary>Tin đã có bị sửa nội dung hoặc đổi cảm xúc — client thay tin cùng id.</summary>
    Task MessageUpdated(ChatMessageDto message);
    Task Kicked(string reason);
}
