import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type AgentConfig, isInside, lightExecutor, type RunnerConfig } from '../config';
import { projectFilesAbove, workDir } from '../core/paths';
import { adapters } from '../executor/run';
import { errText } from '../log';
import type { OfficeHubClient } from '../hub/client';
import type { TelegramClient } from '../telegram';
import { type Git, installHooks, mainBranchWarning, removeHooks, sh } from '../workspace';
import { CheckFailed, type Finding, Report } from './finding';
import { checkModel } from './model';

/** Thứ một lượt kiểm tra agent cần: cấu hình, env + git của agent (HOME / PATH riêng), client OfficeHub / Telegram. */
export interface DoctorContext {
  config: RunnerConfig;
  agent: AgentConfig;
  env: Record<string, string>;
  git: Git;
  hub: OfficeHubClient;
  tg: TelegramClient;
}

export interface DoctorOptions {
  /** Gọi `getMe` của bot Telegram (tắt: `--no-telegram`, lệnh `run`). */
  telegram: boolean;
  /** Chạy thử CLI để đọc model thật — tốn vài trăm token mỗi agent (tắt: `--no-model-check`). */
  modelCheck: boolean;
}

/** Kết quả kiểm tra một agent. `problem` có giá trị = agent không chạy được (đã có dòng ✘ tương ứng trong `findings`). */
export interface Diagnosis {
  findings: Finding[];
  problem?: string;
  /** Id nhân viên của token (đọc được trước khi lỗi thì vẫn trả). */
  employeeId?: string;
  /** Model thật đọc được khi chạy thử. */
  model?: string;
}

/**
 * Kiểm tra một agent theo thứ tự: CLI → token → workspace (repo / hook / nhánh) → env_file → Telegram → gh → model (sau cùng: chỉ tốn token khi
 * mọi kiểm tra khác đã qua). Lỗi đầu tiên dừng các bước sau. Có tác dụng phụ lên repo: cài hook (worktree) / gỡ hook của runner (in_place).
 */
export async function diagnoseAgent(c: DoctorContext, o: DoctorOptions): Promise<Diagnosis> {
  const report = new Report(c.agent.employeeCode);
  const result: Diagnosis = { findings: report.findings };
  const probe = { env: c.env, cwd: c.config.dataDir, enabled: o.modelCheck };
  try {
    await checkCli(c, report);
    result.employeeId = await checkToken(c, report);
    if (c.agent.workspace.mode === 'none') checkNoneWorkspace(c, report);
    else await checkRepoWorkspace(c, report);
    if (c.agent.envFile && !existsSync(c.agent.envFile))
      throw new CheckFailed(`không thấy env_file ${c.agent.envFile}`);
    if (o.telegram) await checkTelegram(c, report);
    if (c.agent.workspace.mode === 'worktree') await checkGh(c, report);
    result.model = await checkModel({ ...probe, exec: c.agent.executor }, report);
    // TEST-141: model riêng cho chat / họp (`executor.light.model`) — sai thì agent tắt như model chính
    const light = c.agent.executor.light?.model;
    if (light && light !== c.agent.executor.model)
      await checkModel({ ...probe, exec: lightExecutor(c.agent.executor), scope: 'chat / họp' }, report);
  } catch (e) {
    result.problem = errText(e);
    report.fail(result.problem);
  }
  return result;
}

/** Git của runner không chạy được (TEST-46) → agent có repo tắt, không kiểm tra gì thêm. */
export function gitUnavailable(agent: string, error: string): Diagnosis {
  return { findings: [{ level: 'fail', agent, text: error }], problem: error };
}

async function checkCli(c: DoctorContext, report: Report) {
  const exec = c.agent.executor;
  if (!existsSync(exec.bin)) throw new CheckFailed(`không thấy CLI ${exec.bin}`);
  const version = await sh([exec.bin, '--version'], '/', c.env);
  if (version.code !== 0) throw new CheckFailed(`${exec.bin} --version lỗi: ${version.err || version.out}`);
  const model = exec.model ? `model cấu hình ${exec.model}` : 'model: mặc định của CLI (không cấu hình)';
  report.ok(`CLI ${exec.kind} ${exec.bin} — ${version.out.split('\n')[0]} · ${model}`);
  for (const warning of adapters[exec.kind].homeWarnings?.(exec, c.env.HOME!) ?? []) report.warn(warning);
}

/** Token AI phải thuộc đúng nhân viên trong cấu hình. Trả id nhân viên. */
async function checkToken(c: DoctorContext, report: Report): Promise<string> {
  const me = await c.hub.me();
  if (me.code !== c.agent.employeeCode)
    throw new CheckFailed(`token thuộc nhân viên ${me.code}, không phải ${c.agent.employeeCode}`);
  report.ok(`token AI đúng nhân viên (${me.fullName})`);
  return me.id;
}

/** Agent nghiệp vụ (TEST-80): không repo / git / hook / gh. CLI chạy trong thư mục trống dưới data_dir, chỉ có tool MCP. */
function checkNoneWorkspace(c: DoctorContext, report: Report) {
  const work = workDir(c.config.dataDir, c.agent.employeeCode, 'x');
  report.ok(`workspace none — không repo / git / PR; CLI chạy trong ${dirname(work)}, chỉ tool MCP`);
  if (!adapters[c.agent.executor.kind].caps.toolRestriction)
    report.warn(
      `adapter ${c.agent.executor.kind} — runner không tắt được công cụ có sẵn của CLI (chạy lệnh, đọc / ghi file); CLI phải tự giới hạn`,
    );
  const above = projectFilesAbove(work);
  if (above.length)
    report.warn(
      `thư mục chạy nằm dưới ${above.join(', ')} — CLI có thể nạp hướng dẫn / repo đó; đặt runner.data_dir ra ngoài mọi repo`,
    );
}

