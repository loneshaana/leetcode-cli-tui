import { LANGUAGES } from '../languages';

/**
 * Very small, dependency-free syntax highlighter for the TUI editor.
 *
 * It highlights a single (already horizontally-scrolled) visible line and
 * returns a blessed-tag string. All literal text is escaped with
 * `blessed.escape` so that braces in source code are never parsed as tags.
 */

interface LangSpec {
  keywords: Set<string>;
  /** Primitive / built-in type names (coloured distinctly from keywords). */
  types: Set<string>;
  /** Literal constants (true/false/null/None/nil …). */
  constants: Set<string>;
  /** Line-comment token (e.g. "//" or "#"). */
  line: string;
  /** Whether backtick template strings are supported. */
  backtick: boolean;
  /** Multi-line block rules (block comments, triple-quoted strings). */
  blocks: BlockRule[];
}

/** A delimited region that may span multiple lines. */
interface BlockRule {
  open: string;
  close: string;
  cls: 'comment' | 'string';
}

const KEYWORDS: Record<string, string[]> = {
  java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var true false null record sealed yield'.split(
    ' '
  ),
  cpp: 'alignas alignof auto bool break case catch char class const constexpr continue decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept nullptr operator private protected public register return short signed sizeof static static_cast struct switch template this throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while'.split(
    ' '
  ),
  python: 'and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield True False None match case self'.split(
    ' '
  ),
  javascript: 'async await break case catch class const continue debugger default delete do else export extends false finally for function if import in instanceof let new null of return super switch this throw true try typeof var void while with yield static get set'.split(
    ' '
  ),
  typescript: 'async await break case catch class const continue debugger default delete do else enum export extends false finally for function if implements import in instanceof interface let namespace new null of private protected public readonly return static super switch this throw true try type typeof var void while yield as any number string boolean unknown never'.split(
    ' '
  ),
  golang: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false iota'.split(
    ' '
  ),
  rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while'.split(
    ' '
  ),
  csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using var virtual void volatile while async await'.split(
    ' '
  ),
  kotlin: 'as break by class continue do else false for fun if import in interface is null object override package private protected public return super this throw true try typealias val var when while abstract companion const data enum inline internal open sealed suspend'.split(
    ' '
  ),
  swift: 'associatedtype class deinit enum extension func import init inout internal let open operator private protocol public static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch false is nil rethrows super self throw throws true try'.split(
    ' '
  ),
  ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield attr_accessor attr_reader attr_writer require'.split(
    ' '
  ),
  scala: 'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait true try type val var while with yield'.split(
    ' '
  ),
};

/**
 * Primitive / built-in type names per language. Coloured with the theme's
 * `type` colour so declarations read distinctly from control-flow keywords.
 * A word listed here wins over the keyword set (see the classifier precedence
 * in `highlightLine`).
 */
const TYPES: Record<string, string[]> = {
  java: 'boolean byte char double float int long short void var String Integer Long Double Boolean Character Object List Map Set'.split(' '),
  cpp: 'bool char double float int long short void wchar_t signed unsigned auto size_t string vector'.split(' '),
  python: 'int float complex str bool bytes bytearray list dict set frozenset tuple object'.split(' '),
  javascript: [],
  typescript: 'number string boolean unknown never any void object bigint symbol'.split(' '),
  golang: 'int int8 int16 int32 int64 uint uint8 uint16 uint32 uint64 uintptr float32 float64 complex64 complex128 string bool byte rune error'.split(' '),
  rust: 'i8 i16 i32 i64 i128 isize u8 u16 u32 u64 u128 usize f32 f64 bool char str String Vec Option Result Box'.split(' '),
  csharp: 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void var'.split(' '),
  kotlin: 'Int Long Short Byte Double Float Boolean Char String Unit Any List Map Set Array'.split(' '),
  swift: 'Int Double Float Bool String Character Array Dictionary Set Optional Any'.split(' '),
  ruby: [],
  scala: 'Int Long Short Byte Double Float Boolean Char String Unit Any AnyRef Nothing List Map Option'.split(' '),
};

