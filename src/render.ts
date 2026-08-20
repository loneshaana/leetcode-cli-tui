import TurndownService from 'turndown';

const turndown = new TurndownService({
  headingStyle: 'atx',
  codeBlockStyle: 'fenced',
  bulletListMarker: '-',
});

// Keep <pre> blocks (LeetCode examples) readable.
turndown.addRule('pre', {
  filter: ['pre'],
  replacement: (content, node) => {
    const text = (node as HTMLElement).textContent || '';
    return '\n```\n' + text.replace(/\n+$/, '') + '\n```\n';
  },
});

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&times;': '\u00d7',
  '&le;': '\u2264',
  '&ge;': '\u2265',
  '&minus;': '-',
};

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&lt;|&gt;|&amp;|&quot;|&#39;|&apos;|&times;|&le;|&ge;|&minus;/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Convert LeetCode HTML problem content into readable markdown/plain text. */
export function htmlToText(html: string): string {
  if (!html) return '';
  let md: string;
  try {
    md = turndown.turndown(html);
  } catch {
    md = html.replace(/<[^>]+>/g, '');
  }
  return decodeEntities(md).replace(/\n{3,}/g, '\n\n').trim();
}
