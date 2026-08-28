import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import { resolveProblem } from '../util/resolve';
import { writeSolutionFile } from '../solution';
import { runTui } from '../tui/app';
import * as log from '../util/log';

interface TuiOptions {
  lang?: string;
}

export async function tuiCommand(ref: string, opts: TuiOptions): Promise<void> {
  const config = loadConfig();
  const cookies = requireCookies(config);
  const client = new LeetCodeClient(cookies);

  log.info('Fetching problem...');
  const problem = await resolveProblem(client, ref);

  if (problem.isPaidOnly) {
    log.warn('This is a premium problem; its content may be unavailable without a subscription.');
  }

  const langInput = opts.lang || config.lang;
  // Create the file if missing (keeps existing edits otherwise). For SQL/Pandas
  // -only problems the requested language may not be offered, so use whatever
  // language (and path) writeSolutionFile actually chose.
  const { lang, filePath, fellBack, requestedName } = writeSolutionFile(
    config,
    problem,
    langInput,
    false
  );
  if (fellBack) {
    log.warn(`${requestedName} isn't available for this problem; using ${lang.name} instead.`);
  }

  await runTui({ client, problem, filePath });
  log.info('Closed TUI. Your work is saved at:');
  process.stderr.write(`  ${filePath}\n`);
}
