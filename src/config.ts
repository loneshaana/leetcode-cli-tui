import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

export interface StoredCookies {
  session: string;
  csrftoken: string;
  /** ISO timestamp of when the session was captured. */
  capturedAt?: string;
}

export interface Config {
  /** LeetCode session cookies. */
  cookies?: StoredCookies;
  /** Default language slug (canonical, e.g. "java"). */
  lang: string;
  /** Directory where solution files are stored. */
  workspace: string;
  /** Enable vim key bindings in the TUI editor. */
  vim?: boolean;
  /** Syntax color theme for the TUI editor (see highlight.ts THEMES). */
  theme?: string;
  /** Ring the terminal bell on an Accepted submission (default true). */
  bell?: boolean;
  /** Show the problem's topic tags in the TUI Info panel (default true). */
  tags?: boolean;
  /** Slugs of problems you've had Accepted (for the solved counter). */
  solved?: string[];
  /** Chronological log of Accepted submissions (for streaks & stats). */
  solveLog?: SolveEntry[];
  /** Best solve time in seconds, per problem slug. */
  bestTimes?: Record<string, number>;
  /** Cumulative focused time in seconds spent per problem slug (persisted timer). */
  timeSpent?: Record<string, number>;
}

/** One Accepted submission, recorded for streaks and difficulty stats. */
export interface SolveEntry {
  slug: string;
  difficulty?: string;
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
}

const CONFIG_DIR = path.join(os.homedir(), '.leetcode-cli');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CONFIG: Config = {
  lang: 'java',
  workspace: path.join(os.homedir(), 'leetcode-workspace'),
};

export function configDir(): string {
  return CONFIG_DIR;
}

export function configPath(): string {
  return CONFIG_FILE;
}

export function loadConfig(): Config {
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export function saveConfig(config: Config): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
}

export function updateConfig(patch: Partial<Config>): Config {
  const next = { ...loadConfig(), ...patch };
  saveConfig(next);
  return next;
}

export function ensureWorkspace(config: Config): string {
  fs.mkdirSync(config.workspace, { recursive: true });
  return config.workspace;
}

/** Returns cookies or throws a helpful error prompting the user to log in. */
export function requireCookies(config: Config): StoredCookies {
  if (!config.cookies || !config.cookies.session) {
    throw new Error('Not logged in. Run "leetcode login" first.');
  }
  return config.cookies;
}

/** Record a solved problem slug (deduped) and return the new total solved count. */
export function recordSolved(slug: string, difficulty?: string): number {
  const cfg = loadConfig();
  const solved = new Set(cfg.solved || []);
  solved.add(slug);
  const log = cfg.solveLog ? cfg.solveLog.slice() : [];
  log.push({ slug, difficulty, date: localDate(new Date()) });
  saveConfig({ ...cfg, solved: Array.from(solved), solveLog: log });
  return solved.size;
}

/**
 * Record a solve time (seconds) for a slug, keeping only the fastest. Returns
 * the current best and whether this attempt set a new personal best.
 */
export function recordSolveTime(slug: string, seconds: number): { best: number; isPB: boolean } {
  const cfg = loadConfig();
  const times = { ...(cfg.bestTimes || {}) };
  const prev = times[slug];
  const isPB = prev === undefined || seconds < prev;
  if (isPB) {
    times[slug] = seconds;
    saveConfig({ ...cfg, bestTimes: times });
  }
  return { best: times[slug] ?? seconds, isPB };
}

/**
 * Persist the cumulative focused time (seconds) spent on a problem. The TUI
 * timer passes an absolute running total (prior stored time + this session), so
 * reopening a problem resumes from where you left off. Returns the stored total.
 */
export function recordTimeSpent(slug: string, totalSeconds: number): number {
  const cfg = loadConfig();
  const times = { ...(cfg.timeSpent || {}) };
  const next = Math.max(Math.round(totalSeconds), times[slug] ?? 0);
  times[slug] = next;
  saveConfig({ ...cfg, timeSpent: times });
  return next;
}

/** Format a duration in seconds as `MM:SS`, or `H:MM:SS` past an hour. */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/** Format a Date as a local YYYY-MM-DD calendar day. */
export function localDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export interface Stats {
  total: number;
  byDifficulty: { Easy: number; Medium: number; Hard: number; Unknown: number };
  currentStreak: number;
  longestStreak: number;
  todayCount: number;
  activeDays: number;
}

