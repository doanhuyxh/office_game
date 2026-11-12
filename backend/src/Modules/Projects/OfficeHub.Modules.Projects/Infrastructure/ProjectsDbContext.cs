using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using OfficeHub.Modules.Documents.Contracts;
using OfficeHub.Modules.Projects.Contracts;
using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Infrastructure;

public sealed class ProjectsDbContext(DbContextOptions<ProjectsDbContext> options) : DbContext(options)
{
    public const string Schema = "projects";
    public DbSet<Project> Projects => Set<Project>();
    public DbSet<ProjectMember> Members => Set<ProjectMember>();
    public DbSet<Allocation> Allocations => Set<Allocation>();
    public DbSet<ProjectContract> ProjectContracts => Set<ProjectContract>();
    public DbSet<AllocationFreeze> Freezes => Set<AllocationFreeze>();
    public DbSet<ChangeRequest> ChangeRequests => Set<ChangeRequest>();
    public DbSet<Milestone> Milestones => Set<Milestone>();
    public DbSet<TaskColumn> Columns => Set<TaskColumn>();
    public DbSet<TaskItem> Tasks => Set<TaskItem>();
    public DbSet<TaskComment> Comments => Set<TaskComment>();
    public DbSet<TaskActivity> Activities => Set<TaskActivity>();
    public DbSet<TaskDependency> Dependencies => Set<TaskDependency>();
    public DbSet<AgentSettings> AgentSettings => Set<AgentSettings>();

