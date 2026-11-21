import { existsSync, readdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import {
  type AgentConfig,
  agentWorkspaces,
  defaultWorkspace,
  isInside,
  lightExecutor,
  type ProjectWorkspace,
  type RunnerConfig,
  repoBaseBranches,
} from '../config';
import { projectFilesAbove, workDir } from '../core/paths';
import { adapters } from '../executor/run';
import { errText } from '../log';
import type { OfficeHubClient } from '../hub/client';
import type { TelegramClient } from '../telegram';
import { type Git, installHooks, mainBranchWarning, removeHooks, sh } from '../workspace';
import { CheckFailed, type DoctorProgress, type Finding, Report } from './finding';
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
  /** Nhận từng bước + từng kết quả ngay khi có (lúc khởi động runner, TEST-159). Không đặt = chỉ trả kết quả cuối. */
  progress?: DoctorProgress;
}

/** Kết quả kiểm tra một agent. `problem` có giá trị = agent không chạy được (đã có dòng ✘ tương ứng trong `findings`). */
export interface Diagnosis {
  findings: Finding[];
  problem?: string;
  /** Id nhân viên của token (đọc được trước khi lỗi thì vẫn trả). */
  employeeId?: string;
  /** Họ tên nhân viên của token. */
  employeeName?: string;
  /** Model thật đọc được khi chạy thử. */
  model?: string;
}

/**
 * Kiểm tra một agent theo thứ tự: CLI → token → dự án gắn repo (mã → id) → workspace (repo / hook / nhánh, TỪNG repo) → env_file → Telegram →
 * gh → model (sau cùng: chỉ tốn token khi mọi kiểm tra khác đã qua). Lỗi đầu tiên dừng các bước sau — trừ lỗi của một mục `projects`
 * (TEST-200): chỉ dự án đó tắt (ghi `problem` vào mục, dòng ⚠), agent vẫn chạy các dự án còn lại.
 * Có tác dụng phụ: cài hook (worktree) / gỡ hook của runner (in_place) trên repo; ghi `projectId` / `problem` vào `agent.projects`.
 */
export async function diagnoseAgent(c: DoctorContext, o: DoctorOptions): Promise<Diagnosis> {
  const report = new Report(c.agent.employeeCode, o.progress);
  const result: Diagnosis = { findings: report.findings };
  const probe = { env: c.env, cwd: c.config.dataDir, enabled: o.modelCheck };
  const { executor } = c.agent;
  try {
    report.step(`kiểm tra CLI ${executor.kind} (${executor.bin} --version)`);
    await checkCli(c, report);
    report.step('kiểm tra token AI với OfficeHub (get_my_profile)');
    const me = await checkToken(c, report);
    result.employeeId = me.id;
    result.employeeName = me.fullName;
    if (c.agent.projects.length) {
      report.step(`đổi mã dự án → id (get_project): ${c.agent.projects.map((p) => p.projectCode).join(', ')}`);
      await resolveProjects(c, report);
    }
    if (defaultWorkspace(c.agent)) {
      report.step('kiểm tra workspace none (thư mục chạy)');
      checkNoneWorkspace(c, report);
    } else {
      await checkProjectWorkspaces(c, report);
      if (c.agent.projects.every((p) => p.problem))
        throw new CheckFailed('không dự án nào trong projects chạy được — xem các dòng ⚠ (dự án …) ở trên');
    }
    if (c.agent.envFile && !existsSync(c.agent.envFile))
      throw new CheckFailed(`không thấy env_file ${c.agent.envFile}`);
    if (o.telegram) {
      report.step(`kiểm tra bot Telegram ${c.agent.telegramBot} (getMe)`);
      await checkTelegram(c, report);
    }
    const prRepo = agentWorkspaces(c.agent).find((w) => w.workspace.mode === 'worktree' && !w.problem)?.repo;
    if (prRepo) {
      report.step('kiểm tra gh (gh auth status)');
      await checkGh(c, report, prRepo);
    }
    if (executor.requiredBins.length) {
      report.step(`kiểm tra lệnh cần có: ${executor.requiredBins.join(', ')}`);
      checkRequiredBins(c, report);
    }
    report.step(modelStep(o.modelCheck, executor.model));
    result.model = await checkModel({ ...probe, exec: executor }, report);
    // TEST-141: model riêng cho chat / họp (`executor.light.model`) — sai thì agent tắt như model chính
    const light = executor.light?.model;
    if (light && light !== executor.model) {
      report.step(modelStep(o.modelCheck, light, 'chat / họp'));
      await checkModel({ ...probe, exec: lightExecutor(executor), scope: 'chat / họp' }, report);
    }
  } catch (e) {
    result.problem = errText(e);
    report.fail(result.problem);
  }
  return result;
}

