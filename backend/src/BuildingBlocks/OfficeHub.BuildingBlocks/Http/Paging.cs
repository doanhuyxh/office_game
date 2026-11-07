using Microsoft.EntityFrameworkCore;

namespace OfficeHub.BuildingBlocks.Http;

/// <summary>
/// Một trang của danh sách. Endpoint danh sách nhận <c>?page=&amp;pageSize=</c> (page 1-based; pageSize mặc định 20, tối đa 200):
/// có <c>page</c> → trả <see cref="PagedResult{T}"/>; không có → trả mảng như cũ (MCP tools, script seed / e2e vẫn đọc mảng).
/// Không sealed để endpoint cần thêm số liệu toàn cục (tổng tháng, đếm theo trạng thái…) kế thừa.
/// </summary>
public record PagedResult<T>(IReadOnlyList<T> Items, int Total, int Page, int PageSize);

public static class Paging
{
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 200;

    public static (int Page, int Size) Normalize(int page, int? pageSize) =>
        (Math.Max(1, page), Math.Clamp(pageSize ?? DefaultPageSize, 1, MaxPageSize));

    /// <summary>Cắt trang trên danh sách đã có trong bộ nhớ (danh sách phải tính toàn bộ, hoặc danh sách nhân viên trước khi tính từng người).</summary>
    public static PagedResult<T> Of<T>(IReadOnlyList<T> all, int page, int? pageSize)
    {
        var (p, s) = Normalize(page, pageSize);
        return new([.. all.Skip((p - 1) * s).Take(s)], all.Count, p, s);
    }

    /// <summary>COUNT + OFFSET/LIMIT trên truy vấn đã ORDER BY (thứ tự phải ổn định, vd thêm ThenBy khoá).</summary>
    public static async Task<PagedResult<T>> ToPagedAsync<T>(this IQueryable<T> query, int page, int? pageSize, CancellationToken ct)
    {
        var (p, s) = Normalize(page, pageSize);
        var total = await query.CountAsync(ct);
        return new(await query.Skip((p - 1) * s).Take(s).ToListAsync(ct), total, p, s);
    }

    /// <summary>Giữ thông tin trang, thay các dòng bằng bản đã map (entity → DTO, kể cả map async làm trước đó).</summary>
    public static PagedResult<TOut> With<TIn, TOut>(this PagedResult<TIn> page, IReadOnlyList<TOut> items) =>
        new(items, page.Total, page.Page, page.PageSize);

    public static PagedResult<TOut> Map<TIn, TOut>(this PagedResult<TIn> page, Func<TIn, TOut> map) =>
        page.With([.. page.Items.Select(map)]);
}
