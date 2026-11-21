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
    expect(() => parseConfig(r)).toThrow('dùng chung');
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

  test('TEST-200: cấu hình cũ (không projects) → y như trước: mọi dự án dùng repo cấp agent', () => {
    const a = parseConfig(baseRaw()).agents[0]!;
    expect(a.projects).toEqual([]);
    expect(a.repo).toBe('/srv/agents/NV120/office_game');
    const anyProject = workspaceFor(a, '01a1cb11-4644-716a-bf4d-8ab17b2f159b')!;
    expect(anyProject).toEqual({ projectCode: '', repo: a.repo, baseBranch: 'main', workspace: a.workspace });
    expect(agentWorkspaces(a)).toEqual([anyProject]);
  });

  test('TEST-200: projects hợp lệ — repo theo dự án; base_branch / workspace không khai → cấp agent → runner', () => {
    const r: any = baseRaw();
    r.runner.base_branch = 'release';
    delete r.agents[0].repo; // repo cấp agent là tuỳ chọn khi có projects
    r.agents[0].projects = [
      { project: 'office', repo: '/srv/agents/NV120/office_game', base_branch: 'developer' },
      { project: 'SHOP', repo: '/srv/agents/NV120/shop', workspace: { mode: 'in_place', allow_env_files: true } },
    ];
    const a = parseConfig(r).agents[0]!;
    expect(a.repo).toBe('');
    expect(defaultWorkspace(a)).toBeNull();
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

  test('TEST-200: workspaceFor — theo id dự án đã đổi từ mã; dự án không khai → mặc định cấp agent hoặc null; dự án đang tắt → null', () => {
    const r: any = baseRaw();
    r.agents[0].projects = [{ project: 'SHOP', repo: '/srv/agents/NV120/shop', base_branch: 'developer' }];
    const a = parseConfig(r).agents[0]!;
    const SHOP = '01A1CB11-4644-716A-BF4D-000000000001',
      OTHER = '01a1cb11-4644-716a-bf4d-000000000002';
    // chưa đổi mã → id (chưa chạy doctor): mục projects chưa nhận việc, mọi dự án rơi về mặc định
    expect(workspaceFor(a, SHOP)!.projectCode).toBe('');
    a.projects[0]!.projectId = SHOP.toLowerCase();
    expect(workspaceFor(a, SHOP)).toBe(a.projects[0]!); // so id không phân biệt hoa thường
    expect(workspaceFor(a, OTHER)!.repo).toBe('/srv/agents/NV120/office_game');
    a.projects[0]!.problem = 'repo lỗi';
    expect(workspaceFor(a, SHOP)).toBeNull(); // dự án tắt KHÔNG rơi về repo mặc định (sai repo)
    // agent chỉ khai projects: dự án không khai → null
    delete r.agents[0].repo;
    const only = parseConfig(r).agents[0]!;
    expect(workspaceFor(only, OTHER)).toBeNull();
    expect(agentWorkspaces(only)).toEqual(only.projects);
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
    // có projects nhưng repo cấp agent khai sai → vẫn lỗi (chỉ bỏ trống mới là "không có mặc định")
    expect(bad([ok], { repo: 'tuong/doi' })).toThrow('agents[0].repo phải là đường dẫn tuyệt đối');
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
    // mục in_place trùng repo mặc định của chính agent
    r.agents[0].projects = [{ project: 'A', repo: r.agents[0].repo, workspace: inPlace }];
    expect(() => parseConfig(r)).toThrow('dùng chung');
    // mục in_place trùng repo một dự án của agent khác
    r.agents[0].projects = [{ project: 'A', repo: shop, workspace: inPlace }];
    r.agents.push({
      ...baseRaw().agents[0],
      employee_code: 'NV121',
      telegram_bot: 'Agent_Dev02_Bot',
      repo: '/srv/agents/NV121/office_game',
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
    ];
    r.agents.push({
      ...baseRaw().agents[0],
      employee_code: 'NV121',
      telegram_bot: 'Agent_Dev02_Bot',
      repo: shared, // mặc định cấp agent: main
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
