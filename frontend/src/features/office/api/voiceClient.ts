import type { Participant, RemoteParticipant, RemoteTrack, RemoteTrackPublication, Room, TrackPublication } from 'livekit-client';
import { REALTIME } from '@/config/env';
import { ApiError, httpPost } from '@/services/api-client';
import { OFFICE_MAP } from '../engine/officeMap';
import { VOICE_FAR, voiceChannelAt, voiceVolume, type VoiceChannelInfo } from '../engine/voiceChannel';

/** Khớp VoiceTokenResponse (backend/src/OfficeHub.Realtime/Voice/VoiceEndpoints.cs). */
interface VoiceToken { url: string; token: string; room: string; channel: string; meeting: boolean; screen: boolean }

export type VoiceStatus = 'off' | 'connecting' | 'on';
export interface VoiceView {
  status: VoiceStatus;
  /** Kênh đang ở (đã kết nối) — null khi tắt voice. */
  channel: VoiceChannelInfo | null;
  micOn: boolean;
  /** Đang nghe (loa bật). Tắt loa = vẫn trong kênh nhưng không phát âm thanh người khác. */
  speakerOn: boolean;
  sharing: boolean;
  /** Số người nghe thấy mình (khu mở: trong ~6 m; phòng: cả phòng). */
  peers: number;
  /** Trình duyệt chặn phát âm thanh → cần người dùng bấm một lần. */
  needsAudioClick: boolean;
  /** Màn hình người khác đang chia sẻ trong phòng (mới nhất nếu nhiều người cùng chia sẻ). */
  screen: { track: RemoteTrack; name: string } | null;
  /** Số màn hình đang được chia sẻ trong phòng (của người khác). */
  screenCount: number;
  /** Lý do không vào được voice (hiện trên thẻ voice, kèm nút thử lại). */
  error: string | null;
}

export const VOICE_INITIAL: VoiceView = {
  status: 'off', channel: null, micOn: false, speakerOn: true, sharing: false, peers: 0, needsAudioClick: false, screen: null, screenCount: 0, error: null,
};

/** Vị trí lấy từ OfficeScene (identity LiveKit = userId = id người chơi trên hub). */
export interface VoicePositions {
  me(): { x: number; z: number } | null;
  of(id: string): { x: number; z: number } | null;
}

// livekit-client (~400 KB) chỉ tải khi bật voice lần đầu.
type LiveKit = typeof import('livekit-client');
let LK: LiveKit | null = null;
const loadLiveKit = async () => (LK ??= await import('livekit-client'));

const SWITCH_DEBOUNCE = 400; // đứng ở cửa không bị đổi kênh liên tục
const TOKEN_RETRY = 500; // server chưa nhận vị trí mới (Move gửi mỗi 100 ms)
const HYSTERESIS = 1; // m — tránh bật / tắt nhận âm liên tục khi đứng ở rìa 6 m

/**
 * Voice LiveKit cho văn phòng 3D (không phụ thuộc React). Vào văn phòng là tự vào voice ĐỂ NGHE; micro mặc định tắt
 * (chỉ xin quyền micro khi người dùng bật). "Tắt loa" chỉ ngừng phát âm thanh, vẫn giữ kết nối.
 * - Server quyết định room theo vị trí (`POST /rt/voice/token`); client chỉ báo đổi kênh khi đi qua cửa phòng.
 * - Kênh không phải phòng họp: chỉ nhận âm người trong ~6 m, âm lượng giảm theo khoảng cách (`voiceVolume`).
 * - Phòng họp (`voice: "room"`): nghe cả phòng.
 * - Mọi phòng có tường: chia sẻ màn hình — chỉ người đang ở trong phòng (cùng room LiveKit, server bảo vệ) xem được.
 */
