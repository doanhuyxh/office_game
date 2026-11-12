import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConfigError, isInside, parseConfig } from '../src/config';
import { claudeAdapter } from '../src/executor/adapters/claude';
import { customAdapter, fillArgs } from '../src/executor/adapters/custom';
import type { ExecContext, ExecResult } from '../src/executor/types';
import { redact, registerSecret } from '../src/log';
import { buildPrompt, mcpConfig } from '../src/prompt';
import { Store } from '../src/store';
import { checkTask, parseWake } from '../src/validator';
import { COMMIT_MSG_MARK, PRE_PUSH_MARK, branchName, commitMsgHook, prePushHook } from '../src/workspace';

const TG = '123456789:AAH-test-token-abcdefghijklmnopqrstu';
export const baseRaw = () => ({
  officehub: { mcp_url: 'http://localhost:5200/mcp' },
  telegram: { group_chat_id: '-1001234567890', notifier_bot: '@OfficeHub_Notify_Bot' },
  runner: { data_dir: '/var/lib/r', worktrees_dir: '/srv/agents/worktrees', max_parallel: 2 },
  agents: [{
    employee_code: 'nv120', telegram_bot: 'Agent_Dev01_Bot', telegram_token: TG, token: 'ohk_abcdefgh12345678', repo: '/srv/agents/NV120/office_game',
    executor: { kind: 'claude', bin: '/usr/local/bin/claude', model: 'claude-sonnet-5-5', max_budget_usd: 5 },
  }],
});

