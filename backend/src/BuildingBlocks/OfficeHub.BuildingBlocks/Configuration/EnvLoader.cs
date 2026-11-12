namespace OfficeHub.BuildingBlocks.Configuration;

/// <summary>
/// Nạp file <c>.env</c> ở gốc repo (tìm ngược từ thư mục hiện tại) vào biến môi trường.
/// Biến môi trường đã có sẵn (do Docker / CI đặt) luôn được ưu tiên, không bị ghi đè.
/// Phải gọi TRƯỚC <c>WebApplication.CreateBuilder</c>.
/// Dừng ở gốc git (thư mục có <c>.git</c> — thư mục hoặc file của worktree): worktree nằm trong repo (agent-runner, <c>.claude/worktrees</c>)
/// KHÔNG đọc nhầm <c>.env</c> của repo chính (đang trỏ DB production) — TEST-44. Không có <c>.git</c> (container) → dò tới gốc ổ đĩa như cũ.
/// </summary>
public static class EnvLoader
{
    /// <summary>Thư mục chứa file .env đã nạp (null nếu không tìm thấy).</summary>
    public static string? RootDirectory { get; private set; }

    public static void Load() => Load(Directory.GetCurrentDirectory());

    /// <summary>Tìm + nạp .env bắt đầu từ <paramref name="startDirectory"/>. Trả đường dẫn file đã nạp (null = không có).</summary>
    public static string? Load(string startDirectory)
    {
        var found = Find(startDirectory);
        if (found is null) return null;
        DotNetEnv.Env.NoClobber().Load(found);
        RootDirectory = Path.GetDirectoryName(found);
        return found;
    }

    /// <summary>File .env sẽ được nạp khi chạy từ <paramref name="startDirectory"/> (không nạp) — hàm thuần để test.</summary>
    public static string? Find(string startDirectory)
    {
        var dir = new DirectoryInfo(startDirectory);
        while (dir is not null)
        {
            var candidate = Path.Combine(dir.FullName, ".env");
            if (File.Exists(candidate)) return candidate;
            if (Directory.Exists(Path.Combine(dir.FullName, ".git")) || File.Exists(Path.Combine(dir.FullName, ".git"))) return null; // gốc repo / worktree
            dir = dir.Parent;
        }
        return null;
    }

    /// <summary>Đường dẫn tương đối trong .env được tính từ thư mục chứa .env.</summary>
    public static string ResolvePath(string path, string fallbackRoot) =>
        Path.IsPathRooted(path) ? path : Path.GetFullPath(Path.Combine(RootDirectory ?? fallbackRoot, path));
}