export class VoiceClient {
  private room: Room | null = null;
  private joined: VoiceChannelInfo | null = null;
  private wanted: VoiceChannelInfo | null = null;
  private enabled = false;
  private micWanted = false;
  private speakerOn = true;
  private gen = 0;
  private switchTimer = 0;
  private tick = 0;
  private audioHost = document.createElement('div');
  /** Màn hình người khác đang chia sẻ, theo thứ tự nhận (cuối = mới nhất). */
  private screens: { track: RemoteTrack; name: string }[] = [];
  private view: VoiceView = VOICE_INITIAL;

  onChange?: (v: VoiceView) => void;
  onSpeaking?: (ids: Set<string>) => void;
  onError?: (message: string) => void;

  constructor(private pos: VoicePositions) {
    this.audioHost.hidden = true;
    document.body.appendChild(this.audioHost);
    this.tick = window.setInterval(() => this.updateHearing(), 250);
  }

  get state() { return this.view; }

  /** Gọi khi kênh tại vị trí của mình đổi (OfficeScene.onVoiceChannel). */
  setChannel(ch: VoiceChannelInfo) {
    this.wanted = ch;
    if (!this.enabled || this.joined?.id === ch.id) { clearTimeout(this.switchTimer); return; }
    clearTimeout(this.switchTimer);
    this.switchTimer = window.setTimeout(() => void this.join(), SWITCH_DEBOUNCE);
  }

  /** Vào voice (tự gọi khi vào văn phòng). Micro giữ nguyên trạng thái người dùng chọn (mặc định tắt). */
  async enable() {
    if (this.enabled) return;
    this.enabled = true;
    this.set({ error: null });
    const me = this.pos.me();
    if (!this.wanted && me) this.wanted = voiceChannelAt(OFFICE_MAP, me.x, me.z);
    await this.join();
  }

  async disable() {
    this.enabled = false;
    this.gen++;
    clearTimeout(this.switchTimer);
    await this.leave();
    this.set({ status: 'off', channel: null, micOn: false, sharing: false, peers: 0, needsAudioClick: false });
  }

  /** Bật / tắt nghe (loa) — vẫn ở trong kênh, người khác vẫn nghe mình nếu micro bật. */
  toggleSpeaker() {
    this.speakerOn = !this.speakerOn;
    this.set({ speakerOn: this.speakerOn });
    this.updateHearing();
  }

  async toggleMic() {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    this.micWanted = !lp.isMicrophoneEnabled;
    await this.applyMic();
  }

