import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isInside } from './config';

export interface Sh { code: number; out: string; err: string }

/** Chạy lệnh (không qua shell) và chờ xong. */
export async function sh(cmd: string[], cwd: string, env?: Record<string, string>): Promise<Sh> {
  const p = Bun.spawn(cmd, { cwd, env: env ?? (process.env as Record<string, string>), stdout: 'pipe', stderr: 'pipe' });
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, out: out.trim(), err: err.trim() };
}

async function git(cwd: string, ...args: string[]) {
  const r = await sh(['git', ...args], cwd);
  if (r.code !== 0) throw new Error(`git ${args[0]} lỗi: ${r.err || r.out}`);
  return r.out;
}

/** Nhánh của việc: agent/<mã NV>/<mã việc> (chữ thường). */
export const branchName = (employeeCode: string, taskCode: string) => `agent/${employeeCode.toLowerCase()}/${taskCode.toLowerCase()}`;

/** Thư mục chặn: agent không được đổi mã runner (agent sửa được luật / bộ điều phối của chính nó). */
export const PROTECTED_PATHS = ['agent-runner/'];

export const PRE_PUSH_MARK = '# officehub-agent-runner pre-push';

/**
 * Hook pre-push (nằm ở .git/hooks — dùng chung cho mọi worktree của repo): chặn push lên main / master và chặn nhánh có thay đổi trong
 * agent-runner/. Áp dụng cho cả agent tự `git push` lẫn runner. Lớp bảo vệ thật vẫn là branch protection + CODEOWNERS trên GitHub.
 */
export function prePushHook(baseBranch: string) {
  return `#!/bin/sh
${PRE_PUSH_MARK} — do runner cài, đừng sửa tay (TEST-44)
zero=0000000000000000000000000000000000000000
while read local_ref local_sha remote_ref remote_sha; do
  case "$remote_ref" in
    refs/heads/${baseBranch}|refs/heads/main|refs/heads/master)
      echo "agent-runner: không push lên $remote_ref" >&2; exit 1 ;;
  esac
  [ "$local_sha" = "$zero" ] && continue
  if [ "$remote_sha" = "$zero" ]; then range="origin/${baseBranch}..$local_sha"; else range="$remote_sha..$local_sha"; fi
  if git diff --name-only $range 2>/dev/null | grep -q '^${PROTECTED_PATHS[0]}'; then
    echo "agent-runner: nhánh có thay đổi trong ${PROTECTED_PATHS[0]} — agent không được sửa bộ điều phối" >&2; exit 1
  fi
done
exit 0
`;
}

/** Cài / cập nhật hook pre-push. Hook khác đã có (không phải của runner) → không ghi đè, trả cảnh báo. */
export async function installPrePush(repo: string, baseBranch: string): Promise<string | null> {
  const common = await git(repo, 'rev-parse', '--git-common-dir');
  const dir = join(common.startsWith('/') ? common : join(repo, common), 'hooks');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'pre-push');
  if (existsSync(path) && !readFileSync(path, 'utf8').includes(PRE_PUSH_MARK)) return `${path} đã có hook khác — không ghi đè, tự gộp chặn main / agent-runner/`;
  writeFileSync(path, prePushHook(baseBranch));
  chmodSync(path, 0o755);
  return null;
}

/**
 * Worktree riêng cho việc, NGOÀI repo: {worktreesDir}/{mã NV}/{mã việc}. Đã có (việc bị trả về) → dùng lại, nhánh giữ nguyên.
 * Chưa có → fetch rồi tạo nhánh mới từ origin/{base}.
 */
export async function prepareWorktree(repo: string, worktreesDir: string, employeeCode: string, taskCode: string, baseBranch: string) {
  const path = join(worktreesDir, employeeCode, taskCode.toUpperCase());
  if (isInside(repo, path)) throw new Error('repo không được nằm trong worktree');
  const branch = branchName(employeeCode, taskCode);
  await git(repo, 'fetch', '--quiet', 'origin', baseBranch);
  if (existsSync(join(path, '.git'))) return { path, branch, reused: true };
  mkdirSync(join(worktreesDir, employeeCode), { recursive: true });
  const exists = (await sh(['git', 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], repo)).code === 0;
  if (exists) await git(repo, 'worktree', 'add', path, branch);
  else await git(repo, 'worktree', 'add', '-b', branch, path, `origin/${baseBranch}`);
  return { path, branch, reused: false };
}

/** Số commit của nhánh chưa có trên origin/{base} + file đổi (để chặn agent-runner/). */
export async function branchChanges(worktree: string, baseBranch: string) {
  const ahead = Number(await git(worktree, 'rev-list', '--count', `origin/${baseBranch}..HEAD`));
  const files = ahead > 0 ? (await git(worktree, 'diff', '--name-only', `origin/${baseBranch}...HEAD`)).split('\n').filter(Boolean) : [];
  const dirty = (await git(worktree, 'status', '--porcelain')).length > 0;
  return { ahead, files, dirty, touchesProtected: files.some((f) => PROTECTED_PATHS.some((p) => f.startsWith(p))) };
}

/**
 * Push nhánh + mở PR bằng gh (đăng nhập sẵn trong HOME của agent hoặc GH_TOKEN trong env_file). PR đã có → trả link cũ.
 */
export async function publish(worktree: string, branch: string, baseBranch: string, title: string, body: string, env: Record<string, string>) {
  const push = await sh(['git', 'push', '--quiet', '-u', 'origin', branch], worktree, env);
  if (push.code !== 0) throw new Error(`git push lỗi: ${push.err || push.out}`);
  const existing = await sh(['gh', 'pr', 'list', '--head', branch, '--state', 'open', '--json', 'url', '--jq', '.[0].url'], worktree, env);
  if (existing.code === 0 && existing.out) return existing.out;
  const pr = await sh(['gh', 'pr', 'create', '--base', baseBranch, '--head', branch, '--title', title, '--body', body], worktree, env);
  if (pr.code !== 0) throw new Error(`gh pr create lỗi: ${pr.err || pr.out}`);
  return pr.out.split('\n').pop()!;
}
