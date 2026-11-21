// Adapter CLI (claude, codex, antigravity, custom): lệnh, đọc output, model thật, transcript, HOME.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lightExecutor, parseConfig } from '../src/config';
import { claudeAdapter, parseProbe, probeArgs } from '../src/executor/adapters/claude';
import { mainModel, modelLine, modelMatches, readModelUsage } from '../src/executor/model';
import { resultComment } from '../src/jobs/task';
import { codexAdapter, codexMcpArgs } from '../src/executor/adapters/codex';
import { codexEvents } from '../src/executor/adapters/codex/events';
import { codexHasSession, codexSessionModel } from '../src/executor/adapters/codex/session';
import { antigravityAdapter, antigravitySettings, parseProbe as agyProbe } from '../src/executor/adapters/antigravity';
import { antigravityEvents } from '../src/executor/adapters/antigravity/events';
import { antigravityHasSession, antigravityMcpFile } from '../src/executor/adapters/antigravity/session';
import { customAdapter, fillArgs } from '../src/executor/adapters/custom';
import type { ExecContext, ExecResult } from '../src/executor/types';
import { MCP_SYSTEM_PROMPT } from '../src/prompt/system';
import { userClaudeExtras } from '../src/executor/adapters/claude/home';
import { baseRaw } from './fixtures/config';

