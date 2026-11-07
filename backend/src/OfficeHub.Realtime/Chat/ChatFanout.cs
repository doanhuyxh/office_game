using Microsoft.AspNetCore.SignalR;
using OfficeHub.Realtime.Hubs;
using OfficeHub.Realtime.Simulation;

namespace OfficeHub.Realtime.Chat;

/// <summary>
/// Sau khi Api lưu tin / thu hồi tin: phát cho client chat (theo danh sách người nhận Api trả về) và cho HUD chat của văn phòng 3D
/// (Office → mọi người trong 3D; Room → chỉ người đang đứng trong phòng đó; Direct → không).
/// </summary>
public sealed class ChatFanout(IHubContext<ChatHub, IChatClient> chat, IHubContext<OfficeRoomHub, IOfficeClient> office, Presence presence, OfficeMap map)
{
    public async Task<ChatMessageDto> PublishMessageAsync(SendResultDto result)
    {
        var dto = ChatRouting.ToHubMessage(result);
        var groups = ChatRouting.Groups(result.Recipients, dto.SenderId);
        await (groups is null ? chat.Clients.Group(ChatRouting.AllGroup) : chat.Clients.Groups(groups)).Message(dto);

        if (ChatRouting.ToOfficeChat(dto) is { } line)
        {
            if (dto.ConversationType == "Office")
                await office.Clients.Group(OfficeRoomHub.OfficeGroup).Chat(line);
            else if (dto.RoomId is { } roomId)
            {
                var targets = presence.All.Where(o => map.WallRoomOf(o)?.Id == roomId).Select(o => o.ConnectionId).ToList();
                if (targets.Count > 0) await office.Clients.Clients(targets).Chat(line);
            }
        }
        return dto;
    }

    /// <summary>Thu hồi tin: chỉ báo client chat (HUD 3D không có tin cũ để gỡ).</summary>
    public Task PublishDeletedAsync(DeleteResultDto result, string actorUserId)
    {
        var groups = ChatRouting.Groups(result.Recipients, actorUserId);
        return (groups is null ? chat.Clients.Group(ChatRouting.AllGroup) : chat.Clients.Groups(groups))
            .MessageDeleted(result.ConversationId.ToString(), result.MessageId.ToString());
    }
}
