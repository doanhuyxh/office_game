using OfficeHub.Modules.LaborContracts.Domain;

namespace OfficeHub.Modules.LaborContracts.Tests;

public class ProbationReminderTests
{
    private static readonly DateOnly Today = new(2026, 11, 7);
    private static readonly Guid Emp = Guid.NewGuid();

    private static LaborContract Contract(ContractType type, int startOffset, int? endOffset) => new()
    {
        EmployeeId = Emp, Number = Guid.NewGuid().ToString("N")[..8], Type = type,
        StartDate = Today.AddDays(startOffset), EndDate = endOffset is { } e ? Today.AddDays(e) : null,
    };

    [Theory]
    [InlineData(8, false, false, false, null)]
    [InlineData(7, false, false, false, ProbationReminderKind.Days7)]
    [InlineData(4, true, false, false, null)]
    [InlineData(3, true, false, false, ProbationReminderKind.Days3)]
    [InlineData(2, false, false, false, ProbationReminderKind.Days3)]   // tạo muộn: chỉ nhắc mốc gần nhất
    [InlineData(0, true, false, false, ProbationReminderKind.Days3)]    // hết thử việc hôm nay
    [InlineData(1, true, true, false, null)]
    [InlineData(-1, true, true, false, ProbationReminderKind.Overdue)]  // hôm sau ngày kết thúc
    [InlineData(-7, true, true, false, ProbationReminderKind.Overdue)]  // bù khi job ngừng
    [InlineData(-8, false, false, false, null)]                         // quá cửa sổ: không cảnh báo hợp đồng cũ
    [InlineData(-1, true, true, true, null)]                            // chỉ cảnh báo một lần
    public void Due_by_days_left(int left, bool r7, bool r3, bool overdue, ProbationReminderKind? expected) =>
        Assert.Equal(expected, ContractRules.DueProbationReminder(Today.AddDays(left), Today, r7, r3, overdue));

    [Fact]
    public void Only_probation_without_following_contract()
    {
        var p = Contract(ContractType.Probation, -50, 5);
        Assert.Equal(ProbationReminderKind.Days7, ContractRules.DueProbationReminder(p, [p], Today));

        var next = Contract(ContractType.Fixed, 6, 400);                 // HĐLĐ ký sẵn từ hôm sau ngày kết thúc
        Assert.Null(ContractRules.DueProbationReminder(p, [p, next], Today));

        next.DeletedAt = DateTimeOffset.UnixEpoch;                       // HĐ nhập nhầm đã xoá → vẫn nhắc
        Assert.Equal(ProbationReminderKind.Days7, ContractRules.DueProbationReminder(p, [p, next], Today));

        var earlier = Contract(ContractType.Probation, -200, -100);      // hợp đồng trước đó không tính là "tiếp theo"
        Assert.Equal(ProbationReminderKind.Days7, ContractRules.DueProbationReminder(p, [earlier, p], Today));

        var otherEmp = Contract(ContractType.Indefinite, 6, null);
        otherEmp.EmployeeId = Guid.NewGuid();
        Assert.Equal(ProbationReminderKind.Days7, ContractRules.DueProbationReminder(p, [p, otherEmp], Today));
    }

    [Fact]
    public void Terminated_or_non_probation_skipped()
    {
        var fixedTerm = Contract(ContractType.Fixed, -100, 3);
        Assert.Null(ContractRules.DueProbationReminder(fixedTerm, [fixedTerm], Today));
        var p = Contract(ContractType.Probation, -30, -1);
        Assert.Equal(ProbationReminderKind.Overdue, ContractRules.DueProbationReminder(p, [p], Today));
        p.TerminatedOn = Today.AddDays(-2);                              // không đạt, đã chấm dứt
        Assert.Null(ContractRules.DueProbationReminder(p, [p], Today));
    }

    [Fact]
    public void Flags_on_entity_are_respected()
    {
        var p = Contract(ContractType.Probation, -30, 3);
        p.Reminded7At = DateTimeOffset.UnixEpoch;
        Assert.Equal(ProbationReminderKind.Days3, ContractRules.DueProbationReminder(p, [p], Today));
        p.Reminded3At = DateTimeOffset.UnixEpoch;
        Assert.Null(ContractRules.DueProbationReminder(p, [p], Today));
    }
}
