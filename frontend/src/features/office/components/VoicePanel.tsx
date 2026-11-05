import { useEffect, useRef, useState } from 'react';
import type { VoiceClient, VoiceView } from '../api/voiceClient';

/** Thẻ voice ở góc dưới phải: bật / tắt voice, micro (M), chia sẻ màn hình (chỉ phòng họp). */
export function VoicePanel({ voice, view }: { voice: VoiceClient | null; view: VoiceView }) {
  if (!voice) return null;
  const { status, channel, micOn, sharing, peers, needsAudioClick } = view;

  if (status === 'off') {
    return (
      <div className="card voice">
        <button type="button" className="primary" onClick={() => void voice.enable()} data-testid="office-voice-toggle">🎙 Bật voice</button>
        <small>Nói chuyện với người đứng gần, hoặc vào phòng họp để có kênh riêng</small>
      </div>
    );
  }
  return (
    <div className="card voice" data-testid="office-voice" data-status={status} data-channel={channel?.id ?? ''}>
      <div className="title">
        <span className={`dot ${status === 'on' ? 'online' : 'connecting'}`} />
        <b>{channel?.name ?? 'Voice'}</b>
        {status === 'connecting' && <small>đang kết nối…</small>}
      </div>
      {status === 'on' && (
        <small data-testid="office-voice-peers">
          {channel?.meeting ? 'Kênh riêng của phòng' : channel?.id === 'open' ? 'Nghe người trong ~6 m' : 'Kênh riêng · nghe theo khoảng cách'}
          {' · '}{peers === 0 ? 'chưa có ai nghe' : `${peers} người nghe được bạn`}
        </small>
      )}
      {needsAudioClick && <button type="button" className="primary" onClick={() => void voice.resumeAudio()}>🔊 Bấm để nghe âm thanh</button>}
      <div className="row">
        <button type="button" className={micOn ? 'on' : 'off'} onClick={() => void voice.toggleMic()} disabled={status !== 'on'}
          title="Bật / tắt micro (M)" data-testid="office-voice-mic" data-on={micOn}>
          {micOn ? '🎙 Micro bật' : '🔇 Micro tắt'}
        </button>
        {channel?.meeting && (
          <button type="button" className={sharing ? 'on' : ''} onClick={() => void voice.toggleScreen()} disabled={status !== 'on'} title="Chia sẻ màn hình">
            🖥 {sharing ? 'Dừng chia sẻ' : 'Chia sẻ'}
          </button>
        )}
        <button type="button" onClick={() => void voice.disable()} title="Tắt voice" data-testid="office-voice-off">Tắt</button>
      </div>
    </div>
  );
}

/** Màn hình người khác đang chia sẻ trong phòng họp. Bấm để phóng to / thu nhỏ. */
export function ScreenView({ screen }: { screen: VoiceView['screen'] }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [big, setBig] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !screen) return;
    screen.track.attach(el);
    return () => { screen.track.detach(el); };
  }, [screen]);
  if (!screen) return null;
  return (
    <div className={`card screen ${big ? 'big' : ''}`} onClick={() => setBig((b) => !b)} title={big ? 'Thu nhỏ' : 'Phóng to'}>
      <video ref={ref} autoPlay playsInline muted />
      <small>🖥 {screen.name} đang chia sẻ màn hình</small>
    </div>
  );
}
