namespace OfficeHub.Modules.LaborContracts.Domain;

/// <summary>Đọc số tiền thành chữ tiếng Việt cho hợp đồng: 15.500.000 → "Mười lăm triệu năm trăm nghìn đồng".</summary>
public static class VietnameseNumber
{
    private static readonly string[] Digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
    private static readonly string[] Units = ["", " nghìn", " triệu", " tỷ", " nghìn tỷ", " triệu tỷ"];

    public static string MoneyToWords(decimal amount)
    {
        var n = (long)Math.Round(Math.Abs(amount), 0, MidpointRounding.AwayFromZero);
        if (n == 0) return "Không đồng";
        var groups = new List<int>();
        for (var x = n; x > 0; x /= 1000) groups.Add((int)(x % 1000));

        var parts = new List<string>();
        for (var i = groups.Count - 1; i >= 0; i--)
        {
            if (groups[i] == 0) continue;
            // Nhóm không phải nhóm cao nhất mà < 100 → đọc đủ "không trăm" (1.050.000 = một triệu không trăm năm mươi nghìn).
            var full = i < groups.Count - 1;
            parts.Add(ReadTriple(groups[i], full) + Units[i]);
        }
        var s = string.Join(" ", parts) + " đồng";
        return (amount < 0 ? "Âm " : "") + char.ToUpper(s[0]) + s[1..];
    }

    private static string ReadTriple(int n, bool full)
    {
        int h = n / 100, t = n / 10 % 10, u = n % 10;
        var w = new List<string>();
        if (h > 0 || full) w.Add(Digits[h] + " trăm");
        if (t == 0)
        {
            if (u > 0) { if (h > 0 || full) w.Add("lẻ"); w.Add(Digits[u]); }
        }
        else
        {
            w.Add(t == 1 ? "mười" : Digits[t] + " mươi");
            if (u == 1) w.Add(t == 1 ? "một" : "mốt");
            else if (u == 4 && t > 1) w.Add("tư");
            else if (u == 5) w.Add("lăm");
            else if (u > 0) w.Add(Digits[u]);
        }
        return string.Join(" ", w);
    }
}
