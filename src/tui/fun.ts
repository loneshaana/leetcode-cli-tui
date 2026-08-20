import pc from 'picocolors';
import type { Stats } from '../config';

/**
 * Little bits of delight for the LeetCode CLI: celebratory banners, cheers,
 * encouragements and tips. Two flavours are provided: blessed-tag strings for
 * the TUI output pane and picocolors strings for plain CLI output.
 */

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export const CHEERS = [
  'Nailed it! 🚀',
  'Crushed it! 💪',
  'Big brain energy. 🧠',
  'Clean and green. ✅',
  "That's a wrap! 🎬",
  'You own this. 👑',
  'Ship it! 🚢',
  'Flawless victory. 🏆',
  'Certified problem-solver. 🎓',
  'Green means go! 🟢',
];

export const ENCOURAGEMENTS = [
  'So close — tweak and retry! 🔧',
  'Every WA is a clue. Debug on! 🕵️',
  'Bugs fear you. Try again! 🐛',
  'Progress, not perfection. Keep going! 🌱',
  "You'll get it next run. 💡",
  'Deep breath. One edge case at a time. 🌊',
];

export const TIPS = [
  'Tip: Ctrl-T lets you run your own custom testcases.',
  'Tip: press F2 for vim keybindings.',
  'Tip: Ctrl-A saves a clean copy of your solution.',
  'Tip: Ctrl-E opens the file in your $EDITOR.',
  'Tip: brackets and quotes auto-close as you type.',
  'Tip: Enter keeps your indentation automatically.',
  'Tip: Shift-Tab cycles focus between the panes.',
];

const CONFETTI = ['✨', '🎉', '🎊', '⭐', '💫', '🌟', '🎈'];

export function confetti(n = 16): string {
  let s = '';
  for (let i = 0; i < n; i++) s += pick(CONFETTI);
  return s;
}

/** Format a duration in seconds as M:SS (or H:MM:SS past an hour). */
export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

export interface Badge {
  icon: string;
  label: string;
}

/** All achievement badges currently earned for the given stats. */
export function earnedBadges(stats: Stats): Badge[] {
  const b: Badge[] = [];
  const t = stats.total;
  const d = stats.byDifficulty;
  const cs = stats.currentStreak;
  if (t >= 1) b.push({ icon: '✅', label: 'First Blood' });
  if (t >= 10) b.push({ icon: '🔟', label: '10 Solved' });
  if (t >= 25) b.push({ icon: '🥉', label: '25 Solved' });
  if (t >= 50) b.push({ icon: '🥈', label: '50 Solved' });
  if (t >= 100) b.push({ icon: '🥇', label: 'Centurion' });
  if (d.Hard >= 1) b.push({ icon: '💀', label: 'Hard Cleared' });
  if (d.Easy >= 1 && d.Medium >= 1 && d.Hard >= 1) b.push({ icon: '🎯', label: 'Well Rounded' });
  if (cs >= 3) b.push({ icon: '🔥', label: '3-Day Streak' });
  if (cs >= 7) b.push({ icon: '🚀', label: '7-Day Streak' });
  if (cs >= 30) b.push({ icon: '👑', label: '30-Day Streak' });
  return b;
}

/** Badges present in `after` but not in `before` (newly unlocked this solve). */
export function newlyUnlocked(before: Stats, after: Stats): Badge[] {
  const had = new Set(earnedBadges(before).map((x) => x.label));
  return earnedBadges(after).filter((x) => !had.has(x.label));
}

/** Extra celebration details for the Accepted banner. */
export interface AcceptedExtra {
  seconds?: number;
  isPB?: boolean;
  best?: number;
  badges?: Badge[];
}

/** A celebratory Accepted banner using blessed color tags (for the TUI). */
export function acceptedBannerTags(solved?: number, extra?: AcceptedExtra): string {
  const cheer = pick(CHEERS);
  const stat =
    solved && solved > 0 ? `\n{cyan-fg}🏆 ${solved} solved so far — keep the streak alive!{/cyan-fg}` : '';
  const lines = [
    `{green-fg}${confetti(26)}{/green-fg}`,
    '{green-fg}{bold}  ╔══════════════════════╗{/bold}{/green-fg}',
    '{green-fg}{bold}  ║   ✅  ACCEPTED!  ✅  ║{/bold}{/green-fg}',
    '{green-fg}{bold}  ╚══════════════════════╝{/bold}{/green-fg}',
    `{green-fg}${confetti(26)}{/green-fg}`,
    `{yellow-fg}{bold}${cheer}{/bold}{/yellow-fg}${stat}`,
  ];
  if (extra && typeof extra.seconds === 'number') {
    lines.push(
      extra.isPB
        ? `{green-fg}{bold}⏱  New personal best: ${fmtDuration(extra.seconds)}!{/bold}{/green-fg}`
        : `{grey-fg}⏱  Solved in ${fmtDuration(extra.seconds)}` +
            (typeof extra.best === 'number' ? ` (best ${fmtDuration(extra.best)})` : '') +
            `{/grey-fg}`
    );
  }
  if (extra && extra.badges && extra.badges.length) {
    const b = extra.badges.map((x) => `${x.icon} ${x.label}`).join('   ');
    lines.push(`{magenta-fg}{bold}🏅 Unlocked: ${b}{/bold}{/magenta-fg}`);
  }
  lines.push('');
  return lines.join('\n');
}

/** An encouraging header for a non-accepted submission (blessed tags). */
export function encouragementTags(): string {
  return `{yellow-fg}${pick(ENCOURAGEMENTS)}{/yellow-fg}\n`;
}

/** A short welcome + random tip for the TUI output pane (blessed tags). */
export function welcomeTags(title: string): string {
  return [
    `{cyan-fg}{bold}${title}{/bold}{/cyan-fg}`,
    `{grey-fg}${pick(TIPS)}{/grey-fg}`,
    '',
    '{grey-fg}Ctrl-R run · Ctrl-S submit · Ctrl-Q quit{/grey-fg}',
  ].join('\n');
}

/** A celebratory Accepted banner using picocolors (for plain CLI output). */
export function celebrateCli(solved?: number): string {
  const lines = [
    pc.green(confetti()),
    pc.green(pc.bold('  ✅  ACCEPTED!  ✅')),
    pc.yellow(pc.bold(pick(CHEERS))),
  ];
  if (solved && solved > 0) lines.push(pc.cyan(`🏆 ${solved} solved so far`));
  return lines.join('\n');
}
