// TEST-144: transcript phiên agent lên cloud — che bí mật giữ JSON hợp lệ, gửi / thay, lỗi theo mã, khôi phục lười đúng một phiên.
// Máy chủ giả: Bun.serve lưu một bản / (key) như Api.
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claudeProjectDir } from '../src/executor/adapters/claude';
import { registerSecret } from '../src/log';
import { Store } from '../src/store';
import { TranscriptReporter, redactTranscript, sha256Hex, transcriptFile } from '../src/hub/transcript';

const root = mkdtempSync(join(tmpdir(), 'runner-transcript-'));
const TOKEN = 'ohk_transcript_test_token';
registerSecret(TOKEN);

let mode: 'ok' | '400' | '401' | '404' = 'ok';
const saved = new Map<string, any>();
const posts: any[] = [];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname !== '/mcp/transcripts') return new Response(null, { status: 404 });
    if (mode === '401') return new Response(null, { status: 401 });
    if (mode === '404') return new Response('Not Found', { status: 404 });
    if (req.method === 'GET') {
      const t = saved.get(url.searchParams.get('key') ?? '');
      return t ? Response.json(t) : Response.json({ detail: 'Chưa có' }, { status: 404 });
    }
    const b = (await req.json()) as any;
    posts.push(b);
    if (mode === '400') return Response.json({ detail: 'sai' }, { status: 400 });
    const gz = Buffer.from(b.contentBase64, 'base64');
    const dto = {
      key: b.key,
      kind: b.kind,
      sessionId: b.sessionId,
      sha256: sha256Hex(gz),
      updatedAt: new Date().toISOString(),
      contentBase64: b.contentBase64,
    };
    saved.set(b.key, dto);
    return Response.json({ ...dto, contentBase64: null });
  },
});
afterAll(() => {
  server.stop();
  rmSync(root, { recursive: true, force: true });
});

let store: Store,
  home: string,
  cwd: string,
  n = 0;
