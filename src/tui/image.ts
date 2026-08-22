import { PNG } from 'pngjs';

/**
 * Terminal image rendering for the TUI problem pane.
 *
 * LeetCode problem statements often embed PNG diagrams (trees, grids, etc.).
 * Real inline-image protocols (iTerm2 / Kitty / Sixel) don't survive a blessed
 * full-screen repaint, so instead we decode the PNG and draw it as colored
 * Unicode half-block characters ("▀"): each cell packs two vertical pixels —
 * the top pixel as the foreground colour and the bottom pixel as the
 * background colour. The result is just tagged text, so it scrolls and
 * repaints like any other content.
 */

/** Background the image is composited over (transparent pixels blend to this). */
const BG: [number, number, number] = [24, 24, 32];
/** Hard cap on rendered height (in character rows) to keep big diagrams sane. */
const MAX_ROWS = 22;

/** Extract image URLs from LeetCode problem HTML, in document order. */
export function extractImageUrls(html: string): string[] {
  if (!html) return [];
  const urls: string[] = [];
  const re = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)')/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const url = (m[1] || m[2] || '').trim();
    if (url) urls.push(url);
  }
  return urls;
}

const clamp = (n: number): number => (n < 0 ? 0 : n > 255 ? 255 : n | 0);
const hex = (r: number, g: number, b: number): string =>
  '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('');

/**
 * Decode a PNG buffer and render it as an array of blessed-tag lines using
 * half-block characters. `cols` is the desired width in terminal cells; the
 * height is derived from the image's aspect ratio (each cell is 2 px tall).
 */
export function pngToHalfBlocks(buf: Buffer, cols: number): string[] {
  const png = PNG.sync.read(buf);
  const W = png.width;
  const H = png.height;
  const data = png.data; // RGBA, row-major
  if (!W || !H) return [];

  let outCols = Math.max(1, Math.min(cols, Math.max(W, 1)));
  let outRows = Math.max(1, Math.round((H / W) * outCols * 0.5));
  if (outRows > MAX_ROWS) {
    outCols = Math.max(1, Math.round(outCols * (MAX_ROWS / outRows)));
    outRows = MAX_ROWS;
  }
  const pxW = outCols;
  const pxH = outRows * 2;

  const sample = (px: number, py: number): [number, number, number] => {
    const sx = Math.min(W - 1, Math.floor((px * W) / pxW));
    const sy = Math.min(H - 1, Math.floor((py * H) / pxH));
    const idx = (sy * W + sx) * 4;
    const a = data[idx + 3] / 255;
    return [
      data[idx] * a + BG[0] * (1 - a),
      data[idx + 1] * a + BG[1] * (1 - a),
      data[idx + 2] * a + BG[2] * (1 - a),
    ];
  };

  const lines: string[] = [];
  for (let ry = 0; ry < pxH; ry += 2) {
    let line = '';
    for (let cx = 0; cx < pxW; cx++) {
      const [tr, tg, tb] = sample(cx, ry);
      const [br, bg, bb] = sample(cx, ry + 1);
      line += `{${hex(tr, tg, tb)}-fg}{${hex(br, bg, bb)}-bg}\u2580{/}`;
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Fetch a PNG URL and render it to half-block lines. Resolves to null on any
 * failure (network error, non-PNG payload, decode error) so callers can fall
 * back to showing a plain link.
 */
export async function loadImageArt(url: string, cols: number): Promise<string[] | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // PNG magic number check keeps us from feeding JPEG/GIF to the PNG decoder.
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
      return null;
    }
    return pngToHalfBlocks(buf, cols);
  } catch {
    return null;
  }
}
