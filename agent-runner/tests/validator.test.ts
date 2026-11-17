// Tin đánh thức: parseWake (không gọi mạng) + checkTask / checkChat / checkMeeting (kết quả tool MCP).
import { describe, expect, test } from 'bun:test';
import { checkChat, checkMeeting, checkTask, parseWake } from '../src/validator';

describe('validator', () => {
  const opts = { groupChatId: '-1001234567890', employeeCode: 'NV120' };
  const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b',
    T = '01a1ced9-0a22-713a-b89d-cbd02c09c92d';
  const msg = (text: string, over: any = {}) => ({
    message_id: 1,
    date: 0,
    chat: { id: -1001234567890, type: 'supergroup' },
    from: { id: 9, is_bot: true, username: 'OfficeHub_Notify_Bot' },
    text,
    ...over,
  });
  const good = `@agent_dev01_bot\n{"employee_code":"NV120","project_id":"${P}","task_id":"${T}","task_code":"TEST-45"}`;

  test('chỉ cần nhóm + mã nhân viên khớp: người gửi / dòng nhắc bot không quan trọng', () => {
    for (const m of [
      msg(good, { from: { id: 1, is_bot: false, username: 'nguoi_that' } }),
      msg(good.replace('@agent_dev01_bot', '@agent_dev02_bot')),
      msg(good, { from: undefined }),
      msg(good.split('\n')[1]!),
    ])
      expect(parseWake(m as any, opts).ok).toBe(true);
  });

  test('tin đúng', () => {
    const r = parseWake(msg(good), opts);
    expect(r.ok && r.value.kind === 'task' && r.value.task_code).toBe('TEST-45');
    // tin việc có event (assigned / returned / ready / mentioned) vẫn đi luồng việc
    const ev = parseWake(msg(good.replace('"task_code"', '"event":"returned","task_code"')), opts);
    expect(ev.ok && ev.value.kind).toBe('task');
  });

  test('chat_mention (TEST-81): chỉ cần employee_code + conversation_id + message_id', () => {
    const C = '01A1D000-0000-7000-8000-00000000C0DE',
      M = '01a1d000-0000-7000-8000-00000000beef';
    const chat = (o: any = {}) =>
      msg(JSON.stringify({ employee_code: 'NV120', event: 'chat_mention', conversation_id: C, message_id: M, ...o }));
    const r = parseWake(chat(), opts);
    expect(r.ok && r.value).toEqual({
      kind: 'chat',
      employee_code: 'NV120',
      conversation_id: C.toLowerCase(),
      message_id: M,
    });
    const bad = (m: any) => {
      const x = parseWake(m, opts);
      return x.ok ? '' : x.reason;
    };
    expect(bad(chat({ employee_code: 'NV999' }))).toContain('không phải của agent');
    expect(bad(chat({ message_id: undefined }))).toContain('thiếu trường');
    expect(bad(chat({ conversation_id: 'office' }))).toContain('không phải GUID');
    expect(bad(chat({ event: 'chat_mention_x' }))).toContain('thiếu trường'); // event lạ không có trường việc → bỏ
  });

  test('meeting_turn (TEST-84): employee_code + session_id + conversation_id; checkMeeting đúng phiên + đang giữ lượt', () => {
    const SS = '01A1D500-0000-7000-8000-0000000000AA',
      C = '01a1d500-0000-7000-8000-0000000000bb';
    const turn = (o: any = {}) =>
      msg(JSON.stringify({ employee_code: 'NV120', event: 'meeting_turn', session_id: SS, conversation_id: C, ...o }));
    const r = parseWake(turn(), opts);
    expect(r.ok && r.value).toEqual({
      kind: 'meeting',
      employee_code: 'NV120',
      session_id: SS.toLowerCase(),
      conversation_id: C,
    });
    const bad = (m: any) => {
      const x = parseWake(m, opts);
      return x.ok ? '' : x.reason;
    };
    expect(bad(turn({ employee_code: 'NV121' }))).toContain('không phải của agent');
    expect(bad(turn({ session_id: undefined }))).toContain('thiếu trường');
    expect(bad(turn({ session_id: 'abc' }))).toContain('không phải GUID');

    const m = (o: any = {}) => ({ inMeeting: true, sessionId: SS.toLowerCase(), isMyTurn: true, isChair: true, ...o });
    expect(checkMeeting(m(), SS)).toEqual({ ok: true, value: { isChair: true } });
    expect(checkMeeting(m({ isMyTurn: false }), SS)).toEqual({ ok: false, reason: 'không phải lượt của agent' });
    expect(checkMeeting(m({ sessionId: C }), SS)).toEqual({ ok: false, reason: 'agent đang dự cuộc họp khác' });
    expect(checkMeeting({ inMeeting: false }, SS).ok).toBe(false);
    expect(checkMeeting(null, SS).ok).toBe(false);
  });

  test('checkChat: còn tin nhắc chưa đọc mới chạy; kênh office không lộ id', () => {
    const C = '01a1d000-0000-7000-8000-00000000c0de';
    const list = (o: any[]) => o;
    expect(checkChat(list([{ conversation: C, type: 'room', mentionedUnread: 2 }]), C.toUpperCase())).toEqual({
      ok: true,
      value: { conversation: C },
    });
    expect(checkChat(list([{ conversation: C, type: 'room', mentionedUnread: 0, unread: 5 }]), C)).toEqual({
      ok: false,
      reason: 'không còn tin nhắc chưa đọc',
    });
    expect(checkChat(list([{ conversation: 'office', type: 'office', mentionedUnread: 1 }]), C)).toEqual({
      ok: true,
      value: { conversation: 'office' },
    });
    expect(checkChat(list([{ conversation: 'khac', mentionedUnread: 3 }]), C)).toEqual({
      ok: false,
      reason: 'agent không ở trong hội thoại này',
    });
    expect(checkChat('lỗi', C).ok).toBe(false);
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
    const d = (t: any, dependsOn: any[] = []) => ({
      task: { id: T, projectId: P, assigneeEmployeeId: 'me', done: false, title: 'X', code: 'TEST-45', ...t },
      dependsOn,
    });
    expect(checkTask(d({}), w, 'me').ok).toBe(true);
    expect(checkTask(d({ assigneeEmployeeId: 'other' }), w, 'me')).toEqual({
      ok: false,
      reason: 'việc không còn giao cho agent này',
    });
    expect(checkTask(d({ done: true }), w, 'me').ok).toBe(false);
    expect(checkTask(d({ projectId: 'khac' }), w, 'me').ok).toBe(false);
    const waiting = checkTask(
      d({}, [
        { code: 'TEST-41', done: true },
        { code: 'TEST-42', done: false },
      ]),
      w,
      'me',
    );
    expect(waiting.ok === false && waiting.reason).toBe('việc còn chờ TEST-42');
    expect(checkTask(null, w, 'me').ok).toBe(false);
  });
});
