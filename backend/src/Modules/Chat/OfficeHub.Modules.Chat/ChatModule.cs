using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Chat.Features;
using OfficeHub.Modules.Chat.Infrastructure;

namespace OfficeHub.Modules.Chat;

/// <summary>
/// Tin nhắn: kênh toàn văn phòng, kênh nhóm theo phòng có tường (như văn phòng 3D) và chat 1-1; lưu vĩnh viễn (xoá mềm), đính kèm ảnh / tệp
/// (S3, thư mục <c>chat/</c>). Phát realtime do hub Realtime (<c>ChatHub</c>) đảm nhiệm — module này là nguồn sự thật và kiểm tra quyền.
/// </summary>
public sealed class ChatModule : IModule
{
    public string Name => "chat";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<ChatDbContext>(config, ChatDbContext.Schema);
        services.AddValidatedOptions<ChatSettings>(config, ChatSettings.Section);
        services.AddSingleton<ChatRooms>();
        services.AddSingleton<ChatThrottle>();
        services.AddScoped<ChatStore>();
        services.AddHostedService<ChatMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/chat").WithTags("Chat");
        ChatEndpoints.Map(g.MapGroup("").RequireAuthorization());
        // Body nhỏ (roomId + userId): giới hạn 16 KB — đường này chỉ gọi trong mạng Docker, nginx chặn từ ngoài (TEST-18)
        InternalEndpoints.Map(g.MapGroup("/internal").AllowAnonymous().WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(16 * 1024)));
    }
}