  async toggleScreen() {
    const lp = this.room?.localParticipant;
    if (!lp || !this.joined?.screen) return;
    try {
      await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: true });
    } catch (e) {
      if ((e as Error)?.name !== 'NotAllowedError') this.onError?.('Không chia sẻ được màn hình');
    }
    this.set({ sharing: lp.isScreenShareEnabled });
  }

  /** Trình duyệt chặn tự phát âm thanh → gọi trong onClick. */
  async resumeAudio() {
    await this.room?.startAudio().catch(() => {});
    this.set({ needsAudioClick: !!this.room && !this.room.canPlaybackAudio });
  }

  dispose() {
    this.enabled = false;
    this.gen++;
    clearTimeout(this.switchTimer);
    clearInterval(this.tick);
    void this.leave();
    this.audioHost.remove();
  }

  // ---------- nội bộ ----------

  /** Không vào được voice: dừng, ghi lý do lên thẻ voice (không toast — tự vào khi mở văn phòng nên tránh làm phiền). */
  private fail(message: string) {
    this.enabled = false;
    this.set({ status: 'off', channel: null, error: message });
  }

  private set(p: Partial<VoiceView>) {
    this.view = { ...this.view, ...p };
    this.onChange?.(this.view);
  }

  private async leave() {
    const r = this.room;
    this.room = null;
    this.joined = null;
    this.onSpeaking?.(new Set());
    this.clearScreens();
    if (r) await r.disconnect().catch(() => {});
    this.audioHost.replaceChildren();
  }

  private async join() {
    const g = ++this.gen;
    clearTimeout(this.switchTimer);
    if (!this.enabled || !this.wanted) return;
    const target = this.wanted;
    if (this.room && this.joined?.id === target.id) return;
    await this.leave();
    if (g !== this.gen) return;
    this.set({ status: 'connecting', channel: target, sharing: false, peers: 0 });

    // Server cấp token cho kênh tại vị trí nó đang biết; vừa qua cửa thì có thể chưa kịp cập nhật → hỏi lại vài lần.
    let tk: VoiceToken | null = null;
    for (let i = 0; i < 6; i++) {
      try {
        tk = await httpPost<VoiceToken>(REALTIME.voiceToken);
      } catch (e) {
        if (g !== this.gen) return;
        this.fail(e instanceof ApiError ? e.message : 'Không kết nối được voice');
        return;
      }
      if (g !== this.gen) return;
      if (tk.channel === target.id) break;
      await new Promise((r) => setTimeout(r, TOKEN_RETRY));
      if (g !== this.gen) return;
    }
    if (!tk) return;
    const channel = tk.channel === target.id ? target : { ...voiceChannelFromId(tk.channel), meeting: tk.meeting, screen: tk.screen };

    let lk: LiveKit;
    try {
      lk = await loadLiveKit();
    } catch {
      if (g !== this.gen) return;
      this.fail('Không tải được module voice, thử tải lại trang');
      return;
    }
    if (g !== this.gen) return;
    const room = new lk.Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    this.wire(lk, room);
    try {
      await room.connect(tk.url, tk.token, { autoSubscribe: false });
    } catch {
      if (g !== this.gen) return;
      this.fail('Không kết nối được máy chủ voice');
      return;
    }
    if (g !== this.gen) { void room.disconnect(); return; }
    this.room = room;
    this.joined = channel;
    this.set({ status: 'on', channel, needsAudioClick: !room.canPlaybackAudio });
    await this.applyMic();
    this.updateHearing();
    // Server trả kênh khác kênh mình đang đứng (vị trí chưa kịp đồng bộ) → thử lại.
    if (this.wanted && this.wanted.id !== channel.id) this.setChannel(this.wanted);
  }

  private async applyMic() {
    const lp = this.room?.localParticipant;
    if (!lp) return;
    try {
      await lp.setMicrophoneEnabled(this.micWanted);
    } catch (e) {
      this.micWanted = false;
      const name = (e as Error)?.name;
      this.onError?.(name === 'NotAllowedError' ? 'Trình duyệt chưa cho dùng micro — bạn vẫn nghe được người khác'
        : name === 'NotFoundError' ? 'Không tìm thấy micro' : 'Không bật được micro');
    }
    this.set({ micOn: lp.isMicrophoneEnabled });
  }

  private wire(lk: LiveKit, room: Room) {
    const { RoomEvent, Track } = lk;
    const mine = () => this.room === room;
    room
      .on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
        if (!mine()) return;
        if (track.kind === Track.Kind.Audio) {
          const el = track.attach();
          this.audioHost.appendChild(el);
        } else if (track.source === Track.Source.ScreenShare) {
          this.screens = [...this.screens.filter((s) => s.track !== track), { track, name: p.name || p.identity }];
          this.publishScreens();
        }
      })
      .on(RoomEvent.TrackUnsubscribed, (track) => {
        track.detach().forEach((el) => el.remove());
        if (!mine() || !this.screens.some((s) => s.track === track)) return;
        this.screens = this.screens.filter((s) => s.track !== track);
        this.publishScreens(); // còn người khác đang chia sẻ → hiện màn hình của họ
      })
      .on(RoomEvent.TrackPublished, () => mine() && this.updateHearing())
      .on(RoomEvent.ParticipantConnected, () => mine() && this.updateHearing())
      .on(RoomEvent.ParticipantDisconnected, () => mine() && this.updateHearing())
      .on(RoomEvent.LocalTrackUnpublished, (pub) => {
        if (mine() && pub.source === Track.Source.ScreenShare) this.set({ sharing: false });
        if (mine() && pub.source === Track.Source.Microphone) this.set({ micOn: false });
      })
      .on(RoomEvent.LocalTrackPublished, (pub) => {
        if (mine() && pub.source === Track.Source.ScreenShare) this.set({ sharing: true });
      })
      .on(RoomEvent.TrackMuted, (pub, p) => mine() && p.isLocal && pub.source === Track.Source.Microphone && this.set({ micOn: false }))
      .on(RoomEvent.TrackUnmuted, (pub, p) => mine() && p.isLocal && pub.source === Track.Source.Microphone && this.set({ micOn: true }))
      .on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) => mine() && this.onSpeaking?.(new Set(speakers.map((s) => s.identity))))
      .on(RoomEvent.AudioPlaybackStatusChanged, () => mine() && this.set({ needsAudioClick: !room.canPlaybackAudio }))
      .on(RoomEvent.Disconnected, () => {
        if (!mine()) return;
        // Bị server cắt (đổi kênh, mất mạng lâu…) → vào lại kênh tại vị trí hiện tại.
        this.room = null;
        this.joined = null;
        this.audioHost.replaceChildren();
        this.onSpeaking?.(new Set());
        this.clearScreens();
        if (!this.enabled) return;
        this.set({ status: 'connecting', sharing: false });
        clearTimeout(this.switchTimer);
        this.switchTimer = window.setTimeout(() => void this.join(), 1500);
      });
  }

  private publishScreens() {
    this.set({ screen: this.screens.at(-1) ?? null, screenCount: this.screens.length });
  }

  private clearScreens() {
    this.screens = [];
    if (this.view.screen || this.view.screenCount) this.publishScreens();
  }

  /** Bật / tắt nhận âm + chỉnh âm lượng theo khoảng cách (4 lần / giây). */
  private updateHearing() {
    const room = this.room, ch = this.joined;
    if (!room || !ch) return;
    const me = this.pos.me();
    let peers = 0;
    for (const p of room.remoteParticipants.values()) {
      const o = this.pos.of(p.identity);
      const dist = me && o ? Math.hypot(o.x - me.x, o.z - me.z) : Infinity;
      for (const pub of p.trackPublications.values()) this.subscribe(p, pub as RemoteTrackPublication, ch, dist);
      if (ch.meeting || dist < VOICE_FAR) peers++;
    }
    if (peers !== this.view.peers) this.set({ peers });
  }

  private subscribe(p: RemoteParticipant, pub: RemoteTrackPublication, ch: VoiceChannelInfo, dist: number) {
    const { Track } = LK!; // có room thì module đã tải
    const { meeting } = ch;
    let want: boolean;
    if (pub.source === Track.Source.Microphone) {
      want = meeting || dist < VOICE_FAR + (pub.isSubscribed ? HYSTERESIS : 0);
      p.setVolume(!this.speakerOn ? 0 : meeting ? 1 : voiceVolume(dist), Track.Source.Microphone);
    } else {
      // Màn hình: cả phòng xem (không theo khoảng cách) — chỉ phòng có tường mới có, khu mở không.
      want = ch.screen && isScreen(pub);
      if (pub.source === Track.Source.ScreenShareAudio) p.setVolume(this.speakerOn ? 1 : 0, Track.Source.ScreenShareAudio);
    }
    if (pub.isSubscribed !== want) pub.setSubscribed(want);
  }
}

const isScreen = (pub: TrackPublication) => pub.source === 'screen_share' || pub.source === 'screen_share_audio';

function voiceChannelFromId(id: string): VoiceChannelInfo {
  const r = OFFICE_MAP.rooms.find((x) => x.id === id);
  return r ? { id, name: r.name, meeting: r.voice === 'room', screen: !!r.walls } : { id, name: 'Khu mở', meeting: false, screen: false };
}
