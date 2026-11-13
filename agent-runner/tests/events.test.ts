import { describe, expect, test } from 'bun:test';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeAdapter } from '../src/executor/adapters/claude';
import { claudeEvents } from '../src/executor/adapters/claude-events';
import { customAdapter } from '../src/executor/adapters/custom';
import {
  type ActivityEvent, HIDDEN, HIDDEN_OUTPUT, LIMITS, cutDiff, diffOf, displayPath, isSensitiveCommand, isSensitivePath, mask, sanitize,
  sessionEnd, sessionStart,
} from '../src/executor/events';
import { runExecutor } from '../src/executor/run';
import { registerSecret } from '../src/log';

const fixture = join(import.meta.dir, 'fixtures/claude-events.jsonl');
const lines = () => readFileSync(fixture, 'utf8').split('\n');
const all = (cwd = '/w') => { const ex = claudeEvents(cwd); return lines().flatMap((l) => ex(l)); };
const tool = (id: string, name: string, input: unknown) =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, content: unknown, isError = false) =>
  JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });

describe('sự kiện xem trực tiếp (TEST-93): stream-json của Claude Code', () => {
  test('từng loại sự kiện, đúng thứ tự', () => {
    const ev = all();
    expect(ev.map((e) => `${e.kind}:${e.id}`)).toEqual([
      'thinking:think-1', 'say:say-2',
      'file_read:toolu_read1', 'file_read:toolu_read1',
      'search:toolu_grep1', 'search:toolu_grep1',
      'file_edit:toolu_edit1', 'file_edit:toolu_edit1',
      'file_write:toolu_write1',
      'command:toolu_bash1', 'command:toolu_bash1',
      'command:toolu_bash2', 'command:toolu_bash2',
      'tool:toolu_mcp1', 'tool:toolu_mcp1',
    ]);
    expect(ev[0]).toEqual({ id: 'think-1', kind: 'thinking', title: 'Suy nghĩ', text: 'Cần xem file cấu hình trước rồi mới sửa.' });
    expect(ev[1]).toEqual({ id: 'say-2', kind: 'say', title: 'Nói', text: 'Tôi sẽ đọc file rồi chạy test.' });
  });

  test('đọc file / tìm kiếm: chỉ đường dẫn + mẫu tìm, KHÔNG gửi nội dung file hay kết quả', () => {
    const ev = all();
    expect(ev[2]).toEqual({ id: 'toolu_read1', kind: 'file_read', title: 'Đọc src/a.ts', path: 'src/a.ts' });
    expect(ev[3]).toEqual({ id: 'toolu_read1', kind: 'file_read', ok: true });
    expect(ev[4]).toEqual({ id: 'toolu_grep1', kind: 'search', title: 'Tìm trong code', text: 'useBotWatch', path: 'src' });
    expect(ev[5]).toEqual({ id: 'toolu_grep1', kind: 'search', ok: true });
    expect(JSON.stringify(ev)).not.toContain('SECRET_FILE_BODY');
    expect(JSON.stringify(ev)).not.toContain('grep hit body');
  });

  test('sửa / ghi file: diff dòng - / +, đường dẫn tương đối', () => {
    const ev = all();
    expect(ev[6]).toEqual({ id: 'toolu_edit1', kind: 'file_edit', title: 'Sửa src/a.ts', path: 'src/a.ts',
      diff: '-const a = 1;\n-const b = 2;\n+const a = 10;\n+const b = 2;\n+const c = 3;' });
    expect(ev[7]).toEqual({ id: 'toolu_edit1', kind: 'file_edit', ok: true }); // thông báo "has been updated" không gửi
    expect(ev[8]).toEqual({ id: 'toolu_write1', kind: 'file_write', title: 'Ghi docs/new.md', path: 'docs/new.md', diff: '+# Tiêu đề\n+Dòng 2' });
  });

  test('lệnh: kết quả về sau ghép đúng id, kèm ok', () => {
    const ev = all();
    expect(ev[9]).toEqual({ id: 'toolu_bash1', kind: 'command', title: 'Chạy kiểm thử', text: 'bun test' });
    expect(ev[10]).toEqual({ id: 'toolu_bash1', kind: 'command', output: '12 pass\n0 fail', ok: true });
    expect(ev[11]).toEqual({ id: 'toolu_bash2', kind: 'command', title: 'Chạy lệnh', text: 'dotnet build' });
    expect(ev[12]).toEqual({ id: 'toolu_bash2', kind: 'command', output: 'error CS1002: ; expected', ok: false });
  });

  test('tool OfficeHub: chỉ tên tool, không tham số / kết quả', () => {
    const ev = all();
    expect(ev[13]).toEqual({ id: 'toolu_mcp1', kind: 'tool', title: 'OfficeHub comment_task' });
    expect(ev[14]).toEqual({ id: 'toolu_mcp1', kind: 'tool', ok: true });
    expect(JSON.stringify(ev)).not.toContain('bình luận nội bộ');
    expect(JSON.stringify(ev)).not.toContain('salary');
  });

  test('dòng không phải JSON / init / result / kết quả của tool lạ → không có sự kiện', () => {
    const ex = claudeEvents('/w');
    expect(ex('not json')).toEqual([]);
    expect(ex('{"type":"system","subtype":"init","model":"m"}')).toEqual([]);
    expect(ex('{"type":"result","subtype":"success"}')).toEqual([]);
    expect(ex(result('toolu_unknown', 'x'))).toEqual([]);
    expect(ex('{"type":"assistant","message":{"content":[{"type":"text","text":"   "},{"type":"redacted_thinking","data":"x"}]}}')).toEqual([]);
  });

  test('MultiEdit gộp diff; tool khác chỉ có tên', () => {
    const ex = claudeEvents('/w');
    expect(ex(tool('m1', 'MultiEdit', { file_path: '/w/a.ts', edits: [{ old_string: 'x', new_string: 'y' }, { old_string: 'p', new_string: '' }] }))[0])
      .toMatchObject({ kind: 'file_edit', path: 'a.ts', diff: '-x\n+y\n-p' });
    expect(ex(tool('w1', 'WebFetch', { url: 'https://example.com/?token=abc' }))[0]).toEqual({ id: 'w1', kind: 'tool', title: 'Dùng WebFetch' });
    expect(ex(tool('t1', 'Task', { description: 'Tìm chỗ gọi hàm', prompt: 'dài…' }))[0]).toEqual({ id: 't1', kind: 'tool', title: 'Giao việc phụ', text: 'Tìm chỗ gọi hàm' });
  });
});

