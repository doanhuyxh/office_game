using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Finance.Domain;

namespace OfficeHub.Modules.Finance.Infrastructure;

public sealed class FinanceDbContext(DbContextOptions<FinanceDbContext> options) : DbContext(options)
{
    public const string Schema = "finance";
    public DbSet<BusinessLine> Lines => Set<BusinessLine>();
    public DbSet<MoneyAccount> Accounts => Set<MoneyAccount>();
    public DbSet<TxCategory> Categories => Set<TxCategory>();
    public DbSet<LedgerEntry> Entries => Set<LedgerEntry>();
    public DbSet<ExpenseRequest> Expenses => Set<ExpenseRequest>();
    public DbSet<FinanceAttachment> Attachments => Set<FinanceAttachment>();
    public DbSet<FinanceSettings> Settings => Set<FinanceSettings>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<BusinessLine>(e =>
        {
            e.ToTable("business_lines");
            e.Property(x => x.Code).HasMaxLength(20);
            e.Property(x => x.Name).HasMaxLength(100);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_business_lines_code");
        });
        b.Entity<MoneyAccount>(e =>
        {
            e.ToTable("accounts");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.BankName).HasMaxLength(100);
            e.Property(x => x.Last4).HasMaxLength(4);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => x.Name).IsUnique().HasDatabaseName("ux_accounts_name");
        });
        b.Entity<TxCategory>(e =>
        {
            e.ToTable("categories");
            e.Property(x => x.Name).HasMaxLength(100);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => new { x.Kind, x.Name }).IsUnique().HasDatabaseName("ux_categories_kind_name");
        });
        b.Entity<LedgerEntry>(e =>
        {
            e.ToTable("entries");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Counterparty).HasMaxLength(200);
            e.Property(x => x.Description).HasMaxLength(1000);
            e.Property(x => x.InvoiceNumber).HasMaxLength(50);
            e.Property(x => x.SourceType).HasMaxLength(30);
            e.Property(x => x.VoidReason).HasMaxLength(500);
            e.Property(x => x.VoidedByName).HasMaxLength(200);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.Date, x.CreatedAt }).HasDatabaseName("ix_entries_date");
            e.HasIndex(x => x.AccountId).HasDatabaseName("ix_entries_account");
            e.HasIndex(x => x.ProjectId).HasDatabaseName("ix_entries_project").HasFilter("\"ProjectId\" IS NOT NULL");
            // Một nguồn (vd đề nghị chi) chỉ có một dòng sổ còn hiệu lực → bấm "Đã chi" hai lần không ghi trùng.
            e.HasIndex(x => new { x.SourceType, x.SourceId }).IsUnique().HasDatabaseName("ux_entries_source")
                .HasFilter("\"SourceId\" IS NOT NULL AND \"Status\" = 'Active'");
            e.HasOne<MoneyAccount>().WithMany().HasForeignKey(x => x.AccountId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<MoneyAccount>().WithMany().HasForeignKey(x => x.ToAccountId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<TxCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<BusinessLine>().WithMany().HasForeignKey(x => x.BusinessLineId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<ExpenseRequest>(e =>
        {
            e.ToTable("expense_requests");
            e.Property(x => x.Number).UseIdentityAlwaysColumn();
            e.Property(x => x.Reason).HasMaxLength(1000);
            e.Property(x => x.Payee).HasMaxLength(200);
            e.Property(x => x.RejectReason).HasMaxLength(500);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.HasIndex(x => x.Number).IsUnique().HasDatabaseName("ux_expense_requests_number");
            e.HasIndex(x => x.RequesterEmployeeId).HasDatabaseName("ix_expense_requests_requester");
            e.HasIndex(x => x.Status).HasDatabaseName("ix_expense_requests_status");
            e.HasOne<TxCategory>().WithMany().HasForeignKey(x => x.CategoryId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<BusinessLine>().WithMany().HasForeignKey(x => x.BusinessLineId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<FinanceAttachment>(e =>
        {
            e.ToTable("attachments");
            e.Property(x => x.OwnerType).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.FileKey).HasMaxLength(400);
            e.Property(x => x.FileName).HasMaxLength(200);
            e.Property(x => x.ContentType).HasMaxLength(150);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.DeletedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.OwnerType, x.OwnerId }).HasDatabaseName("ix_attachments_owner");
        });
        b.Entity<FinanceSettings>(e =>
        {
            e.ToTable("settings");
            e.Property(x => x.Id).ValueGeneratedNever();
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<FinanceDbContext>
{
    public FinanceDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<FinanceDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", FinanceDbContext.Schema))
            .Options);
}

/// <summary>Chạy migration + tạo mảng kinh doanh và danh mục thu chi mặc định (chỉ khi bảng còn trống). Quỹ tiền do quản trị tài chính tự tạo.</summary>
internal sealed class FinanceMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    private static readonly (string Code, string Name)[] DefaultLines =
        [("CHUNG", "Chung (văn phòng)"), ("OUTSOURCE", "Outsource web / app"), ("AFFILIATE", "Affiliate TikTok / Shopee"), ("KENH-MXH", "Kênh mạng xã hội")];

    private static readonly string[] DefaultIncome =
        ["Doanh thu dịch vụ", "Hoa hồng affiliate", "Lãi tiền gửi", "Thu khác"];

    private static readonly string[] DefaultExpense =
        ["Lương", "Bảo hiểm & thuế", "Thuê văn phòng", "Quảng cáo", "Phần mềm & dịch vụ", "Thiết bị", "Hàng mẫu", "Thuê ngoài", "Tiếp khách & công tác", "Chi khác"];

    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<FinanceDbContext>();
        await db.Database.MigrateAsync(ct);
        if (!await db.Lines.AnyAsync(ct))
        {
            var i = 0;
            foreach (var (code, name) in DefaultLines) db.Lines.Add(new BusinessLine { Code = code, Name = name, SortOrder = ++i });
        }
        if (!await db.Categories.AnyAsync(ct))
        {
            var i = 0;
            foreach (var n in DefaultIncome) db.Categories.Add(new TxCategory { Name = n, Kind = CategoryKind.Income, SortOrder = ++i });
            foreach (var n in DefaultExpense) db.Categories.Add(new TxCategory { Name = n, Kind = CategoryKind.Expense, SortOrder = ++i });
        }
        await db.SaveChangesAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
