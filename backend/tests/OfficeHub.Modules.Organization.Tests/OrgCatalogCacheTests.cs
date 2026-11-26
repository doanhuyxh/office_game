using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using OfficeHub.BuildingBlocks.Caching;
using OfficeHub.BuildingBlocks.Security;
using OfficeHub.Modules.Organization.Contracts;
using OfficeHub.Modules.Organization.Domain;
using OfficeHub.Modules.Organization.Infrastructure;

namespace OfficeHub.Modules.Organization.Tests;

/// <summary>
/// Cache danh mục Organization (TEST-245): lần đọc sau lấy từ RAM; đổi quản lý / phòng ban / chức vụ / xoá nhân viên qua SaveChanges
/// → lần gọi kế tiếp thấy ngay. DB = EF InMemory (ExecuteUpdate / transaction thật → e2e trên Postgres tạm); nhận diện câu SQL ghi
/// (ExecuteUpdate / ExecuteDelete) kiểm bằng model Npgsql.
/// </summary>
public sealed class OrgCatalogCacheTests : IAsyncLifetime
{
    private ServiceProvider _sp = null!;
    private Guid _boss, _mgrA, _mgrB, _staff, _staffChild, _dept, _pos;

    private sealed class NoEncryption : IFieldEncryptor
    {
        public string Encrypt(string plain) => plain;
        public string Decrypt(string token) => token;
    }

    public async Task InitializeAsync()
    {
        var s = new ServiceCollection();
        var dbName = Guid.NewGuid().ToString();
        s.AddDbContext<OrgDbContext>(o => o.UseInMemoryDatabase(dbName));
        s.AddCatalogCache<OrgDbContext>(r => r
            .On<Employee>(OrgCacheTags.Employees)
            .On<Department>(OrgCacheTags.Departments, OrgCacheTags.Employees)
            .On<Position>(OrgCacheTags.Positions));
        s.AddSingleton<IFieldEncryptor, NoEncryption>();
        s.AddScoped<OrgCatalog>();
        s.AddScoped<IFinanceAccess, FinanceAccess>();
        s.AddScoped<IEmployeeDirectory, EmployeeDirectory>();
        _sp = s.BuildServiceProvider();

        await using var scope = _sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<OrgDbContext>();
        var dept = new Department { Name = "Kỹ thuật" };
        var pos = new Position { Name = "Nhân viên", Level = 7 };
        db.AddRange(dept, pos);
        Employee E(string code, Guid? manager) => new()
        {
            Code = code, FullName = code, ManagerId = manager, DepartmentId = dept.Id, PositionId = pos.Id,
            JoinedAt = new DateOnly(2025, 1, 1), Status = EmployeeStatus.Active,
        };
        var boss = E("NV001", null);
        var a = E("NV002", boss.Id);
        var b = E("NV003", boss.Id);
        var staff = E("NV004", a.Id);
        var child = E("NV005", staff.Id);
        db.AddRange(boss, a, b, staff, child);
        await db.SaveChangesAsync();
        (_boss, _mgrA, _mgrB, _staff, _staffChild, _dept, _pos) = (boss.Id, a.Id, b.Id, staff.Id, child.Id, dept.Id, pos.Id);
    }

    public async Task DisposeAsync() => await _sp.DisposeAsync();

    private async Task<T> Dir<T>(Func<IEmployeeDirectory, Task<T>> f)
    {
        await using var scope = _sp.CreateAsyncScope();
        return await f(scope.ServiceProvider.GetRequiredService<IEmployeeDirectory>());
    }