/** Literal constants per language, coloured with the theme's `constant` colour. */
const CONSTANTS: Record<string, string[]> = {
  java: 'true false null'.split(' '),
  cpp: 'true false nullptr NULL'.split(' '),
  python: 'True False None'.split(' '),
  javascript: 'true false null undefined NaN Infinity'.split(' '),
  typescript: 'true false null undefined NaN Infinity'.split(' '),
  golang: 'true false nil iota'.split(' '),
  rust: 'true false None Some Ok Err'.split(' '),
  csharp: 'true false null'.split(' '),
  kotlin: 'true false null'.split(' '),
  swift: 'true false nil'.split(' '),
  ruby: 'true false nil'.split(' '),
  scala: 'true false null Nil None'.split(' '),
};

const ALIASES: Record<string, string> = {
  c: 'cpp',
  python3: 'python',
};

const specCache = new Map<string, LangSpec>();

// Languages that use C-style /* … */ block comments.
const C_BLOCK = new Set([
  'java', 'cpp', 'javascript', 'typescript', 'golang',
  'rust', 'csharp', 'kotlin', 'swift', 'scala',
]);

function blockRules(key: string): BlockRule[] {
  if (key === 'python') {
    // Triple-quoted strings double as multi-line docstrings/"comments".
    return [
      { open: '"""', close: '"""', cls: 'string' },
      { open: "'''", close: "'''", cls: 'string' },
    ];
  }
  if (C_BLOCK.has(key)) return [{ open: '/*', close: '*/', cls: 'comment' }];
  return [];
}

function getSpec(slug: string): LangSpec {
  const key = ALIASES[slug] || slug;
  const cached = specCache.get(key);
  if (cached) return cached;
  const words = KEYWORDS[key] || KEYWORDS.javascript;
  const lineComment = LANGUAGES[slug]?.line || LANGUAGES[key]?.line || '//';
  const spec: LangSpec = {
    keywords: new Set(words),
    types: new Set(TYPES[key] || []),
    constants: new Set(CONSTANTS[key] || []),
    line: lineComment,
    backtick: key === 'javascript' || key === 'typescript',
    blocks: blockRules(key),
  };
  specCache.set(key, spec);
  return spec;
}

const esc = (s: string): string =>
  s.replace(/[{}]/g, (c) => (c === '{' ? '{open}' : '{close}'));
const tag = (t: string, s: string): string => `{${t}}${esc(s)}{/${t}}`;

/** Token colors for a syntax theme (blessed color tags, name or hex). */
export interface Theme {
  keyword: string;
  type: string;
  func: string;
  constant: string;
  string: string;
  number: string;
  comment: string;
}

/** UI accent colours (blessed base colour names) for editor chrome. */
export interface ThemeUi {
  /** Line-number colour for non-current rows. */
  gutter: string;
  /** Line-number colour for the current row. */
  gutterActive: string;
  /** Background colour name used to highlight matching brackets. */
  bracket: string;
  /**
   * Foreground colour for muted UI labels (e.g. the Input/Output/Expected
   * field labels in the run-result table). Uses a visible base-ANSI accent
   * rather than grey, which is near-invisible on many terminals/themes.
   */
  label: string;
}

/**
 * Bare token colours per theme (hex, no `-fg` suffix). This is the single
 * source of truth; the named-ANSI fallback palettes for low-colour terminals
 * are derived from these values programmatically (see `configureColors`).
 */
interface RawTheme {
  keyword: string;
  type: string;
  func: string;
  constant: string;
  string: string;
  number: string;
  comment: string;
}

