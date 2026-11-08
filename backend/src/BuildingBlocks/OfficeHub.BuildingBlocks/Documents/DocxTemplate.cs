using System.Text;
using System.Text.RegularExpressions;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace OfficeHub.BuildingBlocks.Documents;

/// <summary>
/// Điền mẫu Word (.docx): thay <c>{{TenTruong}}</c> (không phân biệt hoa thường, cho phép khoảng trắng: <c>{{ HoTen }}</c>)
/// ở thân văn bản, header, footer. Word hay tách một trường thành nhiều run (do sửa lỗi chính tả, đổi định dạng giữa chừng) →
/// ghép theo vị trí ký tự trong cả đoạn: chữ ngoài trường giữ nguyên định dạng, giá trị lấy định dạng của ký tự đầu trường.
/// Bảng lặp: dòng bảng chứa trường bắt đầu bằng tiền tố (vd <c>{{HM_NoiDung}}</c>) được nhân lên cho mỗi phần tử của danh sách.
/// Dùng chung: mẫu hợp đồng lao động (LaborContracts), báo giá (Sales).
/// </summary>
public static partial class DocxTemplate
{
    [GeneratedRegex(@"\{\{\s*([A-Za-z0-9_]+)\s*\}\}")]
    private static partial Regex Field();

    /// <summary>Tên các trường có trong mẫu (giữ nguyên chữ hoa / thường như trong file, không trùng).</summary>
    public static IReadOnlyList<string> ScanFields(Stream docx)
    {
        using var doc = WordprocessingDocument.Open(docx, false);
        var names = new List<string>();
        foreach (var p in Paragraphs(doc))
            foreach (Match m in Field().Matches(string.Concat(p.Descendants<W.Text>().Select(t => t.Text))))
                if (!names.Contains(m.Groups[1].Value, StringComparer.OrdinalIgnoreCase)) names.Add(m.Groups[1].Value);
        return names;
    }

    /// <summary>Trả về file .docx đã điền. Trường không có trong <paramref name="values"/> được giữ nguyên để HR thấy và sửa tay.</summary>
    public static byte[] Fill(Stream template, IReadOnlyDictionary<string, string> values) => Fill(template, values, null, null);

    /// <summary>
    /// Như <see cref="Fill(Stream, IReadOnlyDictionary{string, string})"/> + bảng lặp: MỌI dòng bảng (thân văn bản) chứa trường bắt đầu bằng
    /// <paramref name="rowPrefix"/> được nhân lên theo <paramref name="rows"/> (mỗi phần tử = giá trị các trường của một dòng), rồi dòng mẫu bị bỏ.
    /// Danh sách rỗng → bỏ dòng mẫu.
    /// </summary>
    public static byte[] Fill(Stream template, IReadOnlyDictionary<string, string> values, IReadOnlyList<IReadOnlyDictionary<string, string>>? rows, string? rowPrefix)
    {
        using var ms = new MemoryStream();
        template.CopyTo(ms);
        using (var doc = WordprocessingDocument.Open(ms, true))
        {
            if (rows is not null && !string.IsNullOrEmpty(rowPrefix) && doc.MainDocumentPart?.Document is { } body)
                foreach (var row in body.Descendants<W.TableRow>().ToList())
                {
                    var text = string.Concat(row.Descendants<W.Text>().Select(t => t.Text));
                    if (!Field().Matches(text).Any(m => m.Groups[1].Value.StartsWith(rowPrefix, StringComparison.OrdinalIgnoreCase))) continue;
                    foreach (var item in rows)
                    {
                        var clone = (W.TableRow)row.CloneNode(true);
                        var map = new Dictionary<string, string>(item, StringComparer.OrdinalIgnoreCase);
                        foreach (var p in clone.Descendants<W.Paragraph>().ToList()) FillParagraph(p, map);
                        row.InsertBeforeSelf(clone);
                    }
                    row.Remove();
                }
            var lookup = new Dictionary<string, string>(values, StringComparer.OrdinalIgnoreCase);
            foreach (var p in Paragraphs(doc).ToList()) FillParagraph(p, lookup);
            doc.MainDocumentPart?.Document?.Save();
            foreach (var h in doc.MainDocumentPart?.HeaderParts ?? []) h.Header?.Save();
            foreach (var f in doc.MainDocumentPart?.FooterParts ?? []) f.Footer?.Save();
        }
        return ms.ToArray();
    }

    private static IEnumerable<W.Paragraph> Paragraphs(WordprocessingDocument doc)
    {
        var main = doc.MainDocumentPart;
        if (main is null) yield break;
        foreach (var p in main.Document?.Descendants<W.Paragraph>() ?? []) yield return p;
        foreach (var h in main.HeaderParts) foreach (var p in h.Header?.Descendants<W.Paragraph>() ?? []) yield return p;
        foreach (var f in main.FooterParts) foreach (var p in f.Footer?.Descendants<W.Paragraph>() ?? []) yield return p;
    }

    internal static void FillParagraph(W.Paragraph p, IReadOnlyDictionary<string, string> values)
    {
        var texts = p.Descendants<W.Text>().ToList();
        if (texts.Count == 0) return;
        var full = new StringBuilder();
        var starts = new int[texts.Count];
        for (var i = 0; i < texts.Count; i++) { starts[i] = full.Length; full.Append(texts[i].Text); }
        var matches = Field().Matches(full.ToString()).Where(m => values.ContainsKey(m.Groups[1].Value)).ToList();
        if (matches.Count == 0) return;

        // Thay từ cuối lên đầu để vị trí các trường phía trước không bị lệch.
        foreach (var m in Enumerable.Reverse(matches))
        {
            var value = values[m.Groups[1].Value];
            int first = IndexAt(starts, m.Index), last = IndexAt(starts, m.Index + m.Length - 1);
            var headStart = m.Index - starts[first];
            var tailStart = m.Index + m.Length - starts[last];
            if (first == last)
            {
                var t = texts[first].Text;
                Set(texts[first], t[..headStart] + value + t[tailStart..]);
            }
            else
            {
                Set(texts[first], texts[first].Text[..headStart] + value);
                for (var i = first + 1; i < last; i++) Set(texts[i], "");
                Set(texts[last], texts[last].Text[tailStart..]);
            }
        }
    }

    private static int IndexAt(int[] starts, int pos)
    {
        var i = Array.BinarySearch(starts, pos);
        if (i >= 0)
        {
            while (i + 1 < starts.Length && starts[i + 1] == pos) i++; // bỏ qua các Text rỗng cùng vị trí
            return i;
        }
        return ~i - 1;
    }

    private static void Set(W.Text t, string value)
    {
        t.Text = value;
        t.Space = SpaceProcessingModeValues.Preserve; // giữ khoảng trắng đầu / cuối
    }
}
