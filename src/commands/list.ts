import pc from 'picocolors';
import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import * as log from '../util/log';
import { difficultyColor } from '../util/log';

interface ListOptions {
  limit?: string;
  skip?: string;
  difficulty?: string;
  search?: string;
  todo?: boolean;
  solved?: boolean;
}

export async function listCommand(opts: ListOptions): Promise<void> {
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  const difficulty = opts.difficulty
    ? (opts.difficulty.toUpperCase() as 'EASY' | 'MEDIUM' | 'HARD')
    : undefined;

  let status: 'AC' | 'NOT_STARTED' | undefined;
  if (opts.solved) status = 'AC';
  else if (opts.todo) status = 'NOT_STARTED';

  const result = await client.listProblems({
    limit: opts.limit ? parseInt(opts.limit, 10) : 50,
    skip: opts.skip ? parseInt(opts.skip, 10) : 0,
    difficulty,
    search: opts.search,
    status,
  });

  if (!result.questions.length) {
    log.warn('No problems matched your filters.');
    return;
  }

  for (const q of result.questions) {
    const mark = q.status === 'ac' ? pc.green('\u2713') : q.status === 'notac' ? pc.yellow('\u00b7') : ' ';
    const lock = q.isPaidOnly ? pc.dim(' [paid]') : '';
    const id = pc.dim(q.frontendId.padStart(4));
    const diff = difficultyColor(q.difficulty.padEnd(6));
    const rate = pc.dim(`${q.acRate.toFixed(1)}%`.padStart(6));
    process.stdout.write(`${mark} ${id}  ${diff}  ${rate}  ${q.title}${lock}\n`);
  }
  process.stderr.write(pc.dim(`\nShowing ${result.questions.length} of ${result.total}. Use --skip to paginate.\n`));
}
