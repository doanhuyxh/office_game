using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Features;

/// <summary>Type = Office | Room | Direct. Title: "Toàn văn phòng" / tên phòng / tên người đối diện (Direct).</summary>
public sealed record ConversationDto(Guid Id, ConversationType Type, string Title, string? RoomId, Guid? PeerUserId,
    DateTimeOffset? LastMessageAt, string? LastPreview, int Unread);

public sealed record PersonDto(Guid UserId, string FullName, string Code, string? DepartmentName);

/// <summary>Url = link presigned (hạn <see cref="ChatRules.AttachmentUrlTtl"/>): ảnh xem trong trình duyệt, tệp khác tải về.</summary>
public sealed record AttachmentDto(Guid Id, string FileName, string ContentType, long Size, bool IsImage, string Url);

/// <summary>Tin đã thu hồi: Deleted = true, Text = null, Attachments rỗng (nội dung vẫn nằm trong DB nhưng không ai xem được).</summary>
public sealed record MessageDto(Guid Id, long Seq, Guid ConversationId, Guid SenderId, string SenderName, string? Text,
    DateTimeOffset CreatedAt, bool Deleted, IReadOnlyList<AttachmentDto> Attachments, string? ClientId);

public sealed record MessagePageDto(IReadOnlyList<MessageDto> Items, bool HasMore);

/// <summary>Recipients = null → mọi người (kênh Office); ngược lại danh sách tài khoản nhận (Direct: hai người; Room: thành viên). Realtime dùng để phát.</summary>
public sealed record SendResultDto(MessageDto Message, ConversationType ConversationType, string? RoomId, string? RoomName, IReadOnlyList<Guid>? Recipients);

public sealed record DeleteResultDto(Guid ConversationId, Guid MessageId, ConversationType ConversationType, string? RoomId, IReadOnlyList<Guid>? Recipients);

public sealed record SendRequest(string? Text, List<Guid>? UploadIds, string? ClientId);

public sealed record DirectRequest(Guid UserId);

/// <summary>ConversationId = Guid, "office" hoặc "room:&lt;id phòng&gt;".</summary>
public sealed record UploadRequest(string? ConversationId, string? FileName, string? ContentType, long Size);

public sealed record UploadTicketDto(Guid Id, string Url, string ContentType, DateTimeOffset ExpiresAt);

public sealed record UnreadDto(int Count);

public sealed record UrlDto(string Url);

public sealed record JoinRoomRequest(Guid UserId);
