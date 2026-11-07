using OfficeHub.Modules.Documents.Domain;
using OfficeHub.Modules.Documents.Infrastructure;
using OfficeHub.Modules.Organization.Contracts;

namespace OfficeHub.Modules.Documents.Tests;

public class DocumentRulesTests
{
    [Theory]
    [InlineData("image/png", "a.png", AssetKind.Image)]
    [InlineData("video/mp4", "clip.mp4", AssetKind.Video)]
    [InlineData("audio/mpeg", "a.mp3", AssetKind.Audio)]
    [InlineData("application/pdf", "hop-dong.pdf", AssetKind.Document)]
    [InlineData("application/octet-stream", "bao-cao.xlsx", AssetKind.Document)]
    [InlineData("application/zip", "thiet-ke.zip", AssetKind.Archive)]
    [InlineData("application/octet-stream", "model.fbx", AssetKind.Other)]
    public void KindOf_uses_mime_then_extension(string mime, string name, AssetKind expected) =>
        Assert.Equal(expected, DocumentRules.KindOf(mime, name));

    [Theory]
    [InlineData("setup.exe", true)]
    [InlineData("SCRIPT.BAT", true)]
    [InlineData("app.apk", true)]
    [InlineData("bao-cao.pdf", false)]
    [InlineData("video.mov", false)]
    public void Executables_are_blocked(string name, bool blocked) => Assert.Equal(blocked, DocumentRules.IsBlocked(name));

    [Fact]
    public void SafeKeyName_strips_vietnamese_marks_and_unsafe_chars()
    {
        Assert.Equal("Bao-cao-thang-10-Dong-Da.pdf", DocumentRules.SafeKeyName("Báo cáo tháng 10 (Đống Đa).pdf"));
        Assert.Equal("file", DocumentRules.SafeKeyName("////"));
        Assert.True(DocumentRules.SafeKeyName(new string('a', 500) + ".mp4").Length <= 120);
    }

    [Fact]
    public void CleanFileName_drops_path_and_control_chars()
    {
        Assert.Equal("a.pdf", DocumentRules.CleanFileName("C:\\Users\\x\\a.pdf"));
        Assert.Equal("ảnh 1.jpg", DocumentRules.CleanFileName("thư mục/ảnh 1.jpg"));
        Assert.Equal("ab.txt", DocumentRules.CleanFileName("a\u0000b.txt"));
    }

    [Theory]
    [InlineData("video/MP4; codecs=avc1", "video/mp4")]
    [InlineData("", "application/octet-stream")]
    [InlineData(null, "application/octet-stream")]
    [InlineData("not a mime", "application/octet-stream")]
    [InlineData("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")]
    public void NormalizeContentType(string? input, string expected) => Assert.Equal(expected, DocumentRules.NormalizeContentType(input));

    [Theory]
    [InlineData("Hợp đồng 2026", null)]
    [InlineData("  ", "Tên thư mục không được để trống")]
    [InlineData("a/b", "Tên thư mục không được chứa / hoặc \\")]
    [InlineData("..", "Tên thư mục không được chứa / hoặc \\")]
    public void FolderNameError(string name, string? error) => Assert.Equal(error, DocumentRules.FolderNameError(name));

    [Fact]
    public void NormalizeTags_trims_dedupes_and_limits()
    {
        var tags = DocumentRules.NormalizeTags(["  khách   hàng A ", "Khách hàng a", "", "logo", .. Enumerable.Range(0, 30).Select(i => $"t{i}")]);
        Assert.Equal("khách hàng A", tags[0]);
        Assert.Equal("logo", tags[1]);
        Assert.Equal(DocumentRules.MaxTags, tags.Count);
        Assert.Equal(DocumentRules.MaxTagLength, DocumentRules.NormalizeTags([new string('x', 100)])[0].Length);
    }

