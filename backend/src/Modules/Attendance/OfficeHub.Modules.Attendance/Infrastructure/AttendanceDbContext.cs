using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OfficeHub.Modules.Attendance.Domain;

namespace OfficeHub.Modules.Attendance.Infrastructure;

public sealed class AttendanceDbContext(DbContextOptions<AttendanceDbContext> options) : DbContext(options)
{
    public const string Schema = "attendance";

    public DbSet<Shift> Shifts => Set<Shift>();
    public DbSet<ScheduleEntry> Schedules => Set<ScheduleEntry>();
    public DbSet<AttendanceEvent> Events => Set<AttendanceEvent>();
    public DbSet<Holiday> Holidays => Set<Holiday>();
    public DbSet<AttendanceCorrection> Corrections => Set<AttendanceCorrection>();
    public DbSet<OvertimeRequest> Overtime => Set<OvertimeRequest>();
    public DbSet<AttendanceReminder> Reminders => Set<AttendanceReminder>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.Entity<AttendanceReminder>(e =>
        {
            e.ToTable("reminders");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.EmployeeId, x.WorkDate, x.Kind }).IsUnique().HasDatabaseName("ux_reminders_employee_day_kind");
        });
        b.HasDefaultSchema(Schema);
        b.Entity<Shift>(e =>
        {
            e.ToTable("shifts");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
            e.HasQueryFilter(x => x.DeletedAt == null);
        });
        b.Entity<ScheduleEntry>(e =>
        {
            e.ToTable("schedules");
            e.HasIndex(x => new { x.EmployeeId, x.EffectiveFrom, x.DayOfWeek }).IsUnique().AreNullsDistinct(false);
            e.HasOne<Shift>().WithMany().HasForeignKey(x => x.ShiftId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<AttendanceEvent>(e =>
        {
            e.ToTable("events");
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Source).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.WorkMode).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Ip).HasMaxLength(64);
            e.Property(x => x.UserAgent).HasMaxLength(512);
            e.Property(x => x.Note).HasMaxLength(500);
            e.Property(x => x.IdempotencyKey).HasMaxLength(100);
            e.HasIndex(x => new { x.EmployeeId, x.WorkDate });
            e.HasIndex(x => x.WorkDate);
            e.HasIndex(x => x.IdempotencyKey).IsUnique().HasFilter("\"IdempotencyKey\" IS NOT NULL");
        });
        b.Entity<AttendanceCorrection>(e =>
        {
            e.ToTable("corrections");
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.WorkMode).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.RejectReason).HasMaxLength(1000);
            e.HasIndex(x => new { x.EmployeeId, x.WorkDate });
        });
        b.Entity<OvertimeRequest>(e =>
        {
            e.ToTable("overtime_requests");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.Reason).HasMaxLength(500);
            e.Property(x => x.RejectReason).HasMaxLength(1000);
            e.HasIndex(x => new { x.EmployeeId, x.WorkDate });
        });
        b.Entity<Holiday>(e =>
        {
            e.ToTable("holidays");
            e.Property(x => x.Name).HasMaxLength(150);
            e.HasIndex(x => x.Date).IsUnique();
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<AttendanceDbContext>
{
    public AttendanceDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<AttendanceDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", AttendanceDbContext.Schema))
            .Options);
}
