using Microsoft.Extensions.Caching.Hybrid;
using Microsoft.Extensions.DependencyInjection;

namespace OfficeHub.BuildingBlocks.Caching;

/// <summary>
/// Cache phía server dùng chung (TEST-244): <see cref="HybridCache"/> CHỈ L1 trong RAM của tiến trình — chưa đăng ký
/// <c>IDistributedCache</c> (Redis là bước B3). Module gọi <see cref="AddOfficeHubCache"/> trong <c>Register</c> (gọi nhiều lần không sao)
/// rồi dùng qua lớp / interface của chính module, không chia sẻ khoá cache giữa các module.
/// ⚠ Xoá cache chỉ có hiệu lực trong tiến trình hiện tại: chạy ≥ 2 bản Api thì phải làm B3 (L2 + phát lệnh xoá sang bản khác) trước.
/// </summary>
public static class CachingExtensions
{
    /// <summary>Hạn mặc định của một mục cache khi module không đặt riêng.</summary>
    public static readonly TimeSpan DefaultExpiration = TimeSpan.FromMinutes(1);

    public static IServiceCollection AddOfficeHubCache(this IServiceCollection services)
    {
        if (services.Any(d => d.ServiceType == typeof(OfficeHubCacheMarker))) return services;
        services.AddSingleton<OfficeHubCacheMarker>();
        services.AddHybridCache(o =>
        {
            o.DefaultEntryOptions = new HybridCacheEntryOptions
            {
                Expiration = DefaultExpiration,
                LocalCacheExpiration = DefaultExpiration,
                Flags = HybridCacheEntryFlags.DisableDistributedCache, // chỉ RAM, kể cả khi sau này có ai đăng ký IDistributedCache
            };
        });
        return services;
    }

    private sealed class OfficeHubCacheMarker;
}
