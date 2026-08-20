import pc from 'picocolors';
import { loadConfig, reviewSchedule, ReviewItem } from '../config';
import { difficultyColor } from '../util/log';
import * as log from '../util/log';

interface ReviewOptions {
  all?: boolean;
  limit?: string;
}

function dueLabel(item: ReviewItem): string {
  if (item.overdueDays > 0) return pc.red(`${item.overdueDays}d overdue`);
  if (item.overdueDays === 0) return pc.yellow('due today');
  return pc.dim(`in ${-item.overdueDays}d`);
}

export async function reviewCommand(opts: ReviewOptions): Promise<void> {
  const cfg = loadConfig();
  const schedule = reviewSchedule(cfg);

  if (schedule.length === 0) {
    log.info('Nothing to review yet — solve a few problems first!');
    return;
  }

  const limit = opts.limit ? parseInt(opts.limit, 10) : 15;
  const due = schedule.filter((s) => s.overdueDays >= 0);
  const list = (opts.all ? schedule : due).slice(0, limit);

  if (!opts.all && due.length === 0) {
    const next = schedule[schedule.length - 1];
    log.success('🎉 Nothing due for review today. Great job staying sharp!');
    process.stderr.write(
      pc.dim(`Next up: ${next.slug} on ${next.dueDate} (in ${-next.overdueDays}d). Use --all to see the full schedule.\n`)
    );
    return;
  }

  const heading = opts.all ? 'Full review schedule' : `Due for review (${due.length})`;
  process.stderr.write('\n' + pc.bold(pc.cyan(`🧠 ${heading}`)) + '\n\n');

  for (const item of list) {
    const diff = difficultyColor((item.difficulty || '?').padEnd(6));
    const reps = pc.dim(`×${item.reps}`);
    const when = dueLabel(item);
    process.stderr.write(
      `  ${when.padEnd(22)} ${diff} ${reps.padEnd(6)} ${pc.white(item.slug)} ${pc.dim(`(last ${item.lastSolved})`)}\n`
    );
  }

  process.stderr.write(
    '\n' + pc.dim(`Refresh one with:  leetcode tui <slug>   e.g.  leetcode tui ${list[0].slug}\n`)
  );
}
