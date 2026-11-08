using OfficeHub.Modules.Finance.Domain;

namespace OfficeHub.Modules.Finance.Tests;

public class LedgerRulesTests
{
    private static readonly Guid A = Guid.NewGuid(), B = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 11, 8);

    private static string[] Fields(TxKind k, long amount, Guid acc, Guid? to, DateOnly date, DateOnly? locked = null) =>
        [.. LedgerRules.Validate(k, amount, acc, to, date, Today, locked).Select(x => x.Field)];

    [Fact]
    public void Valid_income_and_transfer_have_no_errors()
    {
        Assert.Empty(Fields(TxKind.Income, 1_000_000, A, null, Today));
        Assert.Empty(Fields(TxKind.Transfer, 500, A, B, Today.AddDays(-3)));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-5L)]
    [InlineData(LedgerRules.MaxAmount + 1)]
    public void Amount_must_be_positive_and_bounded(long amount) => Assert.Contains("amount", Fields(TxKind.Expense, amount, A, null, Today));

    [Fact]
    public void Transfer_needs_a_different_target_account_and_others_must_not_have_one()
    {
        Assert.Contains("toAccountId", Fields(TxKind.Transfer, 10, A, null, Today));
        Assert.Contains("toAccountId", Fields(TxKind.Transfer, 10, A, A, Today));
        Assert.Contains("toAccountId", Fields(TxKind.Income, 10, A, B, Today));
    }

    [Fact]
    public void Date_cannot_be_future_or_inside_locked_period()
    {
        Assert.Contains("date", Fields(TxKind.Expense, 10, A, null, Today.AddDays(1)));
        var locked = new DateOnly(2026, 10, 31);
        Assert.Contains("date", Fields(TxKind.Expense, 10, A, null, locked, locked));            // đúng ngày khoá = đã khoá
        Assert.Empty(Fields(TxKind.Expense, 10, A, null, locked.AddDays(1), locked));           // ngày sau khoá được ghi
    }

    private static LedgerEntry Entry(TxKind k, long amount, Guid acc, Guid? to = null, TxStatus st = TxStatus.Active) =>
        new() { Kind = k, Amount = amount, AccountId = acc, ToAccountId = to, Status = st };

    [Fact]
    public void Balance_applies_income_expense_and_transfers_to_both_accounts()
    {
        LedgerEntry[] entries =
        [
            Entry(TxKind.Income, 1_000, A), Entry(TxKind.Expense, 300, A), Entry(TxKind.Transfer, 200, A, B),
            Entry(TxKind.Income, 999, A, st: TxStatus.Voided), // đã huỷ: không tính
        ];
        Assert.Equal(5_000 + 1_000 - 300 - 200, LedgerRules.Balance(5_000, entries, A));
        Assert.Equal(0 + 200, LedgerRules.Balance(0, entries, B));
    }

    [Fact]
    public void Transfer_between_accounts_keeps_total_constant()
    {
        LedgerEntry[] entries = [Entry(TxKind.Transfer, 700, A, B)];
        Assert.Equal(1_000, LedgerRules.Balance(1_000, entries, A) + LedgerRules.Balance(0, entries, B));
    }

    [Fact]
    public void Category_kind_must_match_transaction_kind()
    {
        Assert.True(LedgerRules.CategoryMatches(TxKind.Income, CategoryKind.Income));
        Assert.False(LedgerRules.CategoryMatches(TxKind.Expense, CategoryKind.Income));
        Assert.False(LedgerRules.CategoryMatches(TxKind.Transfer, CategoryKind.Expense));
    }

    [Fact]
    public void Only_approved_expense_can_be_paid_and_voiding_payment_reopens_it()
    {
        Assert.True(LedgerRules.CanPay(ExpenseStatus.Approved));
        Assert.False(LedgerRules.CanPay(ExpenseStatus.Pending));
        Assert.False(LedgerRules.CanPay(ExpenseStatus.Paid));
        Assert.Equal(ExpenseStatus.Approved, LedgerRules.AfterPaymentVoided(ExpenseStatus.Paid));
        Assert.Equal(ExpenseStatus.Cancelled, LedgerRules.AfterPaymentVoided(ExpenseStatus.Cancelled));
        Assert.Equal("CP-00042", LedgerRules.ExpenseCode(42));
    }
}
