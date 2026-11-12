namespace OfficeHub.BuildingBlocks.Http;

/// <summary>
/// Mẫu tìm cho <c>EF.Functions.ILike</c> (Postgres, ký tự thoát mặc định là <c>\</c>): thoát <c>\ % _</c> trong từ khoá người dùng nhập
/// (TEST-22) — gõ "%" không còn khớp mọi dòng, "_" không còn là ký tự đại diện.
/// </summary>
public static class Like
{
    public static string Escape(string term) => term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    /// <summary>"%{từ khoá đã thoát}%" — chứa chuỗi.</summary>
    public static string Contains(string term) => $"%{Escape(term.Trim())}%";
}
