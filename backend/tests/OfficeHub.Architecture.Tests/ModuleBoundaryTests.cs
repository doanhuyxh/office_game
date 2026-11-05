using System.Reflection;

namespace OfficeHub.Architecture.Tests;

/// <summary>
/// Giữ ranh giới module: module A KHÔNG được tham chiếu trực tiếp module B.
/// Nếu cần dùng chung, tách phần công khai của B ra project "OfficeHub.Modules.B.Contracts".
/// </summary>
public class ModuleBoundaryTests
{
    private static readonly Assembly[] Modules = Assembly.Load("OfficeHub.Api")
        .GetReferencedAssemblies()
        .Where(a => a.Name!.StartsWith("OfficeHub.Modules.") && !a.Name.EndsWith(".Contracts"))
        .Select(Assembly.Load)
        .ToArray();

    [Fact]
    public void Api_loads_all_modules() => Assert.True(Modules.Length >= 9, $"Chỉ tìm thấy {Modules.Length} module");

    [Fact]
    public void Modules_do_not_reference_each_other()
    {
        var violations = Modules
            .SelectMany(m => m.GetReferencedAssemblies()
                .Where(r => r.Name!.StartsWith("OfficeHub.Modules.") && !r.Name.EndsWith(".Contracts"))
                .Select(r => $"{m.GetName().Name} → {r.Name}"))
            .ToList();
        Assert.True(violations.Count == 0, "Module tham chiếu chéo:\n" + string.Join("\n", violations));
    }

    [Fact]
    public void Realtime_does_not_reference_business_modules()
    {
        var refs = typeof(OfficeHub.Realtime.Hubs.OfficeRoomHub).Assembly.GetReferencedAssemblies()
            .Where(r => r.Name!.StartsWith("OfficeHub.Modules.") && !r.Name.EndsWith(".Contracts"))
            .Select(r => r.Name);
        Assert.Empty(refs);
    }
}
