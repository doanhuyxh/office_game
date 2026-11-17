// Adapter CLI (claude, custom): lệnh, đọc output, model thật, transcript, HOME.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lightExecutor, parseConfig } from '../src/config';
import { claudeAdapter, parseProbe, probeArgs } from '../src/executor/adapters/claude';
import { mainModel, modelLine, modelMatches, readModelUsage } from '../src/executor/model';
import { resultComment } from '../src/jobs/task';
import { customAdapter, fillArgs } from '../src/executor/adapters/custom';
import type { ExecContext, ExecResult } from '../src/executor/types';
import { MCP_SYSTEM_PROMPT } from '../src/prompt/system';
import { userClaudeExtras } from '../src/executor/adapters/claude-home';
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
});
