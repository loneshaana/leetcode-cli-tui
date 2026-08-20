// Language metadata: maps LeetCode language slugs to file extensions and comment syntax.

export interface LangInfo {
  /** LeetCode language slug used in API calls and codeSnippets (e.g. "python3", "golang"). */
  slug: string;
  /** File extension without the dot. */
  ext: string;
  /** Human friendly name. */
  name: string;
  /** Line comment token. */
  line: string;
  /** Optional block comment tokens. */
  block?: { start: string; end: string };
}

export const LANGUAGES: Record<string, LangInfo> = {
  java: { slug: 'java', ext: 'java', name: 'Java', line: '//', block: { start: '/*', end: '*/' } },
  python3: { slug: 'python3', ext: 'py', name: 'Python3', line: '#' },
  python: { slug: 'python', ext: 'py', name: 'Python', line: '#' },
  cpp: { slug: 'cpp', ext: 'cpp', name: 'C++', line: '//', block: { start: '/*', end: '*/' } },
  c: { slug: 'c', ext: 'c', name: 'C', line: '//', block: { start: '/*', end: '*/' } },
  csharp: { slug: 'csharp', ext: 'cs', name: 'C#', line: '//', block: { start: '/*', end: '*/' } },
  javascript: { slug: 'javascript', ext: 'js', name: 'JavaScript', line: '//', block: { start: '/*', end: '*/' } },
  typescript: { slug: 'typescript', ext: 'ts', name: 'TypeScript', line: '//', block: { start: '/*', end: '*/' } },
  golang: { slug: 'golang', ext: 'go', name: 'Go', line: '//', block: { start: '/*', end: '*/' } },
  rust: { slug: 'rust', ext: 'rs', name: 'Rust', line: '//', block: { start: '/*', end: '*/' } },
  kotlin: { slug: 'kotlin', ext: 'kt', name: 'Kotlin', line: '//', block: { start: '/*', end: '*/' } },
  swift: { slug: 'swift', ext: 'swift', name: 'Swift', line: '//', block: { start: '/*', end: '*/' } },
  ruby: { slug: 'ruby', ext: 'rb', name: 'Ruby', line: '#' },
  scala: { slug: 'scala', ext: 'scala', name: 'Scala', line: '//', block: { start: '/*', end: '*/' } },
};

/** Accepts a user-facing alias (e.g. "python", "js", "go") and returns the canonical LangInfo. */
export function resolveLang(input: string): LangInfo {
  const key = input.trim().toLowerCase();
  const aliases: Record<string, string> = {
    py: 'python3',
    python: 'python3',
    'c++': 'cpp',
    js: 'javascript',
    node: 'javascript',
    ts: 'typescript',
    go: 'golang',
    'c#': 'csharp',
    cs: 'csharp',
    rs: 'rust',
  };
  const canonical = aliases[key] || key;
  const info = LANGUAGES[canonical];
  if (!info) {
    throw new Error(
      `Unsupported language "${input}". Supported: ${Object.keys(LANGUAGES).join(', ')}`
    );
  }
  return info;
}

/** Find LangInfo by file extension (e.g. "java" -> Java). */
export function langByExt(ext: string): LangInfo | undefined {
  const clean = ext.replace(/^\./, '').toLowerCase();
  return Object.values(LANGUAGES).find((l) => l.ext === clean);
}