/** Add `n` days to a YYYY-MM-DD string, returning YYYY-MM-DD. */
function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  return localDate(dt);
}

/**
 * Compute current & longest daily streaks from a set of active calendar days.
 * The current streak counts consecutive days ending today (a missed today is
 * forgiven if yesterday was active, so an in-progress streak still shows).
 */
export function streakInfo(
  dates: string[],
  today: string
): { current: number; longest: number; activeDays: number } {
  const set = new Set(dates);
  const sorted = Array.from(set).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    run = prev !== null && addDays(prev, 1) === d ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = d;
  }
  let anchor: string | null = null;
  if (set.has(today)) anchor = today;
  else if (set.has(addDays(today, -1))) anchor = addDays(today, -1);
  let current = 0;
  while (anchor && set.has(anchor)) {
    current++;
    anchor = addDays(anchor, -1);
  }
  return { current, longest, activeDays: set.size };
}

/** Aggregate solve statistics from the config (or a supplied one). */
export function computeStats(cfg: Config = loadConfig(), today = localDate(new Date())): Stats {
  const log = cfg.solveLog || [];
  const byDifficulty = { Easy: 0, Medium: 0, Hard: 0, Unknown: 0 };
  const seen = new Set<string>();
  for (const e of log) {
    if (seen.has(e.slug)) continue;
    seen.add(e.slug);
    const key = (e.difficulty || '').toLowerCase();
    if (key === 'easy') byDifficulty.Easy++;
    else if (key === 'medium') byDifficulty.Medium++;
    else if (key === 'hard') byDifficulty.Hard++;
    else byDifficulty.Unknown++;
  }
  // Older configs only have `solved` (no log): count them as Unknown.
  const solvedSet = new Set(cfg.solved || []);
  for (const slug of solvedSet) {
    if (!seen.has(slug)) {
      seen.add(slug);
      byDifficulty.Unknown++;
    }
  }
  const total = seen.size;
  const { current, longest, activeDays } = streakInfo(
    log.map((e) => e.date),
    today
  );
  const todayCount = new Set(log.filter((e) => e.date === today).map((e) => e.slug)).size;
  return { total, byDifficulty, currentStreak: current, longestStreak: longest, todayCount, activeDays };
}

/** A problem's spaced-repetition review status, derived from the solve log. */
export interface ReviewItem {
  slug: string;
  difficulty?: string;
  lastSolved: string;
  reps: number;
  dueDate: string;
  /** today − dueDate in days; >= 0 means it is due for review. */
  overdueDays: number;
}

/** Whole-day difference `to − from` for two YYYY-MM-DD strings. */
function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** Expanding review intervals (in days) indexed by how many times solved. */
const REVIEW_INTERVALS = [1, 3, 7, 16, 35, 90];

/**
 * Build a spaced-repetition review schedule from the solve log. Each distinct
 * problem is scheduled from its most recent solve, with the interval growing
 * the more times it has been solved. Items are sorted most-overdue first.
 */
export function reviewSchedule(cfg: Config = loadConfig(), today = localDate(new Date())): ReviewItem[] {
  const log = cfg.solveLog || [];
  const groups = new Map<string, { difficulty?: string; dates: string[] }>();
  for (const e of log) {
    const g = groups.get(e.slug) || { difficulty: e.difficulty, dates: [] };
    if (e.difficulty && !g.difficulty) g.difficulty = e.difficulty;
    g.dates.push(e.date);
    groups.set(e.slug, g);
  }
  const items: ReviewItem[] = [];
  for (const [slug, g] of groups) {
    const dates = g.dates.slice().sort();
    const reps = dates.length;
    const last = dates[dates.length - 1];
    const interval = REVIEW_INTERVALS[Math.min(reps - 1, REVIEW_INTERVALS.length - 1)];
    const dueDate = addDays(last, interval);
    items.push({
      slug,
      difficulty: g.difficulty,
      lastSolved: last,
      reps,
      dueDate,
      overdueDays: daysBetween(dueDate, today),
    });
  }
  items.sort((a, b) => b.overdueDays - a.overdueDays || a.dueDate.localeCompare(b.dueDate));
  return items;
}
