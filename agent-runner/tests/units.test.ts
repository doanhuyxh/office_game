import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, isInside, parseConfig } from '../src/config';
import { claudeAdapter, parseProbe, probeArgs } from '../src/executor/adapters/claude';
import { mainModel, modelLine, modelMatches, readModelUsage } from '../src/executor/model';
import { resultComment } from '../src/runner';
import { customAdapter, fillArgs } from '../src/executor/adapters/custom';
import type { ExecContext, ExecResult } from '../src/executor/types';
import { formatLine, redact, registerSecret } from '../src/log';
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

  test('workspace: mặc định worktree; in_place + cờ; sai giá trị / dùng chung repo → lỗi', () => {
    expect(parseConfig(baseRaw()).agents[0]!.workspace).toEqual({ mode: 'worktree', allowBaseBranch: false, allowEnvFiles: false });
    const r: any = baseRaw();
    r.agents[0].workspace = { mode: 'in_place', allow_base_branch: true };
    expect(parseConfig(r).agents[0]!.workspace).toEqual({ mode: 'in_place', allowBaseBranch: true, allowEnvFiles: false });
    r.agents[0].workspace = { mode: 'ban-nhap' };
    expect(() => parseConfig(r)).toThrow(ConfigError);
    r.agents[0].workspace = { mode: 'in_place', allow_env_files: 'yes' };
    expect(() => parseConfig(r)).toThrow(ConfigError);
    // hai agent chung repo mà một bên in_place → lỗi
    r.agents[0].workspace = { mode: 'in_place' };
    r.agents.push({ ...r.agents[0], employee_code: 'NV121', telegram_bot: 'Agent_Dev02_Bot', token: 'ohk_zzzzzzzz12345678', workspace: undefined });
    expect(() => parseConfig(r)).toThrow('bị agent khác dùng chung');
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
    // TEST-64: model chính (init + modelUsage) và model phụ
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(Object.keys(r.modelUsage!)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(r.modelUsage!['claude-sonnet-5-5']).toEqual({ costUsd: 0.8, inputTokens: 44100, outputTokens: 5000 });
    expect(claudeAdapter.activity!(readFileSync(join(import.meta.dir, 'fixtures/claude-stream.jsonl'), 'utf8').split('\n')[0]!, '/w')).toEqual(['Model claude-sonnet-5-5']);
  });

  test('model: init chỉ là model được yêu cầu, model thật lấy từ modelUsage', () => {
    const r: ExecResult = {};
    claudeAdapter.parseLine('{"type":"system","subtype":"init","model":"claude-opus-5-5","session_id":"s"}', r);
    expect(r.model).toBe('claude-opus-5-5');
    // CLI tự hạ model (fallback) → modelUsage không có model init → lấy model tốn nhiều nhất
    claudeAdapter.parseLine('{"type":"result","subtype":"success","is_error":false,"session_id":"s","modelUsage":{"claude-haiku-5-5":{"costUSD":0.01,"outputTokens":10},"claude-sonnet-5-5":{"costUSD":0.3,"outputTokens":900}}}', r);
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(mainModel(undefined, undefined)).toBeUndefined();
    expect(mainModel('x', {})).toBe('x');
    expect(readModelUsage({})).toBeUndefined();
    expect(readModelUsage(null)).toBeUndefined();
  });

  test('model: khớp cấu hình (alias, hậu tố [1m])', () => {
    expect(modelMatches(undefined, 'claude-opus-5-5')).toBe(true);
    expect(modelMatches('opus', 'claude-opus-5-5')).toBe(true);
    expect(modelMatches('claude-opus-5-5[1m]', 'claude-opus-5-5')).toBe(true);
    expect(modelMatches('CLAUDE-OPUS-5-5', 'claude-opus-5-5')).toBe(true);
    expect(modelMatches('claude-opus-5-5', 'claude-sonnet-5-5')).toBe(false);
  });

  test('model: dòng mô tả cho bình luận', () => {
    expect(modelLine({}, undefined)).toBe('không rõ (mặc định của CLI)');
    expect(modelLine({}, 'm1')).toBe('m1 (cấu hình)');
    expect(modelLine({ model: 'm1', modelFromConfig: true }, 'm1')).toBe('m1 (cấu hình)');
    expect(modelLine({ model: 'claude-opus-5-5', modelUsage: { 'claude-opus-5-5': { costUsd: 1 }, 'claude-haiku-5-5': { costUsd: 0.012 } } }, 'opus'))
      .toBe('claude-opus-5-5 · phụ: claude-haiku-5-5 ($0.01)');
    expect(modelLine({ model: 'claude-sonnet-5-5' }, 'claude-opus-5-5')).toBe('claude-sonnet-5-5 ⚠ khác cấu hình (claude-opus-5-5)');
  });

  test('bình luận chi phí có dòng Model', () => {
    const c = resultComment({ agent: 'NV018' }, { exitCode: 0, timedOut: false, durationSec: 120, costUsd: 0.31, model: 'claude-opus-5-5' }, undefined, '', true, 'claude-opus-5-5');
    expect(c).toContain('- Model: claude-opus-5-5');
    expect(c.indexOf('Model')).toBeLessThan(c.indexOf('Chi phí'));
  });

  test('claude: chạy thử model (doctor / start)', () => {
    const a = probeArgs('claude-opus-5-5').join(' ');
    for (const f of ['-p ok', '--output-format stream-json', '--verbose', '--max-turns 1', '--strict-mcp-config', '--model claude-opus-5-5']) expect(a).toContain(f);
    expect(probeArgs(undefined)).not.toContain('--model');
    const ok = ['{"type":"system","subtype":"init","model":"claude-haiku-5-5"}',
      '{"type":"result","subtype":"success","is_error":false,"modelUsage":{"claude-haiku-5-5":{"costUSD":0.0002}}}'].join('\n');
    expect(parseProbe(ok)).toEqual({ model: 'claude-haiku-5-5' });
    // Mẫu thật Claude Code 2.1.x với model sai: init lặp lại tên sai, result is_error + 404
    const bad = ['{"type":"system","subtype":"init","model":"claude-bogus-9"}', '[claude-code:unrecognized_model] {"model":"claude-bogus-9"}',
      '{"type":"result","subtype":"success","is_error":true,"result":"There\'s an issue with the selected model (claude-bogus-9). It may not exist or you may not have access to it.","terminal_reason":"api_error","api_error_status":404,"modelUsage":{}}'].join('\n');
    const p = parseProbe(bad);
    expect(p.invalidModel).toBe(true);
    expect(p.model).toBeUndefined();
    expect(p.error).toContain('selected model');
    const r: ExecResult = {};
    claudeAdapter.parseLine(bad.split('\n')[2]!, r);
    expect(r).toMatchObject({ isError: true, errorKind: 'api_error 404' });
    expect(parseProbe('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"rate limited"}')).toMatchObject({ invalidModel: false, error: 'rate limited' });
    expect(parseProbe('')).toMatchObject({ error: 'CLI không trả sự kiện result' });
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
    customAdapter.parseLine('{"session_id":"x","cost_usd":0.5,"summary":"ok","model":"gpt-x"}', r);
    expect(r).toMatchObject({ sessionId: 'x', costUsd: 0.5, summary: 'ok', model: 'gpt-x' });
    const t: ExecResult = {};
    customAdapter.finish!('dòng 1\nkết quả cuối\n', t);
    expect(t.summary).toBe('dòng 1\nkết quả cuối');
  });
});

