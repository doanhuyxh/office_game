using OfficeHub.BuildingBlocks.Text;

namespace OfficeHub.Modules.Organization.Tests;

/// <summary>Tìm người cho gợi ý @nhắc (TEST-71): bỏ dấu, tách từ, mọi từ phải khớp, xếp hạng.</summary>
public class PersonSearchTests
{
    private sealed record P(string Name, string Code, string? Dept = null, string? Title = null);

    private static readonly P[] People =
    [
        new("Đoàn Quang Huy", "NV010", "DEV", "Nhân viên"),
        new("Nguyễn Văn An", "NV011", "Kinh doanh"),
        new("Nguyễn Văn Huy", "NV012", "Kế toán"),
        new("Huỳnh Thị Mai", "NV013", "DEV"),
        new("Trần Huy Hoàng", "NV014", "Nhân sự"),
        new("Lê Thanh Huyền", "NV018", "DEV"),
        new("Phạm Anh", "NV101", "Kinh doanh", "Trưởng nhóm"),
    ];

    private static List<string> Find(string term, int limit = 20) =>
        PersonSearch.Search(People, term, limit, p => p.Name, p => p.Code, p => p.Dept, p => p.Title).Select(p => p.Name).ToList();

    [Fact]
    public void Fold_removes_vietnamese_accents_and_lowercases()
    {
        Assert.Equal("doan quang huy", PersonSearch.Fold("Đoàn Quang Huy"));
        Assert.Equal("nguyen van", PersonSearch.Fold("NGUYỄN VĂN"));
    }

    [Fact]
    public void Tokens_split_fold_dedupe_and_cap_at_three_words()
    {
        Assert.Equal(["huy", "doan"], PersonSearch.Tokens("  Huy   ĐOÀN huy "));
        Assert.Equal(3, PersonSearch.Tokens("a b c d e").Count);
        Assert.Empty(PersonSearch.Tokens("   "));
    }

    [Fact]
    public void Words_in_any_order_match_full_name()
    {
        Assert.Equal(["Đoàn Quang Huy"], Find("huy doan"));
        Assert.Equal(["Nguyễn Văn An", "Nguyễn Văn Huy"], Find("nguyen van"));
    }

    [Fact]
    public void Exact_code_ranks_first()
    {
        Assert.Equal("Lê Thanh Huyền", Find("NV018")[0]);
        Assert.Equal("Lê Thanh Huyền", Find("nv018")[0]);
    }

    [Fact]
    public void Given_name_prefix_beats_other_word_prefix_and_substring()
    {
        // "huy": tên gọi Huy (Đoàn Quang Huy, Nguyễn Văn Huy) → tên gọi Huyền → đầu từ khác (Huỳnh, Trần Huy Hoàng)
        var r = Find("huy");
        Assert.Equal(["Đoàn Quang Huy", "Lê Thanh Huyền", "Nguyễn Văn Huy"], r.Take(3).OrderBy(x => x).ToList());
        Assert.Equal(["Huỳnh Thị Mai", "Trần Huy Hoàng"], r.Skip(3).OrderBy(x => x).ToList());
    }

    [Fact]
    public void Department_and_title_narrow_namesakes()
    {
        Assert.Equal(["Nguyễn Văn Huy"], Find("huy ke toan"));
        Assert.Equal(["Phạm Anh"], Find("anh truong nhom"));
        Assert.Equal(["Trần Huy Hoàng"], Find("huy nhan su"));
    }

    [Fact]
    public void Every_word_must_match_and_limit_applies()
    {
        Assert.Empty(Find("huy xyz"));
        Assert.Equal(2, Find("", 2).Count);
        Assert.Equal(People.Length, Find("").Count);
    }

    [Fact]
    public void Sql_fold_map_is_aligned_and_covers_vietnamese()
    {
        var (from, to) = PersonSearch.SqlFoldMap;
        Assert.Equal(from.Length, to.Length);
        foreach (var c in "ĐđÀÁẢÃẠĂẰẮẲẴẶÂẦẤẨẪẬàáảãạăằắẳẵặâầấẩẫậÈÉẺẼẸÊỀẾỂỄỆèéẻẽẹêềếểễệÌÍỈĨỊìíỉĩịÒÓỎÕỌÔỒỐỔỖỘƠỜỚỞỠỢòóỏõọôồốổỗộơờớởỡợÙÚỦŨỤƯỪỨỬỮỰùúủũụưừứửữựỲÝỶỸỴỳýỷỹỵ")
        {
            var i = from.IndexOf(c);
            Assert.True(i >= 0, $"thiếu {c}");
            Assert.Equal(PersonSearch.Fold(c.ToString())[0], to[i]);
        }
    }
}
