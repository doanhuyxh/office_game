using DocumentFormat.OpenXml.Packaging;
using OfficeHub.Modules.Sales.Domain;
using OfficeHub.Modules.Sales.Infrastructure;
using static OfficeHub.Modules.Sales.Domain.QuoteRules;
using W = DocumentFormat.OpenXml.Wordprocessing;

namespace OfficeHub.Modules.Sales.Tests;

public class QuoteRulesTests
{
    private static readonly DateOnly Day = new(2026, 11, 8);
    private static readonly List<QuoteLineInput> Lines = [new("Thiết kế giao diện", "màn hình", 12, 2_500_000), new("Lập trình API", "gói", 1.5m, 40_000_000)];

    [Fact]
    public void Totals_apply_discount_before_vat()
    {
        // 30tr + 60tr = 90tr; CK 10 % = 9tr → 81tr; VAT 8 % = 6,48tr → 87,48tr
        Assert.Equal(new QuoteTotals(90_000_000, 9_000_000, 81_000_000, 6_480_000, 87_480_000), Totals(Lines, 10, 8));
        Assert.Equal(60_000_000, LineAmount(1.5m, 40_000_000));
    }

    [Theory]
    [InlineData(15, 15, false)]   // bằng ngưỡng: không cần duyệt
    [InlineData(15.01, 15, true)]
    [InlineData(0, 0, false)]
    public void Approval_only_above_limit(decimal pct, decimal limit, bool needs) => Assert.Equal(needs, NeedsApproval(pct, limit));

    [Fact]
    public void Code_includes_version_after_first() => Assert.Equal(["BG-00012", "BG-00012-v2"], new[] { Code(12, 1), Code(12, 2) });

    [Fact]
    public void Validate_rejects_bad_input()
    {
        Assert.Empty(Validate(Lines, 10, 8, Day, Day.AddDays(30)));
        Assert.Contains(Validate([], 0, 8, Day, Day), e => e.Field == "lines");
        Assert.Contains(Validate([new("x", null, 0, 1)], 0, 8, Day, Day), e => e.Field == "lines");
        Assert.Contains(Validate([new("x", null, 1.234m, 1)], 0, 8, Day, Day), e => e.Field == "lines");
        Assert.Contains(Validate(Lines, 101, 8, Day, Day), e => e.Field == "discountPercent");
        Assert.Contains(Validate(Lines, 0, 7, Day, Day), e => e.Field == "vatRate");
        Assert.Contains(Validate(Lines, 0, 8, Day, Day.AddDays(-1)), e => e.Field == "validUntil");
        Assert.Contains(Validate([new("Miễn phí", null, 1, 0)], 0, 8, Day, Day), e => e.Field == "lines"); // tổng 0
    }

    [Fact]
    public void Status_rules()
    {
        Assert.True(CanRevise(QuoteStatus.Sent));
        Assert.False(CanRevise(QuoteStatus.PendingApproval));
        Assert.False(CanRevise(QuoteStatus.Accepted));
        Assert.True(CanCancel(QuoteStatus.Ready));
        Assert.False(CanCancel(QuoteStatus.Accepted));
        Assert.True(IsEditable(QuoteStatus.Draft));
        Assert.False(IsEditable(QuoteStatus.Ready));
    }

    [Fact]
    public void Default_template_renders_one_table_row_per_line_and_fills_every_field()
    {
        var t = Totals(Lines, 10, 8);
        var q = new Quote
        {
            Number = 12, Version = 2, Title = "App đặt lịch", IssuedOn = Day, ValidUntil = Day.AddDays(30), VatRate = 8, DiscountPercent = 10,
            Subtotal = t.Subtotal, Discount = t.Discount, BeforeTax = t.BeforeTax, Vat = t.Vat, Total = t.Total, Terms = "Thanh toán 2 đợt",
        };
        var i = 0;
        foreach (var l in Lines) q.Lines.Add(new QuoteLine { Order = ++i, Description = l.Description, Unit = l.Unit, Quantity = l.Quantity, UnitPrice = l.UnitPrice, Amount = LineAmount(l.Quantity, l.UnitPrice) });
        var c = new Customer { Name = "Công ty ABC", TaxCode = "0312345678" };
        using var tpl = new MemoryStream(QuoteDocument.DefaultTemplate());
        var bytes = QuoteDocument.Render(tpl, q, c, new Contact { Name = "Nguyễn A", Title = "Giám đốc" }, "Trần B");
        using var doc = WordprocessingDocument.Open(new MemoryStream(bytes), false);
        var text = string.Concat(doc.MainDocumentPart!.Document!.Descendants<W.Text>().Select(x => x.Text));
        var rows = doc.MainDocumentPart.Document.Descendants<W.TableRow>().ToList();
        Assert.Equal(3, rows.Count); // tiêu đề + 2 hạng mục
        Assert.Contains("Lập trình API", string.Concat(rows[2].Descendants<W.Text>().Select(x => x.Text)));
        Assert.Contains("1,5", text);
        Assert.Contains("BG-00012-v2", text);
        Assert.Contains("87.480.000", text);
        Assert.Contains("Nguyễn A (Giám đốc)", text);
        Assert.DoesNotContain("{{", text);
    }
}
