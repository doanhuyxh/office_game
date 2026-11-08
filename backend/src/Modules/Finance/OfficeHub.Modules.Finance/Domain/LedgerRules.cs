namespace OfficeHub.Modules.Finance.Domain;

/// <summary>Quy tắc sổ thu chi — hàm thuần (test: tests/OfficeHub.Modules.Finance.Tests).</summary>
public static class LedgerRules
{
    /// <summary>10 nghìn tỷ đồng — chặn nhập nhầm thừa số 0.</summary>
    public const long MaxAmount = 10_000_000_000_000;

    public static string ExpenseCode(long number) => $"CP-{number:D5}";

    public static bool IsLocked(DateOnly date, DateOnly? lockedThrough) => lockedThrough is { } l && date <= l;

    /// <summary>
    /// Lỗi theo field khi ghi một dòng sổ. Số tiền 1…<see cref="MaxAmount"/>; ngày không ở tương lai và không trong tháng đã khoá;
    /// chuyển quỹ cần quỹ nhận khác quỹ gửi, thu / chi thì không có quỹ nhận.
    /// </summary>
    public static List<(string Field, string Message)> Validate(TxKind kind, long amount, Guid accountId, Guid? toAccountId, DateOnly date, DateOnly today, DateOnly? lockedThrough)
    {
        var e = new List<(string, string)>();
        if (amount < 1) e.Add(("amount", "Số tiền phải lớn hơn 0"));
        else if (amount > MaxAmount) e.Add(("amount", "Số tiền quá lớn, kiểm tra lại số 0"));
        if (accountId == Guid.Empty) e.Add(("accountId", "Chọn quỹ / tài khoản"));
        if (kind == TxKind.Transfer)
        {
            if (toAccountId is null || toAccountId == Guid.Empty) e.Add(("toAccountId", "Chọn quỹ nhận"));
            else if (toAccountId == accountId) e.Add(("toAccountId", "Quỹ nhận phải khác quỹ gửi"));
        }
        else if (toAccountId is not null) e.Add(("toAccountId", "Chỉ chuyển quỹ mới có quỹ nhận"));
        if (date > today) e.Add(("date", "Không ghi giao dịch có ngày ở tương lai"));
        else if (IsLocked(date, lockedThrough)) e.Add(("date", $"Sổ đã khoá đến hết {lockedThrough:dd/MM/yyyy}"));
        return e;
    }

    /// <summary>Ảnh hưởng của một dòng sổ lên số dư quỹ <paramref name="accountId"/> (dòng đã huỷ = 0).</summary>
    public static long Effect(LedgerEntry e, Guid accountId)
    {
        if (e.Status != TxStatus.Active) return 0;
        return e.Kind switch
        {
            TxKind.Income => e.AccountId == accountId ? e.Amount : 0,
            TxKind.Expense => e.AccountId == accountId ? -e.Amount : 0,
            TxKind.Transfer => (e.AccountId == accountId ? -e.Amount : 0) + (e.ToAccountId == accountId ? e.Amount : 0),
            _ => 0,
        };
    }

    public static long Balance(long opening, IEnumerable<LedgerEntry> entries, Guid accountId) => opening + entries.Sum(x => Effect(x, accountId));

    /// <summary>Danh mục phải cùng loại với giao dịch; chuyển quỹ không có danh mục.</summary>
    public static bool CategoryMatches(TxKind kind, CategoryKind category) =>
        kind == TxKind.Income && category == CategoryKind.Income || kind == TxKind.Expense && category == CategoryKind.Expense;

    /// <summary>Chỉ đề nghị đã duyệt mới được chi.</summary>
    public static bool CanPay(ExpenseStatus s) => s == ExpenseStatus.Approved;

    /// <summary>Huỷ giao dịch chi theo đề nghị → đề nghị trở lại "Đã duyệt" để chi lại.</summary>
    public static ExpenseStatus AfterPaymentVoided(ExpenseStatus s) => s == ExpenseStatus.Paid ? ExpenseStatus.Approved : s;
}