describe('sự kiện xem trực tiếp: an toàn', () => {
  test('file nhạy cảm: chỉ đường dẫn, không diff', () => {
    const ex = claudeEvents('/w');
    for (const [name, input] of [
      ['Edit', { file_path: '/w/.env', old_string: 'DB_PASSWORD=old-pass', new_string: 'DB_PASSWORD=new-pass' }],
      ['Write', { file_path: '/w/deploy/server.pem', content: 'PEM-BODY-123' }],
      ['Write', { file_path: '/w/agent-runner/agents.yaml', content: 'token: ohk_abcdefgh12345678' }],
    ] as const) {
      const e = ex(tool('x', name, input))[0]!;
      expect(e.diff).toBeUndefined();
      expect(e.text).toBe(HIDDEN);
      expect(JSON.stringify(e)).not.toMatch(/old-pass|new-pass|PEM-BODY|ohk_/);
    }
  });

  test('nhận diện file / lệnh nhạy cảm', () => {
    for (const p of ['.env', 'backend/.env.production', 'prod.env', 'a/b/key.pem', 'tls/site.key', 'agent-runner/agents.yaml', '~/.ssh/id_rsa', '~/.ssh/id_ed25519.pub', '.npmrc'])
      expect([p, isSensitivePath(p)]).toEqual([p, true]);
    for (const p of ['src/env.ts', 'docs/environment.md', 'src/keyboard.ts', 'agents.example.yaml', 'src/a.ts'])
      expect([p, isSensitivePath(p)]).toEqual([p, false]);
    for (const c of ['cat .env', 'grep KEY backend/.env.production | head', 'printenv', 'env | sort', 'cat ~/.ssh/id_rsa', 'source "./.env" && run'])
      expect([c, isSensitiveCommand(c)]).toEqual([c, true]);
    for (const c of ['bun test', 'dotnet build -warnaserror', 'git status', 'ls src/env', 'NODE_ENV=test bun run build'])
      expect([c, isSensitiveCommand(c)]).toEqual([c, false]);
  });

  test('lệnh đụng file bí mật: lệnh vẫn hiện, kết quả bị ẩn', () => {
    const ex = claudeEvents('/w');
    expect(ex(tool('b1', 'Bash', { command: 'cat .env' }))[0]).toEqual({ id: 'b1', kind: 'command', title: 'Chạy lệnh', text: 'cat .env' });
    expect(ex(result('b1', 'S3__SecretKey=very-secret-value'))[0]).toEqual({ id: 'b1', kind: 'command', output: HIDDEN_OUTPUT, ok: true });
  });

  test('che bí mật ở mọi trường chữ', () => {
    registerSecret('ohk_registered_secret_1234');
    const ex = claudeEvents('/w');
    const cmd = ex(tool('b2', 'Bash', { command: 'curl -H "Authorization: Bearer abcdefgh12345678" https://x && echo ohk_registered_secret_1234', description: 'Gọi API token=abc12345' }))[0]!;
    expect(cmd.text).toBe('curl -H "Authorization: Bearer ***" https://x && echo ***');
    expect(cmd.title).toBe('Gọi API token=***');
    const out = ex(result('b2', 'DB_PASSWORD=hunter2\npostgres://app:s3cr3t@db:5432/x\n-----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----\nxong'))[0]!;
    expect(out.output).toBe('DB_PASSWORD=***\npostgres://app:***@db:5432/x\n***\nxong');
    const say = ex('{"type":"assistant","message":{"content":[{"type":"text","text":"Token là ohk_zzzzzzzz99999999, api_key: \\"sk-abc\\""}]}}')[0]!;
    expect(say.text).toBe('Token là ***, api_key: ***');
    const edit = ex(tool('e9', 'Edit', { file_path: '/w/src/cfg.ts', old_string: 'const password = "p1"', new_string: 'const password = "p2"' }))[0]!;
    expect(edit.diff).toBe('-const password = ***\n+const password = ***');
    expect(mask('123456789:AAH-test-token-abcdefghijklmnopqrstu')).toBe('***');
    expect(mask('maxTokens = 5, bun test, const a = 1')).toBe('maxTokens = 5, bun test, const a = 1'); // không che nhầm chữ thường gặp
  });

  test('cắt độ dài: lệnh giữ đầu, kết quả giữ đuôi, diff ≤ 200 dòng', () => {
    const ex = claudeEvents('/w');
    const cmd = ex(tool('b3', 'Bash', { command: 'echo ' + 'a'.repeat(5000) }))[0]!;
    expect(cmd.text!.length).toBe(LIMITS.text);
    expect(cmd.text!.endsWith('…')).toBe(true);
    const out = ex(result('b3', 'đầu-bị-cắt ' + 'x'.repeat(5000) + ' LỖI CUỐI'))[0]!;
    expect(out.output!.length).toBe(LIMITS.output);
    expect(out.output!.startsWith('…')).toBe(true);
    expect(out.output!.endsWith('LỖI CUỐI')).toBe(true);
    const big = Array.from({ length: 500 }, (_, i) => `dòng ${i}`).join('\n');
    const w = ex(tool('w3', 'Write', { file_path: '/w/big.txt', content: big }))[0]!;
    const dl = w.diff!.split('\n');
    expect(dl.length).toBe(LIMITS.diffLines);
    expect(dl[0]).toBe('+dòng 0');
    expect(dl.at(-1)).toBe('…');
    expect(cutDiff(['+' + 'y'.repeat(20_000), '+z']).length).toBeLessThanOrEqual(LIMITS.diffChars);
    expect(sanitize({ id: 'i'.repeat(100), kind: 'say', title: 't'.repeat(300) })).toMatchObject({ id: 'i'.repeat(64), title: 't'.repeat(199) + '…' });
  });

  test('diff + đường dẫn hiển thị', () => {
    expect(diffOf('', 'a\nb\n')).toBe('+a\n+b');
    expect(diffOf('a', '')).toBe('-a');
    expect(diffOf('', '')).toBe('');
    expect(displayPath('/w/src/a.ts', '/w', '/home/u')).toBe('src/a.ts');
    expect(displayPath('/home/u/.claude/x.json', '/w', '/home/u')).toBe('~/.claude/x.json');
    expect(displayPath('/etc/hosts', '/w', '/home/u')).toBe('/etc/hosts');
    expect(displayPath('/w2/a.ts', '/w', '/home/u')).toBe('/w2/a.ts'); // tiền tố trùng tên không tính là trong cwd
  });
});

