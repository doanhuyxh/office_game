// Định dạng dòng log (json / pretty).
import { describe, expect, test } from 'bun:test';
import { ConfigError, parseConfig } from '../src/config';
import { formatLine } from '../src/log';
import { baseRaw } from './fixtures/config';

describe('định dạng log', () => {
  const t = new Date(2026, 10, 12, 10, 21, 7);
  test('json: một dòng JSON đủ trường', () => {
    const o = JSON.parse(formatLine('info', 'xong job', { job: 3, agent: 'NV120', ok: true }, 'json', false, t));
    expect(o).toMatchObject({ level: 'info', msg: 'xong job', job: 3, agent: 'NV120', ok: true });
  });
  test('pretty: giờ + agent + việc + job, thao tác có ký hiệu, trường còn lại dạng khoá=giá trị', () => {
    const f = { job: 3, agent: 'NV120', task: 'TEST-45' };
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Sửa src/a.ts' }, 'pretty', false, t)).toBe(
      '10:21:07 NV120 TEST-45 #3    ✎ Sửa src/a.ts',
    );
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Chạy: bun test' }, 'pretty', false, t)).toContain(
      '$ bun test',
    );
    expect(formatLine('info', 'agent đang làm', { ...f, action: 'Model claude-opus-5-5' }, 'pretty', false, t)).toBe(
      '10:21:07 NV120 TEST-45 #3    ▶ claude-opus-5-5',
    );
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