/** Câu báo bước kiểm tra model: chạy thử thật thì nói rõ có thể lâu (người xem log không tưởng runner treo). */
function modelStep(enabled: boolean, model: string | undefined, scope?: string): string {
  const what = `model ${scope ? `${scope} ` : ''}${model ?? 'mặc định của CLI'}`;
  return enabled ? `chạy thử ${what} — có thể mất tới 2 phút` : `kiểm tra ${what} (không chạy thử)`;
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

/** Token AI phải thuộc đúng nhân viên trong cấu hình. Trả id + họ tên nhân viên. */
async function checkToken(c: DoctorContext, report: Report): Promise<{ id: string; fullName: string }> {
  const me = await c.hub.me();
  if (me.code !== c.agent.employeeCode)
    throw new CheckFailed(`token thuộc nhân viên ${me.code}, không phải ${c.agent.employeeCode}`);
  report.ok(`token AI đúng nhân viên (${me.fullName})`);
  return me;
}

/** Agent nghiệp vụ (TEST-80): không repo / git / hook / gh. CLI chạy trong thư mục trống dưới data_dir, chỉ có tool MCP. */
function checkNoneWorkspace(c: DoctorContext, report: Report) {
  const work = workDir(c.config.dataDir, c.agent.employeeCode, 'x');
  if (c.agent.workspace.builtinTools) {
    // TEST-163: có shell trên máy runner — agent chạy lệnh theo hướng dẫn dự án / chức vụ, giới hạn bằng quyền của user HOME agent.
    report.warn(
      `workspace none + builtin_tools — không repo nhưng CLI CHẠY ĐƯỢC LỆNH / đọc ghi file trong ${dirname(work)} (quyền của user chạy agent); ` +
        'chỉ cấp khoá / token (ssh, gh) thật cần cho việc của bot này',
    );
  } else report.ok(`workspace none — không repo / git / PR; CLI chạy trong ${dirname(work)}, chỉ tool MCP`);
  if (!c.agent.workspace.builtinTools && !adapters[c.agent.executor.kind].caps.toolRestriction)
    report.warn(
      `adapter ${c.agent.executor.kind} — runner không tắt được công cụ có sẵn của CLI (chạy lệnh, đọc / ghi file); CLI phải tự giới hạn`,
    );
  const above = projectFilesAbove(work);
  if (above.length)
    report.warn(
      `thư mục chạy nằm dưới ${above.join(', ')} — CLI có thể nạp hướng dẫn / repo đó; đặt runner.data_dir ra ngoài mọi repo`,
    );
}

/** Phạm vi của dòng kết quả theo dự án: `NV120 (dự án OFFICE): …`. */
const projectScope = (p: ProjectWorkspace) => `dự án ${p.projectCode}`;

/**
 * TEST-200: đổi mã dự án của từng mục `projects` thành id (tin đánh thức / việc chỉ mang `project_id`). Mã không thấy trên OfficeHub, agent
 * không xem được hoặc không phải thành viên được làm việc → ⚠ và tắt riêng dự án đó.
 */
async function resolveProjects(c: DoctorContext, report: Report) {
  for (const p of c.agent.projects) {
    p.projectId = undefined;
    p.problem = undefined;
    try {
      const found = (await c.hub.getProject(p.projectCode))?.project;
      if (!found?.id || String(found.code ?? '').toUpperCase() !== p.projectCode)
        throw new CheckFailed('OfficeHub không trả dự án có mã này');
      if (found.canWork === false) throw new CheckFailed('agent không phải thành viên được làm việc của dự án');
      p.projectId = found.id;
      report.ok(`mã dự án → id ${found.id}`, projectScope(p));
    } catch (e) {
      disableProject(p, report, `không dùng được mã dự án trên OfficeHub: ${errText(e).slice(0, 200)}`);
    }
  }
}

/** Kiểm tra repo của từng mục `projects` còn bật; repo lỗi → chỉ dự án đó tắt. */
async function checkProjectWorkspaces(c: DoctorContext, report: Report) {
  for (const p of c.agent.projects) {
    if (p.problem) continue;
    report.step(
      `kiểm tra dự án ${p.projectCode} (workspace ${p.workspace.mode}): repo ${p.repo}, danh tính git, hook, nhánh`,
    );
    try {
      await checkRepoWorkspace(c, report, p, projectScope(p));
    } catch (e) {
      disableProject(p, report, errText(e));
    }
  }
}

function disableProject(p: ProjectWorkspace, report: Report, problem: string) {
  p.problem = problem;
  report.warn(`${problem} — dự án TẮT trên máy này (việc của dự án không chạy)`, projectScope(p));
}

/**
 * Mode worktree / in_place: repo có origin, danh tính commit, thư mục của runner đã gitignore, hook, nhánh đang đứng.
 * @param agent mục `projects` đang kiểm tra; dòng kết quả in theo phạm vi `scope` ("dự án <mã>").
 */
async function checkRepoWorkspace(c: DoctorContext, base: Report, agent: ProjectWorkspace, scope: string) {
  const { git, config } = c;
  const report = {
    ok: (text: string) => base.ok(text, scope),
    warn: (text: string) => base.warn(text, scope),
  };
  const inPlace = agent.workspace.mode === 'in_place';
  const origin = await git.run(agent.repo, 'remote', 'get-url', 'origin');
  if (origin.code !== 0) throw new CheckFailed(`${agent.repo} không phải git repo có remote origin`);
  if (!inPlace) {
    // Mode worktree: nhánh việc tách từ origin/<nhánh gốc của agent>, PR merge vào nó → nhánh đó phải có trên origin.
    // ls-remote --exit-code: 2 = origin không có nhánh; mã khác = không hỏi được origin (mạng / quyền) → chỉ cảnh báo, lúc chạy việc sẽ báo lỗi rõ.
    const base = await git.run(agent.repo, 'ls-remote', '--exit-code', '--heads', 'origin', agent.baseBranch);
    if (base.code === 2)
      throw new CheckFailed(
        `origin không có nhánh ${agent.baseBranch} (base_branch) — sửa base_branch hoặc tạo nhánh trên origin`,
      );
    if (base.code !== 0)
      report.warn(`không hỏi được origin để kiểm nhánh gốc ${agent.baseBranch}: ${base.err.slice(0, 200)}`);
    else
      report.ok(
        `nhánh gốc ${agent.baseBranch}: nhánh việc tách từ origin/${agent.baseBranch}, PR merge vào ${agent.baseBranch}`,
      );
  }
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
    for (const warning of await installHooks(git, agent.repo, repoBaseBranches(config, agent.repo)))
      report.warn(warning);
    report.ok(
      `repo ${agent.repo}, hook pre-push (chặn main / force push / agent-runner/) + commit-msg (trailer) đã cài`,
    );
  }
  const onMain = await mainBranchWarning(git, agent);
  if (onMain) report.warn(onMain);
  if (inPlace) await checkInPlace(git, agent, report);
}

