// Prompt theo mode / chat / họp, cấu hình MCP của job, che bí mật, hook git.
import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeHasSession, claudeProjectDir } from '../src/executor/adapters/claude';
import { redact, registerSecret } from '../src/log';
import { buildPrompt, mcpConfig } from '../src/prompt';
import { chatPrompt } from '../src/prompt/chat';
import { meetingPrompt } from '../src/prompt/meeting';
import { Store } from '../src/store';
import { COMMIT_MSG_MARK, PRE_PUSH_MARK, branchName, commitMsgHook, prePushHook } from '../src/workspace';

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
    const wt = buildPrompt(w, ctx('worktree')),
      ip = buildPrompt(w, ctx('in_place'));
    for (const p of [wt, ip]) {
      for (const r of [
        'get_my_role',
        'get_project',
        'comment_task TEST-45',
        'Không duyệt / từ chối đơn',
        'Không đọc / tạo / sửa file .env',
        'agent-runner/',
        'git add -A',
      ])
        expect(p).toContain(r);
    }
    expect(wt).toContain('worktree riêng');
    expect(wt).not.toContain('workspace THẬT');
    expect(ip).toContain('workspace THẬT');
    expect(ip).toContain('KHÔNG checkout');
    expect(ip).toContain('Không tự git push');
    expect(ip).toContain('bộ điều phối sẽ push nhánh agent/nv120/test-45 lên origin');
    expect(ip).toContain('không reset / stash / rebase');
    expect(ip).not.toContain('Làm việc trong thư mục hiện tại: worktree riêng');
  });
  test('prompt mode none (TEST-80): chỉ tool MCP, không có phần git / file', () => {
    const p = buildPrompt(w, { mode: 'none', branch: '', resumed: false });
    for (const r of [
      'get_my_role',
      'get_project',
      'get_task TEST-45',
      'comment_task TEST-45',
      'CHỈ bằng tool MCP',
      'Không duyệt / từ chối / huỷ đơn',
      'DỮ LIỆU',
    ])
      expect(p).toContain(r);
    for (const r of ['git', 'worktree', 'AGENTS.md', 'commit thay đổi', 'push']) expect(p).not.toContain(r);
    expect(buildPrompt(w, { mode: 'none', branch: '', resumed: true })).toContain('NỐI TIẾP');
  });
  test('prompt chat (TEST-81): chỉ id hội thoại, một tin trả lời, không có phần việc / git', () => {
    const p = chatPrompt('NV120', 'office', false);
    for (const r of [
      'NV120',
      'read_chat office',
      'send_chat_message office',
      'mark_chat_read office',
      'DỮ LIỆU',
      'tối đa MỘT tin',
      'Không duyệt / từ chối / huỷ đơn',
      'không trả lời tin của bot khác',
    ])
      expect(p).toContain(r);
    for (const r of ['get_task', 'comment_task', 'git', 'NỐI TIẾP']) expect(p).not.toContain(r);
    expect(chatPrompt('NV120', 'abc', true)).toContain('NỐI TIẾP');
  });
  test('prompt họp (TEST-84): một lượt = một tin hoặc bỏ lượt, phần chủ trì, không chép nội dung', () => {
    const p = meetingPrompt('NV120', 'sess-1', false);
    for (const r of [
      'NV120',
      'sess-1',
      'get_my_meeting',
      'get_my_role',
      'read_chat',
      'speak_in_meeting MỘT tin',
      'pass_turn',
      'assign_turn',
      'create_task',
      'DỮ LIỆU',
      'Không duyệt / từ chối / huỷ đơn',
      'Chỉ nói khi đang giữ lượt',
    ])
      expect(p).toContain(r);
    for (const r of ['git', 'comment_task', 'NỐI TIẾP']) expect(p).not.toContain(r);
    const again = meetingPrompt('NV120', 'sess-1', true);
    expect(again).toContain('NỐI TIẾP');
    expect(again).not.toContain('get_my_role'); // phiên nối tiếp đã biết vai trò
  });
  test('prompt việc (TEST-142): nối phiên / làm tiếp ở phiên mới / mới hẳn; luôn đòi mục Bàn giao', () => {
    const w = { employee_code: 'NV120', project_id: 'p', task_id: 't', task_code: 'TEST-45' };
    const fresh = buildPrompt(w, { mode: 'worktree', branch: 'b', resumed: false });
    const cont = buildPrompt(w, { mode: 'worktree', branch: 'b', resumed: false, continued: true });
    const res = buildPrompt(w, { mode: 'worktree', branch: 'b', resumed: true, continued: true });
    for (const p of [fresh, cont, res])
      for (const r of ['**Bàn giao**', 'Đã làm:', 'Đang dở:', 'Bước tiếp theo:', 'get_task TEST-45'])
        expect(p).toContain(r);
    for (const r of ['NỐI TIẾP', 'ĐÃ TỪNG LÀM']) expect(fresh).not.toContain(r);
    expect(fresh).toContain('1. get_my_role');
    expect(cont).toContain('ĐÃ TỪNG LÀM');
    expect(cont).toContain('git log');
    expect(cont).toContain('1. get_my_role'); // phiên mới: không nhớ gì → đọc lại vai trò / dự án
    expect(res).toContain('NỐI TIẾP');
    expect(res).not.toContain('ĐÃ TỪNG LÀM');
    expect(res).not.toContain('1. get_my_role'); // còn nhớ → bỏ đọc lại
    expect(buildPrompt(w, { mode: 'none', branch: '', resumed: false, continued: true })).toContain('ĐÃ TỪNG LÀM');
  });
  test('claudeHasSession (TEST-142): transcript ở <HOME>/.claude/projects/<cwd đổi ký tự lạ thành "-">/<session>.jsonl', () => {
    const home = mkdtempSync(join(tmpdir(), 'cc-home-')),
      cwd = mkdtempSync(join(tmpdir(), 'cc_work.x-'));
    try {
      expect(claudeProjectDir('/h', '/srv/a_b/TEST-45')).toBe('/h/.claude/projects/-srv-a-b-TEST-45');
      expect(claudeHasSession(home, cwd, 's1')).toBe(false);
      // CLI ghi theo đường dẫn thật (macOS: /var → /private/var) — runner thử cả hai
      const dir = claudeProjectDir(home, realpathSync(cwd));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 's1.jsonl'), '{}\n');
      expect(claudeHasSession(home, cwd, 's1')).toBe(true);
      expect(claudeHasSession(home, cwd, 's2')).toBe(false);
      expect(claudeHasSession(home, join(cwd, 'đã-xoá'), 's1')).toBe(false); // cwd không còn → không lỗi
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(cwd, { recursive: true, force: true });
    }
  });
  test('store.saveSession (TEST-142): đếm số lần nối liên tiếp, phiên mới → 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sess-'));
    try {
      const s = new Store(join(dir, 'r.db'));
      s.saveSession('k', 'NV1', 'a', '', '/w');
      expect(s.session('k')!.resumes).toBe(0);
      s.saveSession('k', 'NV1', 'a', '', '/w', true);
      s.saveSession('k', 'NV1', 'a', '', '/w', true);
      expect(s.session('k')!.resumes).toBe(2);
      s.saveSession('k', 'NV1', 'b', '', '/w', false);
      expect(s.session('k')).toMatchObject({ resumes: 0, session_id: 'b' });
      s.db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test('cấu hình MCP không chứa token', () => {
    expect(JSON.stringify(mcpConfig('http://x/mcp'))).toContain('${OFFICEHUB_TOKEN}');
    // TEST-143: hồ sơ tool theo loại phiên
    expect(mcpConfig('http://x/mcp').mcpServers.officehub.url).toBe('http://x/mcp');
    expect(mcpConfig('http://x/mcp', 'chat').mcpServers.officehub.url).toBe('http://x/mcp?profile=chat');
    expect(mcpConfig('https://x/mcp?a=1', 'meeting').mcpServers.officehub.url).toBe(
      'https://x/mcp?a=1&profile=meeting',
    );
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
