using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Organization.Domain;

namespace OfficeHub.Modules.Organization.Infrastructure;

/// <summary>Chạy migration schema "org" khi khởi động (nếu Database__MigrateOnStartup=true), rồi chuẩn hoá thang cấp bậc.</summary>
internal sealed class OrgMigrator(IServiceProvider sp, IConfiguration config, TimeProvider clock, ILogger<OrgMigrator> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<OrgDbContext>();
        await db.Database.MigrateAsync(ct);
        await EnsurePositionLadderAsync(db, clock, log, ct);
    }

    /// <summary>
    /// Chạy một lần: khi chưa có chức vụ nào, hoặc còn chức vụ cũ chưa có cấp (Level = 0). Thêm các bậc mặc định còn thiếu,
    /// gán cấp cho chức vụ cũ, chuyển chức vụ thực chất là chức danh (vd "Lễ Tân") sang JobTitle của nhân viên + cấp Nhân viên.
    /// Ghi qua EF nên có trong lịch sử sửa (nguồn "system"). Sau lần đầu HR toàn quyền thêm / xoá — không seed lại.
    /// </summary>
    internal static async Task EnsurePositionLadderAsync(OrgDbContext db, TimeProvider clock, ILogger log, CancellationToken ct)
    {
        var all = await db.Positions.ToListAsync(ct);
        var unleveled = all.Where(p => p.Level == 0).ToList();
        if (all.Count > 0 && unleveled.Count == 0) return;

        foreach (var r in PositionLadder.Defaults)
            if (!all.Any(p => PositionLadder.LevelOf(p.Name) == r.Level && EmployeeImportSheet.Normalize(p.Name) == EmployeeImportSheet.Normalize(r.Name)))
                db.Positions.Add(new Position { Name = r.Name, Level = r.Level, SortOrder = r.Level });

        var toJobTitle = new List<(Position Position, string JobTitle)>();
        foreach (var p in unleveled)
        {
            var (action, level, jobTitle) = PositionLadder.Plan(p.Name);
            p.Level = level;
            if (action == PositionLadder.Action.ToJobTitle) toJobTitle.Add((p, jobTitle!));
        }
        await db.SaveChangesAsync(ct);

        if (toJobTitle.Count > 0)
        {
            var staff = await db.Positions.FirstAsync(p => p.Level == PositionLadder.StaffLevel && p.Name == "Nhân viên", ct);
            var now = clock.GetUtcNow();
            foreach (var (p, title) in toJobTitle)
            {
                var emps = await db.Employees.Where(e => e.PositionId == p.Id).ToListAsync(ct);
                foreach (var e in emps)
                {
                    e.JobTitle ??= title;
                    e.PositionId = staff.Id;
                }
                p.DeletedAt = now;
                log.LogInformation("Chức vụ \"{Old}\" → chức danh \"{Title}\" + cấp Nhân viên cho {Count} nhân viên", p.Name, title, emps.Count);
            }
            await db.SaveChangesAsync(ct);
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
