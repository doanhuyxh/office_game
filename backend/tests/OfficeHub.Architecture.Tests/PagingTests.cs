using OfficeHub.BuildingBlocks.Http;

namespace OfficeHub.Architecture.Tests;

public class PagingTests
{
    [Theory]
    [InlineData(0, null, 1, 20)]   // page < 1 → 1; pageSize bỏ trống → mặc định
    [InlineData(3, 0, 3, 1)]       // pageSize < 1 → 1
    [InlineData(2, 999, 2, 200)]   // pageSize > tối đa → tối đa
    public void Normalizes_page_and_size(int page, int? size, int expectedPage, int expectedSize) =>
        Assert.Equal((expectedPage, expectedSize), Paging.Normalize(page, size));

    [Fact]
    public void Slices_in_memory_list_and_keeps_total()
    {
        var all = Enumerable.Range(1, 45).ToList();
        var p2 = Paging.Of(all, 2, 20);
        Assert.Equal((45, 2, 20), (p2.Total, p2.Page, p2.PageSize));
        Assert.Equal(Enumerable.Range(21, 20), p2.Items);
        var last = Paging.Of(all, 3, 20);
        Assert.Equal(Enumerable.Range(41, 5), last.Items);
        Assert.Empty(Paging.Of(all, 4, 20).Items); // quá trang cuối → rỗng, Total vẫn đúng
        Assert.Equal(45, Paging.Of(all, 4, 20).Total);
    }

    [Fact]
    public void Map_keeps_paging_info()
    {
        var p = Paging.Of(Enumerable.Range(1, 5).ToList(), 1, 2).Map(n => $"#{n}");
        Assert.Equal(["#1", "#2"], p.Items);
        Assert.Equal((5, 1, 2), (p.Total, p.Page, p.PageSize));
    }
}
