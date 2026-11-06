using System.Text.RegularExpressions;

namespace OfficeHub.Architecture.Tests;

/// <summary>
/// Luật 5 (AGENTS.md): thời gian do server quyết định qua <see cref="TimeProvider"/> (UTC), lưu DateTimeOffset UTC.
/// Không gọi thẳng DateTime.Now / UtcNow / Today, DateTimeOffset.Now / UtcNow — để test giả lập được giờ và không lẫn giờ máy.
/// </summary>
public partial class TimeSourceTests
{
    [Fact]
    public void Backend_uses_TimeProvider_instead_of_system_clock()
    {
        var src = FindSrc();
        var violations = Directory.EnumerateFiles(src, "*.cs", SearchOption.AllDirectories)
            .Where(f => !f.Contains($"{Path.DirectorySeparatorChar}bin{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}")
                     && !f.Contains($"{Path.DirectorySeparatorChar}Migrations{Path.DirectorySeparatorChar}"))
            .SelectMany(f => File.ReadLines(f).Select((line, i) => (f, i, line)))
            .Where(x => SystemClock().IsMatch(x.line) && !x.line.TrimStart().StartsWith("//"))
            .Select(x => $"{Path.GetRelativePath(src, x.f)}:{x.i + 1}: {x.line.Trim()}")
            .ToList();
        Assert.True(violations.Count == 0, "Dùng TimeProvider.GetUtcNow() thay vì đồng hồ hệ thống:\n" + string.Join("\n", violations));
    }

    private static string FindSrc()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "OfficeHub.slnx"))) return Path.Combine(d.FullName, "src");
        throw new DirectoryNotFoundException("Không tìm thấy backend/src (OfficeHub.slnx)");
    }

    [GeneratedRegex(@"\bDateTime(Offset)?\.(Now|UtcNow|Today)\b")]
    private static partial Regex SystemClock();
}
