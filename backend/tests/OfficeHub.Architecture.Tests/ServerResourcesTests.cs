using OfficeHub.Api;

namespace OfficeHub.Architecture.Tests;

/// <summary>Trang Hệ thống → Tổng quan (TEST-124): đọc CPU / RAM / giới hạn container từ chuỗi /proc mẫu; thiếu file / sai định dạng → null.</summary>
public class ServerResourcesTests
{
    private const string Stat1 = """
        cpu  100 0 50 800 50 0 0 0 0 0
        cpu0 50 0 25 400 25 0 0 0 0 0
        cpu1 50 0 25 400 25 0 0 0 0 0
        intr 12345
        ctxt 999
        """;
    private const string Stat2 = """
        cpu  160 0 70 900 70 0 0 0 0 0
        cpu0 80 0 35 450 35 0 0 0 0 0
        cpu1 80 0 35 450 35 0 0 0 0 0
        """;

    [Fact]
    public void Cpu_stat_counts_cores_and_usage_from_two_samples()
    {
        var a = ServerResources.ParseCpuStat(Stat1)!;
        var b = ServerResources.ParseCpuStat(Stat2)!;
        Assert.Equal(2, a.Cores);
        Assert.Equal(850, a.Idle);
        Assert.Equal(1000, a.Total);
        // Δtotal = 1200 − 1000 = 200, Δidle = 970 − 850 = 120 → bận 80 / 200 = 40%
        Assert.Equal(40, ServerResources.CpuPercent(a, b));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("intr 1 2 3")]
    [InlineData("cpu  1 2 x 4 5")]
    [InlineData("cpu  1 2")]
    public void Cpu_stat_missing_or_malformed_is_null(string? text) => Assert.Null(ServerResources.ParseCpuStat(text));

    [Fact]
    public void Cpu_percent_without_progress_is_null()
    {
        var a = ServerResources.ParseCpuStat(Stat1)!;
        Assert.Null(ServerResources.CpuPercent(a, a));
    }

    [Fact]
    public void Load_average_parses_three_values() =>
        Assert.Equal([0.42, 0.38, 0.31], ServerResources.ParseLoadAvg("0.42 0.38 0.31 1/234 5678\n"));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0.42 0.38")]
    [InlineData("a b c 1/2 3")]
    public void Load_average_missing_or_malformed_is_null(string? text) => Assert.Null(ServerResources.ParseLoadAvg(text));

    [Fact]
    public void Meminfo_reads_total_and_available_in_bytes()
    {
        const string text = """
            MemTotal:        8000000 kB
            MemFree:          500000 kB
            MemAvailable:    3000000 kB
            Buffers:          100000 kB
            """;
        var m = ServerResources.ParseMemInfo(text);
        Assert.Equal((8_000_000L * 1024, 3_000_000L * 1024), m);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("MemTotal: 8000000 kB\nMemFree: 1 kB")] // thiếu MemAvailable
    [InlineData("MemTotal: abc kB\nMemAvailable: 1 kB")]
    [InlineData("MemTotal: 100 kB\nMemAvailable: 200 kB")] // còn dùng được > tổng
    [InlineData("MemTotal: 100 MB\nMemAvailable: 50 MB")] // đơn vị lạ
    public void Meminfo_missing_or_malformed_is_null(string? text) => Assert.Null(ServerResources.ParseMemInfo(text));

    [Theory]
    [InlineData("1073741824\n", 1073741824L)]
    [InlineData("max\n", null)]
    [InlineData("", null)]
    [InlineData(null, null)]
    [InlineData("12abc", null)]
    public void Memory_max_parses_limit_or_null(string? text, long? expected) => Assert.Equal(expected, ServerResources.ParseMemoryMax(text));

    [Theory]
    [InlineData(null, null)]
    [InlineData(0d, "ok")]
    [InlineData(79.9, "ok")]
    [InlineData(80d, "warn")]
    [InlineData(89.9, "warn")]
    [InlineData(90d, "danger")]
    [InlineData(100d, "danger")]
    public void Level_follows_80_90_thresholds(double? percent, string? expected) => Assert.Equal(expected, ServerResources.LevelOf(percent));

    [Fact]
    public async Task Read_never_throws_on_any_platform()
    {
        var r = await ServerResources.ReadAsync(Path.GetTempPath(), CancellationToken.None);
        Assert.True(r.Cpu.Cores > 0);
        Assert.True(r.Memory.ProcessBytes > 0);
        if (!OperatingSystem.IsLinux())
        {
            Assert.Null(r.Cpu.Percent);
            Assert.Null(r.Memory.TotalBytes);
        }
    }
}
