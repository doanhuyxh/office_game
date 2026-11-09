export type MediaKind = { kind: 'image' } | { kind: 'video' } | { kind: 'embed'; src: string } | { kind: 'link' };

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i;
const VIDEO_EXT = /\.(mp4|webm|ogg|ogv|mov|m4v)$/i;

/** Nhận dạng link (chỉ hiển thị — back-end đã chặn mọi scheme ngoài http/https). */
export function mediaKind(url: string): MediaKind {
  let u: URL;
  try { u = new URL(url); } catch { return { kind: 'link' }; }
  const host = u.hostname.replace(/^(www\.|m\.)/, '');
  if (host === 'youtu.be') {
    const id = u.pathname.slice(1).split('/')[0];
    if (id) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` };
  }
  if (host === 'youtube.com') {
    const id = u.searchParams.get('v') ?? /^\/(?:shorts|embed|live)\/([^/?]+)/.exec(u.pathname)?.[1];
    if (id) return { kind: 'embed', src: `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}` };
  }
  if (host === 'vimeo.com') {
    const id = /^\/(\d+)/.exec(u.pathname)?.[1];
    if (id) return { kind: 'embed', src: `https://player.vimeo.com/video/${id}` };
  }
  if (host === 'drive.google.com') {
    const id = /\/file\/d\/([^/]+)/.exec(u.pathname)?.[1];
    if (id) return { kind: 'embed', src: `https://drive.google.com/file/d/${encodeURIComponent(id)}/preview` };
  }
  if (IMAGE_EXT.test(u.pathname)) return { kind: 'image' };
  if (VIDEO_EXT.test(u.pathname)) return { kind: 'video' };
  return { kind: 'link' };
}

export const isHttpUrl = (s: string) => {
  try { const u = new URL(s.trim()); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};