const THEMES_RAW: Record<string, RawTheme> = {
  // Balanced dark palette (One Dark inspired).
  default: {
    keyword: '#c678dd', type: '#e5c07b', func: '#61afef', constant: '#d19a66',
    string: '#98c379', number: '#d19a66', comment: '#7f848e',
  },
  dracula: {
    keyword: '#ff79c6', type: '#8be9fd', func: '#50fa7b', constant: '#bd93f9',
    string: '#f1fa8c', number: '#bd93f9', comment: '#6272a4',
  },
  monokai: {
    keyword: '#f92672', type: '#66d9ef', func: '#a6e22e', constant: '#ae81ff',
    string: '#e6db74', number: '#ae81ff', comment: '#75715e',
  },
  solarized: {
    keyword: '#859900', type: '#b58900', func: '#268bd2', constant: '#d33682',
    string: '#2aa198', number: '#6c71c4', comment: '#657b83',
  },
  neon: {
    keyword: '#ff2e97', type: '#00e5ff', func: '#b967ff', constant: '#ffe15c',
    string: '#05ffa1', number: '#ff9f1c', comment: '#7a88b8',
  },
  // Near-monochrome: distinctions come from brightness, not hue.
  mono: {
    keyword: '#f0f0f0', type: '#cfcfcf', func: '#e0e0e0', constant: '#c8c8c8',
    string: '#a8a8a8', number: '#c8c8c8', comment: '#6f6f6f',
  },
};

/**
 * UI accents use only the 8 base ANSI colour names (indices 1-7) so they stay
 * visible on every terminal tier without downsampling.
 */
const THEME_UI: Record<string, ThemeUi> = {
  default: { gutter: 'blue', gutterActive: 'cyan', bracket: 'blue', label: 'cyan' },
  dracula: { gutter: 'magenta', gutterActive: 'cyan', bracket: 'magenta', label: 'cyan' },
  monokai: { gutter: 'red', gutterActive: 'yellow', bracket: 'magenta', label: 'yellow' },
  solarized: { gutter: 'green', gutterActive: 'cyan', bracket: 'blue', label: 'cyan' },
  neon: { gutter: 'magenta', gutterActive: 'green', bracket: 'magenta', label: 'cyan' },
  mono: { gutter: 'white', gutterActive: 'white', bracket: 'blue', label: 'white' },
};

// ANSI colour index → blessed name. Bright variants (8-15) are only used on
// 16-colour terminals. Black (0) is intentionally never emitted for a token.
const ANSI_NAME = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightblack', 'brightred', 'brightgreen', 'brightyellow',
  'brightblue', 'brightmagenta', 'brightcyan', 'brightwhite',
];

function hexRgb(hex: string): [number, number, number] {
  const m = hex.replace('#', '');
  return [
    parseInt(m.slice(0, 2), 16),
    parseInt(m.slice(2, 4), 16),
    parseInt(m.slice(4, 6), 16),
  ];
}

/** RGB (0-255) → HSL with hue in degrees, saturation and lightness in [0,1]. */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  let h = 0;
  let s = 0;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (mx === r) h = (((g - b) / d) % 6 + 6) % 6;
    else if (mx === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s, l];
}

// Hue centres (degrees) for the six chromatic ANSI colours → colour index.
const HUE_CENTRES: [number, number][] = [
  [0, 1], [60, 3], [120, 2], [180, 6], [240, 4], [300, 5], [360, 1],
];

/**
 * Nearest named ANSI colour to `hex`. Uses hue, not RGB distance, so vivid
 * pastels map to their matching ANSI hue instead of collapsing to white; only
 * genuinely desaturated colours become gray. Black (index 0) is never chosen
 * so a token can't vanish into a dark background — the original invisible
 * comment bug. Bright variants (8-15) are used only when `allowBright`.
 */
function nearestAnsi(hex: string, allowBright: boolean): string {
  const [r, g, b] = hexRgb(hex);
  const [h, s, l] = rgbToHsl(r, g, b);
  // Desaturated: choose a gray by lightness (dim → brightblack, else white).
  if (s < 0.32) {
    if (l >= 0.75) return ANSI_NAME[allowBright ? 15 : 7];
    if (l < 0.62) return ANSI_NAME[allowBright ? 8 : 7];
    return ANSI_NAME[7];
  }
  // Chromatic: snap to the closest hue centre, brightened when light.
  let base = 1;
  let bestDist = Infinity;
  for (const [hc, idx] of HUE_CENTRES) {
    const d = Math.abs(h - hc);
    if (d < bestDist) {
      bestDist = d;
      base = idx;
    }
  }
  return ANSI_NAME[allowBright && l >= 0.5 ? base + 8 : base];
}

/** Terminal colour tier. `full` = truecolor, others are named-ANSI fallbacks. */
type Tier = 'full' | 'ansi16' | 'ansi8';
let tier: Tier = 'full';

