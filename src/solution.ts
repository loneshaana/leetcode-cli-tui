import * as fs from 'fs';
import * as path from 'path';
import { Config, ensureWorkspace } from './config';
import { LangInfo, langByExt, resolveLang } from './languages';
import { Problem } from './api/types';
import { htmlToText } from './render';

const META_PREFIX = 'LEETCODE-META';
const CODE_START = 'LEETCODE-CODE-START';
const CODE_END = 'LEETCODE-CODE-END';

export interface SolutionMeta {
  slug: string;
  questionId: string;
  frontendId: string;
  lang: string; // canonical slug
  title: string;
}

export interface ParsedSolution {
  meta: SolutionMeta;
  code: string;
}

function commentBlock(text: string, lang: LangInfo): string {
  if (lang.block) {
    // Guard against accidentally closing the block comment.
    const safe = text.replace(new RegExp('\\' + lang.block.end.split('').join('\\'), 'g'), '* /');
    return `${lang.block.start}\n${safe}\n${lang.block.end}`;
  }
  return text
    .split('\n')
    .map((l) => `${lang.line} ${l}`.trimEnd())
    .join('\n');
}

/** Build the on-disk file path for a problem+language. */
export function solutionPath(config: Config, problem: Problem, lang: LangInfo): string {
  const ws = ensureWorkspace(config);
  const safeSlug = problem.titleSlug;
  return path.join(ws, `${problem.frontendId}-${safeSlug}.${lang.ext}`);
}

/** Generate the full solution file contents (metadata header + description + code). */
export function renderSolutionFile(
  problem: Problem,
  langInput: string,
  showMeta = true
): { lang: LangInfo; content: string } {
  const lang = resolveLang(langInput);
  const snippet = problem.codeSnippets.find((s) => s.langSlug === lang.slug);
  const starter = snippet ? snippet.code : `${lang.line} No starter code available for ${lang.name}.`;

  const meta = `${lang.line} ${META_PREFIX} slug=${problem.titleSlug}; questionId=${problem.questionId}; frontendId=${problem.frontendId}; lang=${lang.slug}`;
  const titleLine = showMeta
    ? `${lang.line} ${problem.frontendId}. ${problem.title}  [${problem.difficulty}]`
    : `${lang.line} ${problem.frontendId}. ${problem.title}`;
  const headerLines = [
    meta,
    titleLine,
    `${lang.line} https://leetcode.com/problems/${problem.titleSlug}/`,
  ];
  if (showMeta) {
    headerLines.push(`${lang.line} Tags: ${problem.topicTags.map((t) => t.name).join(', ') || '-'}`);
  }
  const header = headerLines.join('\n');

  const description = commentBlock(htmlToText(problem.content), lang);

  const body = [
    header,
    '',
    description,
    '',
    `${lang.line} ${CODE_START} (edit below; run/submit only send this region)`,
    starter.trimEnd(),
    `${lang.line} ${CODE_END}`,
    '',
  ].join('\n');

  return { lang, content: body };
}

/** Write the solution file if absent; never clobbers existing edits. */
export function writeSolutionFile(
  config: Config,
  problem: Problem,
  langInput: string,
  overwrite = false
): { filePath: string; created: boolean; lang: LangInfo } {
  const { lang, content } = renderSolutionFile(problem, langInput, config.tags !== false);
  const filePath = solutionPath(config, problem, lang);
  if (fs.existsSync(filePath) && !overwrite) {
    return { filePath, created: false, lang };
  }
  fs.writeFileSync(filePath, content, 'utf8');
  return { filePath, created: true, lang };
}

/** Parse a solution file: extract metadata and the editable code region. */
export function parseSolutionFile(filePath: string): ParsedSolution {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);

  const metaLine = lines.find((l) => l.includes(META_PREFIX));
  const meta: Partial<SolutionMeta> = {};
  if (metaLine) {
    const after = metaLine.slice(metaLine.indexOf(META_PREFIX) + META_PREFIX.length);
    for (const part of after.split(';')) {
      const [k, v] = part.split('=').map((s) => s && s.trim());
      if (!k || v === undefined) continue;
      if (k === 'slug') meta.slug = v;
      else if (k === 'questionId') meta.questionId = v;
      else if (k === 'frontendId') meta.frontendId = v;
      else if (k === 'lang') meta.lang = v;
    }
  }

  // Infer language from extension if metadata is missing.
  if (!meta.lang) {
    const info = langByExt(path.extname(filePath));
    if (info) meta.lang = info.slug;
  }

  const startIdx = lines.findIndex((l) => l.includes(CODE_START));
  const endIdx = lines.findIndex((l) => l.includes(CODE_END));

  let code: string;
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    code = lines.slice(startIdx + 1, endIdx).join('\n');
  } else {
    // Fallback: strip our metadata/marker lines and send everything else.
    code = lines
      .filter((l) => !l.includes(META_PREFIX) && !l.includes(CODE_START) && !l.includes(CODE_END))
      .join('\n');
  }

  if (!meta.slug || !meta.questionId || !meta.lang) {
    throw new Error(
      `Could not read LeetCode metadata from "${path.basename(filePath)}". ` +
        `Re-create it with "leetcode show <slug>".`
    );
  }

  return {
    meta: {
      slug: meta.slug,
      questionId: meta.questionId,
      frontendId: meta.frontendId || '',
      lang: meta.lang,
      title: meta.slug,
    },
    code: code.replace(/^\n+/, '').replace(/\n+$/, '\n'),
  };
}

/** Write just the clean solution code (no metadata/description) to a file. */
export function exportSolutionCode(code: string, outPath: string): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const body = code.endsWith('\n') ? code : code + '\n';
  fs.writeFileSync(outPath, body, 'utf8');
}

/** Default path for an exported clean solution: <dir>/solutions/<id>-<slug>.<ext>. */
export function defaultExportPath(sourceFile: string, meta: SolutionMeta): string {
  const lang = resolveLang(meta.lang);
  const idPart = meta.frontendId ? `${meta.frontendId}-` : '';
  return path.join(path.dirname(sourceFile), 'solutions', `${idPart}${meta.slug}.${lang.ext}`);
}
export function writeCodeRegion(filePath: string, newCode: string): void {
  const raw = fs.readFileSync(filePath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const startIdx = lines.findIndex((l) => l.includes(CODE_START));
  const endIdx = lines.findIndex((l) => l.includes(CODE_END));
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    // No markers: just overwrite the file with the raw code.
    fs.writeFileSync(filePath, newCode, 'utf8');
    return;
  }
  const next = [
    ...lines.slice(0, startIdx + 1),
    ...newCode.split(/\r?\n/),
    ...lines.slice(endIdx),
  ].join('\n');
  fs.writeFileSync(filePath, next, 'utf8');
}
