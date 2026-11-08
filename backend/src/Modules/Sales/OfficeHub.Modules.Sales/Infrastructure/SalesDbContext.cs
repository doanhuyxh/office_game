using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using OfficeHub.Modules.Sales.Domain;

namespace OfficeHub.Modules.Sales.Infrastructure;

public sealed class SalesDbContext(DbContextOptions<SalesDbContext> options) : DbContext(options)
{
    public const string Schema = "sales";
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Contact> Contacts => Set<Contact>();
    public DbSet<Activity> Activities => Set<Activity>();
    public DbSet<Opportunity> Opportunities => Set<Opportunity>();
    public DbSet<SalesContract> Contracts => Set<SalesContract>();
    public DbSet<Installment> Installments => Set<Installment>();
    public DbSet<ContractAppendix> Appendices => Set<ContractAppendix>();
    public DbSet<Collection> Collections => Set<Collection>();
    public DbSet<Quote> Quotes => Set<Quote>();
    public DbSet<QuoteLine> QuoteLines => Set<QuoteLine>();
    public DbSet<SalesSettings> Settings => Set<SalesSettings>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        b.HasDefaultSchema(Schema);
        b.Entity<Customer>(e =>
        {
            e.ToTable("customers");
            e.Property(x => x.Number).UseIdentityAlwaysColumn();
            e.HasIndex(x => x.Number).IsUnique().HasDatabaseName("ux_customers_number");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.TaxCode).HasMaxLength(20);
            e.Property(x => x.Address).HasMaxLength(300);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.Email).HasMaxLength(200);
            e.Property(x => x.Source).HasMaxLength(100);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.HasIndex(x => x.TaxCode).IsUnique().HasFilter("\"TaxCode\" IS NOT NULL").HasDatabaseName("ux_customers_tax_code");
            e.HasIndex(x => x.OwnerEmployeeId).HasDatabaseName("ix_customers_owner");
            e.HasMany(x => x.Contacts).WithOne().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<Contact>(e =>
        {
            e.ToTable("contacts");
            e.Property(x => x.Name).HasMaxLength(200);
            e.Property(x => x.Title).HasMaxLength(100);
            e.Property(x => x.Phone).HasMaxLength(30);
            e.Property(x => x.Email).HasMaxLength(200);
        });
        b.Entity<Activity>(e =>
        {
            e.ToTable("activities");
            e.Property(x => x.Kind).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Content).HasMaxLength(2000);
            e.Property(x => x.NextAction).HasMaxLength(300);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.CustomerId, x.At }).HasDatabaseName("ix_activities_customer");
            e.HasIndex(x => x.NextActionOn).HasDatabaseName("ix_activities_next");
            e.HasOne<Customer>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<Opportunity>(e =>
        {
            e.ToTable("opportunities");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.Stage).HasConversion<string>().HasMaxLength(12);
            e.Property(x => x.LostReason).HasMaxLength(500);
            e.HasIndex(x => x.CustomerId).HasDatabaseName("ix_opportunities_customer");
            e.HasIndex(x => new { x.OwnerEmployeeId, x.Stage }).HasDatabaseName("ix_opportunities_owner");
            e.HasOne<Customer>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<SalesContract>(e =>
        {
            e.ToTable("contracts");
            e.Property(x => x.Code).HasMaxLength(50);
            e.HasIndex(x => x.Code).IsUnique().HasDatabaseName("ux_contracts_code");
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Billing).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.HasIndex(x => x.CustomerId).HasDatabaseName("ix_contracts_customer");
            e.HasIndex(x => x.OwnerEmployeeId).HasDatabaseName("ix_contracts_owner");
            e.HasOne<Customer>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Opportunity>().WithMany().HasForeignKey(x => x.OpportunityId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Installments).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Appendices).WithOne().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<Quote>(e =>
        {
            e.ToTable("quotes");
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Terms).HasMaxLength(4000);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.ApprovalComment).HasMaxLength(500);
            e.Property(x => x.DecisionNote).HasMaxLength(500);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.Property(x => x.DiscountPercent).HasPrecision(5, 2);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(16);
            e.HasIndex(x => new { x.Number, x.Version }).IsUnique().HasDatabaseName("ux_quotes_number");
            e.HasIndex(x => x.CustomerId).HasDatabaseName("ix_quotes_customer");
            e.HasIndex(x => x.OwnerEmployeeId).HasDatabaseName("ix_quotes_owner");
            e.HasIndex(x => x.ApprovalSubjectId).HasDatabaseName("ix_quotes_approval_subject");
            e.HasOne<Customer>().WithMany().HasForeignKey(x => x.CustomerId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<Opportunity>().WithMany().HasForeignKey(x => x.OpportunityId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<SalesContract>().WithMany().HasForeignKey(x => x.ContractId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Lines).WithOne().HasForeignKey(x => x.QuoteId).OnDelete(DeleteBehavior.Cascade);
        });
        b.Entity<QuoteLine>(e =>
        {
            e.ToTable("quote_lines");
            e.Property(x => x.Description).HasMaxLength(500);
            e.Property(x => x.Unit).HasMaxLength(30);
            e.Property(x => x.Quantity).HasPrecision(12, 2);
        });
        b.Entity<SalesSettings>(e =>
        {
            e.ToTable("settings");
            e.Property(x => x.Id).ValueGeneratedNever();
            e.Property(x => x.QuoteDiscountLimitPercent).HasPrecision(5, 2);
            e.Property(x => x.QuoteTemplateKey).HasMaxLength(400);
            e.Property(x => x.QuoteTemplateName).HasMaxLength(200);
            e.Property(x => x.UpdatedByName).HasMaxLength(200);
        });
        b.Entity<ContractAppendix>(e =>
        {
            e.ToTable("contract_appendices");
            e.Property(x => x.Code).HasMaxLength(50);
            e.Property(x => x.Title).HasMaxLength(300);
            e.Property(x => x.Note).HasMaxLength(2000);
            e.Property(x => x.CancelReason).HasMaxLength(500);
            e.Property(x => x.CreatedByName).HasMaxLength(200);
            e.HasIndex(x => new { x.ContractId, x.Code }).IsUnique().HasDatabaseName("ux_contract_appendices_code");
            // Một CR chỉ một phụ lục còn hiệu lực.
            e.HasIndex(x => x.ChangeRequestId).IsUnique().HasDatabaseName("ux_contract_appendices_cr").HasFilter("\"ChangeRequestId\" IS NOT NULL AND NOT \"Cancelled\"");
        });
        b.Entity<Installment>(e =>
        {
            e.ToTable("installments");
            e.Property(x => x.Title).HasMaxLength(200);
            e.Property(x => x.CancelReason).HasMaxLength(500);
            e.HasIndex(x => x.DueOn).HasDatabaseName("ix_installments_due");
            e.HasOne<ContractAppendix>().WithMany().HasForeignKey(x => x.AppendixId).OnDelete(DeleteBehavior.Restrict);
            e.HasMany(x => x.Collections).WithOne().HasForeignKey(x => x.InstallmentId).OnDelete(DeleteBehavior.Restrict);
        });
        b.Entity<Collection>(e =>
        {
            e.ToTable("collections");
            e.Property(x => x.CreatedByName).HasMaxLength(200);
        });
    }
}

public sealed class DesignTimeFactory : IDesignTimeDbContextFactory<SalesDbContext>
{
    public SalesDbContext CreateDbContext(string[] args) =>
        new(new DbContextOptionsBuilder<SalesDbContext>()
            .UseNpgsql("Host=localhost;Database=design_time", o => o.MigrationsHistoryTable("__ef_migrations", SalesDbContext.Schema))
            .Options);
}

internal sealed class SalesMigrator(IServiceProvider sp, IConfiguration config) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!config.GetValue("Database:MigrateOnStartup", true)) return;
        using var scope = sp.CreateScope();
        await scope.ServiceProvider.GetRequiredService<SalesDbContext>().Database.MigrateAsync(ct);
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
