using OfficeHub.BuildingBlocks.Configuration;

namespace OfficeHub.Architecture.Tests;

/// <summary>TEST-44: worktree nằm trong repo không được đọc .env của repo chính (DB production).</summary>
public class EnvLoaderTests : IDisposable
{
    private readonly string _root = Directory.CreateTempSubdirectory("envloader-").FullName;

    public void Dispose() => Directory.Delete(_root, true);

    private string Dir(params string[] parts)
    {
        var p = Path.Combine([_root, .. parts]);
        Directory.CreateDirectory(p);
        return p;
    }

    [Fact]
    public void Finds_env_at_repo_root_from_subfolder()
    {
        Dir("repo", ".git");
        File.WriteAllText(Path.Combine(_root, "repo", ".env"), "X=1");
        Assert.Equal(Path.Combine(_root, "repo", ".env"), EnvLoader.Find(Dir("repo", "backend", "src", "OfficeHub.Api")));
    }

    [Fact]
    public void Worktree_inside_repo_does_not_read_main_env()
    {
        Dir("repo", ".git");
        File.WriteAllText(Path.Combine(_root, "repo", ".env"), "ConnectionStrings__Default=production");
        var wt = Dir("repo", ".officehub-runner", "worktrees", "NV018", "TEST-45");
        File.WriteAllText(Path.Combine(wt, ".git"), "gitdir: ../../../../.git/worktrees/TEST-45"); // worktree: .git là FILE
        Assert.Null(EnvLoader.Find(Path.Combine(Dir("repo", ".officehub-runner", "worktrees", "NV018", "TEST-45", "backend"))));
    }

    [Fact]
    public void Worktree_own_env_is_used()
    {
        Dir("repo", ".git");
        File.WriteAllText(Path.Combine(_root, "repo", ".env"), "X=prod");
        var wt = Dir("repo", ".claude", "worktrees", "a");
        File.WriteAllText(Path.Combine(wt, ".git"), "gitdir: x");
        File.WriteAllText(Path.Combine(wt, ".env"), "X=test");
        Assert.Equal(Path.Combine(wt, ".env"), EnvLoader.Find(Dir("repo", ".claude", "worktrees", "a", "backend")));
    }

    [Fact]
    public void Without_git_keeps_walking_up_like_before() // container: /app không có .git
    {
        File.WriteAllText(Path.Combine(_root, ".env"), "X=1");
        Assert.Equal(Path.Combine(_root, ".env"), EnvLoader.Find(Dir("app", "bin")));
    }
}
