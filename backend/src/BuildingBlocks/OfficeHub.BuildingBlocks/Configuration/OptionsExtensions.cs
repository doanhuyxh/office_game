using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;

namespace OfficeHub.BuildingBlocks.Configuration;

public static class OptionsExtensions
{
    /// <summary>
    /// Bind một section cấu hình và kiểm tra ngay khi app khởi động.
    /// Thiếu key bắt buộc → app dừng và in rõ tên biến cần điền trong .env.
    /// </summary>
    public static OptionsBuilder<T> AddValidatedOptions<T>(this IServiceCollection services, IConfiguration config, string section)
        where T : class =>
        services.AddOptions<T>()
            .Bind(config.GetSection(section))
            .ValidateDataAnnotations()
            .ValidateOnStart();
}
