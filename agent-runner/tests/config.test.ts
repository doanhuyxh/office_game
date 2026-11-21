// Cấu hình runner (agents.yaml): parseConfig, lightExecutor, isInside.
import { describe, expect, test } from 'bun:test';
import { ConfigError, isInside, parseConfig, repoBaseBranches } from '../src/config';
import { baseRaw } from './fixtures/config';

describe('config', () => {
  test('hợp lệ → chuẩn hoá mã NV / bot / mặc định', () => {
    const c = parseConfig(baseRaw());
    expect(c.agents[0]!.employeeCode).toBe('NV120');
    expect(c.agents[0]!.telegramBot).toBe('@agent_dev01_bot');
    expect(c.agents[0]!.executor.timeoutMin).toBe(60);
    expect(c.baseBranch).toBe('main');
    expect(c.telegramApiUrl).toBe('https://api.telegram.org');
  });

  test('base_branch: mỗi agent một nhánh gốc, không khai → runner.base_branch (mặc định main); tên sai → lỗi', () => {
    const r: any = baseRaw();
    r.agents.push({ ...r.agents[0], employee_code: 'nv121', telegram_bot: 'Agent_App01_Bot' });
    r.agents.push({
      ...r.agents[0],
      employee_code: 'nv122',
      telegram_bot: 'Agent_Ops01_Bot',
      workspace: { mode: 'none' },
    });
    r.agents[0].base_branch = 'developer';
    const c = parseConfig(r);
    expect(c.agents.map((a) => a.baseBranch)).toEqual(['developer', 'main', 'main']);
    // hook của repo dùng chung chặn nhánh gốc của mọi agent có repo đó (agent mode none không tính)
    expect(repoBaseBranches(c, c.agents[0]!.repo)).toEqual(['developer', 'main']);
    r.runner.base_branch = 'release/2.0';
    expect(parseConfig(r).agents.map((a) => a.baseBranch)).toEqual(['developer', 'release/2.0', 'release/2.0']);
    for (const bad of ['--force', 'a b', '', 5]) {
      const x: any = baseRaw();
      x.agents[0].base_branch = bad;
      expect(() => parseConfig(x)).toThrow('base_branch phải là tên nhánh');
    }
  });

  test('workspace: mặc định worktree; in_place + cờ; sai giá trị / dùng chung repo → lỗi', () => {
    expect(parseConfig(baseRaw()).agents[0]!.workspace).toEqual({
      mode: 'worktree',
      allowBaseBranch: false,
      allowEnvFiles: false,
      builtinTools: false,
    });
    const r: any = baseRaw();
    r.agents[0].workspace = { mode: 'in_place', allow_base_branch: true };
    expect(parseConfig(r).agents[0]!.workspace).toEqual({
      mode: 'in_place',
      allowBaseBranch: true,
      allowEnvFiles: false,
      builtinTools: false,
    });
    r.agents[0].workspace = { mode: 'ban-nhap' };
    expect(() => parseConfig(r)).toThrow(ConfigError);
    r.agents[0].workspace = { mode: 'in_place', allow_env_files: 'yes' };
    expect(() => parseConfig(r)).toThrow(ConfigError);
    // hai agent chung repo mà một bên in_place → lỗi
    r.agents[0].workspace = { mode: 'in_place' };
    r.agents.push({
      ...r.agents[0],
      employee_code: 'NV121',
      telegram_bot: 'Agent_Dev02_Bot',
      token: 'ohk_zzzzzzzz12345678',
      workspace: undefined,
    });
    expect(() => parseConfig(r)).toThrow('bị agent khác dùng chung');
  });

  test('workspace none (TEST-80): không cần repo, repo khai báo bị bỏ qua', () => {
    const raw = baseRaw() as any;
    raw.agents[0].workspace = { mode: 'none' };
    delete raw.agents[0].repo;
    const a = parseConfig(raw).agents[0]!;
    expect(a.workspace.mode).toBe('none');
    expect(a.repo).toBe('');
    raw.agents[0].repo = 'tuong/doi'; // không kiểm khi mode none
    expect(parseConfig(raw).agents[0]!.repo).toBe('');
    raw.agents[0].workspace = { mode: 'worktree' };
    expect(() => parseConfig(raw)).toThrow('repo phải là đường dẫn tuyệt đối');
  });

  test('workspace.builtin_tools (TEST-163): chỉ với mode none, phải là true / false', () => {
    const raw = baseRaw() as any;
    raw.agents[0].workspace = { mode: 'none', builtin_tools: true };
    expect(parseConfig(raw).agents[0]!.workspace.builtinTools).toBe(true);
    raw.agents[0].workspace = { mode: 'none', builtin_tools: 'yes' };
    expect(() => parseConfig(raw)).toThrow('builtin_tools là true / false');
    raw.agents[0].workspace = { mode: 'worktree', builtin_tools: true };
    expect(() => parseConfig(raw)).toThrow('builtin_tools chỉ dùng với mode none');
  });

  test('worktrees_dir trong repo được phép (doctor bắt buộc gitignore); repo trong worktrees_dir → lỗi', () => {
    const r = baseRaw();
    r.runner.worktrees_dir = '/srv/agents/NV120/office_game/.officehub-runner/worktrees';
    expect(parseConfig(r).worktreesDir).toBe('/srv/agents/NV120/office_game/.officehub-runner/worktrees');
    r.runner.worktrees_dir = '/srv/agents';
    expect(() => parseConfig(r)).toThrow(ConfigError);
  });

  test('gom nhiều lỗi một lần', () => {
    const r: any = baseRaw();
    r.agents[0].token = 'abc';
    r.agents[0].telegram_bot = '@khongphai';
    r.agents[0].executor = { kind: 'custom', bin: 'relative/bin' };
    r.agents.push({ ...baseRaw().agents[0] });
    try {
      parseConfig(r);
      throw new Error('phải lỗi');
    } catch (e) {
      const p = (e as ConfigError).problems.join('\n');
      expect(p).toContain('token phải là token AI');
      expect(p).toContain('telegram_bot');
      expect(p).toContain('executor.bin');
      expect(p).toContain('executor.args bắt buộc');
    }
  });

  test('git.executable: trống = git trong PATH, tương đối → lỗi, tuyệt đối → giữ', () => {
    expect(parseConfig(baseRaw()).gitBin).toBe('git');
    const r: any = baseRaw();
    r.git = { executable: 'bin/git' };
    expect(() => parseConfig(r)).toThrow('git.executable');
    r.git = { executable: '/usr/bin/git' };
    expect(parseConfig(r).gitBin).toBe('/usr/bin/git');
  });

  test('isInside', () => {
    expect(isInside('/a/b/c', '/a/b')).toBe(true);
    expect(isInside('/a/bc', '/a/b')).toBe(false);
  });
});
