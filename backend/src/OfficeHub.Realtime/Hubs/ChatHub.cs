using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.Realtime.Auth;
using OfficeHub.Realtime.Chat;

namespace OfficeHub.Realtime.Hubs;

/// <summary>
/// Hub tin nhắn cho toàn bộ web (không cần đang ở văn phòng 3D). Một tài khoản có thể có nhiều kết nối (tab / thiết bị).
/// Realtime không lưu gì: Send / Delete gọi Api bằng cookie của chính kết nối rồi phát lại theo người nhận Api trả về.
/// </summary>
[Authorize]
public sealed class ChatHub(ChatConnections connections, SessionValidator sessions, ChatApi api, ChatFanout fanout, ILogger<ChatHub> log) : Hub<IChatClient>
{
    public const string Path = "/rt/hub/chat";

    private string UserId => Context.UserIdentifier ?? throw new HubException("unauthorized");

    public override async Task OnConnectedAsync()
    {
        if (Context.User?.HasClaim(ClaimNames.MustChangePassword, "true") == true || Context.User?.MustSetup() == true)
        {
            Context.Abort();
            return;
        }
        var authCookie = SessionValidator.AuthCookieHeader(Context.GetHttpContext()?.Request.Headers.Cookie.ToString());
        if (await sessions.CheckAsync(authCookie, Context.ConnectionAborted) == SessionState.Invalid)
        {
            await Clients.Caller.Kicked(SessionWatch.ExpiredReason);
            Context.Abort();
            return;
        }
        connections.Add(Context.ConnectionId, new ChatConnection(UserId, authCookie, Context));
        await Groups.AddToGroupAsync(Context.ConnectionId, ChatRouting.AllGroup);
        await Groups.AddToGroupAsync(Context.ConnectionId, ChatRouting.UserGroup(UserId));
        log.LogDebug("{User} mở kết nối chat", UserId);
    }

    public override Task OnDisconnectedAsync(Exception? exception)
    {
        connections.Remove(Context.ConnectionId);
        return Task.CompletedTask;
    }

    /// <summary>
    /// Gửi tin. <paramref name="conversationId"/> = Guid hội thoại, "office" hoặc "room:&lt;id phòng&gt;". <paramref name="uploadIds"/> = id vé tải lên
    /// (Api xác nhận file đã nằm trên S3). Trả về tin đã lưu cho người gửi; tin cũng được phát tới mọi kết nối của người nhận (kể cả người gửi → client lọc trùng theo id / clientId).
    /// </summary>
    public async Task<ChatMessageDto> Send(string conversationId, string? text, string[]? uploadIds, string? clientId)
    {
        var uploads = new List<Guid>();
        foreach (var raw in uploadIds ?? [])
            uploads.Add(Guid.TryParse(raw, out var g) ? g : throw new HubException("Tệp đính kèm không hợp lệ"));
        var result = await api.SendAsync(Cookie(), conversationId, text, uploads, clientId, Context.ConnectionAborted);
        return await fanout.PublishMessageAsync(result);
    }

    /// <summary>Thu hồi tin của chính mình (xoá mềm) → mọi người nhận <c>MessageDeleted</c>.</summary>
    public async Task Delete(string messageId)
    {
        if (!Guid.TryParse(messageId, out var id)) throw new HubException("Tin nhắn không hợp lệ");
        var result = await api.DeleteAsync(Cookie(), id, Context.ConnectionAborted);
        await fanout.PublishDeletedAsync(result, UserId);
    }

    private string Cookie() =>
        connections.TryGet(Context.ConnectionId, out var c) && c.AuthCookie is { } cookie ? cookie : throw new HubException(SessionWatch.ExpiredReason);
}
