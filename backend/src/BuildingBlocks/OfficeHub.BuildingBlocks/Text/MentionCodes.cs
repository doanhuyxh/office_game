using System.Text.RegularExpressions;

namespace OfficeHub.BuildingBlocks.Text;

/// <summary>
/// "@mã-nhân-viên" trong văn bản thường — cú pháp chung của bình luận việc (Projects, TEST-62/63) và tin nhắn chat (TEST-70).
/// FE khớp cùng mẫu ở <c>frontend/src/utils/mention.ts</c>. Hàm thuần — test ở OfficeHub.Modules.Projects.Tests (AgentTeamRulesTests).
/// </summary>
public static partial class MentionCodes
{
    [GeneratedRegex(@"(?<![\p{L}\p{N}_.@])@([\p{L}\p{N}_.\-]{2,40})", RegexOptions.CultureInvariant)]
    private static partial Regex MentionRegex();

    /// <summary>Mã được nhắc bằng @ (không phân biệt hoa thường, bỏ trùng, giữ thứ tự, tối đa <paramref name="max"/>).
    /// Bỏ dấu chấm / gạch cuối (vd "@NV012." cuối câu). Email (a@b.c) không tính vì trước @ là chữ.</summary>
    public static IReadOnlyList<string> Parse(string? content, int max)
    {
        if (string.IsNullOrEmpty(content) || max <= 0) return [];
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var list = new List<string>();
        foreach (Match m in MentionRegex().Matches(content))
        {
            var code = m.Groups[1].Value.TrimEnd('.', '-');
            if (code.Length >= 2 && seen.Add(code)) list.Add(code);
            if (list.Count == max) break;
        }
        return list;
    }
}