/**
 * Tell the highlighter how many colours the active terminal supports. Called
 * once at start-up with `screen.program.tput.colors`. Below 256 colours the
 * truecolor hexes are downsampled to the nearest bright ANSI name (16-colour
 * terminals) or base ANSI name (8-colour terminals) so every token — comments
 * especially — stays visible instead of collapsing to the background.
 */
export function configureColors(colors?: number): void {
  if (typeof colors !== 'number') return;
  tier = colors >= 256 ? 'full' : colors >= 16 ? 'ansi16' : 'ansi8';
}

/** Resolve a bare hex colour to a `<color>-fg` tag for the current tier. */
function fg(bare: string): string {
  if (tier === 'full') return bare + '-fg';
  return nearestAnsi(bare, tier === 'ansi16') + '-fg';
}

const themeCache = new Map<string, Theme>();

/**
 * Public truecolor palettes (with `-fg` tags), exposed for reference/tests.
 * Highlighting itself goes through `getTheme`, which applies tier downsampling.
 */
export const THEMES: Record<string, Theme> = Object.fromEntries(
  Object.entries(THEMES_RAW).map(([name, r]) => [
    name,
    {
      keyword: r.keyword + '-fg', type: r.type + '-fg', func: r.func + '-fg',
      constant: r.constant + '-fg', string: r.string + '-fg',
      number: r.number + '-fg', comment: r.comment + '-fg',
    },
  ])
);

export function themeNames(): string[] {
  return Object.keys(THEMES_RAW);
}

/** UI accent colours for a theme (used by the editor for gutter/brackets). */
export function getThemeUi(name?: string): ThemeUi {
  return (name && THEME_UI[name]) || THEME_UI.default;
}

function getTheme(name?: string): Theme {
  const raw = (name && THEMES_RAW[name]) || THEMES_RAW.default;
  const cacheKey = tier + ':' + (name && THEMES_RAW[name] ? name : 'default');
  const cached = themeCache.get(cacheKey);
  if (cached) return cached;
  const theme: Theme = {
    keyword: fg(raw.keyword),
    type: fg(raw.type),
    func: fg(raw.func),
    constant: fg(raw.constant),
    string: fg(raw.string),
    number: fg(raw.number),
    comment: fg(raw.comment),
  };
  themeCache.set(cacheKey, theme);
  return theme;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const NUM_BODY = /[0-9a-fA-FxXbBoO._]/;

/**
 * True when the identifier ending at `j` is a function call, i.e. the next
 * non-space character is an opening parenthesis. Purely lexical: it colours
 * calls, constructors and declarations alike, which is the intent for a
 * lightweight highlighter.
 */
function isCall(text: string, j: number, n: number): boolean {
  let k = j;
  while (k < n && (text[k] === ' ' || text[k] === '\t')) k++;
  return k < n && text[k] === '(';
}

/** Syntax token class; maps directly onto a `Theme` colour field. */
type TokenCls = 'keyword' | 'type' | 'func' | 'constant' | 'string' | 'number' | 'comment';

interface Span {
  from: number;
  to: number;
  cls: TokenCls;
}

/**
 * Tokenise one physical line, honouring a multi-line block that may already be
 * open at the start of the line. `startBlock` is -1 when no block is open, or
 * the index into `spec.blocks` of the block carried over from the previous
 * line. Returns the coloured spans plus `endBlock`, the block state to feed
 * into the next line so block comments / triple-quoted strings colour across
 * line boundaries.
 */
function tokenize(text: string, spec: LangSpec, startBlock: number): { spans: Span[]; endBlock: number } {
  const n = text.length;
  const spans: Span[] = [];
  let i = 0;
  let blk = startBlock;

  // Finish a block carried over from a previous line.
  if (blk >= 0 && blk < spec.blocks.length) {
    const { close, cls } = spec.blocks[blk];
    const k = text.indexOf(close);
    if (k < 0) {
      if (n > 0) spans.push({ from: 0, to: n, cls });
      return { spans, endBlock: blk };
    }
    spans.push({ from: 0, to: k + close.length, cls });
    i = k + close.length;
  }

  while (i < n) {
    const c = text[i];

    // Block open (block comment / triple-quoted string). Checked before line
    // comments and strings so `"""` isn't seen as an empty string, etc.
    let opened = false;
    for (let bi = 0; bi < spec.blocks.length; bi++) {
      const { open, close, cls } = spec.blocks[bi];
      if (text.startsWith(open, i)) {
        const k = text.indexOf(close, i + open.length);
        if (k < 0) {
          spans.push({ from: i, to: n, cls });
          return { spans, endBlock: bi };
        }
        spans.push({ from: i, to: k + close.length, cls });
        i = k + close.length;
        opened = true;
        break;
      }
    }
    if (opened) continue;

    // Line comment: colour the rest of the line.
    if (spec.line && text.startsWith(spec.line, i)) {
      spans.push({ from: i, to: n, cls: 'comment' });
      break;
    }

    // String / char literal.
    if (c === '"' || c === "'" || (spec.backtick && c === '`')) {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '\\') {
          j += 2;
          continue;
        }
        if (text[j] === c) {
          j++;
          break;
        }
        j++;
      }
      spans.push({ from: i, to: j, cls: 'string' });
      i = j;
      continue;
    }

    // Number literal.
    if (DIGIT.test(c) && (i === 0 || !IDENT.test(text[i - 1]))) {
      let j = i + 1;
      while (j < n && NUM_BODY.test(text[j])) j++;
      spans.push({ from: i, to: j, cls: 'number' });
      i = j;
      continue;
    }

    // Identifier: classify by precedence constant → type → keyword → callable.
    // Reserved words match first, so `if (`, `while (`, `return (` and
    // `sizeof (` are never mis-coloured as calls.
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT.test(text[j])) j++;
      const word = text.slice(i, j);
      let cls: TokenCls | '' = '';
      if (spec.constants.has(word)) cls = 'constant';
      else if (spec.types.has(word)) cls = 'type';
      else if (spec.keywords.has(word)) cls = 'keyword';
      else if (isCall(text, j, n)) cls = 'func';
      if (cls) spans.push({ from: i, to: j, cls });
      i = j;
      continue;
    }

    i++;
  }

  return { spans, endBlock: -1 };
}

