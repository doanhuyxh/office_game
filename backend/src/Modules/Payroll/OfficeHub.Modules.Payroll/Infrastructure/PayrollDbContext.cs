using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Payroll.Domain;

namespace OfficeHub.Modules.Payroll.Infrastructure;

public sealed class PayrollDbContext(DbContextOptions<PayrollDbContext> options) : DbContext(options)
{
    public const string Schema = "payroll";
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public DbSet<PayrollSettings> Settings => Set<PayrollSettings>();
    public DbSet<EmployeePayProfile> Profiles => Set<EmployeePayProfile>();
    public DbSet<PayPeriod> Periods => Set<PayPeriod>();
    public DbSet<Payslip> Payslips => Set<Payslip>();
    public DbSet<PayAdjustment> Adjustments => Set<PayAdjustment>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<PayrollSettings>(e =>
        {
            e.ToTable("settings");
            e.Property(x => x.RulesJson).HasColumnType("jsonb");
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => x.EffectiveFrom).IsUnique();
        });
        b.Entity<EmployeePayProfile>(e =>
        {
            e.ToTable("profiles");
            e.HasKey(x => x.EmployeeId);
            e.Property(x => x.TaxCode).HasMaxLength(20);
            e.Property(x => x.Note).HasMaxLength(500);
        });
        b.Entity<PayPeriod>(e =>
        {
            e.ToTable("periods");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.LockedByName).HasMaxLength(200);
            e.HasIndex(x => x.Month).IsUnique();
        });
        b.Entity<Payslip>(e =>
        {
            e.ToTable("payslips");
            e.HasIndex(x => new { x.PeriodId, x.EmployeeId }).IsUnique();
            e.HasIndex(x => x.EmployeeId);
        });
        b.Entity<PayAdjustment>(e =>
        {
            e.ToTable("adjustments");
            e.Property(x => x.Label).HasMaxLength(200);
            e.Property(x => x.AmountEncrypted).HasMaxLength(200);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.PeriodId, x.EmployeeId });
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<PayrollDbContext>
{
    public PayrollDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<PayrollDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", PayrollDbContext.Schema))
            .Options);
}

/// <summary>Migrate + tạo bộ thông số mặc định (hiệu lực từ 2026-01-01) nếu chưa có — HR / kế toán phải rà lại ở trang Bảng lương → Thông số.</summary>
internal sealed class PayrollMigrator(IServiceProvider sp, IConfiguration config, TimeProvider clock) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<PayrollDbContext>();
        if (config.GetValue("Database:MigrateOnStartup", true)) await db.Database.MigrateAsync(ct);
        if (await db.Settings.AnyAsync(ct)) return;
        db.Settings.Add(new PayrollSettings
        {
            EffectiveFrom = new DateOnly(2026, 1, 1),
            RulesJson = JsonSerializer.Serialize(new PayrollRules(), PayrollDbContext.Json),
            CreatedAt = clock.GetUtcNow(),
            CreatedByName = "Mặc định hệ thống (cần kế toán xác nhận)",
        });
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
