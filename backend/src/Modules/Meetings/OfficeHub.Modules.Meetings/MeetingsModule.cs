using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.Meetings.Features;
using OfficeHub.Modules.Meetings.Infrastructure;

namespace OfficeHub.Modules.Meetings;

/// <summary>Đặt phòng họp (phòng lấy từ bản đồ văn phòng 3D): lịch, chặn trùng giờ, mời người (chuông + email), huỷ; phiên họp agent trong phòng họp.</summary>
public sealed class MeetingsModule : IModule
{
    public string Name => "meetings";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<MeetingsDbContext>(config, MeetingsDbContext.Schema);
        services.AddSingleton<MeetingRooms>();
        services.AddHostedService<MeetingsMigrator>();
        services.AddHostedService<AgentMeetingExpiryJob>();
        services.AddScoped<AgentMeetingTurnService>();
        services.AddScoped<OfficeHub.Modules.Meetings.Contracts.IAgentMeetingTurns>(sp => sp.GetRequiredService<AgentMeetingTurnService>());
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/meetings").WithTags("Meetings").RequireAuthorization();
        BookingEndpoints.Map(g);
        AgentMeetingEndpoints.Map(g); // /sessions — phiên họp agent (TEST-74); /agent-settings — trần lượt / phút, chỉ admin
        // Realtime hỏi phiên đang họp để bot đi vào phòng (TEST-76) — khoá nội bộ, không cookie; nginx chặn từ ngoài
        AgentMeetingLiveEndpoints.Map(api.MapGroup("/meetings/internal").WithTags("Meetings").AllowAnonymous()
            .WithMetadata(new Microsoft.AspNetCore.Mvc.RequestSizeLimitAttribute(16 * 1024)));
    }
}
