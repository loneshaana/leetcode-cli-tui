import { LeetCodeClient } from '../api/client';
import { loadConfig, requireCookies } from '../config';
import { resolveProblem } from '../util/resolve';
import { writeSolutionFile, solutionPath } from '../solution';
import { resolveLang } from '../languages';
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
  const lang = resolveLang(langInput);
  // Create the file if missing (keeps existing edits otherwise).
  writeSolutionFile(config, problem, langInput, false);
  const filePath = solutionPath(config, problem, lang);

  await runTui({ client, problem, filePath });
  log.info('Closed TUI. Your work is saved at:');
  process.stderr.write(`  ${filePath}\n`);
}
