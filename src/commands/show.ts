import pc from 'picocolors';
import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import { resolveProblem } from '../util/resolve';
import { writeSolutionFile } from '../solution';
import { htmlToText } from '../render';
import * as log from '../util/log';
import { difficultyColor } from '../util/log';

interface ShowOptions {
  lang?: string;
  gen?: boolean;
  overwrite?: boolean;
  open?: boolean; // print description to stdout
}

export async function showCommand(ref: string, opts: ShowOptions): Promise<void> {
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  const problem = await resolveProblem(client, ref);

  process.stderr.write(
    `\n${pc.bold(`${problem.frontendId}. ${problem.title}`)}  ${difficultyColor(problem.difficulty)}\n`
  );
  process.stderr.write(pc.dim(`https://leetcode.com/problems/${problem.titleSlug}/\n`));
  if (problem.topicTags.length && config.tags !== false) {
    process.stderr.write(pc.dim(`Tags: ${problem.topicTags.map((t) => t.name).join(', ')}\n`));
  }

  if (problem.isPaidOnly) {
    log.warn('This is a premium (paid-only) problem; content may be unavailable.');
  }

  if (opts.open) {
    process.stdout.write('\n' + htmlToText(problem.content) + '\n');
  }

  if (opts.gen !== false) {
    const lang = opts.lang || config.lang;
    const { filePath, created } = writeSolutionFile(config, problem, lang, opts.overwrite);
    if (created) log.success(`Solution file: ${filePath}`);
    else log.info(`Solution file already exists: ${filePath} (use --overwrite to reset)`);
    process.stderr.write(pc.dim(`Edit it, then: leetcode run "${filePath}"  |  leetcode submit "${filePath}"\n`));
    process.stderr.write(pc.dim(`Or open the TUI: leetcode tui ${problem.titleSlug}\n`));
  }
}
