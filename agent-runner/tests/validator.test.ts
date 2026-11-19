// Tin đánh thức: parseWake (không gọi mạng) + checkTask / checkChat / checkMeeting (kết quả tool MCP).
import { describe, expect, test } from 'bun:test';
import {
  actedOnTask,
  checkChat,
  checkFollow,
  checkMeeting,
  checkTask,
  parseWake,
  pickStartupTasks,
} from '../src/validator';

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

  test('column_entered (TEST-180): cùng 4 trường như tin việc → job follow, trường thêm bị bỏ qua; tin cũ review_requested / task_done cũng vậy', () => {
    const extra = (event: string) =>
      `"event":"${event}","column_id":"${T}","assignee_code":"NV018","project_code":"TEST","task_code"`;
    const r = parseWake(msg(good.replace('"task_code"', extra('column_entered'))), opts);
    expect(r.ok && r.value).toEqual({
      kind: 'follow',
      employee_code: 'NV120',
      project_id: P,
      task_id: T,
      task_code: 'TEST-45',
    });
    for (const old of ['review_requested', 'task_done']) {
      const legacy = parseWake(msg(good.replace('"task_code"', extra(old))), opts);
      expect(legacy.ok && legacy.value.kind).toBe('follow');
    }
    // vẫn kiểm GUID / mã việc như tin việc
    expect(
      parseWake(
        msg(good.replace('"task_code"', extra('column_entered')).replace(`"task_id":"${T}"`, '"task_id":"x"')),
        opts,
      ).ok,
    ).toBe(false);
  });

  test('checkFollow (TEST-180): còn theo dõi + việc ở cột đánh thức bot theo dõi', () => {
    const w = { project_id: P, task_id: T };
    const base = { id: T, projectId: P, title: 'X', code: 'TEST-45', done: false, columnId: 'c-deploy' };
    const cols = [{ id: 'c-rev', wakeFollowers: true }, { id: 'c-deploy', wakeFollowers: true }, { id: 'c-doing' }];
    const detail = (t: any = {}, followers: any = [{ employeeId: 'me' }], columns: any[] = cols) => ({
      task: { ...base, ...t },
      followers,
      columns,
    });
    expect(checkFollow(detail(), w, 'me')).toEqual({ ok: true, value: { title: 'X', code: 'TEST-45' } });
    // việc đã xong vẫn chạy được nếu cột hoàn thành bật đánh thức
    expect(checkFollow(detail({ done: true }), w, 'me').ok).toBe(true);
    expect(checkFollow(detail({}, [{ employeeId: 'other' }]), w, 'me')).toEqual({
      ok: false,
      reason: 'agent không còn theo dõi việc này',
    });
    expect(checkFollow(detail({}, null), w, 'me').ok).toBe(false);
    // việc đã sang cột không đánh thức (máy chủ bỏ trường false)
    expect(checkFollow(detail({ columnId: 'c-doing' }), w, 'me')).toEqual({
      ok: false,
      reason: 'việc không còn ở cột đánh thức bot theo dõi',
    });
    expect(checkFollow(detail({ projectId: 'khac' }), w, 'me').ok).toBe(false);
    expect(checkFollow(detail({ id: 'khac' }), w, 'me').ok).toBe(false);
    expect(checkFollow(null, w, 'me').ok).toBe(false);
  });

  test('checkFollow: OfficeHub trước TEST-178 (chưa có wakeFollowers) — người review / cột isReview / việc đã xong', () => {
    const w = { project_id: P, task_id: T };
    const base = { id: T, projectId: P, title: 'X', code: 'TEST-45', done: false, columnId: 'c-rev' };
    const old = (t: any = {}, followers: any[] = []) => ({
      task: { ...base, ...t },
      followers,
      columns: [{ id: 'c-rev', isReview: true }, { id: 'c-done' }],
    });
    expect(checkFollow(old({ reviewerEmployeeId: 'me' }), w, 'me').ok).toBe(true);
    expect(checkFollow(old({ columnId: 'c-done', done: true }, [{ employeeId: 'me' }]), w, 'me').ok).toBe(true);
    expect(checkFollow(old({ columnId: 'c-done' }, [{ employeeId: 'me' }]), w, 'me').ok).toBe(false);
    expect(checkFollow(old({ reviewerEmployeeId: 'other' }), w, 'me').ok).toBe(false);
  });

  test('actedOnTask (TEST-180): bình luận / thao tác MỚI của chính agent sau phiên', () => {
    const before = {
      comments: [{ id: 'c1', authorName: 'Bot Thử', byBot: true }],
      activities: [{ id: 'a1', actorName: 'Bot Thử', byBot: true }],
    };
    // không có gì mới → tự dừng
    expect(actedOnTask(before, before, 'Bot Thử')).toBe(false);
    // bình luận mới của người / bot khác không tính
    const others = {
      ...before,
      comments: [
        ...before.comments,
        { id: 'c2', authorName: 'Người thật', byBot: false },
        { id: 'c3', authorName: 'Bot khác', byBot: true },
        { id: 'c4', authorName: 'Bot Thử', byBot: false }, // cùng tên nhưng không phải qua token AI
      ],
    };
    expect(actedOnTask(before, others, 'Bot Thử')).toBe(false);
    expect(
      actedOnTask(
        before,
        { ...before, comments: [...before.comments, { id: 'c5', authorName: 'Bot Thử', byBot: true }] },
        'Bot Thử',
      ),
    ).toBe(true);
    // kéo lùi việc (lịch sử Moved) cũng tính
    expect(
      actedOnTask(
        before,
        { ...before, activities: [...before.activities, { id: 'a2', actorName: 'Bot Thử', byBot: true }] },
        'Bot Thử',
      ),
    ).toBe(true);
    // không đọc được kết quả sau phiên / không biết tên → coi như có (vẫn bình luận chi phí)
    expect(actedOnTask(before, undefined, 'Bot Thử')).toBe(true);
    expect(actedOnTask(before, before, undefined)).toBe(true);
    expect(actedOnTask(undefined, { comments: [{ id: 'c1', authorName: 'Bot Thử', byBot: true }] }, 'Bot Thử')).toBe(
      true,
    );
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
    // TEST-164: mã việc liên quan cho prompt — chỉ mã đúng dạng, không tên
    const related = checkTask(
      {
        ...d({}, [{ code: 'TEST-41', done: true }, { code: 'xấu; rm -rf', done: true }, { done: true }]),
        blocks: [{ code: 'TEST-50', done: false }],
      },
      w,
      'me',
    );
    expect(related.ok && related.value).toEqual({
      title: 'X',
      code: 'TEST-45',
      dependsOn: ['TEST-41'],
      blocks: ['TEST-50'],
    });
    expect(checkTask(d({}), w, 'me')).toEqual({
      ok: true,
      value: { title: 'X', code: 'TEST-45', dependsOn: [], blocks: [] },
    });
  });
});

