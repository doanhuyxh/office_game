using OfficeHub.Modules.Chat.Domain;

namespace OfficeHub.Modules.Chat.Features;

/// <summary>Type = Office | Room | Direct | Group. Title: "Toàn văn phòng" / tên phòng / tên người đối diện (Direct) / tên nhóm (Group).</summary>
/// <param name="MentionedUnread">Số tin chưa đọc có @nhắc tới tôi (TEST-70) — FE hiện "@", bot (list_chats) ưu tiên đọc.</param>
/// <param name="PeerIsBot">Direct với tài khoản bot (AI) — FE nhắc "tin nhắn được gửi tới trợ lý AI bên ngoài".</param>
public sealed record ConversationDto(Guid Id, ConversationType Type, string Title, string? RoomId, Guid? PeerUserId,
    DateTimeOffset? LastMessageAt, string? LastPreview, int Unread, bool PeerIsBot = false, int MentionedUnread = 0);

/// <summary>Thành viên nhóm (Group). IsCreator = người tạo nhóm.</summary>
public sealed record GroupMemberDto(Guid UserId, string FullName, string? Code, bool IsCreator);

/// <summary>Một loại emoji trên tin: ai đã thả (client tự xét "của tôi").</summary>
public sealed record ReactionDto(string Emoji, IReadOnlyList<Guid> UserIds);

/// <summary>Người được @nhắc trong tin (TEST-70): FE thay "@Code" bằng tên (tô nổi). Người đã nghỉ việc không còn trong danh sách → hiện chữ thường.</summary>
public sealed record MentionDto(Guid UserId, string Code, string Name);

/// <summary>Gợi ý khi gõ @ trong ô soạn tin: thành viên hội thoại đang làm việc (Office: mọi nhân viên).</summary>
public sealed record MentionCandidateDto(Guid UserId, string FullName, string Code, bool IsBot, string? AvatarUrl);

public sealed record PersonDto(Guid UserId, string FullName, string Code, string? DepartmentName);

/// <summary>Url = link presigned (hạn <see cref="ChatRules.AttachmentUrlTtl"/>): ảnh xem trong trình duyệt, tệp khác tải về.</summary>
public sealed record AttachmentDto(Guid Id, string FileName, string ContentType, long Size, bool IsImage, string Url);

/// <summary>Tin đã thu hồi: Deleted = true, Text = null, Attachments rỗng (nội dung vẫn nằm trong DB nhưng không ai xem được).</summary>
public sealed record MessageDto(Guid Id, long Seq, Guid ConversationId, Guid SenderId, string SenderName, string? Text,
    DateTimeOffset CreatedAt, bool Deleted, IReadOnlyList<AttachmentDto> Attachments, string? ClientId, bool ByBot = false,
    DateTimeOffset? EditedAt = null, IReadOnlyList<ReactionDto>? Reactions = null, IReadOnlyList<MentionDto>? Mentions = null);

public sealed record MessagePageDto(IReadOnlyList<MessageDto> Items, bool HasMore);

/// <summary>
/// Kết quả gửi / sửa / thả cảm xúc (Realtime phát cho người nhận: gửi → <c>Message</c>, sửa / cảm xúc → <c>MessageUpdated</c>).
/// Recipients = null → mọi người (kênh Office); ngược lại danh sách tài khoản nhận (Direct: hai người; Room: thành viên). Realtime dùng để phát.</summary>
public sealed record SendResultDto(MessageDto Message, ConversationType ConversationType, string? RoomId, string? RoomName, IReadOnlyList<Guid>? Recipients);

public sealed record DeleteResultDto(Guid ConversationId, Guid MessageId, ConversationType ConversationType, string? RoomId, IReadOnlyList<Guid>? Recipients);

public sealed record SendRequest(string? Text, List<Guid>? UploadIds, string? ClientId);

public sealed record EditRequest(string? Text);

public sealed record ReactRequest(string? Emoji);

public sealed record GroupRequest(string? Title, List<Guid>? UserIds);

public sealed record MembersRequest(List<Guid>? UserIds);

public sealed record DirectRequest(Guid UserId);

/// <summary>ConversationId = Guid, "office" hoặc "room:&lt;id phòng&gt;".</summary>
public sealed record UploadRequest(string? ConversationId, string? FileName, string? ContentType, long Size);

public sealed record UploadTicketDto(Guid Id, string Url, string ContentType, DateTimeOffset ExpiresAt);

public sealed record UnreadDto(int Count);

public sealed record UrlDto(string Url);

public sealed record JoinRoomRequest(Guid UserId);
