using System.Diagnostics;
using System.Globalization;

namespace OfficeHub.Api;

/// <summary>CPU cả máy. Cores = số nhân (dòng cpuN trong /proc/stat, không đọc được thì Environment.ProcessorCount); Load = load average 1 / 5 / 15 phút.</summary>
public sealed record CpuInfoDto(int Cores, double? Percent, string? Level, IReadOnlyList<double>? Load);
/// <summary>RAM cả máy (/proc/meminfo: Used = MemTotal − MemAvailable) + RAM riêng tiến trình Api + giới hạn container (null = không giới hạn / không đọc được).</summary>
public sealed record MemoryInfoDto(long? TotalBytes, long? UsedBytes, long? AvailableBytes, double? Percent, string? Level, long ProcessBytes, long? ContainerLimitBytes);
/// <summary>Một phân vùng: Free = dung lượng còn dùng được (cột Avail của df); Percent = Used / (Used + Free) như df.</summary>
public sealed record DiskInfoDto(string Path, long TotalBytes, long UsedBytes, long FreeBytes, double Percent, string Level);
/// <summary>Disks rỗng = không đọc được ổ cứng.</summary>
public sealed record ServerResourcesDto(CpuInfoDto Cpu, MemoryInfoDto Memory, IReadOnlyList<DiskInfoDto> Disks);

/// <summary>
/// Tài nguyên của máy chạy container Api (TEST-124, thẻ "Thông tin máy chủ" ở Hệ thống → Tổng quan). Chỉ đo khi có request, không job nền.
/// Đọc /proc (Linux; container thấy /proc của máy chủ) — chạy Windows / macOS hay file thiếu / định dạng lạ thì mục đó null, không làm lỗi cả trang.
/// Ngưỡng: &lt; 80% "ok", 80–90% "warn", ≥ 90% "danger".
/// </summary>
public static class ServerResources
{
    public const string Ok = "ok", Warn = "warn", Danger = "danger";
    private static readonly TimeSpan CpuSampleGap = TimeSpan.FromMilliseconds(200);

    public static async Task<ServerResourcesDto> ReadAsync(string? keysPath, CancellationToken ct)
    {
        var first = ParseCpuStat(TryRead("/proc/stat"));
        CpuStatSample? second = null;
        if (first is not null)
        {
            await Task.Delay(CpuSampleGap, ct);
            second = ParseCpuStat(TryRead("/proc/stat"));
        }
        var cpuPercent = first is not null && second is not null ? CpuPercent(first, second) : null;
        var cpu = new CpuInfoDto(second?.Cores ?? first?.Cores ?? Environment.ProcessorCount, cpuPercent, LevelOf(cpuPercent),
            ParseLoadAvg(TryRead("/proc/loadavg")));

        var mem = ParseMemInfo(TryRead("/proc/meminfo"));
        var memPercent = mem is { Total: > 0 } m ? Round((double)(m.Total - m.Available) / m.Total * 100) : (double?)null;
        long processBytes;
        using (var p = Process.GetCurrentProcess()) processBytes = p.WorkingSet64;
        var memory = new MemoryInfoDto(mem?.Total, mem is { } mv ? mv.Total - mv.Available : null, mem?.Available, memPercent, LevelOf(memPercent),
            processBytes, ParseMemoryMax(TryRead("/sys/fs/cgroup/memory.max")));

        return new ServerResourcesDto(cpu, memory, ReadDisks(keysPath));
    }

    /// <summary>Mức cảnh báo theo %: &lt; 80 ok, 80–90 warn, ≥ 90 danger; null → null.</summary>
    public static string? LevelOf(double? percent) => percent switch
    {
        null => null,
        >= 90 => Danger,
        >= 80 => Warn,
        _ => Ok,
    };

    /// <summary>Một lần đọc /proc/stat: Idle = idle + iowait; Total = user..steal (guest đã nằm trong user nên không cộng).</summary>
    public sealed record CpuStatSample(long Idle, long Total, int Cores);

