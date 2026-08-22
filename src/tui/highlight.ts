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
  /** Line-comment token (e.g. "//" or "#"). */
  line: string;
  /** Whether backtick template strings are supported. */
  backtick: boolean;
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

const ALIASES: Record<string, string> = {
  c: 'cpp',
  python3: 'python',
};

const specCache = new Map<string, LangSpec>();

function getSpec(slug: string): LangSpec {
  const key = ALIASES[slug] || slug;
  const cached = specCache.get(key);
  if (cached) return cached;
  const words = KEYWORDS[key] || KEYWORDS.javascript;
  const lineComment = LANGUAGES[slug]?.line || LANGUAGES[key]?.line || '//';
  const spec: LangSpec = {
    keywords: new Set(words),
    line: lineComment,
    backtick: key === 'javascript' || key === 'typescript',
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
  string: string;
  number: string;
  comment: string;
}

export const THEMES: Record<string, Theme> = {
  default: { keyword: 'yellow-fg', string: 'green-fg', number: 'magenta-fg', comment: '#8a8a8a-fg' },
  dracula: { keyword: '#ff79c6-fg', string: '#f1fa8c-fg', number: '#bd93f9-fg', comment: '#6272a4-fg' },
  monokai: { keyword: '#f92672-fg', string: '#e6db74-fg', number: '#ae81ff-fg', comment: '#75715e-fg' },
  solarized: { keyword: '#859900-fg', string: '#2aa198-fg', number: '#d33682-fg', comment: '#93a1a1-fg' },
  neon: { keyword: '#39ff14-fg', string: '#00ffff-fg', number: '#ff00ff-fg', comment: '#4d9999-fg' },
  mono: { keyword: 'white-fg', string: '#b0b0b0-fg', number: 'white-fg', comment: '#8a8a8a-fg' },
};

export function themeNames(): string[] {
  return Object.keys(THEMES);
}

function getTheme(name?: string): Theme {
  return (name && THEMES[name]) || THEMES.default;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;
const NUM_BODY = /[0-9a-fA-FxXbBoO._]/;

/**
 * Highlight one line of source and return a blessed-tag string.
 * `text` must be the exact visible slice; all output is width-preserving.
 */
export function highlightLine(text: string, slug: string, themeName?: string): string {
  const spec = getSpec(slug);
  const theme = getTheme(themeName);
  const n = text.length;
  let out = '';
  let i = 0;
  while (i < n) {
    const c = text[i];

    // Line comment: colour the rest of the visible line.
    if (spec.line && text.startsWith(spec.line, i)) {
      out += tag(theme.comment, text.slice(i));
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
      out += tag(theme.string, text.slice(i, j));
      i = j;
      continue;
    }

    // Number literal.
    if (DIGIT.test(c) && (i === 0 || !IDENT.test(text[i - 1]))) {
      let j = i + 1;
      while (j < n && NUM_BODY.test(text[j])) j++;
      out += tag(theme.number, text.slice(i, j));
      i = j;
      continue;
    }

    // Identifier / keyword.
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT.test(text[j])) j++;
      const word = text.slice(i, j);
      out += spec.keywords.has(word) ? tag(theme.keyword, word) : esc(word);
      i = j;
      continue;
    }

    out += esc(c);
    i++;
  }
  return out;
}