/**
 * Block state at the end of `text` given the state at its start. Used by the
 * editor to fast-forward multi-line block state from the top of the file to the
 * first visible row, and to chain state between visible rows.
 */
export function blockStateAfter(text: string, slug: string, startBlock = -1): number {
  return tokenize(text, getSpec(slug), startBlock).endBlock;
}

/**
 * Highlight one line of source and return a blessed-tag string.
 *
 * The lexer always scans the whole logical `text` so that string/comment state
 * is correct, but only characters in the visible column window `[start, end)`
 * are emitted. This keeps highlighting stable under horizontal scrolling. Pass
 * `startBlock` (from `blockStateAfter` on the previous line) so multi-line
 * block comments and triple-quoted strings stay coloured across lines. The
 * emitted text is width-preserving for the requested window.
 */
export function highlightLine(
  text: string,
  slug: string,
  themeName?: string,
  start = 0,
  end = text.length,
  startBlock = -1
): string {
  const spec = getSpec(slug);
  const theme = getTheme(themeName);
  const n = text.length;
  const lo = Math.max(0, start);
  const hi = Math.min(n, end);
  const { spans } = tokenize(text, spec, startBlock);
  let out = '';

  // Emit [from, to) clipped to the visible window, wrapped in `color` (empty =
  // plain escaped text).
  const emit = (from: number, to: number, color: string): void => {
    const a = Math.max(from, lo);
    const b = Math.min(to, hi);
    if (a >= b) return;
    const s = text.slice(a, b);
    out += color ? tag(color, s) : esc(s);
  };

  // Walk the line, filling gaps between coloured spans with plain text.
  let pos = 0;
  for (const sp of spans) {
    if (sp.from > pos) emit(pos, sp.from, '');
    emit(sp.from, sp.to, theme[sp.cls]);
    pos = sp.to;
  }
  if (pos < n) emit(pos, n, '');
  return out;
}