describe('pickStartupTasks (TEST-158): việc bắt bù lúc khởi động', () => {
  const P = '01a1cb11-4644-716a-bf4d-8ab17b2f159b';
  const id = (n: number) => `01a1ced9-0a22-713a-b89d-${String(n).padStart(12, '0')}`;
  const row = (n: number, over: Record<string, unknown> = {}) => ({
    id: id(n),
    projectId: P,
    code: `TEST-${n}`,
    waitingOn: 0,
    awaitingHuman: false,
    projectActive: true,
    ...over,
  });

  test('giữ việc cần làm theo đúng thứ tự máy chủ trả; đếm việc bị bỏ theo lý do', () => {
    const r = pickStartupTasks([
      row(3),
      row(1, { awaitingHuman: true }),
      row(2, { waitingOn: 2 }),
      row(5, { projectActive: false }),
      row(4),
      { id: 'khong-phai-guid', projectId: P, code: 'TEST-9', awaitingHuman: false, projectActive: true },
      null,
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.tasks).toEqual([
      { id: id(3), projectId: P, code: 'TEST-3' },
      { id: id(4), projectId: P, code: 'TEST-4' },
    ]);
    expect(r.value).toMatchObject({ total: 7, awaitingHuman: 1, blocked: 1, inactive: 1, invalid: 2 });
  });

  test('dự án không chạy / còn chờ việc khác được xét trước awaitingHuman; thiếu projectActive → không chạy', () => {
    const r = pickStartupTasks([
      row(1, { projectActive: false, awaitingHuman: true }),
      row(2, { projectActive: undefined }),
      row(3, { waitingOn: undefined }),
    ]);
    expect(r.ok && r.value).toMatchObject({ tasks: [{ code: 'TEST-3' }], inactive: 2, awaitingHuman: 0 });
  });

  test('OfficeHub bản cũ (không có awaitingHuman) → không đạt, không đoán', () => {
    const r = pickStartupTasks([row(1), row(2, { awaitingHuman: undefined })]);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining('bản cũ') });
  });

  test('không phải danh sách → không đạt; danh sách rỗng → không có việc', () => {
    expect(pickStartupTasks('lỗi').ok).toBe(false);
    expect(pickStartupTasks(undefined).ok).toBe(false);
    expect(pickStartupTasks([])).toEqual({
      ok: true,
      value: { tasks: [], total: 0, awaitingHuman: 0, blocked: 0, inactive: 0, invalid: 0 },
    });
  });
});
