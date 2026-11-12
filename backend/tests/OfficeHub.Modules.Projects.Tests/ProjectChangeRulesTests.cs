using OfficeHub.Modules.Projects.Domain;

namespace OfficeHub.Modules.Projects.Tests;

public class ProjectChangeRulesTests
{
    private static readonly ProjectSnapshot Base = new("Website", ProjectKind.Internal, ProjectStatus.Active, "Mô tả", "Kỹ thuật", null, ["HD-1"],
        new DateOnly(2026, 11, 1), new DateOnly(2026, 11, 30), 20m, true, "## Hướng dẫn");

    [Fact]
    public void No_change_no_lines() => Assert.Empty(ProjectChangeRules.Diff(Base, Base with { Contracts = ["HD-1"] }));

    [Fact]
    public void Short_values_for_simple_fields()
    {
        var after = Base with { Name = "Website mới", Status = ProjectStatus.Closed, EndOn = new DateOnly(2026, 12, 15), BudgetManDays = 25.5m, Sequential = false };
        Assert.Equal([
            "Tên: \"Website\" → \"Website mới\"",
            "Trạng thái: Đang chạy → Đã đóng",
            "Kết thúc dự kiến: 30/11/2026 → 15/12/2026",
            "Ngân sách ngày công: 20 → 25.5",
            "Đi lần lượt: bật → tắt",
        ], ProjectChangeRules.Diff(Base, after));
    }

    [Fact]
    public void Long_text_only_says_edited()
    {
        var lines = ProjectChangeRules.Diff(Base, Base with { Description = "Khác hẳn", WorkGuide = "## Bản mới bí mật" });
        Assert.Equal(["Mô tả: đã sửa", "Hướng dẫn làm việc: đã sửa"], lines);
        Assert.DoesNotContain(lines, l => l.Contains("bí mật"));
    }

    [Fact]
    public void Empty_values_and_department()
    {
        var lines = ProjectChangeRules.Diff(Base with { Department = null, EndOn = null }, Base with { Department = "Kinh doanh" });
        Assert.Equal(["Phòng ban chủ trì: trống → Kinh doanh", "Kết thúc dự kiến: trống → 30/11/2026"], lines);
    }

    [Fact]
    public void Description_null_and_empty_are_the_same() => Assert.Empty(ProjectChangeRules.Diff(Base with { Description = null }, Base with { Description = "" }));

    [Fact]
    public void Contracts_added_and_removed() =>
        Assert.Equal(["Loại: Nội bộ → Làm cho khách", "Hợp đồng bán: thêm HD-2, thêm HD-3, bỏ HD-1"],
            ProjectChangeRules.Diff(Base, Base with { Kind = ProjectKind.Client, Contracts = ["HD-3", "HD-2"] }));

    [Fact]
    public void Business_line_changed() => Assert.Equal(["Mảng kinh doanh: đã đổi"], ProjectChangeRules.Diff(Base, Base with { BusinessLineId = Guid.NewGuid() }));

    [Fact]
    public void Actor_label_marks_bot() =>
        Assert.Equal(("Nguyễn A", "BOT (token của Nguyễn A)"), (ProjectChangeRules.Actor("Nguyễn A", false), ProjectChangeRules.Actor("Nguyễn A", true)));

    [Fact]
    public void Body_is_cut()
    {
        Assert.Equal("A đã sửa: x; y.", ProjectChangeRules.Body("A", ["x", "y"]));
        Assert.True(ProjectChangeRules.Body("A", [new string('x', 500)]).Length <= TaskNotifyRules.MaxBody + 1);
    }

    private static readonly Guid Actor = Guid.NewGuid(), M1 = Guid.NewGuid(), M2 = Guid.NewGuid();
    private static readonly (Guid?, bool)[] Members = [(Actor, true), (M1, true), (M2, false), (null, true)];

    [Fact]
    public void Web_edit_skips_the_editor() => Assert.Equal([M1], ProjectChangeRules.Recipients(Members, Actor, byToken: false));

    [Fact]
    public void Token_edit_also_notifies_the_token_owner() => Assert.Equal([Actor, M1], ProjectChangeRules.Recipients(Members, Actor, byToken: true));
}
