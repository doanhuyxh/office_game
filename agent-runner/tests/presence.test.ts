// PresenceReporter: trạng thái bot trong văn phòng 3D (đang làm / rảnh / lỗi).
import { describe, expect, test } from 'bun:test';

describe('presence (văn phòng 3D: đang làm / rảnh)', () => {
  test('nhãn thô — không lộ lệnh / đường dẫn / lời agent', async () => {
    const { activityLabel, presenceUrl } = await import('../src/hub/presence');
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
    const { PresenceReporter } = await import('../src/hub/presence');
    const got: any[] = [];
    let status = 204;
    const srv = Bun.serve({
      port: 0,
      async fetch(req) {
        got.push(await req.json());
        return new Response(null, { status });
      },
    });
    const gap = PresenceReporter.minGapMs;
    PresenceReporter.minGapMs = 300;
    try {
      const p = new PresenceReporter(`http://localhost:${srv.port}/mcp`, 'ohk_x', 'NV120');
      p.working('WEB-12', 'Sửa form');
      await Bun.sleep(50);
      p.activity('Đọc a.ts');
      p.activity('Sửa a.ts');
      p.activity('Sửa b.ts');
      await Bun.sleep(50);
      expect(got).toEqual([{ state: 'working', task: 'WEB-12 · Sửa form' }]); // chưa tới nhịp
      await Bun.sleep(400);
      expect(got.at(-1)).toEqual({ state: 'working', task: 'WEB-12 · Sửa form', activity: 'Sửa code' }); // chỉ nhãn mới nhất
      expect(got.length).toBe(2);
      p.idle();
      await Bun.sleep(50);
      expect(got.at(-1)).toEqual({ state: 'idle' });
      p.activity('Đọc a.ts'); // rảnh → bỏ qua thao tác
      status = 403;
      p.working('WEB-13');
      await Bun.sleep(50);
      const n = got.length;
      p.idle();
      await Bun.sleep(50);
      expect(got.length).toBe(n); // đã ngừng báo
      p.stop();
    } finally {
      PresenceReporter.minGapMs = gap;
      srv.stop();
    }
  });
});

test('presence: lỗi job → error gửi ngay, giữ qua idle() và nhịp còn sống, job kế / start() xoá; 400 (máy chủ cũ) → gửi idle (TEST-121)', async () => {
  const { PresenceReporter } = await import('../src/hub/presence');
  const got: any[] = [];
  let rejectError = false;
  const srv = Bun.serve({
    port: 0,
    async fetch(req) {
      const b = (await req.json()) as any;
      got.push(b);
      return new Response(null, { status: rejectError && b.state === 'error' ? 400 : 204 });
    },
  });
  const beat = PresenceReporter.heartbeatMs;
  PresenceReporter.heartbeatMs = 150;
  const logs: string[] = [];
  const orig = console.log,
    origErr = console.error;
  console.log = console.error = (...a: unknown[]) => {
    logs.push(a.join(' '));
  };
  try {
    const p = new PresenceReporter(`http://localhost:${srv.port}/mcp`, 'ohk_x', 'NV018');
    p.working('WEB-12', 'Sửa form');
    await Bun.sleep(30);
    p.error('Hết giờ  ', { task: 'WEB-12 · Sửa form', taskId: 't1', projectId: 'p1' });
    await Bun.sleep(30);
    const err = { state: 'error' as const, task: 'WEB-12 · Sửa form', error: 'Hết giờ', taskId: 't1', projectId: 'p1' };
    expect(got.at(-1)).toEqual(err);
    p.idle(); // finally của job
    p.activity('Đọc a.ts');
    await Bun.sleep(30);
    expect(got.at(-1)).toEqual(err);
    expect(p.state).toEqual(err);
    p.start(); // khởi động: báo rảnh + nhịp
    await Bun.sleep(30);
    expect(got.at(-1)).toEqual({ state: 'idle' });
    p.error('x'.repeat(100)); // chỉ loại lỗi ngắn
    await Bun.sleep(30);
    expect(got.at(-1)).toEqual({ state: 'error', error: 'x'.repeat(40) });
    const n = got.length;
    await Bun.sleep(200); // nhịp còn sống gửi lại lỗi
    expect(got.length).toBeGreaterThan(n);
    expect(got.at(-1)).toEqual({ state: 'error', error: 'x'.repeat(40) });
    p.working('WEB-13'); // job kế → hết lỗi
    await Bun.sleep(30);
    expect(got.at(-1)).toEqual({ state: 'working', task: 'WEB-13' });
    p.error('Lỗi');
    await Bun.sleep(30);
    p.clearError();
    await Bun.sleep(30);
    expect(got.at(-1)).toEqual({ state: 'idle' });

    rejectError = true; // máy chủ bản cũ
    p.error('Hết giờ');
    await Bun.sleep(50);
    expect(got.slice(-2)).toEqual([{ state: 'error', error: 'Hết giờ' }, { state: 'idle' }]);
    expect(p.state).toEqual({ state: 'idle' });
    p.working('WEB-14');
    await Bun.sleep(30);
    p.error('Mã thoát 1');
    await Bun.sleep(50);
    expect(got.at(-1)).toEqual({ state: 'idle' }); // vẫn báo trạng thái
    expect(logs.filter((l) => l.includes('chưa nhận trạng thái lỗi')).length).toBe(1);
    p.stop();
  } finally {
    PresenceReporter.heartbeatMs = beat;
    console.log = orig;
    console.error = origErr;
    srv.stop();
  }
});

test('presenceFailure: loại lỗi ngắn theo kết quả phiên', async () => {
  const { presenceFailure } = await import('../src/jobs/task');
  expect(presenceFailure({ exitCode: 0, timedOut: true, isError: false })).toBe('Hết giờ');
  expect(presenceFailure({ exitCode: 1, timedOut: false, isError: true })).toBe('CLI báo lỗi');
  expect(presenceFailure({ exitCode: 3, timedOut: false, isError: false })).toBe('Mã thoát 3');
});

test('presence: máy chủ chưa có endpoint (405) → ghi log một lần, vẫn thử lại, có lại thì báo chạy lại', async () => {
  const { PresenceReporter } = await import('../src/hub/presence');
  let status = 405,
    hits = 0;
  const srv = Bun.serve({
    port: 0,
    async fetch() {
      hits++;
      return new Response(null, { status });
    },
  });
  const logs: string[] = [];
  const orig = console.log,
    origErr = console.error;
  console.log = console.error = (...a: unknown[]) => {
    logs.push(a.join(' '));
  };
  try {
    const p = new PresenceReporter(`http://localhost:${srv.port}/mcp`, 'ohk_x', 'NV018');
    for (const s of ['a', 'b', 'c']) {
      p.working(s);
      await Bun.sleep(30);
    }
    expect(hits).toBe(3); // không bị tắt như 403
    expect(logs.filter((l) => l.includes('chưa có endpoint')).length).toBe(1);
    status = 204;
    p.idle();
    await Bun.sleep(30);
    expect(logs.some((l) => l.includes('đã chạy lại'))).toBe(true);
    p.stop();
  } finally {
    console.log = orig;
    console.error = origErr;
    srv.stop();
  }
});
