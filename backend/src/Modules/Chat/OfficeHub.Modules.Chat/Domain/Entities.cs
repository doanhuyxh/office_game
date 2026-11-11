using System.Text.Json.Serialization;

namespace OfficeHub.Modules.Chat.Domain;

/// <summary>Trả ra API dạng chuỗi ("Office" / "Room" / "Direct").</summary>
[JsonConverter(typeof(JsonStringEnumConverter<ConversationType>))]
public enum ConversationType { Office, Room, Direct }

/// <summary>
/// Hội thoại. Office = kênh toàn văn phòng (đúng một dòng); Room = kênh nhóm của một phòng có tường (RoomId = id trong shared/office-map.json,
/// chỉ thành viên mới xem được); Direct = chat 1-1 (UserLowId &lt; UserHighId để mỗi cặp chỉ có một hội thoại).
/// LastSeq / LastMessageAt / LastPreview là bản sao để liệt kê hội thoại không phải quét bảng tin nhắn.
/// </summary>
public sealed class Conversation
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public ConversationType Type { get; set; }
    public string? RoomId { get; set; }
    public Guid? UserLowId { get; set; }
    public Guid? UserHighId { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public long LastSeq { get; set; }
    public DateTimeOffset? LastMessageAt { get; set; }
    public string? LastPreview { get; set; }
}

/// <summary>Người đã từng ở trong phòng (do Realtime báo) → được xem / nhắn kênh phòng đó trên web.</summary>
public sealed class RoomMember
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset JoinedAt { get; set; }
}

/// <summary>Tin nhắn. Thu hồi = đặt <see cref="DeletedAt"/> (xoá mềm, giữ nội dung và file). Seq tăng dần toàn bảng, dùng làm con trỏ cuộn lịch sử.</summary>
public sealed class Message
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public long Seq { get; set; }
    public Guid ConversationId { get; set; }
    public Guid SenderId { get; set; }
    public required string SenderName { get; set; }
    public string? Text { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset? DeletedAt { get; set; }
    /// <summary>Id do client sinh để khử trùng khi gửi lại (cùng hội thoại + người gửi + ClientId chỉ lưu một lần).</summary>
    public string? ClientId { get; set; }
    /// <summary>Gửi bằng token AI (chỉ tài khoản bot, qua MCP) → hiện nhãn BOT.</summary>
    public bool ByBot { get; set; }
    public List<MessageAttachment> Attachments { get; set; } = [];
}

public sealed class MessageAttachment
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid MessageId { get; set; }
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public bool IsImage { get; set; }
}

/// <summary>Đã đọc đến tin <see cref="LastReadSeq"/> của hội thoại. Không có dòng: Office = coi như đã đọc hết (khởi tạo khi xem lần đầu), còn lại = chưa đọc gì.</summary>
public sealed class ReadState
{
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public long LastReadSeq { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

/// <summary>Vé tải lên: file đã xin presigned PUT nhưng chưa gắn vào tin nhắn nào.</summary>
public sealed class UploadTicket
{
    public Guid Id { get; set; } = Guid.CreateVersion7();
    public Guid ConversationId { get; set; }
    public Guid UserId { get; set; }
    public required string FileKey { get; set; }
    public required string FileName { get; set; }
    public required string ContentType { get; set; }
    public long Size { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}