    private async Task Db(Func<OrgDbContext, Task> f)
    {
        await using var scope = _sp.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<OrgDbContext>();
        await f(db);
        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Second_read_comes_from_memory_snapshot()
    {
        var first = await Dir(d => d.GetAsync(_staff));
        var second = await Dir(d => d.GetAsync(_staff));
        Assert.NotNull(first);
        Assert.Same(first, second); // cùng đối tượng trong RAM, không đọc DB / không serialize lại
        Assert.Equal("Kỹ thuật", first!.DepartmentName);
    }

    [Fact]
    public async Task Changing_manager_updates_subordinates_of_old_and_new_manager_immediately()
    {
        Assert.True(new HashSet<Guid> { _staff, _staffChild }.SetEquals(await Dir(d => d.GetSubordinateIdsAsync(_mgrA))));
        Assert.Empty(await Dir(d => d.GetSubordinateIdsAsync(_mgrB)));

        await Db(async db => (await db.Employees.SingleAsync(e => e.Id == _staff)).ManagerId = _mgrB);

        Assert.Empty(await Dir(d => d.GetSubordinateIdsAsync(_mgrA)));
        Assert.True(new HashSet<Guid> { _staff, _staffChild }.SetEquals(await Dir(d => d.GetSubordinateIdsAsync(_mgrB))));
        Assert.Equal(4, (await Dir(d => d.GetSubordinateIdsAsync(_boss))).Count);
        Assert.Equal(_mgrB, (await Dir(d => d.GetAsync(_staff)))!.ManagerId);
    }

    [Fact]
    public async Task Resigning_and_soft_deleting_employee_is_visible_immediately()
    {
        Assert.Equal(5, (await Dir(d => d.ListActiveAsync())).Count);
        await Db(async db => (await db.Employees.SingleAsync(e => e.Id == _staffChild)).Status = EmployeeStatus.Resigned);
        Assert.Equal(4, (await Dir(d => d.ListActiveAsync())).Count);
        Assert.False((await Dir(d => d.GetAsync(_staffChild)))!.IsActive);

        await Db(async db => (await db.Employees.SingleAsync(e => e.Id == _staffChild)).DeletedAt = DateTimeOffset.UtcNow);
        Assert.Null(await Dir(d => d.GetAsync(_staffChild)));
        Assert.DoesNotContain(_staffChild, await Dir(d => d.GetSubordinateIdsAsync(_mgrA)));
    }

    [Fact]
    public async Task Department_change_refreshes_department_list_and_employee_department_name()
    {
        Assert.Single(await Dir(d => d.ListDepartmentsAsync()));
        await Db(async db =>
        {
            (await db.Departments.SingleAsync(d => d.Id == _dept)).Name = "Công nghệ";
            db.Departments.Add(new Department { Name = "Kinh doanh" });
        });
        var list = await Dir(d => d.ListDepartmentsAsync());
        Assert.Equal(["Công nghệ", "Kinh doanh"], list.Select(d => d.Name).Order());
        Assert.Equal("Công nghệ", (await Dir(d => d.GetAsync(_staff)))!.DepartmentName);
    }

    [Fact]
    public async Task Position_change_is_visible_immediately()
    {
        Assert.Equal("Nhân viên", (await Dir(d => d.GetPositionAsync(_staff)))!.Name);
        await Db(async db => (await db.Positions.SingleAsync(p => p.Id == _pos)).Name = "Chuyên viên");
        Assert.Equal("Chuyên viên", (await Dir(d => d.GetPositionAsync(_staff)))!.Name);

        var lead = new Position { Name = "Trưởng nhóm", Level = 5 };
        await Db(async db =>
        {
            db.Positions.Add(lead);
            (await db.Employees.SingleAsync(e => e.Id == _staff)).PositionId = lead.Id;
        });
        Assert.Equal("Trưởng nhóm", (await Dir(d => d.GetPositionAsync(_staff)))!.Name);
    }

    [Fact]
    public async Task Finance_permission_follows_position_and_status_immediately()
    {
        var userId = Guid.NewGuid();
        await Db(async db => (await db.Employees.SingleAsync(e => e.Id == _staff)).UserId = userId);
        async Task<FinancePermission> Perm()
        {
            await using var scope = _sp.CreateAsyncScope(); // FinanceAccess nhớ kết quả trong một request → mỗi lần một scope
            return await scope.ServiceProvider.GetRequiredService<IFinanceAccess>().GetAsync(userId);
        }
        async Task<IReadOnlyList<Guid>> Approvers()
        {
            await using var scope = _sp.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<IFinanceAccess>().ListUserIdsAsync(FinancePermission.Approve);
        }

        Assert.Equal(FinancePermission.None, await Perm());
        await Db(async db => (await db.Positions.SingleAsync(p => p.Id == _pos)).FinancePermissions = (int)FinancePermission.Approve);
        Assert.Equal(FinancePermission.Approve | FinancePermission.View, await Perm());
        Assert.Equal([userId], await Approvers());

        await Db(async db => (await db.Employees.SingleAsync(e => e.Id == _staff)).Status = EmployeeStatus.Resigned);
        Assert.Equal(FinancePermission.None, await Perm());
        Assert.Empty(await Approvers());
    }

    [Fact]
    public async Task Returned_collections_do_not_leak_the_snapshot()
    {
        var list = (List<EmployeeRef>)await Dir(d => d.ListActiveAsync());
        list.Clear();
        var subs = (HashSet<Guid>)await Dir(d => d.GetSubordinateIdsAsync(_mgrA));
        subs.Clear();
        Assert.Equal(5, (await Dir(d => d.ListActiveAsync())).Count);
        Assert.Equal(2, (await Dir(d => d.GetSubordinateIdsAsync(_mgrA))).Count);
    }

    [Fact]
    public void Sql_write_detection_matches_execute_update_and_delete_on_source_tables_only()
    {
        var cache = _sp.GetRequiredService<CatalogCache>();
        var inv = new CatalogCacheInvalidation<OrgDbContext>(cache, new CatalogCacheRules()
            .On<Employee>(OrgCacheTags.Employees)
            .On<Department>(OrgCacheTags.Departments, OrgCacheTags.Employees)
            .On<Position>(OrgCacheTags.Positions));
        using var db = new OrgDbContext(new DbContextOptionsBuilder<OrgDbContext>().UseNpgsql("Host=localhost;Database=none").Options);

        Assert.Equal([OrgCacheTags.Employees],
            inv.TagsForSql(db, "UPDATE org.employees AS e\nSET \"ManagerId\" = NULL\nWHERE e.\"ManagerId\" = @id"));
        Assert.Equal([OrgCacheTags.Departments, OrgCacheTags.Employees],
            inv.TagsForSql(db, "UPDATE org.departments AS d SET \"HeadEmployeeId\" = NULL WHERE d.\"HeadEmployeeId\" = @id").Order());
        Assert.Equal([OrgCacheTags.Positions], inv.TagsForSql(db, "DELETE FROM \"org\".\"positions\" WHERE \"Id\" = @p0"));
        Assert.Equal([OrgCacheTags.Employees], inv.TagsForSql(db, "INSERT INTO org.employees (\"Id\") VALUES (@p0)"));
        Assert.Empty(inv.TagsForSql(db, "SELECT e.\"Id\" FROM org.employees AS e"));
        Assert.Empty(inv.TagsForSql(db, "UPDATE org.profile_change_requests SET \"Status\" = 1"));
        Assert.Empty(inv.TagsForSql(db, "UPDATE org.employees_archive SET x = 1"));
    }
}
