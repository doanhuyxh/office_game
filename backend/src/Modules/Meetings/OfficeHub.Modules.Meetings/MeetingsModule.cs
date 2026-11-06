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

/// <summary>Đặt phòng họp (phòng lấy từ bản đồ văn phòng 3D): lịch, chặn trùng giờ, mời người (chuông + email), huỷ.</summary>
public sealed class MeetingsModule : IModule
{
    public string Name => "meetings";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<MeetingsDbContext>(config, MeetingsDbContext.Schema);
        services.AddSingleton<MeetingRooms>();
        services.AddHostedService<MeetingsMigrator>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api) =>
        BookingEndpoints.Map(api.MapGroup("/meetings").WithTags("Meetings").RequireAuthorization());
}