/** File .env ở gốc repo mà CLI chạy trong repo đọc được (bỏ qua .env.example / .sample / .template). */
const rootEnvFiles = (repo: string) =>
  readdirSync(repo).filter((f) => f === '.env' || (f.startsWith('.env.') && !/\.(example|sample|template)$/.test(f)));

/** in_place: CLI chạy thẳng trong repo → đọc được .env ở gốc repo (worktree ngoài repo thì không). Mặc định từ chối. */
async function checkInPlace(git: Git, agent: ProjectWorkspace, report: Pick<Report, 'ok' | 'warn'>) {
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
  const onBase = [agent.baseBranch, 'main', 'master'].includes(branch);
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

/**
 * `executor.required_bins` (TEST-180): mỗi lệnh phải tìm được trong PATH của agent (env riêng, không phải PATH của runner) — thiếu thì agent tắt,
 * để biết ngay lúc khởi động thay vì bot hỏng giữa phiên làm theo hướng dẫn (deploy cần ssh / gh…).
 */
function checkRequiredBins(c: DoctorContext, report: Report) {
  const bins = c.agent.executor.requiredBins;
  const missing = bins.filter((b) => (isAbsolute(b) ? !existsSync(b) : !Bun.which(b, { PATH: c.env.PATH ?? '' })));
  if (missing.length)
    throw new CheckFailed(
      `thiếu lệnh ${missing.join(', ')} trong PATH của agent (executor.required_bins) — cài hoặc sửa PATH`,
    );
  report.ok(`có đủ lệnh: ${bins.join(', ')}`);
}

/** Mode worktree cần `gh` để mở PR — chưa đăng nhập chỉ cảnh báo (vẫn push được nhánh). */
async function checkGh(c: DoctorContext, report: Report, repo: string) {
  const gh = await sh(['gh', 'auth', 'status'], repo, c.env).catch(() => ({
    code: 1,
    out: '',
    err: 'không có gh',
  }));
  if (gh.code === 0) report.ok('gh đã đăng nhập');
  else report.warn(`gh chưa sẵn sàng (${(gh.err || gh.out).split('\n')[0]}) — sẽ không tạo được PR`);
}
