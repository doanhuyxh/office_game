using System.Data.Common;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Hosting;
using OfficeHub.BuildingBlocks.Auth;
using Serilog;

namespace OfficeHub.BuildingBlocks.Persistence;

/// <summary>
/// Cấu hình đo số truy vấn DB theo request (TEST-243). Không bắt buộc trong .env:
/// <c>Diagnostics__DbQueryStats</c> (mặc định true) — đếm + ghi <c>DbQueries</c> / <c>DbMs</c> / <c>Route</c> / <c>Auth</c> vào dòng log request sẵn có;
/// <c>Diagnostics__DbQueryWarnAt</c> (mặc định 0 = tắt) — request có ≥ N câu thì dòng log request lên mức Warning (lọc nhanh trong Seq).
/// </summary>
public sealed class DiagnosticsSettings
{
    public const string Section = "Diagnostics";
    public bool DbQueryStats { get; set; } = true;
    public int DbQueryWarnAt { get; set; }

    public static DiagnosticsSettings From(IConfiguration cfg) => cfg.GetSection(Section).Get<DiagnosticsSettings>() ?? new();
}

/// <summary>
/// Bộ đếm truy vấn DB của MỘT request: số câu lệnh + tổng thời gian chờ DB (cộng dồn, các câu chạy song song cộng cả hai).
/// Gắn vào luồng async bằng <see cref="Begin"/> (middleware <see cref="DbQueryStatsExtensions.UseDbQueryStats"/>);
/// <see cref="DbQueryCountInterceptor"/> cộng vào bộ đếm đang gắn — job nền / ngoài request không có bộ đếm thì bỏ qua.
/// </summary>
public sealed class DbQueryStats
{
    public const string ItemKey = "officehub.db_query_stats";
    private static readonly AsyncLocal<DbQueryStats?> CurrentSlot = new();

    private int _count;
    private long _ticks;

    public static DbQueryStats? Current => CurrentSlot.Value;
    public int Count => Volatile.Read(ref _count);
    public double Milliseconds => TimeSpan.FromTicks(Interlocked.Read(ref _ticks)).TotalMilliseconds;

    /// <summary>Tạo bộ đếm mới cho luồng async hiện tại (và các lời gọi con).</summary>
    public static DbQueryStats Begin() => CurrentSlot.Value = new DbQueryStats();

    public void Add(TimeSpan duration)
    {
        Interlocked.Increment(ref _count);
        Interlocked.Add(ref _ticks, duration.Ticks);
    }
}

/// <summary>Đếm mọi câu lệnh EF Core (đọc / ghi / scalar, cả câu lỗi) vào <see cref="DbQueryStats.Current"/>. Gắn cho mọi DbContext module ở <see cref="DbContextExtensions.AddModuleDbContext{TContext}"/>.</summary>
public sealed class DbQueryCountInterceptor : DbCommandInterceptor
{
    private static void Count(TimeSpan duration) => DbQueryStats.Current?.Add(duration);

    public override DbDataReader ReaderExecuted(DbCommand command, CommandExecutedEventData eventData, DbDataReader result)
    { Count(eventData.Duration); return result; }

    public override ValueTask<DbDataReader> ReaderExecutedAsync(DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
    { Count(eventData.Duration); return ValueTask.FromResult(result); }

    public override int NonQueryExecuted(DbCommand command, CommandExecutedEventData eventData, int result)
    { Count(eventData.Duration); return result; }

    public override ValueTask<int> NonQueryExecutedAsync(DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
    { Count(eventData.Duration); return ValueTask.FromResult(result); }

    public override object? ScalarExecuted(DbCommand command, CommandExecutedEventData eventData, object? result)
    { Count(eventData.Duration); return result; }

    public override ValueTask<object?> ScalarExecutedAsync(DbCommand command, CommandExecutedEventData eventData, object? result, CancellationToken cancellationToken = default)
    { Count(eventData.Duration); return ValueTask.FromResult(result); }

    public override void CommandFailed(DbCommand command, CommandErrorEventData eventData) => Count(eventData.Duration);

    public override Task CommandFailedAsync(DbCommand command, CommandErrorEventData eventData, CancellationToken cancellationToken = default)
    { Count(eventData.Duration); return Task.CompletedTask; }
}

public static class DbQueryStatsExtensions
{
    /// <summary>
    /// Middleware đặt TRƯỚC <c>UseSerilogRequestLogging</c>: mở bộ đếm cho request; Development thêm header
    /// <c>Server-Timing: db;dur=…;desc="N queries"</c> (xem trong DevTools → Network → Timing). Tắt bằng <c>Diagnostics__DbQueryStats=false</c>.
    /// </summary>
    public static IApplicationBuilder UseDbQueryStats(this IApplicationBuilder app, DiagnosticsSettings settings, IWebHostEnvironment env)
    {
        if (!settings.DbQueryStats) return app;
        var serverTiming = env.IsDevelopment();
        return app.Use(async (ctx, next) =>
        {
            var stats = DbQueryStats.Begin();
            ctx.Items[DbQueryStats.ItemKey] = stats;
            if (serverTiming)
                ctx.Response.OnStarting(() =>
                {
                    ctx.Response.Headers.Append("Server-Timing",
                        $"db;dur={stats.Milliseconds.ToString("0.#", System.Globalization.CultureInfo.InvariantCulture)};desc=\"{stats.Count} queries\"");
                    return Task.CompletedTask;
                });
            await next(ctx);
        });
    }

    public static DbQueryStats? GetDbQueryStats(this HttpContext ctx) => ctx.Items.TryGetValue(DbQueryStats.ItemKey, out var v) ? v as DbQueryStats : null;

    /// <summary>Kiểu xác thực của request cho log: token (token AI / MCP), cookie, anonymous.</summary>
    public static string AuthKind(this HttpContext ctx) =>
        ctx.User.Identity is not { IsAuthenticated: true } id ? "anonymous"
        : ctx.User.IsAccessToken() ? "token"
        : "cookie"; // mọi scheme còn lại của Api / Realtime / Mcp là cookie đăng nhập (Identity.Application / AuthCookie)

    /// <summary>Thêm DbQueries / DbMs / Route / Auth vào dòng log request của Serilog (gọi trong EnrichDiagnosticContext).</summary>
    public static void EnrichDbQueryStats(IDiagnosticContext diag, HttpContext ctx)
    {
        diag.Set("Route", (ctx.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "");
        diag.Set("Auth", ctx.AuthKind());
        if (ctx.GetDbQueryStats() is not { } s) return;
        diag.Set("DbQueries", s.Count);
        diag.Set("DbMs", Math.Round(s.Milliseconds, 1));
    }
}
