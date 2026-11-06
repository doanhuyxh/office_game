using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Auditing;

namespace OfficeHub.Architecture.Tests;

/// <summary>Interceptor lịch sử sửa: đúng trường, che bí mật, bỏ trường kỹ thuật, chỉ gửi khi lưu thành công.</summary>
public class ChangeAuditTests
{
    [Audited]
    public sealed class Person
    {
        public Guid Id { get; set; } = Guid.NewGuid();
        public string FullName { get; set; } = "";
        public string? SalaryEncrypted { get; set; }
        [AuditMask] public string? Pin { get; set; }
        public DateOnly JoinedAt { get; set; }
        public DateTimeOffset UpdatedAt { get; set; }
        public Address Home { get; set; } = new();
    }

    public sealed class Address { public string? City { get; set; } }

    public sealed class NotAudited { public int Id { get; set; } public string Name { get; set; } = ""; }

    private sealed class Sink : IChangeAuditSink
    {
        public List<ChangeRecord> Records { get; } = [];
        public void Enqueue(ChangeRecord record) => Records.Add(record);
    }

    private sealed class TestDb(DbContextOptions<TestDb> o) : DbContext(o)
    {
        public DbSet<Person> People => Set<Person>();
        public DbSet<NotAudited> Others => Set<NotAudited>();
        protected override void OnModelCreating(ModelBuilder b)
        {
            b.HasDefaultSchema("org");
            b.Entity<Person>().OwnsOne(p => p.Home);
        }
    }

    private static (TestDb Db, Sink Sink) Create()
    {
        var sink = new Sink();
        var sp = new ServiceCollection().AddSingleton<IChangeAuditSink>(sink).BuildServiceProvider();
        var interceptor = new AuditSaveChangesInterceptor(sp, TimeProvider.System);
        var db = new TestDb(new DbContextOptionsBuilder<TestDb>().UseInMemoryDatabase(Guid.NewGuid().ToString()).AddInterceptors(interceptor).Options);
        return (db, sink);
    }

    [Fact]
    public async Task Records_add_modify_delete_with_masking_and_ignored_fields()
    {
        var (db, sink) = Create();
        var p = new Person { FullName = "Nguyễn Văn An", SalaryEncrypted = "v1:abc", Pin = "1234", JoinedAt = new DateOnly(2026, 11, 1) };
        db.People.Add(p);
        db.Others.Add(new NotAudited { Id = 1, Name = "x" });
        await db.SaveChangesAsync();

        var added = Assert.Single(sink.Records);
        Assert.Equal(("org", "Person", "Added", "Nguyễn Văn An", "system"), (added.Module, added.Entity, added.Action, added.EntityLabel, added.Source));
        Assert.Equal(p.Id.ToString(), added.EntityId);
        Assert.Contains(added.Changes, c => c is { Field: "SalaryEncrypted", New: "•••", Masked: true });
        Assert.Contains(added.Changes, c => c is { Field: "Pin", New: "•••", Masked: true });
        Assert.Contains(added.Changes, c => c is { Field: "JoinedAt", New: "2026-11-01" });
        Assert.DoesNotContain(added.Changes, c => c.Field is "Id" or "UpdatedAt");

        sink.Records.Clear();
        p.UpdatedAt = DateTimeOffset.UtcNow;            // chỉ trường kỹ thuật → không ghi
        p.Home.City = "Hà Nội";                         // entity owned → bỏ qua
        await db.SaveChangesAsync();
        Assert.Empty(sink.Records);

        p.FullName = "Nguyễn Văn Bình";
        p.SalaryEncrypted = "v1:def";
        await db.SaveChangesAsync();
        var mod = Assert.Single(sink.Records);
        Assert.Equal("Modified", mod.Action);
        Assert.Equal(2, mod.Changes.Count);
        Assert.Contains(mod.Changes, c => c is { Field: "FullName", Old: "Nguyễn Văn An", New: "Nguyễn Văn Bình" });
        Assert.Contains(mod.Changes, c => c is { Field: "SalaryEncrypted", Old: "•••", New: "•••", Masked: true });
        Assert.DoesNotContain(mod.Changes, c => c.Old == "v1:abc" || c.New == "v1:def");

        sink.Records.Clear();
        db.People.Remove(p);
        await db.SaveChangesAsync();
        var del = Assert.Single(sink.Records);
        Assert.Equal(("Deleted", "Nguyễn Văn Bình"), (del.Action, del.EntityLabel));
    }

    [Fact]
    public async Task Failed_save_records_nothing()
    {
        var (db, sink) = Create();
        var id = Guid.NewGuid();
        db.People.Add(new Person { Id = id, FullName = "A" });
        await db.SaveChangesAsync();
        sink.Records.Clear();
        db.ChangeTracker.Clear();
        db.People.Add(new Person { Id = id, FullName = "Trùng khoá" });
        await Assert.ThrowsAnyAsync<Exception>(() => db.SaveChangesAsync());
        Assert.Empty(sink.Records);
    }
}
