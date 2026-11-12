import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { isInside } from './config';

export interface Sh { code: number; out: string; err: string }

/** Chạy lệnh (không qua shell) và chờ xong. */
export async function sh(cmd: string[], cwd: string, env?: Record<string, string>): Promise<Sh> {
  const p = Bun.spawn(cmd, { cwd, env: env ?? (process.env as Record<string, string>), stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out.trim(), err: err.trim() };
}

/**
 * Mọi lệnh git của runner đi qua đây với file chạy từ cấu hình `git.executable` (TEST-46; trống = "git" trong PATH).
 * Không ghi đè user.name / user.email, không giữ token: dùng cấu hình git + credential helper / SSH key sẵn có trong HOME.
 * `GIT_TERMINAL_PROMPT=0`: thiếu thông tin đăng nhập → lỗi ngay, không treo chờ nhập mật khẩu.
 */
export class Git {
  constructor(readonly bin: string, readonly env: Record<string, string> = process.env as Record<string, string>) {}

  /** Bản dùng env khác (HOME / PATH của agent). */
  withEnv(env: Record<string, string>) { return new Git(this.bin, env); }

  run(cwd: string, ...args: string[]) { return sh([this.bin, ...args], cwd, { ...this.env, GIT_TERMINAL_PROMPT: '0' }); }

  async out(cwd: string, ...args: string[]) {
    const r = await this.run(cwd, ...args);
    if (r.code !== 0) throw new Error(`git ${args[0]} lỗi: ${r.err || r.out}`);
    return r.out;
  }

  /** PATH có thư mục của git cấu hình ở đầu → CLI agent, gh, hook đều gọi đúng git này. */
  pathWithGit(path: string | undefined) {
    return isAbsolute(this.bin) ? [dirname(this.bin), path].filter(Boolean).join(':') : path ?? '';
  }

  /** Kiểm tra lúc khởi động: file chạy được + phiên bản. Lỗi → ném (runner không nhận việc). */
  async version() {
    if (isAbsolute(this.bin) && !existsSync(this.bin)) throw new Error(`git.executable ${this.bin} không tồn tại`);
    const r = await this.run('/', '--version').catch((e) => ({ code: 1, out: '', err: String(e) }));
    if (r.code !== 0) throw new Error(`git.executable ${this.bin} không chạy được: ${r.err || r.out}`);
    return r.out;
  }

  /** Danh tính commit lấy từ cấu hình git của máy (repo / global của HOME). Thiếu → null. */
  async identity(repo: string) {
    const name = (await this.run(repo, 'config', 'user.name')).out;
    const email = (await this.run(repo, 'config', 'user.email')).out;
    return name && email ? { name, email } : null;
  }
}

/** Nhánh của việc: agent/<mã NV>/<mã việc> (chữ thường). */
export const branchName = (employeeCode: string, taskCode: string) => `agent/${employeeCode.toLowerCase()}/${taskCode.toLowerCase()}`;

/** Thư mục chặn: agent không được đổi mã runner (agent sửa được luật / bộ điều phối của chính nó). */
export const PROTECTED_PATHS = ['agent-runner/'];

export const PRE_PUSH_MARK = '# officehub-agent-runner pre-push';
export const COMMIT_MSG_MARK = '# officehub-agent-runner commit-msg';

/** Biến môi trường runner đặt cho CLI agent — hook commit-msg dựa vào đây để gắn trailer (commit của người không bị đụng). */
export const AGENT_ENV = 'OFFICEHUB_AGENT', TASK_ENV = 'OFFICEHUB_TASK';

/**
 * Hook pre-push (nằm ở .git/hooks — dùng chung cho mọi worktree của repo): chặn push lên main / master, chặn force push (commit trên remote
 * không phải tổ tiên của commit đẩy lên) và chặn nhánh có thay đổi trong agent-runner/. Áp dụng cho cả agent tự `git push` lẫn runner.
 * Lớp bảo vệ thật vẫn là branch protection + CODEOWNERS trên GitHub.
 */
export function prePushHook(baseBranch: string) {
  return `#!/bin/sh
${PRE_PUSH_MARK} — do runner cài, đừng sửa tay (TEST-44, TEST-46)
zero=0000000000000000000000000000000000000000
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/${baseBranch}|refs/heads/main|refs/heads/master)
      echo "agent-runner: không push lên $remote_ref" >&2; exit 1 ;;
  esac
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" != "$zero" ] && ! git merge-base --is-ancestor "$remote_sha" "$local_sha" 2>/dev/null; then
    echo "agent-runner: không force push $remote_ref" >&2; exit 1
  fi
  if [ "$remote_sha" = "$zero" ]; then range="origin/${baseBranch}..$local_sha"; else range="$remote_sha..$local_sha"; fi
  if git diff --name-only $range 2>/dev/null | grep -q '^${PROTECTED_PATHS[0]}'; then
    echo "agent-runner: nhánh có thay đổi trong ${PROTECTED_PATHS[0]} — agent không được sửa bộ điều phối" >&2; exit 1
  fi
done
exit 0
`;
}

/**
 * Hook commit-msg: chỉ khi commit được tạo trong phiên agent ($${AGENT_ENV} có giá trị) → thêm trailer "Agent: <mã NV>" + "Task: <mã việc>".
 * Không đổi tác giả (vẫn là tài khoản git của máy). Commit của người (không có biến) → không làm gì.
 */
export function commitMsgHook() {
  return `#!/bin/sh
${COMMIT_MSG_MARK} — do runner cài, đừng sửa tay (TEST-46)
[ -z "$${AGENT_ENV}" ] && exit 0
git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Agent: $${AGENT_ENV}" "$1" || exit 1
if [ -n "$${TASK_ENV}" ]; then
  git interpret-trailers --in-place --if-exists addIfDifferent --trailer "Task: $${TASK_ENV}" "$1" || exit 1
fi
exit 0
`;
}

/** Cài / cập nhật hook pre-push + commit-msg. Hook khác đã có (không phải của runner) → không ghi đè, trả cảnh báo. */
export async function installHooks(git: Git, repo: string, baseBranch: string): Promise<string[]> {
  const common = await git.out(repo, 'rev-parse', '--git-common-dir');
  const dir = join(isAbsolute(common) ? common : join(repo, common), 'hooks');
  mkdirSync(dir, { recursive: true });
  const warnings: string[] = [];
  for (const [name, mark, body] of [['pre-push', PRE_PUSH_MARK, prePushHook(baseBranch)], ['commit-msg', COMMIT_MSG_MARK, commitMsgHook()]] as const) {
    const path = join(dir, name);
    if (existsSync(path) && !readFileSync(path, 'utf8').includes(mark)) { warnings.push(`${path} đã có hook khác — không ghi đè, tự gộp phần của runner`); continue; }
    writeFileSync(path, body);
    chmodSync(path, 0o755);
  }
  return warnings;
}

/**
 * Worktree riêng cho việc: {worktreesDir}/{mã NV}/{mã việc}. Đã có (việc bị trả về) → dùng lại, nhánh giữ nguyên.
 * Chưa có → fetch rồi tạo nhánh mới từ origin/{base}.
 */
export async function prepareWorktree(git: Git, repo: string, worktreesDir: string, employeeCode: string, taskCode: string, baseBranch: string) {
  const path = join(worktreesDir, employeeCode, taskCode.toUpperCase());
  if (isInside(repo, path)) throw new Error('repo không được nằm trong worktree');
  const branch = branchName(employeeCode, taskCode);
  await git.out(repo, 'fetch', '--quiet', 'origin', baseBranch);
  if (existsSync(join(path, '.git'))) return { path, branch, reused: true };
  mkdirSync(join(worktreesDir, employeeCode), { recursive: true });
  const exists = (await git.run(repo, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`)).code === 0;
  if (exists) await git.out(repo, 'worktree', 'add', path, branch);
  else await git.out(repo, 'worktree', 'add', '-b', branch, path, `origin/${baseBranch}`);
  return { path, branch, reused: false };
}

/** Số commit của nhánh chưa có trên origin/{base} + file đổi (để chặn agent-runner/). */
export async function branchChanges(git: Git, worktree: string, baseBranch: string) {
  const ahead = Number(await git.out(worktree, 'rev-list', '--count', `origin/${baseBranch}..HEAD`));
  const files = ahead > 0 ? (await git.out(worktree, 'diff', '--name-only', `origin/${baseBranch}...HEAD`)).split('\n').filter(Boolean) : [];
  const dirty = (await git.out(worktree, 'status', '--porcelain')).length > 0;
  return { ahead, files, dirty, touchesProtected: files.some((f) => PROTECTED_PATHS.some((p) => f.startsWith(p))) };
}

/**
 * Push nhánh (không bao giờ --force) + mở PR bằng gh (đăng nhập sẵn trong HOME hoặc GH_TOKEN trong env_file). PR đã có → trả link cũ.
 */
export async function publish(git: Git, worktree: string, branch: string, baseBranch: string, title: string, body: string) {
  const push = await git.run(worktree, 'push', '--quiet', '-u', 'origin', branch);
  if (push.code !== 0) throw new Error(`git push lỗi: ${push.err || push.out}`);
  const env = { ...git.env, GIT_TERMINAL_PROMPT: '0' };
  const existing = await sh(['gh', 'pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], worktree, env);
  if (existing.code === 0 && existing.out) return existing.out;
  const pr = await sh(['gh', 'pr', 'create', '--base', baseBranch, '--head', branch, '--title', title, '--body', body], worktree, env);
  if (pr.code !== 0) throw new Error(`gh pr create lỗi: ${pr.err || pr.out}`);
  return pr.out.split('\n').pop()!;
}