beforeEach(() => {
  n++;
  store = new Store(join(root, `r${n}.db`));
  home = join(root, `home${n}`);
  cwd = join(root, `work${n}`);
  mkdirSync(cwd, { recursive: true });
  mode = 'ok';
  saved.clear();
  posts.length = 0;
});
const reporter = () => new TranscriptReporter(`http://localhost:${server.port}/mcp`, TOKEN, 'NV120', store, home);
/** Phiên vừa chạy: transcript ở HOME/.claude/projects/<cwd>, dòng task_sessions + hàng chờ. */
const session = (key: string, sid: string, lines: object[], kind = 'task') => {
  const dir = claudeProjectDir(home, realpathSync(cwd));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.jsonl`), lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  store.saveSession(key, 'NV120', sid, 'agent/nv120/test-45', cwd);
  store.markTranscript(key, kind, 'Đã làm: sửa nút. Đang dở: không. Bước tiếp theo: review.');
};

describe('che bí mật', () => {
  test('che từng chuỗi trong JSON — dòng vẫn là JSON hợp lệ; dòng không phải JSON che cả dòng', () => {
    const out = redactTranscript(
      [
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'tool_result', content: 'DB_PASSWORD=hunter2\nAPI_KEY=abc123' }] },
          n: 5,
        }),
        JSON.stringify({
          type: 'assistant',
          text: `dùng ${TOKEN} và Bearer eyJhbGciOiJIUzI1NiJ9.x.y`,
          token: 'sk-thật',
        }),
        'không phải json password=lo',
        '',
      ].join('\n'),
    );
    const lines = out.split('\n');
    const a = JSON.parse(lines[0]!),
      b = JSON.parse(lines[1]!);
    expect(a.n).toBe(5);
    expect(a.message.content[0].content).not.toContain('hunter2');
    expect(a.message.content[0].content).not.toContain('abc123');
    expect(b.text).not.toContain(TOKEN);
    expect(b.text).toContain('Bearer ***');
    expect(b.token).toBe('sk-thật'); // tên khoá JSON không phải nội dung "token=…" — chỉ che chuỗi có mẫu bí mật
    expect(lines[2]).toBe('không phải json password=***');
  });
});

describe('gửi', () => {
  test('gửi bản đã che + gzip, sha256; không đổi thì không gửi lại; đổi thì thay', async () => {
    session('T1', 's-1', [
      { type: 'user', text: `token=${TOKEN}` },
      { type: 'assistant', text: 'xong' },
    ]);
    const r = reporter();
    expect(await r.flush()).toBe(1);
    const p = posts[0];
    expect(p).toMatchObject({ key: 'T1', kind: 'task', sessionId: 's-1', cwd, branch: 'agent/nv120/test-45' });
    expect(p.summary).toContain('Bước tiếp theo');
    const text = Buffer.from(Bun.gunzipSync(Buffer.from(p.contentBase64, 'base64'))).toString();
    expect(text).not.toContain(TOKEN);
    expect(
      text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l).type),
    ).toEqual(['user', 'assistant']); // vẫn đọc được để --resume
    expect(store.session('T1')).toMatchObject({
      transcript_pending: 0,
      transcript_sha: sha256Hex(Buffer.from(p.contentBase64, 'base64')),
    });
    // Đánh dấu lại nhưng file không đổi → không gửi
    store.markTranscript('T1', 'task', null);
    expect(await r.flush()).toBe(0);
    expect(posts.length).toBe(1);
    // Phiên nối tiếp ghi thêm → gửi bản mới (máy chủ thay)
    session('T1', 's-1', [
      { type: 'user', text: 'a' },
      { type: 'assistant', text: 'b' },
      { type: 'user', text: 'lần 2' },
    ]);
    expect(await r.flush()).toBe(1);
    expect(saved.size).toBe(1);
  });

  test('không còn file → bỏ (ghi lỗi); 400 → bỏ; 404 → giữ chờ; 401 → ngừng', async () => {
    store.saveSession('X', 'NV120', 'mất', '', cwd);
    store.markTranscript('X', 'chat', null);
    expect(await reporter().flush()).toBe(0);
    expect(store.session('X')!.transcript_error).toContain('không còn file');

    session('T2', 's-2', [{ type: 'user' }]);
    mode = '404';
    const r = reporter();
    expect(await r.flush()).toBe(0);
    expect(store.session('T2')!.transcript_pending).toBe(1); // thử lại ở nhịp sau
    mode = '400';
    expect(await r.flush()).toBe(0);
    expect(store.session('T2')).toMatchObject({ transcript_pending: 0, transcript_error: 'OfficeHub từ chối (400)' });

    session('T3', 's-3', [{ type: 'user' }]);
    mode = '401';
    expect(await r.flush()).toBe(0);
    expect(r.isDisabled).toBe(true);
    mode = 'ok';
    expect(await r.flush()).toBe(0);
    expect(store.session('T3')!.transcript_pending).toBe(1);
  });
});

describe('khôi phục lười', () => {
  test('máy mới: tải đúng phiên, ghi vào thư mục transcript của cwd; quá 10 phút / lệch sha / chưa có → phiên mới', async () => {
    session(
      'T4',
      's-4',
      [
        { type: 'user', text: 'việc cũ' },
        { type: 'assistant', text: 'đang dở' },
      ],
      'meeting',
    );
    await reporter().flush();
    // "Máy mới": HOME khác, chưa có transcript
    home = join(root, `home-new${n}`);
    expect(transcriptFile(home, cwd, 's-4')).toBeUndefined();
    expect(await reporter().restore('T4', cwd)).toBe('s-4');
    const f = transcriptFile(home, cwd, 's-4')!;
    expect(readFileSync(f, 'utf8')).toContain('đang dở');
    // Chưa có trên cloud
    expect(await reporter().restore('KHÔNG-CÓ', cwd)).toBeUndefined();
    // Quá ngưỡng nối phiên → không tải (phiên mới rẻ hơn)
    saved.get('T4').updatedAt = new Date(Date.now() - 11 * 60_000).toISOString();
    rmSync(f);
    expect(await reporter().restore('T4', cwd)).toBeUndefined();
    expect(existsSync(f)).toBe(false);
    // Lệch sha256 → bỏ
    saved.get('T4').updatedAt = new Date().toISOString();
    saved.get('T4').sha256 = '0'.repeat(64);
    expect(await reporter().restore('T4', cwd)).toBeUndefined();
  });
});
