import pc from 'picocolors';
import { loadConfig, computeStats, formatDuration, localDate } from '../config';
import { earnedBadges } from '../tui/fun';

/** Render a small horizontal bar of block characters. */
function bar(n: number, max: number, width = 20): string {
  if (max <= 0) return '';
  const filled = Math.round((n / max) * width);
  return '█'.repeat(Math.max(0, filled)) + '░'.repeat(Math.max(0, width - filled));
}

function streakFlame(days: number): string {
  if (days <= 0) return pc.dim('no active streak — solve one today! ');
  const fire = '🔥'.repeat(Math.min(days, 7));
  return `${fire} ${pc.bold(String(days))} day${days === 1 ? '' : 's'}`;
}

/** Shade a day cell by how many problems were solved that day. */
function heatCell(count: number): string {
  if (count <= 0) return pc.dim('·');
  if (count === 1) return pc.green('▪');
  if (count <= 3) return pc.green('▩');
  return pc.greenBright('█');
}

/** A compact "last 30 days" activity strip built from the solve log. */
function activityStrip(dates: string[], today = new Date()): string[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d, (counts.get(d) || 0) + 1);
  const cells: string[] = [];
  for (let i = 29; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    cells.push(heatCell(counts.get(localDate(d)) || 0));
  }
  return cells;
}

export async function statsCommand(): Promise<void> {
  const cfg = loadConfig();
  const s = computeStats(cfg);
  const d = s.byDifficulty;
  const max = Math.max(d.Easy, d.Medium, d.Hard, d.Unknown, 1);

  const out: string[] = [];
  out.push('');
  out.push(pc.bold(pc.cyan('  ✦ Your LeetCode stats ✦')));
  out.push('');
  out.push(`  ${pc.bold('Solved')}      ${pc.bold(pc.green(String(s.total)))} problem${s.total === 1 ? '' : 's'}`);
  out.push(`  ${pc.bold('Today')}       ${s.todayCount > 0 ? pc.green(String(s.todayCount)) : pc.dim('0')}`);
  out.push(`  ${pc.bold('Streak')}      ${streakFlame(s.currentStreak)}`);
  out.push(`  ${pc.bold('Best streak')} ${pc.yellow(String(s.longestStreak))} day${s.longestStreak === 1 ? '' : 's'}`);
  out.push(`  ${pc.bold('Active days')} ${s.activeDays}`);
  out.push('');
  out.push(`  ${pc.green('Easy')}     ${pc.green(bar(d.Easy, max))} ${d.Easy}`);
  out.push(`  ${pc.yellow('Medium')}   ${pc.yellow(bar(d.Medium, max))} ${d.Medium}`);
  out.push(`  ${pc.red('Hard')}     ${pc.red(bar(d.Hard, max))} ${d.Hard}`);
  if (d.Unknown > 0) {
    out.push(`  ${pc.dim('Other')}    ${pc.dim(bar(d.Unknown, max))} ${d.Unknown}`);
  }
  out.push('');

  // Solve times (from recorded personal bests) — data we already track.
  const times = Object.values(cfg.bestTimes || {}).filter((t) => typeof t === 'number' && t > 0);
  if (times.length) {
    const fastest = Math.min(...times);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    out.push(`  ${pc.bold('Solve times')}  ${pc.dim(`(${times.length} timed)`)}`);
    out.push(`  ${pc.cyan('Fastest')}    ${pc.bold(formatDuration(fastest))}`);
    out.push(`  ${pc.cyan('Average')}    ${formatDuration(avg)}`);
    out.push('');
  }

  // Last-30-days activity heatmap from the solve log.
  const cells = activityStrip((cfg.solveLog || []).map((e) => e.date));
  out.push(`  ${pc.bold('Last 30 days')}`);
  out.push('  ' + cells.slice(0, 15).join(' '));
  out.push('  ' + cells.slice(15).join(' ') + `   ${pc.dim('less')} ${pc.dim('·')} ${pc.green('▪')} ${pc.green('▩')} ${pc.greenBright('█')} ${pc.dim('more')}`);
  out.push('');

  const badges = earnedBadges(s);
  if (badges.length) {
    out.push(`  ${pc.bold('Badges')}`);
    out.push('  ' + badges.map((b) => `${b.icon} ${pc.magenta(b.label)}`).join('   '));
    out.push('');
  }
  if (s.total === 0) {
    out.push(pc.dim('  No problems solved yet. Run "leetcode tui <problem>" and get that first ✅!'));
    out.push('');
  }
  process.stdout.write(out.join('\n') + '\n');
}