describe('định dạng log', () => {
  const t = new Date(2026, 10, 12, 10, 21, 7);
  test('json: một dòng JSON đủ trường', () => {
    const o = JSON.parse(formatLine('info', 'xong job', { job: 3, agent: 'NV120', ok: true }, 'json', false, t));
    expect(o).toMatchObject({ level: 'info', msg: 'xong job', job: 3, agent: 'NV120', ok: true });
  });
  test('pretty: giờ + agent + việc + job, thao tác có ký hiệu, trường còn lại dạng khoá=giá trị', () => {
    const f = { job: 3, agent: 'NV120', task: 'TEST-45' };
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Sửa src/a.ts' }, 'pretty', false, t)).toBe('10:21:07 NV120 TEST-45 #3    ✎ Sửa src/a.ts');
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Chạy: bun test' }, 'pretty', false, t)).toContain('$ bun test');
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Model claude-opus-5-5' }, 'pretty', false, t)).toBe('10:21:07 NV120 TEST-45 #3    ▶ claude-opus-5-5');
    const done = formatLine('info', 'xong job', { ...f, ok: true, cost: 0.42, pr: undefined }, 'pretty', false, t);
    expect(done).toContain('xong job');
    expect(done).toContain('ok=true cost=0.42');
    expect(done).not.toContain('pr=');
    expect(formatLine('warn', 'bỏ job', { job: 4, reason: 'x' }, 'pretty', false, t)).toContain('⚠ bỏ job');
    expect(formatLine('error', 'job lỗi', {}, 'pretty', false, t)).toContain('✘ job lỗi');
    expect(formatLine('info', 'x', {}, 'pretty', true, t)).toContain('\x1b['); // có màu khi bật
    expect(formatLine('info', 'x', {}, 'pretty', false, t)).not.toContain('\x1b[');
  });
  test('config: runner.log_format', () => {
    expect(parseConfig(baseRaw()).logFormat).toBe('auto');
    const r: any = baseRaw();
    r.runner.log_format = 'xml';
    expect(() => parseConfig(r)).toThrow(ConfigError);
  });
});

