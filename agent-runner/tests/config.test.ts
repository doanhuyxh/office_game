// Cấu hình runner (agents.yaml): parseConfig, lightExecutor, isInside.
import { describe, expect, test } from 'bun:test';
import {
  agentWorkspaces,
  ConfigError,
  defaultWorkspace,
  isInside,
  parseConfig,
  repoBaseBranches,
  workspaceFor,
} from '../src/config';
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

  test('base_branch: mục projects → cấp agent → runner.base_branch (mặc định main); tên sai → lỗi', () => {
    const r: any = baseRaw();
    r.agents.push({ ...baseRaw().agents[0], employee_code: 'nv121', telegram_bot: 'Agent_App01_Bot' });
    r.agents.push({
      ...baseRaw().agents[0],
      employee_code: 'nv122',
      telegram_bot: 'Agent_Ops01_Bot',
      workspace: { mode: 'none' },
      projects: undefined,
    });
    r.agents[0].base_branch = 'developer';
    const bases = (c: ReturnType<typeof parseConfig>) => c.agents.map((a) => a.projects.map((p) => p.baseBranch));
    const c = parseConfig(r);
    expect(bases(c)).toEqual([['developer'], ['main'], []]);
    // hook của repo dùng chung chặn nhánh gốc của mọi agent có repo đó (agent mode none không tính)
    expect(repoBaseBranches(c, '/srv/agents/NV120/office_game')).toEqual(['developer', 'main']);
    r.runner.base_branch = 'release/2.0';
    expect(bases(parseConfig(r))).toEqual([['developer'], ['release/2.0'], []]);
    for (const bad of ['--force', 'a b', '', 5]) {
      const x: any = baseRaw();
      x.agents[0].base_branch = bad;
      expect(() => parseConfig(x)).toThrow('base_branch phải là tên nhánh');
    }
  });

  test('workspace: mặc định worktree; in_place + cờ; sai giá trị / dùng chung repo → lỗi', () => {
    const worktree = { mode: 'worktree' as const, allowBaseBranch: false, allowEnvFiles: false, builtinTools: false };
    const first = parseConfig(baseRaw()).agents[0]!;
    expect(first.workspace).toEqual(worktree);
    expect(first.projects[0]!.workspace).toEqual(worktree);
    const r: any = baseRaw();
    r.agents[0].workspace = { mode: 'in_place', allow_base_branch: true };
    // workspace cấp agent là mặc định của mục projects không khai workspace
    expect(parseConfig(r).agents[0]!.projects[0]!.workspace).toEqual({
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
    expect(() => parseConfig(r)).toThrow('dùng chung');
  });

  test('workspace none (TEST-80): không repo, không projects; repo khai báo bị bỏ qua', () => {
    const raw = baseRaw() as any;
    raw.agents[0].workspace = { mode: 'none' };
    expect(() => parseConfig(raw)).toThrow('không khai được projects');
    delete raw.agents[0].projects;
    const a = parseConfig(raw).agents[0]!;
    expect(a.workspace.mode).toBe('none');
    expect(a.projects).toEqual([]);
    expect(defaultWorkspace(a)).toEqual({ projectCode: '', repo: '', baseBranch: '', workspace: a.workspace });
    // agent nghiệp vụ: mọi dự án dùng chung nơi làm không repo
    expect(workspaceFor(a, '01a1cb11-4644-716a-bf4d-8ab17b2f159b')!.workspace.mode).toBe('none');
    raw.agents[0].repo = 'tuong/doi'; // không kiểm khi mode none
    expect(parseConfig(raw).agents[0]!.projects).toEqual([]);
  });

  test('TEST-200: agent có repo BẮT BUỘC khai projects; repo ở cấp agent (cấu hình cũ) → lỗi kèm cách chuyển', () => {
    const r: any = baseRaw();
    delete r.agents[0].projects;
    expect(() => parseConfig(r)).toThrow('agents[0].projects bắt buộc');
    r.agents[0].projects = [];
    expect(() => parseConfig(r)).toThrow('agents[0].projects phải có ít nhất một dự án');
    const old: any = baseRaw();
    old.agents[0].repo = '/srv/agents/NV120/office_game';
    expect(() => parseConfig(old)).toThrow('agents[0].repo không còn dùng — chuyển vào agents[0].projects');
    delete old.agents[0].projects;
    expect(() => parseConfig(old)).toThrow('agents[0].repo không còn dùng');
  });

  test('workspace.builtin_tools (TEST-163): chỉ với mode none, phải là true / false', () => {
    const raw = baseRaw() as any;
    const projects = raw.agents[0].projects;
    delete raw.agents[0].projects;
    raw.agents[0].workspace = { mode: 'none', builtin_tools: true };
    expect(parseConfig(raw).agents[0]!.workspace.builtinTools).toBe(true);
    raw.agents[0].workspace = { mode: 'none', builtin_tools: 'yes' };
    expect(() => parseConfig(raw)).toThrow('builtin_tools là true / false');
    raw.agents[0].projects = projects;
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

  test('TEST-200: projects hợp lệ — repo theo dự án; base_branch / workspace không khai → cấp agent → runner', () => {
    const r: any = baseRaw();
    r.runner.base_branch = 'release';
    r.agents[0].projects = [
      { project: 'office', repo: '/srv/agents/NV120/office_game', base_branch: 'developer' },
      { project: 'SHOP', repo: '/srv/agents/NV120/shop', workspace: { mode: 'in_place', allow_env_files: true } },
    ];
    const a = parseConfig(r).agents[0]!;
    expect(defaultWorkspace(a)).toBeNull();
    expect(agentWorkspaces(a)).toEqual(a.projects);
    expect(a.projects).toEqual([
      {
        projectCode: 'OFFICE',
        repo: '/srv/agents/NV120/office_game',
        baseBranch: 'developer',
        workspace: { mode: 'worktree', allowBaseBranch: false, allowEnvFiles: false, builtinTools: false },
      },
      {
        projectCode: 'SHOP',
        repo: '/srv/agents/NV120/shop',
        baseBranch: 'release',
        workspace: { mode: 'in_place', allowBaseBranch: false, allowEnvFiles: true, builtinTools: false },
      },
    ]);
    // base_branch / workspace cấp agent là mặc định của mục không khai
    r.agents[0].base_branch = 'main';
    r.agents[0].workspace = { mode: 'in_place', allow_base_branch: true };
    r.agents[0].projects[1] = { project: 'SHOP', repo: '/srv/agents/NV120/shop' };
    r.agents[0].projects[0].workspace = { mode: 'worktree' };
    const b = parseConfig(r).agents[0]!;
    expect(b.projects.map((p) => [p.baseBranch, p.workspace.mode, p.workspace.allowBaseBranch])).toEqual([
      ['developer', 'worktree', false],
      ['main', 'in_place', true],
    ]);
  });

  test('TEST-200: workspaceFor — theo id dự án đã đổi từ mã; dự án không khai / chưa đổi được id / đang tắt → null', () => {
    const r: any = baseRaw();
    r.agents[0].projects = [{ project: 'SHOP', repo: '/srv/agents/NV120/shop', base_branch: 'developer' }];
    const a = parseConfig(r).agents[0]!;
    const SHOP = '01A1CB11-4644-716A-BF4D-000000000001',
      OTHER = '01a1cb11-4644-716a-bf4d-000000000002';
    expect(workspaceFor(a, SHOP)).toBeNull(); // chưa đổi mã → id (chưa chạy doctor): mục chưa nhận việc
    a.projects[0]!.projectId = SHOP.toLowerCase();
    expect(workspaceFor(a, SHOP)).toBe(a.projects[0]!); // so id không phân biệt hoa thường
    expect(workspaceFor(a, OTHER)).toBeNull(); // dự án không khai → không chạy trên máy này
    a.projects[0]!.problem = 'repo lỗi';
    expect(workspaceFor(a, SHOP)).toBeNull();
  });

  test('TEST-200: projects sai — thiếu / trùng mã, repo tương đối / trong worktrees_dir, base_branch sai, mode none', () => {
    const bad = (projects: unknown, agent: Record<string, unknown> = {}) => {
      const r: any = baseRaw();
      Object.assign(r.agents[0], agent, { projects });
      return () => parseConfig(r);
    };
    const ok = { project: 'SHOP', repo: '/srv/agents/NV120/shop' };
    expect(bad('SHOP')).toThrow('projects phải là danh sách');
    expect(bad([{ repo: ok.repo }])).toThrow('projects[0].project bắt buộc');
    expect(bad([{ ...ok, project: 'a b' }])).toThrow('projects[0].project bắt buộc');
    expect(bad([ok, { ...ok, project: 'shop', repo: '/srv/agents/NV120/shop2' }])).toThrow(
      'projects[1].project SHOP bị trùng',
    );
    expect(bad([{ ...ok, repo: 'tuong/doi' }])).toThrow('projects[0].repo phải là đường dẫn tuyệt đối');
    expect(bad([{ project: 'SHOP' }])).toThrow('projects[0].repo phải là đường dẫn tuyệt đối');
    expect(bad([{ ...ok, repo: '/srv/agents/worktrees/shop' }])).toThrow(
      'projects[0]: repo không được nằm trong runner.worktrees_dir',
    );
    expect(bad([{ ...ok, base_branch: '--force' }])).toThrow('projects[0].base_branch phải là tên nhánh');
    expect(bad([{ ...ok, workspace: { mode: 'none' } }])).toThrow('mode none không dùng trong projects');
    expect(bad([{ ...ok, workspace: { mode: 'worktree', builtin_tools: true } }])).toThrow('builtin_tools chỉ dùng');
    // agent nghiệp vụ (mode none) không khai được projects
    expect(bad([ok], { workspace: { mode: 'none' } })).toThrow('không khai được projects');
  });

  test('TEST-200: in_place không dùng chung repo — xét từng cặp (agent, dự án)', () => {
    const inPlace = { mode: 'in_place' };
    const shop = '/srv/agents/NV120/shop';
    const r: any = baseRaw();
    // hai mục in_place cùng repo trong một agent
    r.agents[0].projects = [
      { project: 'A', repo: shop, workspace: inPlace },
      { project: 'B', repo: shop, workspace: inPlace },
    ];
    expect(() => parseConfig(r)).toThrow('NV120 (dự án A): workspace in_place nhưng repo /srv/agents/NV120/shop');
    // mục in_place trùng repo một dự án của agent khác
    r.agents[0].projects = [{ project: 'A', repo: shop, workspace: inPlace }];
    r.agents.push({
      ...baseRaw().agents[0],
      employee_code: 'NV121',
      telegram_bot: 'Agent_Dev02_Bot',
      projects: [{ project: 'A', repo: shop }],
    });
    expect(() => parseConfig(r)).toThrow('dùng chung');
    // worktree dùng chung repo thì được (mỗi việc một worktree)
    r.agents[0].projects = [{ project: 'A', repo: shop }];
    expect(parseConfig(r).agents).toHaveLength(2);
  });

  test('TEST-200: repoBaseBranches gom nhánh gốc của MỌI cặp (agent, dự án) dùng chung repo', () => {
    const shared = '/srv/agents/shared/shop';
    const r: any = baseRaw();
    r.agents[0].base_branch = 'developer';
    r.agents[0].projects = [
      { project: 'SHOP', repo: shared, base_branch: 'release/2.0' },
      { project: 'WEB', repo: shared }, // theo cấp agent: developer
      { project: 'OFFICE', repo: '/srv/agents/NV120/office_game' },
    ];
    r.agents.push({
      ...baseRaw().agents[0],
      employee_code: 'NV121',
      telegram_bot: 'Agent_Dev02_Bot',
      projects: [{ project: 'SHOP', repo: shared }], // runner.base_branch: main
    });
    const c = parseConfig(r);
    expect(repoBaseBranches(c, shared)).toEqual(['developer', 'main', 'release/2.0']);
    expect(repoBaseBranches(c, '/srv/agents/NV120/office_game')).toEqual(['developer']);
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
