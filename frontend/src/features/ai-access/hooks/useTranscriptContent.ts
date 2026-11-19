import { useCallback, useEffect, useRef, useState } from 'react';
import { agentTranscriptApi } from '../api/agentTranscript.api';
import type { IAgentTranscript } from '../types/agentTranscript.types';
import { TranscriptParser, type ITranscriptTurn } from '../utils/transcriptParse';

export type TranscriptContentState =
  | { status: 'loading'; loaded: number; total: number; turns: number }
  | { status: 'done'; turns: ITranscriptTurn[]; bytes: number; ms: number }
  | { status: 'error'; error: unknown; stage: 'fetch' | 'read' };

/** Ghép lại chunk đầu đã đọc để dò định dạng với phần còn lại của luồng. */
function prepend(first: Uint8Array, reader: ReadableStreamDefaultReader<Uint8Array>, onBytes: (n: number) => void): ReadableStream<Uint8Array> {
  let sentFirst = false;
  return new ReadableStream<Uint8Array>({
    async pull(ctl) {
      if (!sentFirst) {
        sentFirst = true;
        ctl.enqueue(first);
        return;
      }
      const { done, value } = await reader.read();
      if (done) ctl.close();
      else {
        onBytes(value.byteLength);
        ctl.enqueue(value);
      }
    },
    cancel: (r) => reader.cancel(r),
  });
}

const PROGRESS_EVERY_MS = 120;

/**
 * Tải + giải nén + tách dòng transcript THEO LUỒNG ngay trên trình duyệt (TEST-197): `fetch` (cookie) → `DecompressionStream('gzip')` →
 * `TextDecoderStream` → {@link TranscriptParser}. Không dùng React Query / localStorage: dữ liệu chỉ sống trong component đang mở — đóng bảng
 * xem (unmount) là bỏ. `enabled = false` → không tải (vd file vượt ngưỡng chưa bấm "Vẫn mở"). Huỷ request khi đóng / tải lại.
 * Server trả `application/gzip` không kèm `Content-Encoding`; nếu proxy đã tự giải nén (không thấy byte đầu 1f 8b) thì đọc thẳng chữ.
 */
export function useTranscriptContent(t: Pick<IAgentTranscript, 'id' | 'sizeBytes'>, enabled: boolean) {
  const [state, setState] = useState<TranscriptContentState>({ status: 'loading', loaded: 0, total: t.sizeBytes, turns: 0 });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((a) => a + 1), []);
  const started = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const ctrl = new AbortController();
    let cancelled = false;
    started.current = performance.now();
    setState({ status: 'loading', loaded: 0, total: t.sizeBytes, turns: 0 });

    (async () => {
      let res: Response;
      try {
        res = await agentTranscriptApi.open(t.id, ctrl.signal);
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error, stage: 'fetch' });
        return;
      }
      const total = Number(res.headers.get('content-length')) || t.sizeBytes;
      let loaded = 0;
      const parser = new TranscriptParser();
      try {
        if (!res.body) throw new Error('Trình duyệt không đọc được luồng dữ liệu');
        const reader = res.body.getReader();
        const head = await reader.read();
        const first = head.value ?? new Uint8Array();
        loaded = first.byteLength;
        let bytes = prepend(first, reader, (n) => { loaded += n; });
        if (first[0] === 0x1f && first[1] === 0x8b) bytes = bytes.pipeThrough(new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>);
        const text = bytes.pipeThrough(new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>).getReader();
        let rest = '';
        let last = 0;
        for (;;) {
          const { done, value } = await text.read();
          if (cancelled) return;
          if (done) break;
          const parts = (rest + value).split('\n');
          rest = parts.pop() ?? '';
          for (const l of parts) parser.push(l);
          const now = performance.now();
          if (now - last > PROGRESS_EVERY_MS) {
            last = now;
            setState({ status: 'loading', loaded, total, turns: parser.turns.length });
          }
        }
        if (rest) parser.push(rest);
        if (!cancelled) setState({ status: 'done', turns: parser.turns, bytes: loaded, ms: Math.round(performance.now() - started.current) });
      } catch (error) {
        if (!cancelled) setState({ status: 'error', error, stage: 'read' });
      }
    })();

    return () => {
      cancelled = true;
      ctrl.abort();
    };
  }, [t.id, t.sizeBytes, enabled, attempt]);

  return { state, retry };
}
