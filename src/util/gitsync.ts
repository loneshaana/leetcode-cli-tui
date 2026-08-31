import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { Config, loadConfig } from '../config';
import { resolveLang } from '../languages';
import { exportSolutionCode } from '../solution';

/** Details of an Accepted solution to persist into the git repo. */
export interface SolvedInfo {
  frontendId: string;
  slug: string;
  title: string;
  /** Canonical language slug (e.g. "java", "python3"). */
  lang: string;
  difficulty?: string;
  /** Clean solution code (no problem description / metadata header). */
  code: string;
}

export interface SyncResult {
  status: 'disabled' | 'committed' | 'nochange' | 'error';
  pushed?: boolean;
  file?: string;
  message?: string;
  detail?: string;
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run a git command in `dir`, resolving (never rejecting) with the result. */
function git(dir: string, args: string[], timeoutMs = 20000): Promise<GitResult> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn('git', ['-C', dir, ...args], { windowsHide: true });
    } catch (e) {
      resolve({ code: -1, stdout: '', stderr: (e as Error).message });
      return;
    }
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }, timeoutMs);
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (err += d));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout: out, stderr: err || (e as Error).message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: out, stderr: err });
    });
  });
}

/** The directory solutions are synced into (dedicated dir or the workspace). */
export function syncDir(config: Config): string {
  return config.gitSyncDir || config.workspace;
}

/** True when `dir` exists and is inside a git work tree. */
export async function isGitRepo(dir: string): Promise<boolean> {
  if (!dir || !fs.existsSync(dir)) return false;
  const r = await git(dir, ['rev-parse', '--is-inside-work-tree']);
  return r.code === 0 && r.stdout.trim() === 'true';
}

function solutionRepoPath(dir: string, info: SolvedInfo): string {
  const ext = resolveLang(info.lang).ext;
  return path.join(dir, 'solutions', `${info.frontendId}-${info.slug}.${ext}`);
}

function commitMessage(config: Config, info: SolvedInfo): string {
  const tmpl = config.gitSyncMessage || 'Solve {id}. {title}{difficulty} ({lang})';
  const diff = info.difficulty ? ` [${info.difficulty}]` : '';
  return tmpl
    .replace(/\{id\}/g, info.frontendId)
    .replace(/\{slug\}/g, info.slug)
    .replace(/\{title\}/g, info.title || info.slug)
    .replace(/\{difficulty\}/g, diff)
    .replace(/\{lang\}/g, info.lang);
}

/**
 * Commit (and optionally push) the given paths in `dir`. Returns a result
 * object describing the outcome; never throws.
 */
async function commitAndPush(
  dir: string,
  message: string,
  addPaths: string[],
  push: boolean
): Promise<SyncResult> {
  const add = await git(dir, ['add', '--', ...addPaths]);
  if (add.code !== 0) {
    return { status: 'error', detail: add.stderr.trim() || 'git add failed' };
  }
  const staged = await git(dir, ['diff', '--cached', '--quiet', '--', ...addPaths]);
  // exit 0 => no staged changes; exit 1 => changes present.
  if (staged.code === 0) return { status: 'nochange' };
  const commit = await git(dir, ['commit', '-m', message, '--', ...addPaths]);
  if (commit.code !== 0) {
    const hint = /user\.(name|email)|please tell me who you are/i.test(commit.stderr)
      ? ' (set git user.name / user.email)'
      : '';
    return { status: 'error', message, detail: (commit.stderr.trim() || 'git commit failed') + hint };
  }
  if (!push) return { status: 'committed', pushed: false, message };
  let pushed = await git(dir, ['push'], 30000);
  // First push on a fresh branch has no upstream. If a remote exists, retry with
  // `push -u origin <branch>` so the very first sync just works.
  if (pushed.code !== 0 && /no upstream|set-upstream|has no upstream branch/i.test(pushed.stderr)) {
    const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim() || 'HEAD';
    const remote = await git(dir, ['remote']);
    const remotes = remote.stdout.split(/\r?\n/).map((r) => r.trim()).filter(Boolean);
    if (remotes.length > 0) {
      const target = remotes.includes('origin') ? 'origin' : remotes[0];
      pushed = await git(dir, ['push', '-u', target, branch], 30000);
    }
  }
  if (pushed.code !== 0) {
    const hint = /no upstream|set-upstream|no configured push destination|does not appear to be a git repo|no such remote|'origin'/i.test(
      pushed.stderr
    )
      ? ' (add a remote first: git -C <dir> remote add origin <url>)'
      : '';
    return {
      status: 'committed',
      pushed: false,
      message,
      detail: (pushed.stderr.trim() || 'git push failed') + hint,
    };
  }
  return { status: 'committed', pushed: true, message };
}

/**
 * Persist an Accepted solution into the configured git repo and commit/push it.
 * No-ops when git sync is disabled. Wrapped so a failure only surfaces a warning
 * — it must never break the submit flow.
 */
export async function syncSolvedSolution(
  info: SolvedInfo,
  config: Config = loadConfig()
): Promise<SyncResult> {
  try {
    if (!config.gitSync) return { status: 'disabled' };
    const dir = syncDir(config);
    if (!(await isGitRepo(dir))) {
      return {
        status: 'error',
        detail: `${dir} is not a git repository. Run "leetcode sync --init" there and add a remote.`,
      };
    }
    const file = solutionRepoPath(dir, info);
    exportSolutionCode(info.code, file);
    const rel = path.relative(dir, file) || file;
    const result = await commitAndPush(
      dir,
      commitMessage(config, info),
      [rel],
      config.gitSyncPush !== false
    );
    return { ...result, file };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
}

/**
 * Manually commit & push everything currently pending under `solutions/` in the
 * sync directory. Used by `leetcode sync` for backfills / catch-up.
 */
export async function syncPending(
  message = 'Update LeetCode solutions',
  config: Config = loadConfig()
): Promise<SyncResult> {
  try {
    const dir = syncDir(config);
    if (!(await isGitRepo(dir))) {
      return {
        status: 'error',
        detail: `${dir} is not a git repository. Run "leetcode sync --init" there and add a remote.`,
      };
    }
    const solDir = path.join(dir, 'solutions');
    const addPath = fs.existsSync(solDir) ? 'solutions' : '.';
    return await commitAndPush(dir, message, [addPath], config.gitSyncPush !== false);
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
}

/**
 * Initialize a git repository in the sync directory (idempotent) and ensure the
 * `solutions/` folder exists. Returns a human-readable status line.
 */
export async function initSyncRepo(
  config: Config = loadConfig()
): Promise<{ ok: boolean; dir: string; detail: string }> {
  const dir = syncDir(config);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'solutions'), { recursive: true });
    if (await isGitRepo(dir)) {
      return { ok: true, dir, detail: 'already a git repository' };
    }
    const init = await git(dir, ['init']);
    if (init.code !== 0) {
      return { ok: false, dir, detail: init.stderr.trim() || 'git init failed' };
    }
    return { ok: true, dir, detail: 'initialized empty git repository' };
  } catch (e) {
    return { ok: false, dir, detail: (e as Error).message };
  }
}
