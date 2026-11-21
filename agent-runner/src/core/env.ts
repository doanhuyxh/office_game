import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { type AgentConfig, readEnvFile } from '../config';
import { BASE_ENV, type Git } from '../workspace';

/** Biến Windows tiến trình con cần để chạy bình thường (không chứa bí mật). */
const WINDOWS_ENV = [
  'SystemRoot',
  'SystemDrive',
  'windir',
  'ComSpec',
  'PATHEXT',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'APPDATA',
  'LOCALAPPDATA',
  'ProgramData',
  'ProgramFiles',
  'ProgramFiles(x86)',
  'ProgramW6432',
  'CommonProgramFiles',
  'USERNAME',
  'USERDOMAIN',
  'COMPUTERNAME',
  'OS',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
];

/** Biến của runner được chuyển cho tiến trình con (không chứa bí mật). */
const INHERITED_ENV = ['PATH', 'LANG', 'LC_ALL', 'TERM', 'TMPDIR', 'USER', 'SHELL', 'DOTNET_ROOT'];

/** HOME của CLI agent: `executor.home`, không đặt thì HOME của runner. */
export const agentHome = (a: AgentConfig) => a.executor.home ?? process.env.HOME ?? homedir();

/**
 * Biến môi trường cho tiến trình con của một agent: KHÔNG kế thừa toàn bộ env của runner (tránh lộ bí mật khác) — chỉ PATH / ngôn ngữ /
 * HOME + SSH_AUTH_SOCK + `env_file`. PATH có thư mục của git cấu hình ở đầu (CLI agent / gh / hook gọi đúng git đó).
 */
export function agentEnv(a: AgentConfig, git: Git): Record<string, string> {
  const env: Record<string, string> = {};
  const copy = (target: string, source = target) => {
    const value = process.env[source];
    if (value) env[target] = value;
  };
  for (const k of INHERITED_ENV) copy(k);
  if (process.platform === 'win32') {
    // Windows: không có HOME (dùng USERPROFILE); thiếu SystemRoot / APPDATA… thì git, gh, claude.exe lỗi mạng / không thấy cấu hình.
    const actualName = (k: string) => Object.keys(process.env).find((x) => x.toLowerCase() === k.toLowerCase());
    for (const k of WINDOWS_ENV) {
      const name = actualName(k);
      if (name) copy(k, name);
    }
    env.HOME = agentHome(a);
    env.USERPROFILE = a.executor.home ?? env.USERPROFILE ?? homedir();
  } else {
    env.HOME = agentHome(a);
  }
  copy('SSH_AUTH_SOCK'); // SSH key sẵn có của máy (ssh-agent)
  if (a.envFile && existsSync(a.envFile)) Object.assign(env, readEnvFile(a.envFile));
  env.PATH = git.pathWithGit(env.PATH);
  if (a.baseBranch) env[BASE_ENV] = a.baseBranch; // hook pre-push: phạm vi so của nhánh mới theo nhánh gốc của agent này
  env.GIT_TERMINAL_PROMPT = '0'; // không treo chờ mật khẩu
  return env;
}
