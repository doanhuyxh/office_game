namespace OfficeHub.BuildingBlocks.Configuration;

/// <summary>
/// Nạp file <c>.env</c> ở gốc repo (tìm ngược từ thư mục hiện tại) vào biến môi trường.
/// Biến môi trường đã có sẵn (do Docker / CI đặt) luôn được ưu tiên, không bị ghi đè.
/// Phải gọi TRƯỚC <c>WebApplication.CreateBuilder</c>.
/// </summary>
public static class EnvLoader
{
    /// <summary>Thư mục chứa file .env đã nạp (null nếu không tìm thấy).</summary>
    public static string? RootDirectory { get; private set; }

    public static void Load()
    {
        var dir = new DirectoryInfo(Directory.GetCurrentDirectory());
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate))
            {
                DotNetEnv.Env.NoClobber().Load(candidate);
                RootDirectory = dir.FullName;
                return;
            }
            dir = dir.Parent;
        }
    }

    /// <summary>Đường dẫn tương đối trong .env được tính từ thư mục chứa .env.</summary>
    public static string ResolvePath(string path, string fallbackRoot) =>
        Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(RootDirectory ?? fallbackRoot, path));
}
