import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * Safari < 16.2 (iOS 15, vd. iPhone 6s/7) không có `color-mix()`.
 * Tailwind 4 sinh `bg-warning/5` = fallback `var(--warning)` (ĐẶC, mất độ trong) + `@supports (color-mix)` bản đúng
 * → trên máy cũ mọi màu theme có `/độ-mờ` thành khối màu đặc (vd. thẻ cảnh báo cam chói).
 *
 * Plugin (chỉ lúc build):
 *  1. Đọc biến màu theme trong global.css (:root + .dark), tính kênh sRGB → thêm `--x-rgb: r g b`.
 *  2. Trước mỗi khối `@supports (color:color-mix(...))` chèn rule `prop: rgb(var(--x-rgb) / N%)`
 *     — trình duyệt cũ dùng rule này, trình duyệt mới vẫn bị khối @supports phía sau ghi đè.
 */
export function legacyColorFallback(themeCss: string): Plugin {
  return {
    name: 'officehub:legacy-color-fallback',
    apply: 'build',
    generateBundle(_, bundle) {
      const vars = themeRgbVars(readFileSync(themeCss, 'utf8'));
      const known = new Set(Object.keys(vars.root));
      const varCss = `:root{${decls(vars.root)}}.dark{${decls(vars.dark)}}`;
      for (const file of Object.values(bundle)) {
        if (file.type !== 'asset' || !file.fileName.endsWith('.css') || typeof file.source !== 'string') continue;
        const out = addFallbacks(file.source, known);
        file.source = file.fileName.includes('index-') ? varCss + out : out;
      }
    },
  };
}

const decls = (m: Record<string, string>) => Object.entries(m).map(([k, v]) => `--${k}-rgb:${v}`).join(';');

const SUPPORTS = '@supports (color:color-mix(in lab, red, red)){';
const MIX = /^([-\w]+):color-mix\(in oklab, var\(--([-\w]+)\) ([\d.]+)%, transparent\)(!important)?$/;

function addFallbacks(css: string, known: Set<string>): string {
  let out = '';
  let pos = 0;
  for (let i = css.indexOf(SUPPORTS); i !== -1; i = css.indexOf(SUPPORTS, pos)) {
    // Tìm dấu } đóng khối @supports.
    let depth = 1;
    let j = i + SUPPORTS.length;
    for (; j < css.length && depth > 0; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0;
    const inner = css.slice(i + SUPPORTS.length, j - 1);
    let fallback = '';
    // Chỉ xử lý rule phẳng `selector{decl;decl}` (Tailwind sinh đúng dạng này).
    for (const m of inner.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const ds = m[2].split(';').flatMap((d) => {
        const x = MIX.exec(d.trim());
        return x && known.has(x[2]) ? [`${x[1]}:rgb(var(--${x[2]}-rgb) / ${x[3]}%)${x[4] ?? ''}`] : [];
      });
      if (ds.length) fallback += `${m[1]}{${ds.join(';')}}`;
    }
    out += css.slice(pos, i) + fallback + css.slice(i, j);
    pos = j;
  }
  return out + css.slice(pos);
}

/** Đọc `--x: oklch(...)` / `--x: var(--y)` trong khối `:root {` và `.dark {` → kênh "r g b". */
function themeRgbVars(src: string) {
  const block = (sel: string) => {
    const m = new RegExp(`^${sel.replace('.', '\\.')} \\{([^}]*)\\}`, 'm').exec(src);
    return Object.fromEntries([...(m?.[1] ?? '').matchAll(/--([-\w]+):\s*([^;]+);/g)].map((x) => [x[1], x[2].trim()]));
  };
  const resolve = (raw: Record<string, string>, base?: Record<string, string>) => {
    const out: Record<string, string> = {};
    const all = { ...base, ...raw };
    const bg = parseOklch(all.background);
    for (const [k, v] of Object.entries(all)) {
      const alias = /^var\(--([-\w]+)\)$/.exec(v);
      if (alias) { out[k] = `var(--${alias[1]}-rgb)`; continue; }
      const c = parseOklch(v);
      if (!c) continue;
      // Biến có alpha sẵn (border/input bản tối): trộn trước với nền cho ra màu đặc gần đúng.
      const [r, g, b] = c.alpha < 1 && bg ? c.rgb.map((x, i) => x * c.alpha + bg.rgb[i] * (1 - c.alpha)) : c.rgb;
      out[k] = [r, g, b].map((x) => Math.round(x)).join(' ');
    }
    return out;
  };
  const root = resolve(block(':root'));
  return { root, dark: resolve(block('.dark'), block(':root')) };
}

function parseOklch(v: string | undefined) {
  const m = v && /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+)%)?\)$/.exec(v);
  if (!m) return null;
  const [L, C, H] = [+m[1], +m[2], (+m[3] * Math.PI) / 180];
  const a = C * Math.cos(H), b = C * Math.sin(H);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ];
  const rgb = lin.map((x) => {
    const c = Math.min(1, Math.max(0, x));
    return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  });
  return { rgb, alpha: m[4] ? +m[4] / 100 : 1 };
}
