using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace OfficeHub.BuildingBlocks.Persistence;

public static class DbContextExtensions
{
    public const string ConnectionName = "Default";

    /// <summary>
    /// Mỗi module một DbContext, một schema Postgres riêng, bảng lịch sử migration riêng.
    /// Module không được JOIN chéo schema của module khác.
    /// </summary>
    public static IServiceCollection AddModuleDbContext<TContext>(this IServiceCollection services, IConfiguration config, string schema)
        where TContext : DbContext
    {
        var cs = config.GetConnectionString(ConnectionName)
                 ?? throw new InvalidOperationException("Thiếu ConnectionStrings__Default trong .env");
        services.AddDbContext<TContext>(o => o
            .UseNpgsql(cs, npg => npg.MigrationsHistoryTable("__ef_migrations", schema))
            .UseSnakeCaseNamingConventionIfAvailable());
        return services;
    }

    // Chỗ cắm sẵn: thêm EFCore.NamingConventions nếu muốn tên cột snake_case.
    private static DbContextOptionsBuilder UseSnakeCaseNamingConventionIfAvailable(this DbContextOptionsBuilder b) => b;
}
