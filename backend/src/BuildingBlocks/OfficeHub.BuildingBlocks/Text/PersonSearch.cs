using System.Globalization;
using System.Text;

namespace OfficeHub.BuildingBlocks.Text;

/// <summary>
/// Tìm người cho gợi ý @nhắc (TEST-71) — dùng chung Bảng tin, Chat (qua <c>IEmployeeDirectory.SearchActiveAsync</c>) và lọc trong bộ nhớ
/// (thành viên nhóm chat). Bỏ dấu, tách từ (tối đa <see cref="MaxTokens"/>), MỌI từ phải khớp (họ tên, mã, phòng ban, chức vụ).
/// Hạng (nhỏ = tốt): mã khớp chính xác → đầu tên gọi (từ cuối họ tên) → đầu một từ trong họ tên → đầu mã / từ phòng ban / chức vụ → giữa chuỗi.
/// FE có bản cùng quy tắc cho bình luận việc: <c>frontend/src/utils/mention.ts</c> (<c>rankPeople</c>).
/// </summary>
public static class PersonSearch
{
    public const int MaxTokens = 3;
    public const int MaxTermLength = 40;

    /// <summary>Chữ thường, bỏ dấu tiếng Việt (đ → d) — "Nguyễn" → "nguyen".</summary>
    public static string Fold(string? s)
    {
        var sb = new StringBuilder();
        foreach (var c in (s ?? "").Normalize(NormalizationForm.FormD))
        {
            if (CharUnicodeInfo.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark) continue;
            sb.Append(c is 'đ' or 'Đ' ? 'd' : char.ToLowerInvariant(c));
        }
        return sb.ToString();
    }

    /// <summary>Từ khoá đã bỏ dấu, tách theo khoảng trắng, bỏ trùng; cắt <see cref="MaxTermLength"/> ký tự và <see cref="MaxTokens"/> từ.</summary>
    public static IReadOnlyList<string> Tokens(string? term)
    {
        var t = (term ?? "").Trim();
        if (t.Length > MaxTermLength) t = t[..MaxTermLength];
        return Fold(t).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries).Distinct().Take(MaxTokens).ToList();
    }

    /// <summary>
    /// Hạng của một người với các từ khoá (null = không khớp). Không có từ khoá → 0 (mọi người cùng hạng, xếp theo tên).
    /// Điểm = hạng kém nhất trong các từ × 16 + tổng hạng (≤ 3 từ × hạng ≤ 4 &lt; 16) — người khớp tốt mọi từ đứng trước.
    /// </summary>
    public static int? Rank(IReadOnlyList<string> tokens, string fullName, string code, string? department = null, string? title = null)
    {
        if (tokens.Count == 0) return 0;
        var name = Words(fullName);
        var fCode = Fold(code);
        var other = Words($"{department} {title}");
        int worst = 0, sum = 0;
        foreach (var t in tokens)
        {
            int tier;
            if (fCode == t) tier = 0;
            else if (name.Length > 0 && name[^1].StartsWith(t, StringComparison.Ordinal)) tier = 1;
            else if (name.Any(w => w.StartsWith(t, StringComparison.Ordinal))) tier = 2;
            else if (fCode.StartsWith(t, StringComparison.Ordinal) || other.Any(w => w.StartsWith(t, StringComparison.Ordinal))) tier = 3;
            else if (name.Any(w => w.Contains(t, StringComparison.Ordinal)) || fCode.Contains(t, StringComparison.Ordinal)
                     || other.Any(w => w.Contains(t, StringComparison.Ordinal))) tier = 4;
            else return null;
            worst = Math.Max(worst, tier);
            sum += tier;
        }
        return worst * 16 + sum;
    }

    /// <summary>Lọc + xếp hạng trong bộ nhớ (cùng hạng → theo họ tên), lấy tối đa <paramref name="limit"/>.</summary>
    public static List<T> Search<T>(IEnumerable<T> people, string? term, int limit, Func<T, string> fullName, Func<T, string> code,
        Func<T, string?>? department = null, Func<T, string?>? title = null)
    {
        var tokens = Tokens(term);
        return people
            .Select(p => (p, rank: Rank(tokens, fullName(p), code(p), department?.Invoke(p), title?.Invoke(p))))
            .Where(x => x.rank is not null)
            .OrderBy(x => x.rank)
            .ThenBy(x => fullName(x.p), StringComparer.Create(CultureInfo.GetCultureInfo("vi-VN"), ignoreCase: true))
            .Take(limit)
            .Select(x => x.p)
            .ToList();
    }

    private static string[] Words(string? s) => Fold(s).Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);

    /// <summary>
    /// Cặp chuỗi cho hàm SQL <c>translate(text, from, to)</c> — bỏ dấu tiếng Việt / Latin ngay trong PostgreSQL (không cần extension unaccent),
    /// để lọc thô bằng ILIKE trước khi xếp hạng. Ký tự hoa có dấu → chữ thường không dấu (ILIKE lo phần hoa / thường ASCII).
    /// </summary>
    public static readonly (string From, string To) SqlFoldMap = BuildSqlFoldMap();

    private static (string, string) BuildSqlFoldMap()
    {
        var from = new StringBuilder();
        var to = new StringBuilder();
        foreach (var (start, end) in new[] { (0x00C0, 0x024F), (0x1E00, 0x1EFF) })
            for (var i = start; i <= end; i++)
            {
                var c = (char)i;
                var f = Fold(c.ToString());
                if (f.Length == 1 && f[0] is >= 'a' and <= 'z') { from.Append(c); to.Append(f[0]); }
            }
        return (from.ToString(), to.ToString());
    }
}