    /// <summary>Giới hạn đội agent đang áp dụng (đọc mỗi lần: chỉ request qua token AI cần, truy vấn theo khoá chính).</summary>
    public async Task<AgentLimits> AgentLimitsAsync(CancellationToken ct) =>
        await AgentSettings.AsNoTracking().Where(x => x.Id == Domain.AgentSettings.SingletonId)
            .Select(x => new AgentLimits(x.MaxBotTasksPerDay, x.MaxBotStreak)).FirstOrDefaultAsync(ct) ?? AgentLimits.Default;

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Project>(e =>
        {
            e.ToTable("projects");
            e.Property(x => x.Code).HasMaxLength(30); // = documents.projects.Code (chép sang)
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(2000);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.BudgetManDays).HasPrecision(10, 2);
            e.Property(x => x.WorkGuide).HasMaxLength(TaskRules.MaxDescription);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_projects_code");
            e.HasMany(x => x.Members).WithOne().HasForeignKey(m => m.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ProjectMember>(e =>
        {
            e.ToTable("members");
            e.HasKey(x => new { x.ProjectId, x.EmployeeId });
            e.Property(x => x.Role).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => x.EmployeeId).HasDatabaseName("ix_members_employee");
        });
        b.Entity<Allocation>(e =>
        {
            e.ToTable("allocations");
            e.HasKey(x => new { x.ProjectId, x.EmployeeId, x.Month });
            e.Property(x => x.Percent).HasPrecision(5, 2);
            e.HasIndex(x => new { x.EmployeeId, x.Month }).HasDatabaseName("ix_allocations_employee_month");
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<ProjectContract>(e =>
        {
            e.ToTable("contracts");
            e.HasKey(x => new { x.ProjectId, x.ContractId });
            e.HasIndex(x => x.ContractId).IsUnique().HasDatabaseName("ux_project_contracts_contract"); // một hợp đồng chỉ thuộc một dự án
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<AgentSettings>(e =>
        {
            e.ToTable("agent_settings");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.UpdatedByName).HasMaxLength(200);
        });
        b.Entity<AllocationFreeze>(e =>
        {
            e.ToTable("allocation_freezes");
            e.HasKey(x => x.Month);
        });
        b.Entity<ChangeRequest>(e =>
        {
            e.ToTable("change_requests");
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Description).HasMaxLength(5000);
            e.Property(x => x.DecisionNote).HasMaxLength(1000);
            e.Property(x => x.DecidedByName).HasMaxLength(200);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.EstimateManDays).HasPrecision(8, 2);
            e.Property(x => x.BudgetAddedManDays).HasPrecision(8, 2);
            e.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique().HasDatabaseName("ux_change_requests_number");
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<Milestone>(e =>
        {
            e.ToTable("milestones");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.AcceptedByName).HasMaxLength(200);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => x.ProjectId).HasDatabaseName("ix_milestones_project");
            e.HasIndex(x => x.InstallmentId).IsUnique().HasFilter("\"InstallmentId\" IS NOT NULL").HasDatabaseName("ux_milestones_installment");
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<TaskColumn>(e =>
        {
            e.ToTable("task_columns");
            e.Property(x => x.Name).HasMaxLength(TaskColumnRules.MaxName);
            e.Property(x => x.Color).HasMaxLength(7);
            e.HasIndex(x => new { x.ProjectId, x.Position }).HasDatabaseName("ix_task_columns_project");
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<TaskItem>(e =>
        {
            e.ToTable("tasks");
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Description).HasMaxLength(TaskRules.MaxDescription);
            e.Property(x => x.MediaLinks).HasColumnType("text[]").HasDefaultValueSql("'{}'");
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.EstimateDays).HasPrecision(6, 2);
            e.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique().HasDatabaseName("ux_tasks_number");
            e.HasIndex(x => new { x.AssigneeEmployeeId, x.CompletedAt }).HasDatabaseName("ix_tasks_assignee");
            e.HasIndex(x => x.ColumnId).HasDatabaseName("ix_tasks_column");
            e.HasOne<TaskColumn>().WithMany().HasForeignKey(x => x.ColumnId).OnDelete(DeleteBehavior.Restrict); // xoá cột: chuyển hết việc trước
            e.HasOne<Project>().WithMany().HasForeignKey(x => x.ProjectId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Milestone>().WithMany().HasForeignKey(x => x.MilestoneId).OnDelete(DeleteBehavior.SetNull);
        });
        b.Entity<TaskComment>(e =>
        {
            e.ToTable("task_comments");
            e.Property(x => x.Content).HasMaxLength(3000);
            e.Property(x => x.AuthorName).HasMaxLength(200);
            e.HasIndex(x => new { x.TaskId, x.CreatedAt }).HasDatabaseName("ix_task_comments_task");
            e.HasIndex(x => x.CreatedAt).HasDatabaseName("ix_task_comments_time"); // luồng thay đổi (/activity)
            e.HasOne<TaskItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<TaskDependency>(e =>
        {
            e.ToTable("task_dependencies");
            e.HasKey(x => new { x.TaskId, x.DependsOnId });
            e.HasIndex(x => x.DependsOnId).HasDatabaseName("ix_task_dependencies_on");
            // Xoá việc → xoá luôn quan hệ chờ (cả hai chiều)
            e.HasOne<TaskItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<TaskItem>().WithMany().HasForeignKey(x => x.DependsOnId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<TaskActivity>(e =>
        {
            e.ToTable("task_activities");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.From).HasMaxLength(200);
            e.Property(x => x.To).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(TaskWorkflow.MaxNote);
            e.Property(x => x.ActorName).HasMaxLength(200);
            e.HasIndex(x => new { x.TaskId, x.At }).HasDatabaseName("ix_task_activities_task");
            e.HasIndex(x => x.At).HasDatabaseName("ix_task_activities_time"); // luồng thay đổi (/activity)
            e.HasOne<TaskItem>().WithMany().HasForeignKey(x => x.TaskId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<ProjectsDbContext>
{
    public ProjectsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<ProjectsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", ProjectsDbContext.Schema))
            .Options);
}

/// <summary>
/// Chạy migration, rồi chép dự án + thành viên còn thiếu từ module Documents (dự án tạo trước 2026-11-08) — giữ nguyên Id.
/// Idempotent: chỉ thêm dự án chưa có; bảng cũ không bị sửa / xoá. Đăng ký SAU DocumentsModule (bảng cũ đã migrate).
/// </summary>
internal sealed class ProjectsMigrator(IServiceProvider sp, IConfiguration config, ILogger<ProjectsMigrator> log) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<ProjectsDbContext>();
        await db.Database.MigrateAsync(ct);
        await EnsureColumnsAsync(db, ct);
        IReadOnlyList<LegacyProject> legacy;
        try { legacy = await scope.ServiceProvider.GetRequiredService<ILegacyDocumentProjects>().ListAsync(ct); }
        catch (Exception ex) { log.LogWarning(ex, "Không đọc được dự án cũ ở module Documents — bỏ qua bước chép"); return; }
        var have = (await db.Projects.Select(p => p.Id).ToListAsync(ct)).ToHashSet();
        var codes = (await db.Projects.Select(p => p.Code).ToListAsync(ct)).ToHashSet();
        var added = 0;
        foreach (var l in legacy.Where(l => !have.Contains(l.Id)))
        {
            if (!codes.Add(l.Code)) { log.LogWarning("Dự án cũ {Code} trùng mã với dự án mới — không chép", l.Code); continue; }
            var p = new Project
            {
                Id = l.Id, Code = l.Code, Name = l.Name, Description = l.Description, Kind = ProjectKind.Internal,
                Status = l.Closed ? ProjectStatus.Closed : ProjectStatus.Active, DepartmentId = l.DepartmentId, CreatedAt = l.CreatedAt, CreatedByName = l.CreatedByName,
                StartOn = DateOnly.FromDateTime(l.CreatedAt.UtcDateTime),
            };
            foreach (var m in l.Members)
                p.Members.Add(new ProjectMember { EmployeeId = m.EmployeeId, Role = (ProjectMemberRole)m.Role, AddedAt = m.AddedAt });
            db.Projects.Add(p);
            added++;
        }
        if (added > 0)
        {
            await db.SaveChangesAsync(ct);
            log.LogInformation("Đã chép {Count} dự án từ module Documents sang Projects", added);
            await EnsureColumnsAsync(db, ct);
        }
    }

    /// <summary>Dự án chưa có cột trạng thái (vd vừa chép từ Documents) → thêm 4 cột mặc định. Idempotent.</summary>
    private static async Task EnsureColumnsAsync(ProjectsDbContext db, CancellationToken ct)
    {
        var missing = await db.Projects.Where(p => !db.Columns.Any(c => c.ProjectId == p.Id)).Select(p => p.Id).ToListAsync(ct);
        if (missing.Count == 0) return;
        foreach (var id in missing) db.Columns.AddRange(TaskColumnRules.Defaults(id));
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
