using static OfficeHub.Modules.Finance.Domain.AttachmentRules;

namespace OfficeHub.Modules.Finance.Tests;

public class AttachmentRulesTests
{
    [Theory]
    [InlineData("hoa-don.pdf", 1000, true)]
    [InlineData("HOADON.XML", 1000, true)]   // hoá đơn điện tử
    [InlineData("anh chup.JPG", 1000, true)]
    [InlineData("virus.exe", 1000, false)]
    [InlineData("khong-duoi", 1000, false)]
    [InlineData("a.pdf", 0, false)]
    [InlineData("a.pdf", MaxBytes + 1, false)]
    public void Validate_accepts_office_documents_up_to_20mb(string name, long size, bool ok) => Assert.Equal(ok, Validate(name, size).Count == 0);

    [Fact]
    public void Clean_file_name_strips_path_and_keeps_extension()
    {
        Assert.Equal("hd.pdf", CleanFileName(@"C:\Users\x\hd.pdf"));
        Assert.Equal("hd.pdf", CleanFileName("../../hd.pdf"));
        var longName = CleanFileName(new string('a', 300) + ".pdf");
        Assert.Equal(200, longName.Length);
        Assert.EndsWith(".pdf", longName);
    }

    [Fact]
    public void File_key_is_safe_and_under_finance_prefix()
    {
        var id = Guid.Parse("01a1bb23-d70f-74b5-9950-3f418f1a3564");
        Assert.Equal("finance/2026/11/01a1bb23d70f74b599503f418f1a3564/Ho____n_th_ng_11.pdf",
            FileKey(new DateTimeOffset(2026, 11, 8, 0, 0, 0, TimeSpan.Zero), id, "Hoá đơn tháng 11.pdf"));
    }

    [Fact]
    public void Content_type_is_normalized() =>
        Assert.Equal("application/octet-stream", NormalizeContentType("<script>"));
}
