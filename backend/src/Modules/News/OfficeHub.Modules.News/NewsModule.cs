using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auth;
using OfficeHub.BuildingBlocks.Modules;
using OfficeHub.BuildingBlocks.Persistence;
using OfficeHub.Modules.News.Features;
using OfficeHub.Modules.News.Infrastructure;

namespace OfficeHub.Modules.News;

/// <summary>
/// Bảng tin nội bộ kiểu mạng xã hội: ai cũng đăng bài (soạn thảo rich-text, ảnh / video / tệp ở S3 thư mục <c>feed/</c>), chọn phạm vi người xem
/// (toàn công ty / phòng ban / danh sách riêng / chỉ mình), bình luận, cảm xúc, @nhắc; tác giả có thể chọn gửi email khi đăng.
/// </summary>
public sealed class NewsModule : IModule
{
    public string Name => "news";

    public void Register(IServiceCollection services, IConfiguration config)
    {
        services.AddModuleDbContext<NewsDbContext>(config, NewsDbContext.Schema);
        services.AddSingleton<HtmlCleaner>();
        services.AddSingleton<NewsThrottle>();
        services.AddScoped<NewsStore>();
        services.AddHostedService<NewsMigrator>();
        services.AddHostedService<NewsScheduler>();
    }

    public void MapEndpoints(IEndpointRouteBuilder api)
    {
        var g = api.MapGroup("/news").WithTags("News").RequireAuthorization();
        PostEndpoints.Map(g);
        CommentEndpoints.Map(g);
        MiscEndpoints.Map(g);
        AdminEndpoints.Map(g.MapGroup("/admin").RequireAuthorization(AuthPolicies.Hr));
    }
}
