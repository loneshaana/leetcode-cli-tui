#!/usr/bin/env node
import { Command } from 'commander';
import * as log from './util/log';
import { loginCommand } from './commands/login';
import { listCommand } from './commands/list';
import { showCommand } from './commands/show';
import { runCommand } from './commands/run';
import { submitCommand } from './commands/submit';
import { exportCommand } from './commands/export';
import { tuiCommand } from './commands/tui';
import { configCommand } from './commands/config';
import { statsCommand } from './commands/stats';
import { randomCommand } from './commands/random';
import { reviewCommand } from './commands/review';

const program = new Command();

program
  .name('leetcode')
  .description('Work with LeetCode problems from your terminal: fetch, edit in a split-pane TUI, run and submit.')
  .version('0.1.0');

program
  .command('login')
  .description('Log in: opens LeetCode in your default browser, then saves your session cookies')
  .option('--no-open', 'Do not open the browser automatically; just show the URL')
  .option('-f, --force', 'Re-login even if a valid session already exists')
  .action(wrap(loginCommand));

program
  .command('list')
  .alias('ls')
  .description('List problems')
  .option('-l, --limit <n>', 'Number of problems to show', '50')
  .option('-s, --skip <n>', 'Offset for pagination', '0')
  .option('-d, --difficulty <level>', 'Filter by easy|medium|hard')
  .option('-q, --search <text>', 'Search by keyword')
  .option('--todo', 'Only unsolved problems')
  .option('--solved', 'Only solved problems')
  .action(wrap(listCommand));

program
  .command('show <problem>')
  .alias('pick')
  .description('Fetch a problem (slug, id, url, or "daily") and generate a solution file')
  .option('-L, --lang <lang>', 'Language (defaults to configured language)')
  .option('-o, --open', 'Print the problem description to stdout')
  .option('--no-gen', 'Do not generate a solution file')
  .option('--overwrite', 'Overwrite an existing solution file')
  .action(wrap(showCommand));

program
  .command('tui <problem>')
  .alias('edit')
  .description('Open the split-pane TUI: description + editor, run/submit inline')
  .option('-L, --lang <lang>', 'Language (defaults to configured language)')
  .action(wrap(tuiCommand));

program
  .command('run <file>')
  .description('Run a solution file against the sample test cases')
  .option('-t, --testcase <input>', 'Custom test input (use \\n for newlines)')
  .action(wrap(runCommand));

program
  .command('submit <file>')
  .description('Submit a solution file to LeetCode')
  .action(wrap(submitCommand));

program
  .command('export <file>')
  .alias('save')
  .description('Save the clean solution code (no metadata/description) to a file')
  .option('-o, --out <path>', 'Output file path (default: <dir>/solutions/<id>-<slug>.<ext>)')
  .action(wrap(exportCommand));

program
  .command('config')
  .description('View or change configuration')
  .option('-L, --lang <lang>', 'Set the default language')
  .option('-w, --workspace <dir>', 'Set the workspace directory')
  .option('--vim <state>', 'Enable vim key bindings in the TUI editor (on|off)')
  .option('--bell <state>', 'Ring the terminal bell on Accepted (on|off)')
  .option('--theme <name>', 'Editor syntax theme (default|dracula|monokai|solarized|neon|mono)')
  .action(wrap(configCommand));

program
  .command('stats')
  .description('Show your solved count, streaks and difficulty breakdown')
  .action(wrap(statsCommand));

program
  .command('random')
  .alias('rand')
  .description('Pick a random problem (optionally by difficulty) and generate a solution file')
  .option('-L, --lang <lang>', 'Language (defaults to configured language)')
  .option('-d, --difficulty <level>', 'Filter by easy|medium|hard')
  .option('--todo', 'Only pick from unsolved problems')
  .option('--no-gen', 'Do not generate a solution file')
  .option('--overwrite', 'Overwrite an existing solution file')
  .action(wrap(randomCommand));

program
  .command('review')
  .description('Spaced-repetition review: which solved problems are due to revisit')
  .option('-a, --all', 'Show the full schedule, not just what is due')
  .option('-l, --limit <n>', 'Maximum problems to list', '15')
  .action(wrap(reviewCommand));

program.parseAsync(process.argv).catch((err) => {
  log.error((err as Error).message);
  process.exit(1);
});

/** Wrap an async action so errors are reported cleanly instead of as unhandled rejections. */
function wrap<A extends unknown[]>(fn: (...args: A) => Promise<void>) {
  return async (...args: A): Promise<void> => {
    try {
      await fn(...args);
    } catch (err) {
      log.error((err as Error).message);
      process.exitCode = 1;
    }
  };
}
