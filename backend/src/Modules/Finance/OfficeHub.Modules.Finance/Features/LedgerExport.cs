using ClosedXML.Excel;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using OfficeHub.BuildingBlocks.Http;
using OfficeHub.Modules.Finance.Domain;
using OfficeHub.Modules.Finance.Infrastructure;
using OfficeHub.Modules.Projects.Contracts;

namespace OfficeHub.Modules.Finance.Features;

/// <summary>
/// Excel sổ thu chi cho kế toán dịch vụ / kế toán thuế (công ty không dùng phần mềm kế toán) — quyền Xem tài chính. Dòng đã huỷ không xuất.
/// Sheet "Sổ thu chi" (theo bộ lọc), "Sổ quỹ" (mỗi quỹ: đầu kỳ, phát sinh, luỹ kế, cuối kỳ — bỏ qua lọc mảng / dự án vì số dư là của cả quỹ),
/// "Tổng hợp" (theo danh mục, theo mảng; không tính chuyển quỹ).
/// </summary>
internal static class LedgerExport
{
    private const string Money = "#,##0";
    private const string Date = "dd/MM/yyyy";

    public static async Task<Results<FileContentHttpResult, ValidationProblem>> ExportAsync(FinanceDbContext db, FinanceClock clock, IProjectDirectory projects,
        DateOnly? from, DateOnly? to, Guid? accountId, Guid? lineId, Guid? projectId, CancellationToken ct)
    {
        var f = from ?? clock.ThisMonthStart;
        var t = to ?? clock.Today;
        if (t < f) return new Validation().Add("to", "Đến ngày trước từ ngày").Problem();
        if (t.DayNumber - f.DayNumber > 366 * 5) return new Validation().Add("from", "Tối đa 5 năm mỗi lần xuất").Problem();

        var names = await FinanceQueries.NamesAsync(db, projects, ct);
        var accounts = await db.Accounts.AsNoTracking().OrderBy(a => a.SortOrder).ThenBy(a => a.Name).ToListAsync(ct);
        var active = db.Entries.AsNoTracking().Where(e => e.Status == TxStatus.Active);

        var q = active.Where(e => e.Date >= f && e.Date <= t);
        if (accountId is { } a0) q = q.Where(e => e.AccountId == a0 || e.ToAccountId == a0);
        if (lineId is { } l) q = q.Where(e => e.BusinessLineId == l);
        if (projectId is { } p) q = q.Where(e => e.ProjectId == p);
        var rows = await q.OrderBy(e => e.Date).ThenBy(e => e.CreatedAt).ThenBy(e => e.Id).ToListAsync(ct);
        var expIds = rows.Where(e => e.SourceType == ExpenseEndpoints.SourceType && e.SourceId != null).Select(e => e.SourceId!.Value);
        var counts = await AttachmentEndpoints.CountsAsync(db, [.. rows.Select(e => e.Id), .. expIds], ct);

        using var wb = new XLWorkbook();
        // ---------- Sổ thu chi ----------
        var ws = wb.AddWorksheet("Sổ thu chi");
        ws.Cell(1, 1).Value = $"SỔ THU CHI từ {f:dd/MM/yyyy} đến {t:dd/MM/yyyy}";
        ws.Cell(1, 1).Style.Font.Bold = true;
        string[] head = ["Ngày", "Loại", "Thu", "Chi", "Chuyển quỹ", "Quỹ", "Quỹ nhận", "Danh mục", "Mảng", "Dự án", "Đối tác", "Diễn giải", "Số hoá đơn", "Chứng từ", "Người ghi"];
        Header(ws, 3, head);
        var r = 4;
        foreach (var e in rows)
        {
            ws.Cell(r, 1).Value = e.Date.ToDateTime(TimeOnly.MinValue);
            ws.Cell(r, 2).Value = e.Kind switch { TxKind.Income => "Thu", TxKind.Expense => "Chi", _ => "Chuyển quỹ" };
            ws.Cell(r, e.Kind switch { TxKind.Income => 3, TxKind.Expense => 4, _ => 5 }).Value = e.Amount;
            ws.Cell(r, 6).Value = names.Account(e.AccountId) ?? "";
            ws.Cell(r, 7).Value = names.Account(e.ToAccountId) ?? "";
            ws.Cell(r, 8).Value = names.Category(e.CategoryId) ?? "";
            ws.Cell(r, 9).Value = names.Line(e.BusinessLineId) ?? "";
            ws.Cell(r, 10).Value = names.Project(e.ProjectId) ?? "";
            ws.Cell(r, 11).Value = e.Counterparty ?? "";
            ws.Cell(r, 12).Value = e.Description ?? "";
            ws.Cell(r, 13).Value = e.InvoiceNumber ?? "";
            var n = counts.GetValueOrDefault(e.Id) + (e.SourceType == ExpenseEndpoints.SourceType && e.SourceId is { } sid ? counts.GetValueOrDefault(sid) : 0);
            if (n > 0) ws.Cell(r, 14).Value = n;
            ws.Cell(r, 15).Value = e.CreatedByName;
            r++;
        }
        ws.Cell(r, 2).Value = "Tổng";
        ws.Cell(r, 3).Value = rows.Where(e => e.Kind == TxKind.Income).Sum(e => e.Amount);
        ws.Cell(r, 4).Value = rows.Where(e => e.Kind == TxKind.Expense).Sum(e => e.Amount);
        ws.Cell(r, 5).Value = rows.Where(e => e.Kind == TxKind.Transfer).Sum(e => e.Amount);
        ws.Row(r).Style.Font.Bold = true;
        ws.Range(4, 1, r, 1).Style.DateFormat.Format = Date;
        ws.Range(4, 3, r, 5).Style.NumberFormat.Format = Money;
        Finish(ws, 3);

        // ---------- Sổ quỹ ----------
        var cash = wb.AddWorksheet("Sổ quỹ");
        cash.Cell(1, 1).Value = $"SỔ QUỸ từ {f:dd/MM/yyyy} đến {t:dd/MM/yyyy} (mọi giao dịch của quỹ, không theo lọc mảng / dự án)";
        cash.Cell(1, 1).Style.Font.Bold = true;
        var shown = accountId is { } only ? accounts.Where(x => x.Id == only).ToList() : accounts;
        var ids = shown.Select(x => x.Id).ToList();
        var touching = await active.Where(e => e.Date <= t && (ids.Contains(e.AccountId) || (e.ToAccountId != null && ids.Contains(e.ToAccountId.Value))))
            .OrderBy(e => e.Date).ThenBy(e => e.CreatedAt).ThenBy(e => e.Id).ToListAsync(ct);
        r = 3;
        foreach (var acc in shown)
        {
            var mine = touching.Where(e => e.AccountId == acc.Id || e.ToAccountId == acc.Id).ToList();
            var balance = LedgerRules.Balance(acc.OpeningBalance, mine.Where(e => e.Date < f), acc.Id);
            cash.Cell(r, 1).Value = $"{acc.Name}{(acc.Last4 is null ? "" : $" (…{acc.Last4})")}{(acc.IsActive ? "" : " — đã đóng")}";
            cash.Cell(r, 1).Style.Font.Bold = true;
            r++;
            Header(cash, r, ["Ngày", "Diễn giải", "Thu / nhận", "Chi / chuyển đi", "Tồn"]);
            r++;
            cash.Cell(r, 2).Value = "Số dư đầu kỳ";
            cash.Cell(r, 5).Value = balance;
            r++;
            long totalIn = 0, totalOut = 0;
            foreach (var e in mine.Where(e => e.Date >= f))
            {
                var eff = LedgerRules.Effect(e, acc.Id);
                if (eff == 0) continue;
                balance += eff;
                if (eff > 0) totalIn += eff; else totalOut -= eff;
                cash.Cell(r, 1).Value = e.Date.ToDateTime(TimeOnly.MinValue);
                cash.Cell(r, 1).Style.DateFormat.Format = Date;
                cash.Cell(r, 2).Value = e.Kind == TxKind.Transfer
                    ? $"Chuyển quỹ {names.Account(e.AccountId)} → {names.Account(e.ToAccountId)}{(e.Description is null ? "" : $": {e.Description}")}"
                    : string.Join(" · ", new[] { e.Description, e.Counterparty }.Where(x => !string.IsNullOrWhiteSpace(x)));
                cash.Cell(r, eff > 0 ? 3 : 4).Value = Math.Abs(eff);
                cash.Cell(r, 5).Value = balance;
                r++;
            }
            cash.Cell(r, 2).Value = "Cộng phát sinh / số dư cuối kỳ";
            cash.Cell(r, 3).Value = totalIn;
            cash.Cell(r, 4).Value = totalOut;
            cash.Cell(r, 5).Value = balance;
            cash.Row(r).Style.Font.Bold = true;
            r += 2;
        }
        cash.Range(3, 3, Math.Max(3, r), 5).Style.NumberFormat.Format = Money;
        cash.Columns().AdjustToContents(1, Math.Max(1, r), 8, 70);

        // ---------- Tổng hợp ----------
        var sum = wb.AddWorksheet("Tổng hợp");
        sum.Cell(1, 1).Value = $"TỔNG HỢP từ {f:dd/MM/yyyy} đến {t:dd/MM/yyyy} (không tính chuyển quỹ)";
        sum.Cell(1, 1).Style.Font.Bold = true;
        var io = rows.Where(e => e.Kind != TxKind.Transfer).ToList();
        Header(sum, 3, ["Loại", "Danh mục", "Số tiền"]);
        r = 4;
        foreach (var g in io.GroupBy(e => (e.Kind, Cat: names.Category(e.CategoryId) ?? "(chưa chọn danh mục)")).OrderBy(g => g.Key.Kind).ThenByDescending(g => g.Sum(e => e.Amount)))
        {
            sum.Cell(r, 1).Value = g.Key.Kind == TxKind.Income ? "Thu" : "Chi";
            sum.Cell(r, 2).Value = g.Key.Cat;
            sum.Cell(r, 3).Value = g.Sum(e => e.Amount);
            r++;
        }
        r++;
        Header(sum, r, ["Mảng", "Thu", "Chi", "Chênh lệch"]);
        var lineStart = ++r;
        foreach (var g in io.GroupBy(e => names.Line(e.BusinessLineId) ?? "(chưa gắn mảng)").OrderBy(g => g.Key))
        {
            var inc = g.Where(e => e.Kind == TxKind.Income).Sum(e => e.Amount);
            var exp = g.Where(e => e.Kind == TxKind.Expense).Sum(e => e.Amount);
            sum.Cell(r, 1).Value = g.Key; sum.Cell(r, 2).Value = inc; sum.Cell(r, 3).Value = exp; sum.Cell(r, 4).Value = inc - exp;
            r++;
        }
        sum.Cell(r, 1).Value = "Tổng";
        sum.Cell(r, 2).Value = io.Where(e => e.Kind == TxKind.Income).Sum(e => e.Amount);
        sum.Cell(r, 3).Value = io.Where(e => e.Kind == TxKind.Expense).Sum(e => e.Amount);
        sum.Cell(r, 4).Value = io.Sum(e => e.Kind == TxKind.Income ? e.Amount : -e.Amount);
        sum.Row(r).Style.Font.Bold = true;
        sum.Range(4, 2, r, 4).Style.NumberFormat.Format = Money;
        sum.Range(4, 3, lineStart - 2, 3).Style.NumberFormat.Format = Money;
        sum.Columns().AdjustToContents(1, r, 8, 60);

        using var ms = new MemoryStream();
        wb.SaveAs(ms);
        return TypedResults.File(ms.ToArray(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", $"so-thu-chi-{f:yyyyMMdd}-{t:yyyyMMdd}.xlsx");
    }

    private static void Header(IXLWorksheet ws, int row, string[] cols)
    {
        for (var i = 0; i < cols.Length; i++) ws.Cell(row, i + 1).Value = cols[i];
        var range = ws.Range(row, 1, row, cols.Length);
        range.Style.Font.Bold = true;
        range.Style.Fill.BackgroundColor = XLColor.FromHtml("#E8EEF7");
    }

    private static void Finish(IXLWorksheet ws, int headerRow)
    {
        ws.SheetView.FreezeRows(headerRow);
        ws.Columns().AdjustToContents(headerRow, Math.Min(ws.LastRowUsed()?.RowNumber() ?? headerRow, headerRow + 500), 8, 60);
    }
}
