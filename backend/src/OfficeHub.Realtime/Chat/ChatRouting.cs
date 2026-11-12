using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Realtime.Hubs;

namespace OfficeHub.Realtime.Chat;

/// <summary>Hàm thuần: chọn người nhận và đổi định dạng tin (dễ test, không đụng SignalR).</summary>
public static class ChatRouting
{
    public const string AllGroup = "all";

    /// <summary>Group SignalR của một tài khoản (mọi kết nối chat của người đó).</summary>
    public static string UserGroup(string userId) => "u:" + (Guid.TryParse(userId, out var g) ? g.ToString() : userId);

    /// <summary>
    /// Các group nhận tin: null = mọi kết nối chat (kênh Office). Ngược lại là group của từng người nhận (bỏ trùng) + LUÔN có người gửi
    /// (để các tab khác của người gửi cũng thấy).
    /// </summary>
    public static IReadOnlyList<string>? Groups(IReadOnlyCollection<Guid>? recipients, string senderId)
    {
        if (recipients is null) return null;
        var set = new HashSet<string>(StringComparer.Ordinal) { UserGroup(senderId) };
        foreach (var r in recipients) set.Add(UserGroup(r.ToString()));
        return set.ToList();
    }

    public static ChatMessageDto ToHubMessage(SendResultDto r)
    {
        var m = r.Message;
        return new ChatMessageDto(m.Id.ToString(), m.Seq, m.ConversationId.ToString(), r.ConversationType, r.RoomId, r.RoomName,
            m.SenderId.ToString(), m.SenderName, m.Text, Iso(m.CreatedAt), m.Deleted,
            (m.Attachments ?? []).Select(a => new ChatAttachmentDto(a.Id.ToString(), a.FileName, a.ContentType, a.Size, a.IsImage, a.Url)).ToArray(),
            m.ClientId, m.ByBot, m.EditedAt is null ? null : Iso(m.EditedAt),
            (m.Reactions ?? []).Select(x => new ChatReactionDto(x.Emoji, (x.UserIds ?? []).Select(u => u.ToString()).ToArray())).ToArray());
    }

    /// <summary>Tin hiện trong HUD chat của văn phòng 3D: chỉ kênh Office / Room, bỏ tin đã thu hồi (null = không gửi vào 3D).</summary>
    public static ChatDto? ToOfficeChat(ChatMessageDto m)
    {
        if (m.Deleted) return null;
        var room = m.ConversationType == "Room";
        if (!room && m.ConversationType != "Office") return null;
        var text = OfficeText(m);
        if (text.Length == 0) return null;
        return new ChatDto(m.SenderId, m.SenderName, text, m.CreatedAt, room ? "room" : "office", room ? m.RoomId : null, room ? m.RoomName : null);
    }

    /// <summary>Nội dung cho HUD 3D (chỉ có chữ): tin chỉ có tệp → "[Ảnh] tên" / "[Tệp] tên".</summary>
    public static string OfficeText(ChatMessageDto m) =>
        !string.IsNullOrWhiteSpace(m.Text) ? m.Text
        : string.Join(", ", m.Attachments.Select(a => (a.IsImage ? "[Ảnh] " : "[Tệp] ") + a.FileName));

    private static string Iso(string s) => Instants.TryParse(s, out var t) ? Instants.Format(t) : s;
}