describe('executor adapters', () => {
  const exec = parseConfig(baseRaw()).agents[0]!.executor;
  const ctx: ExecContext = {
    cwd: '/w',
    jobDir: '/j',
    promptFile: '/j/prompt.md',
    prompt: 'P',
    mcpConfigFile: '/j/mcp.json',
    exec,
  };

  test('claude: cờ bắt buộc + resume + budget', () => {
    const c = claudeAdapter.command({ ...ctx, resumeSessionId: 'sess-1' });
    const a = c.args.join(' ');
    for (const f of [
      '-p P',
      '--output-format stream-json',
      '--verbose',
      '--mcp-config /j/mcp.json',
      '--strict-mcp-config',
      '--setting-sources user',
      '--permission-mode bypassPermissions',
      '--model claude-sonnet-5-5',
      '--max-budget-usd 5',
      '--resume sess-1',
    ])
      expect(a).toContain(f);
  });

  test('executor.light (TEST-141): đè model / ngân sách / số vòng cho chat / họp; không khai báo → y như cũ; sai → lỗi', () => {
    expect(exec.light).toBeUndefined();
    expect(lightExecutor(exec)).toEqual({ ...exec });
    expect(claudeAdapter.command(ctx).args).not.toContain('--max-turns');
    const r: any = baseRaw();
    r.agents[0].executor.max_turns = 80;
    r.agents[0].executor.light = { model: 'claude-haiku-5-5', max_budget_usd: 0.2, max_turns: 8 };
    const e = parseConfig(r).agents[0]!.executor;
    expect(e).toMatchObject({
      model: 'claude-sonnet-5-5',
      maxBudgetUsd: 5,
      maxTurns: 80,
      light: { model: 'claude-haiku-5-5', maxBudgetUsd: 0.2, maxTurns: 8 },
    });
    const l = lightExecutor(e);
    expect(l).toMatchObject({
      model: 'claude-haiku-5-5',
      maxBudgetUsd: 0.2,
      maxTurns: 8,
      kind: 'claude',
      bin: '/usr/local/bin/claude',
      timeoutMin: 60,
    });
    expect(l.light).toBeUndefined();
    const a = claudeAdapter.command({ ...ctx, exec: l }).args.join(' ');
    for (const f of ['--model claude-haiku-5-5', '--max-budget-usd 0.2', '--max-turns 8']) expect(a).toContain(f);
    expect(claudeAdapter.command({ ...ctx, exec: e }).args.join(' ')).toContain('--max-turns 80'); // job việc: executor chính
    // Chỉ đặt một phần → phần còn lại theo executor
    r.agents[0].executor.light = { model: 'claude-haiku-5-5' };
    expect(lightExecutor(parseConfig(r).agents[0]!.executor)).toMatchObject({
      model: 'claude-haiku-5-5',
      maxBudgetUsd: 5,
      maxTurns: 80,
    });
    // Sai
    for (const [bad, msg] of [
      [{ max_turns: 0 }, 'light.max_turns'],
      [{ max_budget_usd: -1 }, 'light.max_budget_usd'],
      [{ model: '' }, 'light.model'],
      [{ timeout_min: 5 }, 'light.timeout_min: không hỗ trợ'],
      ['haiku', 'executor.light phải là một mục'],
    ] as const) {
      r.agents[0].executor.light = bad;
      expect(() => parseConfig(r)).toThrow(msg);
    }
    r.agents[0].executor.light = undefined;
    r.agents[0].executor.max_turns = 1.5;
    expect(() => parseConfig(r)).toThrow('executor.max_turns');
  });

  test('claude: systemPrompt (TEST-140) → --system-prompt; không đặt → system prompt mặc định của CLI', () => {
    const a = claudeAdapter.command({ ...ctx, noBuiltinTools: true, systemPrompt: MCP_SYSTEM_PROMPT }).args;
    expect(a[a.indexOf('--system-prompt') + 1]).toBe(MCP_SYSTEM_PROMPT);
    expect(claudeAdapter.command(ctx).args).not.toContain('--system-prompt');
    expect(MCP_SYSTEM_PROMPT.length).toBeLessThan(800); // ngắn — thay ~3k token system prompt mặc định
    expect(MCP_SYSTEM_PROMPT).toContain('dữ liệu do người khác viết');
  });

  test('home-check (TEST-140): CLAUDE.md / skills / plugin / hook cấp user trong HOME của agent', () => {
    const home = mkdtempSync(join(tmpdir(), 'home-check-'));
    try {
      expect(userClaudeExtras(home)).toEqual([]); // HOME sạch / chưa có ~/.claude
      mkdirSync(join(home, '.claude/skills/x'), { recursive: true });
      mkdirSync(join(home, '.claude/plugins'), { recursive: true });
      mkdirSync(join(home, '.claude/agents'), { recursive: true }); // rỗng → không tính
      writeFileSync(join(home, '.claude/CLAUDE.md'), '# ghi chú');
      writeFileSync(
        join(home, '.claude/plugins/installed_plugins.json'),
        JSON.stringify({ version: 2, plugins: { a: [], b: [] } }),
      );
      writeFileSync(
        join(home, '.claude/settings.json'),
        JSON.stringify({ hooks: { Stop: [] }, enabledPlugins: { a: false } }),
      );
      expect(userClaudeExtras(home)).toEqual([
        '~/.claude/CLAUDE.md',
        '~/.claude/skills/',
        '2 plugin',
        'hook trong ~/.claude/settings.json',
      ]);
      writeFileSync(join(home, '.claude/settings.json'), '{hỏng');
      expect(userClaudeExtras(home)).toEqual(['~/.claude/CLAUDE.md', '~/.claude/skills/', '2 plugin']);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test('claude: noBuiltinTools → --tools "" (chỉ tool MCP); mặc định không có', () => {
    const on = claudeAdapter.command({ ...ctx, noBuiltinTools: true }).args;
    expect(on[on.indexOf('--tools') + 1]).toBe('');
    expect(claudeAdapter.command(ctx).args).not.toContain('--tools');
  });

  test('claude: đọc stream-json mẫu', () => {
    const r: ExecResult = {};
    for (const l of readFileSync(join(import.meta.dir, 'fixtures/claude-stream.jsonl'), 'utf8').split('\n'))
      claudeAdapter.parseLine(l, r);
    expect(r).toMatchObject({
      sessionId: '0d6c1f3e-1111-4222-8333-944455556666',
      costUsd: 0.8123,
      turns: 17,
      inputTokens: 44200,
      outputTokens: 5300,
      isError: false,
    });
    expect(r.summary).toContain('Chờ review');
    // TEST-64: model chính (init + modelUsage) và model phụ
    expect(r.model).toBe('claude-sonnet-5-5');
    expect(Object.keys(r.modelUsage!)).toEqual(['claude-sonnet-5-5', 'claude-haiku-5-5']);
    expect(r.modelUsage!['claude-sonnet-5-5']).toEqual({
      costUsd: 0.8,
      inputTokens: 44100,
      outputTokens: 5000,
      cacheReadTokens: 40000,
      cacheWriteTokens: 3000,
    });
    // TEST-135: phần cache của cả phiên (inputTokens vẫn là tổng gồm cache)
    expect(r).toMatchObject({ cacheReadTokens: 40000, cacheWriteTokens: 3000 });
    // Không trường token nào → không biết (undefined), không phải 0
    expect(readModelUsage({ m: { costUSD: 0.1 } })!.m).toEqual({
      costUsd: 0.1,
      inputTokens: undefined,
      outputTokens: undefined,
    });
    expect(
      claudeAdapter.activity!(
        readFileSync(join(import.meta.dir, 'fixtures/claude-stream.jsonl'), 'utf8').split('\n')[0]!,
        '/w',
      ),
    ).toEqual(['Model claude-sonnet-5-5']);
  });

  test('model: init chỉ là model được yêu cầu, model thật lấy từ modelUsage', () => {
    const r: ExecResult = {};
    claudeAdapter.parseLine('{"type":"system","subtype":"init","model":"claude-opus-5-5","session_id":"s"}', r);
    expect(r.model).toBe('claude-opus-5-5');
    // CLI tự hạ model (fallback) → modelUsage không có model init → lấy model tốn nhiều nhất
    claudeAdapter.parseLine(
      '{"type":"result","subtype":"success","is_error":false,"session_id":"s","modelUsage":{"claude-haiku-5-5":{"costUSD":0.01,"outputTokens":10},"claude-sonnet-5-5":{"costUSD":0.3,"outputTokens":900}}}',
      r,
    );
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
    expect(
      modelLine(
        {
          model: 'claude-opus-5-5',
          modelUsage: { 'claude-opus-5-5': { costUsd: 1 }, 'claude-haiku-5-5': { costUsd: 0.012 } },
        },
        'opus',
      ),
    ).toBe('claude-opus-5-5 · phụ: claude-haiku-5-5 ($0.01)');
    expect(modelLine({ model: 'claude-sonnet-5-5' }, 'claude-opus-5-5')).toBe(
      'claude-sonnet-5-5 ⚠ khác cấu hình (claude-opus-5-5)',
    );
  });

  test('bình luận chi phí có dòng Model', () => {
    const c = resultComment(
      { agent: 'NV018' },
      { exitCode: 0, timedOut: false, durationSec: 120, costUsd: 0.31, model: 'claude-opus-5-5' },
      undefined,
      '',
      true,
      'claude-opus-5-5',
    );
    expect(c).toContain('- Model: claude-opus-5-5');
    expect(c.indexOf('Model')).toBeLessThan(c.indexOf('Chi phí'));
  });

  test('claude: chạy thử model (doctor / start)', () => {
    const a = probeArgs('claude-opus-5-5').join(' ');
    for (const f of [
      '-p ok',
      '--output-format stream-json',
      '--verbose',
      '--max-turns 1',
      '--strict-mcp-config',
      '--model claude-opus-5-5',
    ])
      expect(a).toContain(f);
    expect(probeArgs(undefined)).not.toContain('--model');
    const ok = [
      '{"type":"system","subtype":"init","model":"claude-haiku-5-5"}',
      '{"type":"result","subtype":"success","is_error":false,"modelUsage":{"claude-haiku-5-5":{"costUSD":0.0002}}}',
    ].join('\n');
    expect(parseProbe(ok)).toEqual({ model: 'claude-haiku-5-5' });
    // Mẫu thật Claude Code 2.1.x với model sai: init lặp lại tên sai, result is_error + 404
    const bad = [
      '{"type":"system","subtype":"init","model":"claude-bogus-9"}',
      '[claude-code:unrecognized_model] {"model":"claude-bogus-9"}',
      '{"type":"result","subtype":"success","is_error":true,"result":"There\'s an issue with the selected model (claude-bogus-9). It may not exist or you may not have access to it.","terminal_reason":"api_error","api_error_status":404,"modelUsage":{}}',
    ].join('\n');
    const p = parseProbe(bad);
    expect(p.invalidModel).toBe(true);
    expect(p.model).toBeUndefined();
    expect(p.error).toContain('selected model');
    const r: ExecResult = {};
    claudeAdapter.parseLine(bad.split('\n')[2]!, r);
    expect(r).toMatchObject({ isError: true, errorKind: 'api_error 404' });
    expect(
      parseProbe('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"rate limited"}'),
    ).toMatchObject({ invalidModel: false, error: 'rate limited' });
    expect(parseProbe('')).toMatchObject({ error: 'CLI không trả sự kiện result' });
  });

  test('claude: mô tả thao tác agent đang làm', () => {
    const line = (content: unknown[]) => JSON.stringify({ type: 'assistant', message: { content } });
    const out = claudeAdapter.activity!(
      line([
        { type: 'text', text: 'Đọc   code\ntrước' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/w/src/a.ts' } },
        { type: 'tool_use', name: 'Bash', input: { command: 'bun test' } },
        { type: 'tool_use', name: 'mcp__officehub__update_task_status', input: { status: 'Doing' } },
      ]),
      '/w',
    );
    expect(out).toEqual([
      'Nói: Đọc code trước',
      'Đọc src/a.ts',
      'Chạy: bun test',
      'OfficeHub update_task_status → Doing',
    ]);
    expect(claudeAdapter.activity!('không phải json', '/w')).toEqual([]);
    expect(claudeAdapter.activity!('{"type":"result"}', '/w')).toEqual([]);
  });

  test('claude: hết ngân sách → isError', () => {
    const r: ExecResult = {};
    claudeAdapter.parseLine(
      '{"type":"result","subtype":"error_max_budget_usd","is_error":true,"total_cost_usd":5.01,"session_id":"s"}',
      r,
    );
    expect(r.isError).toBe(true);
    expect(r.errorKind).toBe('error_max_budget_usd');
  });

  test('custom: thay biến + resume_args + output json / text', () => {
    const e = {
      ...exec,
      kind: 'custom' as const,
      args: ['run', '--cwd', '{cwd}', '--p', '{prompt_file}', '-m', '{model}'],
      resumeArgs: ['--session', '{session_id}'],
    };
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

  describe('codex', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-'));
    const mcp = join(dir, 'mcp.json');
    writeFileSync(
      mcp,
      JSON.stringify({
        mcpServers: {
          officehub: {
            type: 'http',
            url: 'https://x.test/mcp?profile=task',
            headers: { Authorization: 'Bearer ${OFFICEHUB_TOKEN}' },
          },
        },
      }),
    );
    const cx: ExecContext = { ...ctx, mcpConfigFile: mcp, exec: { ...exec, kind: 'codex', model: 'gpt-x' } };

    test('cấu hình kind codex hợp lệ, không cần args', () => {
      const raw = baseRaw();
      (raw.agents[0] as any).executor = { kind: 'codex', bin: '/usr/bin/codex' };
      expect(parseConfig(raw).agents[0]!.executor.kind).toBe('codex');
      (raw.agents[0] as any).executor.extra_args = ['--mcp-config', '/x/design-mcp.json'];
      expect(() => parseConfig(raw)).toThrow('--mcp-config');
    });

    test('lệnh: MCP qua -c, phiên có công cụ bỏ sandbox, prompt sau --', () => {
      const c = codexAdapter.command({ ...cx, prompt: '-bắt đầu bằng gạch' });
      expect(c.args.slice(0, 3)).toEqual(['exec', '--json', '--skip-git-repo-check']);
      expect(c.args).toContain('mcp_servers.officehub.url="https://x.test/mcp?profile=task"');
      expect(c.args).toContain('mcp_servers.officehub.bearer_token_env_var="OFFICEHUB_TOKEN"');
      expect(c.args).toContain('mcp_servers.officehub.default_tools_approval_mode="approve"');
      expect(c.args).toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(c.args.slice(c.args.indexOf('-m'), c.args.indexOf('-m') + 2)).toEqual(['-m', 'gpt-x']);
      expect(c.args.slice(-2)).toEqual(['--', '-bắt đầu bằng gạch']);
      expect(c.args.join(' ')).not.toContain('ohk_');
    });

    test('lệnh: phiên chỉ MCP → sandbox read-only; nối phiên → exec resume <id> <prompt>', () => {
      const c = codexAdapter.command({ ...cx, noBuiltinTools: true, resumeSessionId: 'th-1' });
      expect(c.args.slice(0, 2)).toEqual(['exec', 'resume']);
      expect(c.args).toContain('sandbox_mode="read-only"');
      expect(c.args).not.toContain('--dangerously-bypass-approvals-and-sandbox');
      expect(c.args.slice(-3)).toEqual(['--', 'th-1', 'P']);
      expect(codexAdapter.caps.toolRestriction).toBe(false);
    });

    test('file MCP hỏng / thiếu → không có tham số MCP', () => {
      expect(codexMcpArgs(join(dir, 'không-có.json'))).toEqual([]);
    });

    test('đọc output: phiên, tóm tắt, token, lỗi', () => {
      const r: ExecResult = {};
      for (const l of [
        '{"type":"thread.started","thread_id":"th-9"}',
        '{"type":"error","message":"Reconnecting... 2/5"}',
        '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Xong việc"}}',
        '{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":7}}',
        'dòng không phải JSON',
      ])
        codexAdapter.parseLine(l, r);
      expect(r).toMatchObject({
        sessionId: 'th-9',
        summary: 'Xong việc',
        inputTokens: 100,
        cacheReadTokens: 40,
        outputTokens: 7,
        turns: 1,
        isError: false,
      });
      const f: ExecResult = {};
      codexAdapter.parseLine('{"type":"turn.failed","error":{"message":"401 Unauthorized"}}', f);
      expect(f).toMatchObject({ isError: true, errorKind: 'turn_failed', summary: '401 Unauthorized' });
    });

    test('log tiến độ + sự kiện xem trực tiếp', () => {
      const started = '{"type":"item.started","item":{"id":"i1","type":"command_execution","command":"ls"}}';
      const done =
        '{"type":"item.completed","item":{"id":"i1","type":"command_execution","command":"ls","aggregated_output":"a.txt","exit_code":0}}';
      const secret =
        '{"type":"item.completed","item":{"id":"i2","type":"command_execution","command":"cat .env","aggregated_output":"KEY=1","exit_code":0}}';
      const change =
        '{"type":"item.completed","item":{"id":"i3","type":"file_change","changes":[{"path":"/w/src/a.ts","kind":"update"}],"status":"completed"}}';
      const tool =
        '{"type":"item.started","item":{"id":"i4","type":"mcp_tool_call","server":"officehub","tool":"get_task"}}';
      expect(codexAdapter.activity!(started, '/w')).toEqual(['Chạy: ls']);
      expect(codexAdapter.activity!(change, '/w')).toEqual(['Sửa src/a.ts']);
      expect(codexAdapter.activity!(tool, '/w')).toEqual(['OfficeHub get_task']);
      const ev = codexEvents('/w');
      expect(ev(started)).toEqual([{ id: 'i1', kind: 'command', title: 'Chạy lệnh', text: 'ls' }]);
      expect(ev(done)[0]).toMatchObject({ id: 'i1', kind: 'command', ok: true, output: 'a.txt' });
      expect(ev(secret)[0]!.output).not.toContain('KEY=1');
      expect(ev(change)).toEqual([
        { id: 'i3-0', kind: 'file_edit', title: 'Sửa src/a.ts', path: 'src/a.ts', ok: true },
      ]);
      expect(ev(tool)).toEqual([{ id: 'i4', kind: 'tool', title: 'OfficeHub get_task' }]);
    });

    test('hasSession tìm file rollout theo id; doctor cảnh báo chưa đăng nhập + trần không áp dụng', () => {
      const day = join(dir, '.codex', 'sessions', '2026', '11', '18');
      mkdirSync(day, { recursive: true });
      writeFileSync(
        join(day, 'rollout-2026-11-18T15-35-37-th-9.jsonl'),
        '{"type":"session_meta","payload":{}}\n{"type":"turn_context","payload":{"model":"gpt-a"}}\n{"type":"turn_context","payload":{"cwd":"/w","model":"gpt-b"}}\n',
      );
      expect(codexSessionModel(dir, 'th-9')).toBe('gpt-b');
      const done: ExecResult = { sessionId: 'th-9' };
      codexAdapter.finish!('', done, dir);
      expect(done.model).toBe('gpt-b');
      const out = {
        ...done,
        inputTokens: 247405,
        cacheReadTokens: 212096,
        outputTokens: 753,
        exitCode: 0,
        timedOut: false,
        durationSec: 60,
      };
      expect(resultComment({ agent: 'NV010' }, out, undefined, '', true)).toContain(
        '- Token: 247,405 token vào (212,096 đọc từ cache) / 753 ra',
      );
      expect(codexHasSession(dir, '/w', 'th-9')).toBe(true);
      expect(codexHasSession(dir, '/w', 'th-0')).toBe(false);
      const w = codexAdapter.homeWarnings!({ ...cx.exec, home: dir, maxBudgetUsd: 4 }, dir).join('\n');
      expect(w).toContain('auth.json');
      expect(w).toContain('max_budget_usd');
      rmSync(dir, { recursive: true, force: true });
    });
  });

  describe('antigravity (TEST-201)', () => {
    const home = mkdtempSync(join(tmpdir(), 'agy-'));
    const mcp = join(home, 'job-mcp.json');
    writeFileSync(
      mcp,
      JSON.stringify({
        mcpServers: {
          officehub: {
            type: 'http',
            url: 'https://x.test/mcp?profile=task',
            headers: { Authorization: 'Bearer ${OFFICEHUB_TOKEN}' },
          },
        },
      }),
    );
    const ax: ExecContext = {
      ...ctx,
      mcpConfigFile: mcp,
      exec: { ...exec, kind: 'antigravity', bin: '/usr/local/bin/agy', model: 'gemini-x', home },
    };
    const fixture = (name: string) =>
      readFileSync(join(import.meta.dir, 'fixtures', name), 'utf8')
        .split('\n')
        .filter(Boolean);

    test('cấu hình kind antigravity hợp lệ; --mcp-config trong extra_args → lỗi', () => {
      const raw = baseRaw();
      (raw.agents[0] as any).executor = { kind: 'antigravity', bin: '/usr/local/bin/agy' };
      expect(parseConfig(raw).agents[0]!.executor.kind).toBe('antigravity');
      (raw.agents[0] as any).executor.extra_args = ['--mcp-config', '/x/mcp.json'];
      expect(() => parseConfig(raw)).toThrow('--mcp-config');
    });

    test('lệnh phiên có công cụ: stream-json, model, tự duyệt, prompt là giá trị của -p ở cuối; MCP ghi vào HOME qua cầu nối, không có token', () => {
      const c = antigravityAdapter.command({ ...ax, prompt: '-bắt đầu bằng gạch' });
      expect(c.bin).toBe('/usr/local/bin/agy');
      expect(c.args.slice(0, 2)).toEqual(['--output-format', 'stream-json']);
      expect(c.args).toContain('--dangerously-skip-permissions');
      expect(c.args).not.toContain('--sandbox');
      expect(c.args.slice(c.args.indexOf('--model'), c.args.indexOf('--model') + 2)).toEqual(['--model', 'gemini-x']);
      expect(c.args.slice(-2)).toEqual(['-p', '-bắt đầu bằng gạch']);
      expect(JSON.parse(c.args[c.args.indexOf('--settings') + 1]!)).toEqual({
        permissions: { allow: ['mcp(officehub/*)'] },
      });
      // file MCP trong HOME của agent: máy chủ stdio = cầu nối của runner, chỉ có URL + TÊN biến môi trường
      const file = JSON.parse(readFileSync(antigravityMcpFile(home), 'utf8'));
      const server = file.mcpServers.officehub;
      expect(server.args.slice(-5)).toEqual([
        'mcp-bridge',
        '--url',
        'https://x.test/mcp?profile=task',
        '--bearer-env',
        'OFFICEHUB_TOKEN',
      ]);
      expect(server.command).toBe(process.execPath);
      expect(JSON.stringify(file) + c.args.join(' ')).not.toContain('Bearer');
    });

    test('lệnh phiên chỉ MCP: không tự duyệt, sandbox + cấm lệnh; nối phiên --conversation; máy chủ MCP người dùng tự khai được giữ', () => {
      const file = antigravityMcpFile(home);
      mkdirSync(join(home, '.gemini', 'config'), { recursive: true });
      writeFileSync(
        file,
        JSON.stringify({ mcpServers: { stitch: { serverUrl: 'https://stitch.test/mcp' } }, khac: 1 }),
      );
      const c = antigravityAdapter.command({ ...ax, noBuiltinTools: true, resumeSessionId: 'conv-1' });
      expect(c.args).not.toContain('--dangerously-skip-permissions');
      expect(c.args).toContain('--sandbox');
      expect(c.args.slice(c.args.indexOf('--conversation'), c.args.indexOf('--conversation') + 2)).toEqual([
        '--conversation',
        'conv-1',
      ]);
      expect(antigravitySettings(['officehub'], true)).toBe(
        '{"permissions":{"allow":["mcp(officehub/*)"],"deny":["command(*)"]}}',
      );
      expect(c.args).toContain(antigravitySettings(['officehub'], true));
      const written = JSON.parse(readFileSync(file, 'utf8'));
      expect(written.khac).toBe(1);
      expect(Object.keys(written.mcpServers).sort()).toEqual(['officehub', 'stitch']);
      expect(antigravityAdapter.caps).toEqual({ resume: true, toolRestriction: false });
      // file MCP hỏng → ghi lại từ đầu, không ném lỗi
      writeFileSync(file, '');
      antigravityAdapter.command(ax);
      expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).mcpServers)).toEqual(['officehub']);
    });

    test('đọc output thật (agy 1.5.14): phiên, model, tóm tắt, token cộng theo bước (vào gồm cache), số lượt', () => {
      const r: ExecResult = {};
      for (const l of fixture('antigravity-stream.jsonl')) antigravityAdapter.parseLine(l, r);
      expect(r).toEqual({
        sessionId: '11111111-2222-4333-8444-555555555555',
        model: 'gemini-3.8-flash-low',
        summary: 'Lệnh `echo hi` đã chạy, nội dung note.txt là "xin chao".',
        inputTokens: 9458 + 2347 + 7411,
        outputTokens: 127 + 108,
        cacheReadTokens: 7411,
        turns: 3, // 2 công cụ + lượt trả lời cuối
        isError: false,
      });
      // không có chi phí USD → bình luận chỉ ghi token
      const out = { ...r, exitCode: 0, timedOut: false, durationSec: 60, stderrTail: '' } as any;
      expect(resultComment({ agent: 'NV170' }, out, undefined, '', true)).toContain(
        '- Token: 19,216 token vào (7,411 đọc từ cache) / 235 ra',
      );
    });

    test('thao tác bị từ chối ở headless (CLI vẫn thoát 0, SUCCESS) → báo lỗi, không thành công giả; trạng thái khác SUCCESS → lỗi', () => {
      const r: ExecResult = {};
      for (const l of fixture('antigravity-denied.jsonl')) antigravityAdapter.parseLine(l, r);
      expect(r.isError).toBe(true);
      expect(r.errorKind).toBe('denied_actions');
      expect(r.summary).toContain('từ chối thao tác cần duyệt (mcp)');
      expect(r.inputTokens).toBe(9820); // không có số theo bước trong đoạn này → lấy số của result
      const f: ExecResult = {};
      antigravityAdapter.parseLine(
        '{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"quota exceeded\\nchi tiết"}}',
        f,
      );
      expect(f).toMatchObject({ isError: true, errorKind: 'ERROR', summary: 'quota exceeded' });
    });

    test('log tiến độ + sự kiện xem trực tiếp: lệnh kèm output, file chỉ đường dẫn, MCP chỉ tên, lời agent gom text_delta', () => {
      const lines = fixture('antigravity-stream.jsonl');
      expect(lines.flatMap((l) => antigravityAdapter.activity!(l, '/w'))).toEqual(['Chạy: echo hi', 'Đọc note.txt']);
      const ev = antigravityEvents('/w');
      const all = lines.flatMap((l) => ev(l));
      expect(all.filter((e) => e.kind === 'command')).toEqual([
        { id: 'step-2', kind: 'command', title: 'Chạy lệnh', text: 'echo hi' },
        { id: 'step-2', kind: 'command', title: 'Chạy lệnh', text: 'echo hi', ok: true, output: 'hi' },
      ]);
      expect(all.filter((e) => e.kind === 'file_read').at(-1)).toEqual({
        id: 'step-3',
        kind: 'file_read',
        title: 'Đọc note.txt',
        path: 'note.txt',
        ok: true,
      });
      expect(all.at(-1)).toEqual({
        id: 'step-4',
        kind: 'say',
        title: 'Nói',
        text: 'Lệnh `echo hi` đã chạy, nội dung note.txt là "xin chao".',
      });
      const denied = fixture('antigravity-denied.jsonl');
      expect(antigravityAdapter.activity!(denied[0]!, '/w')).toEqual(['OfficeHub ping']);
      const dv = antigravityEvents('/w');
      expect(denied.flatMap((l) => dv(l)).at(-1)).toEqual({
        id: 'step-3',
        kind: 'tool',
        title: 'OfficeHub ping',
        ok: false,
      });
      // lệnh đụng file bí mật → ẩn output
      const secret =
        '{"event":"step_update","step_update":{"step_index":7,"state":"DONE","step_type":"tool","tool_name":"run_command","tool_info":{"parameters":{"CommandLine":"cat .env"},"output":"Command exited with code 0.\\n\\nCommand output:\\nKEY=1"}}}';
      expect(antigravityEvents('/w')(secret)[0]!.output).not.toContain('KEY=1');
    });

    test('chạy thử model: model thật từ init; model sai (thoát 1, result ERROR) → invalidModel', () => {
      expect(antigravityAdapter.probe!(ax.exec).args).toEqual([
        '--output-format',
        'stream-json',
        '--model',
        'gemini-x',
        '-p',
        'ok',
      ]);
      expect(agyProbe(fixture('antigravity-stream.jsonl').join('\n'))).toEqual({ model: 'gemini-3.8-flash-low' });
      const bad =
        '{"event":"result","result":{"conversation_id":"","status":"ERROR","response":"","error":"invalid model selection (--model \\"x\\" --effort \\"\\"): model x is not recognized as a known model or custom model in settings\\nAvailable models:\\n  A"}}';
      expect(agyProbe(bad)).toMatchObject({
        invalidModel: true,
        error: expect.stringContaining('invalid model selection'),
      });
      expect(agyProbe('không phải json')).toEqual({ model: undefined, error: 'CLI không trả sự kiện result' });
    });

    test('còn phiên ở máy (conversations/<id>.db); cảnh báo HOME: chưa từng chạy agy, trần không có tác dụng', () => {
      const w = antigravityAdapter.homeWarnings!({ ...ax.exec, maxTurns: 5 }, home).join('\n');
      expect(w).toContain('chưa từng chạy agy');
      expect(w).toContain('max_turns không có tác dụng');
      const cli = join(home, '.gemini', 'antigravity-cli');
      mkdirSync(join(cli, 'conversations'), { recursive: true });
      writeFileSync(join(cli, 'installation_id'), 'x');
      writeFileSync(join(cli, 'conversations', 'conv-1.db'), '');
      expect(antigravityAdapter.homeWarnings!({ ...ax.exec, maxBudgetUsd: undefined }, home)).toEqual([]);
      expect(antigravityHasSession(home, '/w', 'conv-1')).toBe(true);
      expect(antigravityHasSession(home, '/w', 'conv-0')).toBe(false);
      expect(antigravityHasSession(home, '/w', '../conv-1')).toBe(false);
      // không đặt executor.home → cảnh báo runner sẽ ghi file MCP vào HOME đang dùng chung
      expect(antigravityAdapter.homeWarnings!({ ...ax.exec, home: undefined }, home).join('\n')).toContain(
        '.gemini/config/mcp_config.json',
      );
      rmSync(home, { recursive: true, force: true });
    });
  });
});
