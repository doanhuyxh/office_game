// Store (runner.db): hàng đợi, khoá job, phiên, báo cáo chi phí, migration.
import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/store';

describe('store', () => {
  test('khoá task_id, FIFO, mỗi agent 1, tổng ≤ max, khôi phục', () => {
    const s = new Store(':memory:');
    const a = s.enqueue('NV1', 't1', 'A-1', 'p')!,
      b = s.enqueue('NV1', 't2', 'A-2', 'p')!,
      c = s.enqueue('NV2', 't3', 'A-3', 'p')!;
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

  test('job chat (TEST-81): khoá theo hội thoại, đang chạy → đánh dấu rerun, vẫn mỗi agent 1 phiên', () => {
    const s = new Store(':memory:');
    const t = s.enqueue('NV1', 't1', 'A-1', 'p')!,
      c = s.enqueue('NV1', 'conv1', 'chat:conv1', '', 'chat')!;
    expect(s.getJob(t)!.kind).toBe('task');
    expect(s.getJob(c)!.kind).toBe('chat');
    expect(s.enqueue('NV1', 'conv1', 'chat:conv1', '', 'chat')).toBeNull(); // đang chờ → gộp, không cần rerun
    expect(s.getJob(c)!.rerun).toBeNull();
    expect(s.claimNext(2, ['NV1'])!.id).toBe(t);
    expect(s.claimNext(2, ['NV1'])).toBeNull(); // agent đang làm việc → chat chờ (mỗi agent 1 phiên)
    expect(s.enqueue('NV1', 't1', 'A-1', 'p')).toBeNull();
    expect(s.getJob(t)!.rerun).toBe(1); // việc đang chạy cũng đánh dấu rerun (tin mới giữa phiên không rơi)
    s.requeue(t, 'runner dừng');
    expect(s.getJob(t)!.rerun).toBeNull(); // về hàng đợi → lúc chạy đọc trạng thái mới, bỏ rerun
    expect(s.claimNext(2, ['NV1'])!.id).toBe(t);
    s.enqueue('NV1', 't1', 'A-1', 'p');
    s.hold(t, new Date(0).toISOString(), 'đang họp');
    expect(s.getJob(t)!.rerun).toBeNull();
    expect(s.claimNext(2, ['NV1'])!.id).toBe(t);
    s.enqueue('NV1', 't1', 'A-1', 'p');
    expect(s.recoverRunning()).toBe(1);
    expect(s.getJob(t)!.rerun).toBeNull();
    expect(s.claimNext(2, ['NV1'])!.id).toBe(t);
    s.finish(t, 'done');
    expect(s.claimNext(2, ['NV1'])!.id).toBe(c);
    expect(s.enqueue('NV1', 'conv1', 'chat:conv1', '', 'chat')).toBeNull(); // đang chạy → rerun
    expect(s.getJob(c)!.rerun).toBe(1);
    s.finish(c, 'done', { cost_usd: 0.2 });
    expect(s.costsByKind('2000-01-01')).toMatchObject([
      { kind: 'chat', jobs: 1, cost: 0.2 },
      { kind: 'task', jobs: 1, cost: null },
    ]);
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
      old.run(
        `INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at, finished_at, cost_usd) VALUES ('NV1', 't0', 'A-0', 'p', 'done', '2026', '2026-11-01', 2)`,
      );
      old.close();
      const s = new Store(path);
      const a = s.enqueue('NV1', 't1', 'A-1', 'p')!,
        b = s.enqueue('NV1', 't2', 'A-2', 'p')!;
      s.finish(a, 'done', {
        cost_usd: 1,
        model: 'claude-opus-5-5',
        model_usage: JSON.stringify({ 'claude-opus-5-5': { costUsd: 1 } }),
      });
      s.finish(b, 'done', { cost_usd: 0.5, model: 'claude-opus-5-5' });
      expect(s.getJob(a)).toMatchObject({ model: 'claude-opus-5-5' });
      expect(JSON.parse(s.getJob(a)!.model_usage!)).toEqual({ 'claude-opus-5-5': { costUsd: 1 } });
      expect(s.costsByModel('2000-01-01')).toEqual([
        { agent: 'NV1', kind: 'task', model: null, jobs: 1, cost: 2, input: null, output: null },
        { agent: 'NV1', kind: 'task', model: 'claude-opus-5-5', jobs: 2, cost: 1.5, input: null, output: null },
      ]);
      s.db.close();
      new Store(path).db.close(); // mở lại: cột đã có, không ALTER lần nữa
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('migration theo user_version: DB cũ được nâng cấp một lần, job cũ kind trống → task, bản runner cũ vẫn đọc được; DB mới hơn → từ chối', () => {
    const dir = mkdtempSync(join(tmpdir(), 'runner-db-'));
    try {
      const path = join(dir, 'runner.db');
      const { Database } = require('bun:sqlite');
      // runner.db bản đầu (chưa có user_version, chưa có cột kind / model …) với một job việc và một phiên
      const old = new Database(path, { create: true });
      old.exec(`CREATE TABLE jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, agent TEXT NOT NULL, task_id TEXT NOT NULL, task_code TEXT NOT NULL, project_id TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
        session_id TEXT, cost_usd REAL, input_tokens INTEGER, output_tokens INTEGER, turns INTEGER, pr_url TEXT);
        CREATE TABLE task_sessions (task_id TEXT PRIMARY KEY, agent TEXT NOT NULL, session_id TEXT, branch TEXT NOT NULL, worktree TEXT NOT NULL, updated_at TEXT NOT NULL)`);
      old.run(
        `INSERT INTO jobs (agent, task_id, task_code, project_id, status, created_at) VALUES ('NV1', 't0', 'A-0', 'p', 'queued', '2026')`,
      );
      old.run(`INSERT INTO task_sessions VALUES ('t0', 'NV1', 'sess-old', 'agent/nv1/a-0', '/w', '2026-11-01')`);
      old.close();

      const s = new Store(path);
      const version = () => s.db.query<{ user_version: number }, []>('PRAGMA user_version').get()!.user_version;
      expect(version()).toBe(3);
      // trong mã: key / label; cột trong DB vẫn là task_id / task_code
      expect(s.getJob(1)).toMatchObject({ key: 't0', label: 'A-0', kind: 'task', status: 'queued' });
      expect(s.session('t0')).toMatchObject({
        key: 't0',
        agent: 'NV1',
        session_id: 'sess-old',
        resumes: null,
        cleaned_at: null,
      });
      expect(s.claimNext(1, ['NV1'])).toMatchObject({ id: 1, key: 't0', label: 'A-0', kind: 'task' });
      expect(s.enqueue('NV1', 't0', 'A-0', 'p')).toBeNull(); // khoá vẫn chặn job trùng
      // bản runner cũ đọc bằng tên cột gốc vẫn được (migration không đổi tên / xoá cột)
      expect(s.db.query<any, []>(`SELECT task_id, task_code, kind FROM jobs WHERE id = 1`).get()).toEqual({
        task_id: 't0',
        task_code: 'A-0',
        kind: 'task',
      });
      s.db.close();

      const again = new Store(path); // mở lại: đã ở phiên bản mới nhất, không chạy lại bước nào
      expect(again.getJob(1)?.status).toBe('running');
      again.db.exec('PRAGMA user_version = 99');
      again.db.close();
      expect(() => new Store(path)).toThrow('mới hơn bản runner này');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