    [Fact]
    public void Retention_and_numbers()
    {
        Assert.Equal(new DateOnly(2036, 11, 7), DocumentRules.RetentionUntil(new DateOnly(2026, 11, 7), 10));
        Assert.Null(DocumentRules.RetentionUntil(new DateOnly(2026, 11, 7), null));
        Assert.Equal("TL-KTH-2026-00012", DocumentRules.AssetCode("KTH", 2026, 12));
        Assert.Equal("012/2026/QĐ-KTH", DocumentRules.DocumentNumber(12, 2026, "QĐ", "KTH"));
        Assert.Equal("CTY", DocumentRules.SpaceCode(SpaceKind.Company, "x"));
        Assert.Equal("DAAPP", DocumentRules.SpaceCode(SpaceKind.Project, "da-app"));
        Assert.Equal("PB", DocumentRules.SpaceCode(SpaceKind.Department, null));
    }

    [Fact]
    public void Lifecycle_guards()
    {
        Assert.True(DocumentRules.CanChangeFile(AssetStatus.Draft));
        Assert.False(DocumentRules.CanChangeFile(AssetStatus.Published));
        Assert.False(DocumentRules.CanTrash(AssetStatus.Published));
        Assert.True(DocumentRules.CanArchive(AssetStatus.Published));
        Assert.False(DocumentRules.CanDestroy(AssetStatus.PendingApproval));
        Assert.False(DocumentRules.CanDestroy(AssetStatus.Destroyed));
    }
}

public class DocumentAccessTests
{
    private static readonly Guid Dept = Guid.NewGuid(), Other = Guid.NewGuid(), Proj = Guid.NewGuid();

    private static Viewer V(bool hr = false, Guid[]? depts = null, Guid[]? managed = null, Dictionary<Guid, ProjectRole>? projects = null) =>
        new(Guid.NewGuid(), "A", hr, null, (depts ?? []).ToHashSet(), (managed ?? []).ToHashSet(), projects ?? []);

    [Fact]
    public void Company_space_is_open_to_everyone_but_managed_by_hr()
    {
        Assert.True(DocumentAccess.CanRead(V(), SpaceKind.Company, null));
        Assert.False(DocumentAccess.CanManage(V(), SpaceKind.Company, null));
        Assert.True(DocumentAccess.CanManage(V(hr: true), SpaceKind.Company, null));
    }

    [Fact]
    public void Department_space_requires_membership()
    {
        var v = V(depts: [Dept]);
        Assert.True(DocumentAccess.CanRead(v, SpaceKind.Department, Dept));
        Assert.False(DocumentAccess.CanRead(v, SpaceKind.Department, Other));
        Assert.False(DocumentAccess.CanManage(v, SpaceKind.Department, Dept));
        Assert.True(DocumentAccess.CanManage(V(depts: [Dept], managed: [Dept]), SpaceKind.Department, Dept));
        Assert.True(DocumentAccess.CanRead(V(hr: true), SpaceKind.Department, Other));
    }

    [Fact]
    public void Project_space_members_and_managers()
    {
        var member = V(projects: new() { [Proj] = ProjectRole.Member });
        var manager = V(projects: new() { [Proj] = ProjectRole.Manager });
        Assert.True(DocumentAccess.CanRead(member, SpaceKind.Project, Proj));
        Assert.False(DocumentAccess.CanManage(member, SpaceKind.Project, Proj));
        Assert.True(DocumentAccess.CanManage(manager, SpaceKind.Project, Proj));
        Assert.False(DocumentAccess.CanRead(V(), SpaceKind.Project, Proj));
    }

    [Fact]
    public void Higher_classification_is_hr_only_for_now()
    {
        var a = new Asset { Code = "x", Title = "x", SpaceKind = SpaceKind.Company, Classification = Classification.Confidential };
        Assert.False(DocumentAccess.CanView(V(), a));
        Assert.True(DocumentAccess.CanView(V(hr: true), a));
        a.Classification = Classification.Internal;
        Assert.True(DocumentAccess.CanView(V(), a));
    }

    [Fact]
    public void Descendants_walks_tree_and_survives_cycles()
    {
        var a = Guid.NewGuid(); var b = Guid.NewGuid(); var c = Guid.NewGuid();
        var all = new List<DepartmentRef> { new(a, "A", "A", c, null), new(b, "B", "B", a, null), new(c, "C", "C", b, null) };
        Assert.Equal(3, DocumentAccess.Descendants(all, a).Count());
    }
}