describe('config', () => {
  test('hợp lệ → chuẩn hoá mã NV / bot / mặc định', () => {
    const c = parseConfig(baseRaw());
    expect(c.agents[0]!.employeeCode).toBe('NV120');
    expect(c.agents[0]!.telegramBot).toBe('@agent_dev01_bot');
    expect(c.agents[0]!.executor.timeoutMin).toBe(60);
    expect(c.baseBranch).toBe('main');
    expect(c.telegramApiUrl).toBe('https://api.telegram.org');
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
    try { parseConfig(r); throw new Error('phải lỗi'); } catch (e) {
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

describe('validator', () => {
  const opts = { groupChatId: '-1001234567890', employeeCode: 'NV120' };
  const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b', T = '01a1ced9-0a22-713a-b89d-cbd02c09c92d';
  const msg = (text: string, over: any = {}) => ({
    message_id: 1, date: 0, chat: { id: -1001234567890, type: 'supergroup' }, from: { id: 9, is_bot: true, username: 'OfficeHub_Notify_Bot' }, text, ...over,
  });
  const good = `@agent_dev01_bot\n{"employee_code":"NV120","project_id":"${P}","task_id":"${T}","task_code":"TEST-45"}`;

  test('chỉ cần nhóm + mã nhân viên khớp: người gửi / dòng nhắc bot không quan trọng', () => {
    for (const m of [msg(good, { from: { id: 1, is_bot: false, username: 'nguoi_that' } }), msg(good.replace('@agent_dev01_bot', '@agent_dev02_bot')),
      msg(good, { from: undefined }), msg(good.split('\n')[1]!)]) expect(parseWake(m as any, opts).ok).toBe(true);
  });

  test('tin đúng', () => {
    const r = parseWake(msg(good), opts);
    expect(r.ok && r.value.task_code).toBe('TEST-45');
  });

  test.each([
    ['sai nhóm', msg(good, { chat: { id: -100999, type: 'supergroup' } }), 'sai nhóm'],
    ['không có JSON', msg('@agent_dev01_bot làm việc đi'), 'không có dòng JSON'],
    ['JSON hỏng', msg('@agent_dev01_bot\n{"employee_code":'), 'không hợp lệ'],
    ['thiếu trường', msg(good.replace(',"task_code":"TEST-45"', '')), 'thiếu trường'],
    ['mã NV khác', msg(good.replace('NV120', 'NV999')), 'không phải của agent'],
  ])('%s → bỏ', (_n, m, reason) => {
    const r = parseWake(m as any, opts);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(reason);
  });

  test('checkTask', () => {
    const w = { project_id: P, task_id: T };
    const d = (t: any, dependsOn: any[] = []) => ({ task: { id: T, projectId: P, assigneeEmployeeId: 'me', done: false, title: 'X', code: 'TEST-45', ...t }, dependsOn });
    expect(checkTask(d({}), w, 'me').ok).toBe(true);
    expect(checkTask(d({ assigneeEmployeeId: 'other' }), w, 'me')).toEqual({ ok: false, reason: 'việc không còn giao cho agent này' });
    expect(checkTask(d({ done: true }), w, 'me').ok).toBe(false);
    expect(checkTask(d({ projectId: 'khac' }), w, 'me').ok).toBe(false);
    const waiting = checkTask(d({}, [{ code: 'TEST-41', done: true }, { code: 'TEST-42', done: false }]), w, 'me');
    expect(waiting.ok === false && waiting.reason).toBe('việc còn chờ TEST-42');
    expect(checkTask(null, w, 'me').ok).toBe(false);
  });
});

describe('executor adapters', () => {
  const exec = parseConfig(baseRaw()).agents[0]!.executor;
  const ctx: ExecContext = { cwd: '/w', jobDir: '/j', promptFile: '/j/prompt.md', prompt: 'P', mcpConfigFile: '/j/mcp.json', exec };

  test('claude: cờ bắt buộc + resume + budget', () => {
    const c = claudeAdapter.command({ ...ctx, resumeSessionId: 'sess-1' });
    const a = c.args.join(' ');
    for (const f of ['-p P', '--output-format stream-json', '--verbose', '--mcp-config /j/mcp.json', '--strict-mcp-config', '--setting-sources user',
      '--permission-mode bypassPermissions', '--model claude-sonnet-5-5', '--max-budget-usd 5', '--resume sess-1']) expect(a).toContain(f);
  });

  test('claude: đọc stream-json mẫu', () => {
    const r: ExecResult = {};
    for (const l of readFileSync(join(import.meta.dir, 'fixtures/claude-stream.jsonl'), 'utf8').split('\n')) claudeAdapter.parseLine(l, r);
    expect(r).toMatchObject({ sessionId: '0d6c1f3e-1111-4222-8333-944455556666', costUsd: 0.8123, turns: 17, inputTokens: 44200, outputTokens: 5300, isError: false });
    expect(r.summary).toContain('Chờ review');
  });

  test('claude: mô tả thao tác agent đang làm', () => {
    const line = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
    const out = claudeAdapter.activity!(line([
      { type: 'text', text: 'Đọc   code\ntrước' },
      { type: 'tool_use', name: 'Read', input: { file_path: '/w/src/a.ts' } },
      { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } },
      { type: 'tool_use', name: 'mcp__officehub__update_task_status', input: { status: 'Doing' } },
    ]), '/w');
    expect(out).toEqual(['Nói: Đọc code trước', 'Đọc src/a.ts', 'Chạy: bun test', 'OfficeHub update_task_status → Doing']);
    expect(claudeAdapter.activity!('không phải json', '/w')).toEqual([]);
    expect(claudeAdapter.activity!('{"type":"result"}', '/w')).toEqual([]);
  });

  test('claude: hết ngân sách → isError', () => {
    const r: ExecResult = {};
    claudeAdapter.parseLine('{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":5.01,"session_id":"s"}', r);
    expect(r.isError).toBe(true);
    expect(r.errorKind).toBe('error_max_budget_usd');
  });

  test('custom: thay biến + resume_args + output json / text', () => {
    const e = { ...exec, kind: 'custom' as const, args: ['run', '--cwd', '{cwd}', '--p', '{prompt_file}', '-m', '{model}'], resumeArgs: ['--session', '{session_id}'] };
    const c = customAdapter.command({ ...ctx, exec: e, resumeSessionId: 's9' });
    expect(c.args).toEqual(['run', '--cwd', '/w', '--p', '/j/prompt.md', '-m', 'claude-sonnet-5-5', '--session', 's9']);
    expect(fillArgs(['{mcp_config}'], ctx)).toEqual(['/j/mcp.json']);
    const r: ExecResult = {};
    customAdapter.parseLine('{"session_id":"x","cost_usd":0.5,"summary":"ok"}', r);
    expect(r).toMatchObject({ sessionId: 'x', costUsd: 0.5, summary: 'ok' });
    const t: ExecResult = {};
    customAdapter.finish!('dòng 1\nkết quả cuối\n', t);
    expect(t.summary).toBe('dòng 1\nkết quả cuối');
  });
});

describe('prompt / mcp / log', () => {
  const w = { employee_code: 'NV120', project_id: 'p', task_id: 't', task_code: 'TEST-45' };
  test('prompt không chứa nội dung việc, có quy tắc cứng', () => {
    const p = buildPrompt(w, 'agent/nv120/test-45', false);
    expect(p).toContain('get_my_role');
    expect(p).toContain('KHÔNG push');
    expect(p).toContain('agent-runner/');
    expect(p).not.toContain('NỐI TIẾP');
    expect(buildPrompt(w, 'b', true)).toContain('NỐI TIẾP');
  });
  test('cấu hình MCP không chứa token', () => {
    expect(JSON.stringify(mcpConfig('http://x/mcp'))).toContain('${OFFICEHUB_TOKEN}');
  });
  test('redact', () => {
    registerSecret('ohk_supersecret_1234');
    expect(redact('lỗi với token ohk_supersecret_1234 ở đây')).toBe('lỗi với token *** ở đây');
  });
  test('hook commit-msg chỉ gắn trailer trong phiên agent; pre-push chặn force push', () => {
    const h = commitMsgHook();
    expect(h).toContain(COMMIT_MSG_MARK);
    expect(h).toContain('[ -z "$OFFICEHUB_AGENT" ] && exit 0');
    expect(h).toContain('--trailer "Agent: $OFFICEHUB_AGENT"');
    expect(h).toContain('--trailer "Task: $OFFICEHUB_TASK"');
    expect(prePushHook('main')).toContain('merge-base --is-ancestor');
  });

  test('hook pre-push chặn main + agent-runner/', () => {
    const h = prePushHook('main');
    expect(h).toContain(PRE_PUSH_MARK);
    expect(h).toContain('refs/heads/main');
    expect(h).toContain('^agent-runner/');
    expect(branchName('NV120', 'TEST-45')).toBe('agent/nv120/test-45');
  });
});

describe('store', () => {
  test('khoá task_id, FIFO, mỗi agent 1, tổng ≤ max, khôi phục', () => {
    const s = new Store(':memory:');
    const a = s.enqueue('NV1', 't1', 'A-1', 'p')!, b = s.enqueue('NV1', 't2', 'A-2', 'p')!, c = s.enqueue('NV2', 't3', 'A-3', 'p')!;
    expect(s.enqueue('NV2', 't1', 'A-1', 'p')).toBeNull(); // t1 đang chờ
    expect(s.claimNext(2, ['NV1', 'NV2'])!.id).toBe(a);
    expect(s.claimNext(2, ['NV1', 'NV2'])!.id).toBe(c); // NV1 đang chạy → bỏ qua b
    expect(s.claimNext(2, ['NV1', 'NV2'])).toBeNull(); // đủ 2
    s.finish(a, 'done', { cost_usd: 1.5 });
    expect(s.enqueue('NV1', 't1', 'A-1', 'p')).not.toBeNull(); // xong rồi → nhận lại được
    expect(s.claimNext(2, ['NV1', 'NV2'])!.id).toBe(b);
    expect(s.recoverRunning()).toBe(2);
    expect(s.claimNext(2, ['NV2'])!.agent).toBe('NV2');
    s.saveSession('t1', 'NV1', 's1', 'br', '/w');
    s.saveSession('t1', 'NV1', null, 'br', '/w');
    expect(s.session('t1')!.session_id).toBe('s1'); // null không xoá phiên cũ
    s.setOffset('@b', 42);
    expect(s.offset('@b')).toBe(42);
    expect(s.costs('2000-01-01')[0]).toMatchObject({ agent: 'NV1', cost: 1.5 });
  });
});
