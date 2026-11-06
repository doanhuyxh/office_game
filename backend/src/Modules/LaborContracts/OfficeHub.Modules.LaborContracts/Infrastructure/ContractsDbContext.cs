using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Infrastructure;

public sealed class ContractsDbContext(DbContextOptions<ContractsDbContext> options) : DbContext(options)
{
    public const string Schema = "contracts";

    public DbSet<LaborContract> Contracts => Set<LaborContract>();
    public DbSet<ContractAmendment> Amendments => Set<ContractAmendment>();
    public DbSet<ContractTemplate> Templates => Set<ContractTemplate>();
    public DbSet<SignRequest> SignRequests => Set<SignRequest>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<LaborContract>(e =>
        {
            e.ToTable("contracts");
            e.Property(x => x.Number).HasMaxLength(50);
            e.Property(x => x.Type).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.JobTitle).HasMaxLength(200);
            e.Property(x => x.SalaryEncrypted).HasMaxLength(200);
            e.Property(x => x.AllowanceEncrypted).HasMaxLength(200);
            e.Property(x => x.Note).HasMaxLength(1000);
            e.Property(x => x.TerminationReason).HasMaxLength(500);
            e.OwnsOne(x => x.File, File);
            e.Navigation(x => x.File).IsRequired(); // luôn có object (các cột File* đều null = chưa có file)
            e.HasMany(x => x.Amendments).WithOne().HasForeignKey(a => a.ContractId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.Number).IsUnique().HasFilter("\"DeletedAt\" IS NULL");
            e.HasIndex(x => new { x.EmployeeId, x.StartDate });
            e.HasIndex(x => x.EndDate).HasFilter("\"DeletedAt\" IS NULL AND \"TerminatedOn\" IS NULL");
            e.HasQueryFilter(x => x.DeletedAt == null);
        });
        b.Entity<ContractAmendment>(e =>
        {
            e.ToTable("amendments");
            e.Property(x => x.Number).HasMaxLength(50);
            e.Property(x => x.Content).HasMaxLength(2000);
            e.Property(x => x.SalaryEncrypted).HasMaxLength(200);
            e.Property(x => x.AllowanceEncrypted).HasMaxLength(200);
            e.OwnsOne(x => x.File, File);
            e.Navigation(x => x.File).IsRequired();
            e.HasIndex(x => new { x.ContractId, x.EffectiveDate });
        });
        b.Entity<SignRequest>(e =>
        {
            e.ToTable("sign_requests");
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.OriginalFileKey).HasMaxLength(300);
            e.Property(x => x.SignedFileKey).HasMaxLength(300);
            e.Property(x => x.SignatureImageKey).HasMaxLength(300);
            e.Property(x => x.OriginalSha256).HasMaxLength(64);
            e.Property(x => x.SignedSha256).HasMaxLength(64);
            e.Property(x => x.OtpHash).HasMaxLength(64);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.SignerIp).HasMaxLength(64);
            e.Property(x => x.SignerUserAgent).HasMaxLength(512);
            e.HasIndex(x => x.ContractId);
            e.HasIndex(x => new { x.SignerUserId, x.Status });
        });
        b.Entity<ContractTemplate>(e =>
        {
            e.ToTable("templates");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.ContractType).HasConversion<string>().HasMaxLength(20);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.OwnsOne(x => x.File, File);
            e.Navigation(x => x.File).IsRequired();
        });
    }

    private static void File<T>(Microsoft.EntityFrameworkCore.Metadata.Builders.OwnedNavigationBuilder<T, StoredFile> f) where T : class
    {
        f.Property(x => x.Key).HasColumnName("FileKey").HasMaxLength(300);
        f.Property(x => x.Name).HasColumnName("FileName").HasMaxLength(255);
        f.Property(x => x.ContentType).HasColumnName("FileContentType").HasMaxLength(100);
        f.Property(x => x.Size).HasColumnName("FileSize");
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<ContractsDbContext>
{
    public ContractsDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<ContractsDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", ContractsDbContext.Schema))
            .Options);
}