    public static CpuStatSample? ParseCpuStat(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        CpuStatSample? sample = null;
        var cores = 0;
        foreach (var raw in text.Split('\n'))
        {
            var line = raw.Trim();
            if (!line.StartsWith("cpu", StringComparison.Ordinal)) continue;
            var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts[0] == "cpu")
            {
                if (parts.Length < 5) return null;
                var values = new long[Math.Min(parts.Length - 1, 8)];
                for (var i = 0; i < values.Length; i++)
                    if (!long.TryParse(parts[i + 1], NumberStyles.None, CultureInfo.InvariantCulture, out values[i])) return null;
                var idle = values[3] + (values.Length > 4 ? values[4] : 0);
                sample = new CpuStatSample(idle, values.Sum(), 0);
            }
            else if (parts[0].Length > 3 && parts[0][3..].All(char.IsAsciiDigit)) cores++;
        }
        return sample is null ? null : sample with { Cores = cores > 0 ? cores : Environment.ProcessorCount };
    }

    /// <summary>% CPU bận giữa hai lần đọc; bộ đếm không tăng / lùi → null.</summary>
    public static double? CpuPercent(CpuStatSample a, CpuStatSample b)
    {
        var total = b.Total - a.Total;
        var idle = b.Idle - a.Idle;
        if (total <= 0 || idle < 0 || idle > total) return null;
        return Round((double)(total - idle) / total * 100);
    }

    /// <summary>"0.42 0.38 0.31 1/234 5678" → [0.42, 0.38, 0.31].</summary>
    public static IReadOnlyList<double>? ParseLoadAvg(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return null;
        var parts = text.Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length < 3) return null;
        var load = new double[3];
        for (var i = 0; i < 3; i++)
            if (!double.TryParse(parts[i], NumberStyles.Float, CultureInfo.InvariantCulture, out load[i]) || load[i] < 0) return null;
        return load;
    }

    /// <summary>MemTotal + MemAvailable (kB → byte); thiếu một trong hai hay sai định dạng → null.</summary>
    public static (long Total, long Available)? ParseMemInfo(string? text)
    {
        if (string.IsNullOrEmpty(text)) return null;
        long? total = null, available = null;
        foreach (var raw in text.Split('\n'))
        {
            var colon = raw.IndexOf(':');
            if (colon <= 0) continue;
            var key = raw[..colon].Trim();
            if (key is not ("MemTotal" or "MemAvailable")) continue;
            var parts = raw[(colon + 1)..].Split(' ', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (parts.Length == 0 || !long.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var kb)) return null;
            var multiplier = parts.Length > 1 && parts[1].Equals("kB", StringComparison.OrdinalIgnoreCase) ? 1024L : parts.Length > 1 ? 0 : 1;
            if (multiplier == 0) return null;
            if (key == "MemTotal") total = kb * multiplier; else available = kb * multiplier;
        }
        return total is > 0 && available is >= 0 && available <= total ? (total.Value, available.Value) : null;
    }

    /// <summary>cgroup v2 memory.max: số byte → giới hạn; "max" (không giới hạn), thiếu file, sai định dạng → null.</summary>
    public static long? ParseMemoryMax(string? text)
    {
        var v = text?.Trim();
        return !string.IsNullOrEmpty(v) && long.TryParse(v, NumberStyles.None, CultureInfo.InvariantCulture, out var bytes) && bytes > 0 ? bytes : null;
    }

    /// <summary>Phân vùng "/" + phân vùng chứa thư mục khoá (volume keys) nếu khác. Không đọc được → bỏ qua phân vùng đó.</summary>
    private static List<DiskInfoDto> ReadDisks(string? keysPath)
    {
        var disks = new List<DiskInfoDto>();
        var root = TryDisk("/", "/");
        if (root is not null) disks.Add(root);
        if (!string.IsNullOrWhiteSpace(keysPath) && OperatingSystem.IsLinux())
        {
            var mount = MountPointOf(keysPath);
            if (mount is not null && mount != "/" && TryDisk(mount, keysPath) is { } keys
                && (root is null || keys.TotalBytes != root.TotalBytes || keys.FreeBytes != root.FreeBytes))
                disks.Add(keys);
        }
        return disks;
    }

    /// <summary>Điểm mount dài nhất là tiền tố của path (theo DriveInfo.GetDrives = /proc/self/mountinfo).</summary>
    private static string? MountPointOf(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            return DriveInfo.GetDrives().Select(d => d.Name.TrimEnd('/') is "" ? "/" : d.Name.TrimEnd('/'))
                .Where(m => m == "/" || full == m || full.StartsWith(m + "/", StringComparison.Ordinal))
                .OrderByDescending(m => m.Length).FirstOrDefault();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return null; }
    }

    private static DiskInfoDto? TryDisk(string mount, string label)
    {
        try
        {
            var d = new DriveInfo(mount);
            if (!d.IsReady || d.TotalSize <= 0) return null;
            var used = d.TotalSize - d.TotalFreeSpace;
            var free = d.AvailableFreeSpace;
            var percent = used + free > 0 ? Round((double)used / (used + free) * 100) : 0;
            return new DiskInfoDto(label, d.TotalSize, used, free, percent, LevelOf(percent)!);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException) { return null; }
    }

    private static string? TryRead(string path)
    {
        if (!OperatingSystem.IsLinux()) return null;
        try { return File.ReadAllText(path); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { return null; }
    }

    private static double Round(double v) => Math.Round(v, 1);
}