describe('prompt / mcp / log', () => {
  const w = { employee_code: 'NV120', project_id: 'p', task_id: 't', task_code: 'TEST-45' };
  const ctx = (mode: 'worktree' | 'in_place', resumed = false) => ({ mode, branch: 'agent/nv120/test-45', resumed });
  test('prompt không chứa nội dung việc, có quy tắc cứng', () => {
    const p = buildPrompt(w, ctx('worktree'));
    expect(p).toContain('get_my_role');
    expect(p).toContain('KHÔNG push');
    expect(p).toContain('agent-runner/');
    expect(p).not.toContain('NỐI TIẾP');
    expect(buildPrompt(w, ctx('worktree', true))).toContain('NỐI TIẾP');
  });
  test('prompt theo mode: quy tắc chung ở cả hai, phần git khác nhau', () => {
    const wt = buildPrompt(w, ctx('worktree')), ip = buildPrompt(w, ctx('in_place'));
    for (const p of [wt, ip]) {
      for (const r of ['get_my_role', 'get_project', 'comment_task TEST-45', 'Không duyệt / từ chối đơn', 'Không đọc / tạo / sửa file .env', 'agent-runner/', 'git add -A']) expect(p).toContain(r);
    }
    expect(wt).toContain('worktree riêng');
    expect(wt).not.toContain('workspace THẬT');
    expect(ip).toContain('workspace THẬT');
    expect(ip).toContain('KHÔNG checkout');
    expect(ip).toContain('Không git push');
    expect(ip).toContain('không reset / stash / rebase');
    expect(ip).not.toContain('Làm việc trong thư mục hiện tại: worktree riêng');
    expect(ip).not.toContain('bộ điều phối sẽ push');
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

  test('model: lưu cột model / model_usage, report nhóm theo model, migration DB cũ', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-db-'));
    try {
      const path = join(dir, 'runner.db');
      // runner.db trước TEST-64: bảng jobs chưa có cột model / model_usage
      const { Database } = require('bun:sqlite');
      const old = new Database(path, { create: true });
      old.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, task_id TEXT NOT NULL, task_code TEXT NOT NULL, project_id TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        session_id TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, turns INTEGER, pr_url TEXT)`);
      old.run(`INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, finished_at, cost_usd) VALUES ('NV1', 't0', 'A-0', 'p', 'done', '2026', '2026-11-01', 2)`);
      old.close();
      const s = new Store(path);
      const a = s.enqueue('NV1', 't1', 'A-1', 'p')!, b = s.enqueue('NV1', 't2', 'A-2', 'p')!;
      s.finish(a, 'done', { cost_usd: 1, model: 'claude-opus-5-5', model_usage: JSON.stringify({ 'claude-opus-5-5': { costUsd: 1 } }) });
      s.finish(b, 'done', { cost_usd: 0.5, model: 'claude-opus-5-5' });
      expect(s.getJob(a)).toMatchObject({ model: 'claude-opus-5-5' });
      expect(JSON.parse(s.getJob(a)!.model_usage!)).toEqual({ 'claude-opus-5-5': { costUsd: 1 } });
      expect(s.costsByModel('2000-01-01')).toEqual([
        { agent: 'NV1', model: null, jobs: 1, cost: 2, input: null, output: null },
        { agent: 'NV1', model: 'claude-opus-5-5', jobs: 2, cost: 1.5, input: null, output: null },
      ]);
      s.db.close();
      new Store(path).db.close(); // mở lại: cột đã có, không ALTER lần nữa
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe('presence (văn phòng 3D: đang làm / rảnh)', () => {
  test('nhãn thô — không lộ lệnh / đường dẫn / lời agent', async () => {
    const { activityLabel, presenceUrl } = await import('../src/presence');
    expect(activityLabel('Đọc src/secret/key.ts')).toBe('Đọc code');
    expect(activityLabel('Sửa backend/x.cs')).toBe('Sửa code');
    expect(activityLabel('Chạy: cd backend && dotnet test')).toBe('Chạy kiểm thử');
    expect(activityLabel('Chạy: bun run build')).toBe('Build / kiểm tra');
    expect(activityLabel('Chạy: git commit -m "x"')).toBe('Thao tác git');
    expect(activityLabel('Chạy: curl https://x?token=abc')).toBe('Chạy lệnh');
    expect(activityLabel('Nói: mật khẩu là 123')).toBe('Suy nghĩ');
    expect(activityLabel('OfficeHub update_task_status → Review')).toBe('Cập nhật OfficeHub');
    expect(activityLabel('Model claude-x (cấu hình)')).toBeUndefined();
    expect(presenceUrl('http://h:5200/mcp/')).toBe('http://h:5200/mcp/presence');
  });

  test('gộp theo nhịp, đổi việc / hết việc gửi ngay, 403 → ngừng báo', async () => {
    const { PresenceReporter } = await import('../src/presence');
    const got: any[] = [];
    let status = 204;
    const srv = Bun.serve({ port: 0, async fetch(req) { got.push(await req.json()); return new Response(null, { status }); } });
    const gap = PresenceReporter.minGapMs;
    PresenceReporter.minGapMs = 300;
    try {
      const p = new PresenceReporter(`http://localhost:${srv.port}/mcp`, 'ohk_x', 'NV120');
      p.working('WEB-12', 'Sửa form');
      await Bun.sleep(50);
      p.activity('Đọc a.ts'); p.activity('Sửa a.ts'); p.activity('Sửa b.ts');
      await Bun.sleep(50);
      expect(got).toEqual([{ state: 'working', task: 'WEB-12 · Sửa form' }]);   // chưa tới nhịp
      await Bun.sleep(400);
      expect(got.at(-1)).toEqual({ state: 'working', task: 'WEB-12 · Sửa form', activity: 'Sửa code' }); // chỉ nhãn mới nhất
      expect(got.length).toBe(2);
      p.idle();
      await Bun.sleep(50);
      expect(got.at(-1)).toEqual({ state: 'idle' });
      p.activity('Đọc a.ts');                                                  // rảnh → bỏ qua thao tác
      status = 403;
      p.working('WEB-13');
      await Bun.sleep(50);
      const n = got.length;
      p.idle();
      await Bun.sleep(50);
      expect(got.length).toBe(n);                                              // đã ngừng báo
      p.stop();
    } finally {
      PresenceReporter.minGapMs = gap;
      srv.stop();
    }
  });
});

test('presence: máy chủ chưa có endpoint (405) → ghi log một lần, vẫn thử lại, có lại thì báo chạy lại', async () => {
  const { PresenceReporter } = await import('../src/presence');
  let status = 405, hits = 0;
  const srv = Bun.serve({ port: 0, async fetch() { hits++; return new Response(null, { status }); } });
  const logs: string[] = [];
  const orig = console.log, origErr = console.error;
  console.log = console.error = (...a: unknown[]) => { logs.push(a.join(' ')); };
  try {
    const p = new PresenceReporter(`http://localhost:${srv.port}/mcp`, 'ohk_x', 'NV018');
    for (const s of ['a', 'b', 'c']) { p.working(s); await Bun.sleep(30); }
    expect(hits).toBe(3);                                                   // không bị tắt như 403
    expect(logs.filter((l) => l.includes('chưa có endpoint')).length).toBe(1);
    status = 204;
    p.idle(); await Bun.sleep(30);
    expect(logs.some((l) => l.includes('đã chạy lại'))).toBe(true);
    p.stop();
  } finally {
    console.log = orig; console.error = origErr;
    srv.stop();
  }
});