/** Mode worktree / in_place: repo có origin, danh tính commit, thư mục của runner đã gitignore, hook, nhánh đang đứng. */
async function checkRepoWorkspace(c: DoctorContext, report: Report) {
  const { agent, git, config } = c;
  const inPlace = agent.workspace.mode === 'in_place';
  const origin = await git.run(agent.repo, 'remote', 'get-url', 'origin');
  if (origin.code !== 0) throw new CheckFailed(`${agent.repo} không phải git repo có remote origin`);
  const who = await git.identity(agent.repo);
  if (!who)
    throw new CheckFailed(
      `chưa có git user.name / user.email (HOME ${c.env.HOME}) — commit sẽ lỗi; runner không tự đặt danh tính`,
    );
  report.ok(`commit đứng tên ${who.name} <${who.email}> (tài khoản git của máy), trailer Agent / Task`);
  for (const dir of [config.worktreesDir, config.dataDir].filter((d) => isInside(d, agent.repo))) {
    const ignored = await git.run(agent.repo, 'check-ignore', '-q', join(dir, 'x'));
    if (ignored.code !== 0)
      throw new CheckFailed(`${dir} nằm trong repo nhưng chưa có trong .gitignore — thêm vào trước khi chạy`);
  }
  if (inPlace) {
    const removed = await removeHooks(git, agent.repo); // in_place không dùng hook
    const note = removed.length ? ` — đã gỡ hook của runner: ${removed.join(', ')}` : '';
    report.ok(`repo ${agent.repo}, mode in_place không dùng hook${note}`);
  } else {
    for (const warning of await installHooks(git, agent.repo, config.baseBranch)) report.warn(warning);
    report.ok(
      `repo ${agent.repo}, hook pre-push (chặn main / force push / agent-runner/) + commit-msg (trailer) đã cài`,
    );
  }
  const onMain = await mainBranchWarning(git, agent, config.baseBranch);
  if (onMain) report.warn(onMain);
  if (inPlace) await checkInPlace(c, report);
}

/** File .env ở gốc repo mà CLI chạy trong repo đọc được (bỏ qua .env.example / .sample / .template). */
const rootEnvFiles = (repo: string) =>
  readdirSync(repo).filter((f) => f === '.env' || (f.startsWith('.env.') && !/\.(example|sample|template)$/.test(f)));

/** in_place: CLI chạy thẳng trong repo → đọc được .env ở gốc repo (worktree ngoài repo thì không). Mặc định từ chối. */
async function checkInPlace(c: DoctorContext, report: Report) {
  const { agent, git, config } = c;
  const envFiles = rootEnvFiles(agent.repo);
  if (envFiles.length && !agent.workspace.allowEnvFiles)
    throw new CheckFailed(
      `workspace in_place nhưng repo có ${envFiles.join(', ')} — CLI đọc được file này; dùng bản clone riêng không có .env (hoặc workspace.allow_env_files: true)`,
    );
  if (envFiles.length) report.warn(`repo có ${envFiles.join(', ')} và CLI đọc được (allow_env_files)`);
  const branch = (await git.run(agent.repo, 'symbolic-ref', '--short', '-q', 'HEAD')).out;
  const dirty = (await git.run(agent.repo, 'status', '--porcelain')).out;
  report.ok(
    `workspace in_place — commit thẳng vào nhánh đang checkout rồi runner push nhánh đó lên origin, KHÔNG PR (hiện: ${branch || 'detached HEAD'})`,
  );
  const onBase = [config.baseBranch, 'main', 'master'].includes(branch);
  if (!branch || (!agent.workspace.allowBaseBranch && onBase))
    report.warn('nhánh hiện tại không dùng được cho in_place — việc sẽ bị từ chối cho tới khi chuyển nhánh');
  if (dirty) report.warn('repo đang có thay đổi chưa commit — việc sẽ bị từ chối cho tới khi sạch');
}

async function checkTelegram(c: DoctorContext, report: Report) {
  const bot = await c.tg.getMe();
  if (`@${bot.username.toLowerCase()}` !== c.agent.telegramBot)
    throw new CheckFailed(`telegram_token là của @${bot.username}, không phải ${c.agent.telegramBot}`);
  report.ok(`bot Telegram ${c.agent.telegramBot}`);
}

/** Mode worktree cần `gh` để mở PR — chưa đăng nhập chỉ cảnh báo (vẫn push được nhánh). */
async function checkGh(c: DoctorContext, report: Report) {
  const gh = await sh(['gh', 'auth', 'status'], c.agent.repo, c.env).catch(() => ({
    code: 1,
    out: '',
    err: 'không có gh',
  }));
  if (gh.code === 0) report.ok('gh đã đăng nhập');
  else report.warn(`gh chưa sẵn sàng (${(gh.err || gh.out).split('\n')[0]}) — sẽ không tạo được PR`);
}
