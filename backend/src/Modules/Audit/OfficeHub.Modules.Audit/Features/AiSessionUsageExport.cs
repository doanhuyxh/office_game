using System.Security.Claims;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using OfficeHub.BuildingBlocks.Configuration;
using OfficeHub.Modules.Audit.Domain;
using OfficeHub.Modules.Audit.Infrastructure;
using OfficeHub.Modules.Identity.Contracts;

namespace OfficeHub.Modules.Audit.Features;

/// <summary>
/// Excel mức dùng AI theo phiên (TEST-134), cùng tham số + quyền với <c>/api/ai-usage/summary</c>:
/// sheet "Tổng hợp" (kỳ × model + tổng kỳ), sheet "Phiên" (tối đa <see cref="MaxSessions"/> phiên mới nhất). Giờ trong file là giờ văn phòng.
/// </summary>
internal static class AiSessionUsageExport
{
    public const int MaxSessions = 20_000;
    private const string Usd = "#,##0.000000";
    private const string Count = "#,##0";

    public static async Task<Results<FileContentHttpResult, ValidationProblem, ProblemHttpResult>> ExportAsync(string? from, string? to, string? group,
        string? userId, string? kind, ClaimsPrincipal user, AuditDbContext db, IAccountService accounts, IOptions<OfficeSettings> office, TimeProvider clock,
        CancellationToken ct)
    {
        var (q, error) = AiSessionUsageEndpoints.Build(user, from, to, group, userId, kind, db, office, clock);
        if (q is null) return error!.Invalid is { } v ? v : error.Denied!;
        var data = AiSessionLedger.Summarize(await AiSessionUsageEndpoints.RowsAsync(q, db, ct), q.Group, q.Tz);
        var sessions = await q.Sessions.Include(s => s.Models).OrderByDescending(s => s.FinishedAt).ThenByDescending(s => s.Id)
            .Take(MaxSessions).ToListAsync(ct);
        var names = await accounts.GetManyAsync(sessions.Select(s => s.UserId).Distinct().ToList(), ct);

        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Tổng hợp");
        ws.Cell(1, 1).Value = $"MỨC DÙNG AI từ {q.From:dd/MM/yyyy} đến {q.To:dd/MM/yyyy} (theo {GroupName(q.Group)}, giờ Việt Nam)";
        ws.Cell(1, 1).Style.Font.Bold = true;
        Header(ws, 3, ["Kỳ", "Model", "Số phiên", "Token vào", "Token ra", "Cache đọc", "Cache ghi", "Chi phí (USD)", "Phiên thiếu chi phí"]);
        var r = 4;
        foreach (var b in data.Buckets)
        {
            foreach (var g in data.Groups.Where(x => x.Bucket == b.Bucket))
            {
                Fill(ws, r++, g.Bucket, g.Model, g.Sessions, g.InputTokens, g.OutputTokens, g.CacheReadTokens, g.CacheWriteTokens, g.CostUsd, g.CostMissing);
            }
            Fill(ws, r, b.Bucket!, "Cộng kỳ", b.Sessions, b.InputTokens, b.OutputTokens, b.CacheReadTokens, b.CacheWriteTokens, b.CostUsd, b.CostMissing);
            ws.Row(r++).Style.Font.Italic = true;
        }
        var t = data.Total;
        Fill(ws, r, "Tổng", "", t.Sessions, t.InputTokens, t.OutputTokens, t.CacheReadTokens, t.CacheWriteTokens, t.CostUsd, t.CostMissing);
        ws.Row(r).Style.Font.Bold = true;
        ws.Range(4, 3, r, 7).Style.NumberFormat.Format = Count;
        ws.Range(4, 8, r, 8).Style.NumberFormat.Format = Usd;
        ws.Columns().AdjustToContents();

        var ss = wb.AddWorksheet("Phiên");
        Header(ss, 1, ["Kết thúc", "Bắt đầu", "Thời lượng (giây)", "Tài khoản", "Loại", "Mã việc", "Công cụ", "Trạng thái", "Lượt",
            "Model", "Token vào", "Token ra", "Cache đọc", "Cache ghi", "Chi phí (USD)", "Mã phiên"]);
        r = 2;
        foreach (var s in sessions)
        {
            var d = AiSessionUsageEndpoints.ToDto(s, names);
            ss.Cell(r, 1).Value = TimeZoneInfo.ConvertTime(s.FinishedAt, q.Tz).DateTime;
            ss.Cell(r, 2).Value = TimeZoneInfo.ConvertTime(s.StartedAt, q.Tz).DateTime;
            ss.Cell(r, 3).Value = d.DurationSeconds;
            ss.Cell(r, 4).Value = d.FullName is { Length: > 0 } fn ? fn : d.UserName ?? s.UserId.ToString();
            ss.Cell(r, 5).Value = s.Kind;
            ss.Cell(r, 6).Value = s.TaskCode ?? "";
            ss.Cell(r, 7).Value = s.Executor;
            ss.Cell(r, 8).Value = s.Status;
            if (s.Turns is { } turns) ss.Cell(r, 9).Value = turns;
            ss.Cell(r, 10).Value = string.Join(", ", d.Models.Select(m => m.Model));
            ss.Cell(r, 11).Value = d.InputTokens;
            ss.Cell(r, 12).Value = d.OutputTokens;
            ss.Cell(r, 13).Value = d.CacheReadTokens;
            ss.Cell(r, 14).Value = d.CacheWriteTokens;
            if (s.CostUsd is { } cost) ss.Cell(r, 15).Value = cost;
            ss.Cell(r, 16).Value = s.SourceId;
            r++;
        }
        ss.Range(2, 1, Math.Max(2, r), 2).Style.DateFormat.Format = "dd/MM/yyyy HH:mm";
        ss.Range(2, 11, Math.Max(2, r), 14).Style.NumberFormat.Format = Count;
        ss.Range(2, 15, Math.Max(2, r), 15).Style.NumberFormat.Format = Usd;
        ss.Columns().AdjustToContents();

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return TypedResults.File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"muc-dung-ai-{q.From:yyyyMMdd}-{q.To:yyyyMMdd}.xlsx");
    }

    private static string GroupName(string group) => group switch
    {
        AiSessionLedger.Month => "tháng",
        AiSessionLedger.Year => "năm",
        _ => "ngày",
    };

    private static void Header(IXLWorksheet ws, int row, string[] titles)
    {
        for (var i = 0; i < titles.Length; i++) ws.Cell(row, i + 1).Value = titles[i];
        ws.Row(row).Style.Font.Bold = true;
    }

    private static void Fill(IXLWorksheet ws, int r, string bucket, string model, int sessions, long input, long output, long cacheRead, long cacheWrite,
        decimal cost, int missing)
    {
        ws.Cell(r, 1).Value = bucket;
        ws.Cell(r, 2).Value = model;
        ws.Cell(r, 3).Value = sessions;
        ws.Cell(r, 4).Value = input;
        ws.Cell(r, 5).Value = output;
        ws.Cell(r, 6).Value = cacheRead;
        ws.Cell(r, 7).Value = cacheWrite;
        ws.Cell(r, 8).Value = cost;
        if (missing > 0) ws.Cell(r, 9).Value = missing;
    }
}
