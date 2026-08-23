import pc from 'picocolors';
import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import { writeSolutionFile } from '../solution';
import * as log from '../util/log';
import { difficultyColor } from '../util/log';

interface RandomOptions {
  lang?: string;
  difficulty?: string;
  todo?: boolean;
  gen?: boolean;
  overwrite?: boolean;
}

export async function randomCommand(opts: RandomOptions): Promise<void> {
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  const difficulty = opts.difficulty
    ? (opts.difficulty.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD')
    : undefined;
  const status = opts.todo ? 'NOT_STARTED' : undefined;

  // Find the size of the matching set, then jump to a random window within it.
  const probe = await client.listProblems({ limit: 1, skip: 0, difficulty, status });
  if (!probe.total) {
    log.warn('No problems matched your filters.');
    return;
  }

  const windowSize = 25;
  const maxSkip = Math.max(0, probe.total - windowSize);
  const skip = Math.floor(Math.random() * (maxSkip + 1));
  const win = await client.listProblems({ limit: windowSize, skip, difficulty, status });
  const candidates = win.questions.filter((q) => !q.isPaidOnly);
  const pool = candidates.length ? candidates : win.questions;
  const chosen = pool[Math.floor(Math.random() * pool.length)];

  log.info('🎲 Rolling the dice…');
  const problem = await client.getProblem(chosen.titleSlug);

  const showMeta = config.tags !== false;
  process.stderr.write(
    `\n${pc.bold(`${problem.frontendId}. ${problem.title}`)}` +
      `${showMeta ? `  ${difficultyColor(problem.difficulty)}` : ''}\n`
  );
  process.stderr.write(pc.dim(`https://leetcode.com/problems/${problem.titleSlug}/\n`));
  if (problem.topicTags.length && showMeta) {
    process.stderr.write(pc.dim(`Tags: ${problem.topicTags.map((t) => t.name).join(', ')}\n`));
  }

  if (opts.gen !== false) {
    const lang = opts.lang || config.lang;
    const { filePath, created } = writeSolutionFile(config, problem, lang, opts.overwrite);
    if (created) log.success(`Solution file: ${filePath}`);
    else log.info(`Solution file already exists: ${filePath} (use --overwrite to reset)`);
    process.stderr.write(pc.dim(`Open the TUI: leetcode tui ${problem.titleSlug}\n`));
  }
}