describe('sự kiện xem trực tiếp: phiên + vòng chạy CLI', () => {
  test('session_start / session_end dựng từ việc + kết quả CLI', () => {
    expect(sessionStart('TEST-45 · Sửa lỗi đăng nhập', 'claude-sonnet-5-5'))
      .toEqual({ id: 'session', kind: 'session_start', title: 'Bắt đầu', task: 'TEST-45 · Sửa lỗi đăng nhập', model: 'claude-sonnet-5-5' });
    expect(sessionStart('TEST-45')).toEqual({ id: 'session', kind: 'session_start', title: 'Bắt đầu', task: 'TEST-45' });
    expect(sessionEnd({ model: 'claude-opus-5-5', turns: 9, costUsd: 0.42, isError: false }, 'TEST-45'))
      .toEqual({ id: 'session-end', kind: 'session_end', title: 'Kết thúc', ok: true, task: 'TEST-45', model: 'claude-opus-5-5', turns: 9, costUsd: 0.42 });
    expect(sessionEnd({ isError: true })).toEqual({ id: 'session-end', kind: 'session_end', title: 'Kết thúc (lỗi)', ok: false });
  });

  test('adapter claude có bộ tách sự kiện, custom thì không', () => {
    expect(typeof claudeAdapter.events).toBe('function');
    expect(customAdapter.events).toBeUndefined();
  });

  test('runExecutor: onEvent nhận sự kiện theo dòng stdout; onEvent ném lỗi không làm hỏng job', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-events-'));
    try {
      const bin = join(dir, 'fake-claude.sh');
      writeFileSync(bin, `#!/bin/sh\ncat '${fixture}'\n`);
      chmodSync(bin, 0o755);
      const exec = { kind: 'claude', bin, model: 'claude-sonnet-5-5', extraArgs: [], timeoutMin: 1 } as any;
      const base = { cwd: '/w', jobDir: dir, promptFile: join(dir, 'p.md'), prompt: 'P', mcpConfigFile: join(dir, 'mcp.json'), exec };
      const got: ActivityEvent[] = [];
      const r = await runExecutor({ ...base, cwd: dir, onEvent: (e) => got.push(e) }, { PATH: process.env.PATH ?? '' });
      expect(r.exitCode).toBe(0);
      expect(got.length).toBe(15);
      expect(got.filter((e) => e.kind === 'command' && e.output).map((e) => e.id)).toEqual(['toolu_bash1', 'toolu_bash2']);
      expect(sessionEnd(r)).toMatchObject({ kind: 'session_end', turns: 9, costUsd: 0.42, model: 'claude-sonnet-5-5', ok: true });

      const bad = await runExecutor({ ...base, cwd: dir, onEvent: () => { throw new Error('gửi lỗi'); } }, { PATH: process.env.PATH ?? '' });
      expect(bad.exitCode).toBe(0);
      expect(bad.turns).toBe(9);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
