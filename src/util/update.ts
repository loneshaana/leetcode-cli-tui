import https from 'https';
import * as fs from 'fs';
import * as path from 'path';
import pc from 'picocolors';
import { configDir } from '../config';

/**
 * Lightweight, dependency-free "update available" notifier (like the popular
 * `update-notifier`, but without the dependency tree).
 *
 * Design goals:
 * - Never slow the CLI down: the notice is printed from a small on-disk cache
 *   that a PRIOR run refreshed. The network check runs in the background with
 *   its socket unref'd so it can't keep a quick command alive.
 * - Never crash the CLI: every path is wrapped in try/catch and stays silent on
 *   any error (offline, missing cache dir, malformed JSON, …).
 * - Be quiet in non-interactive/CI use so it doesn't pollute scripted output.
 */

const PKG = 'leetcode-cli-tui';
const CACHE_FILE = path.join(configDir(), 'update-check.json');
/** How often to hit the registry, at most. */
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day
/** Hard cap on the background request so it never lingers. */
const REQUEST_TIMEOUT_MS = 3000;

interface UpdateCache {
  /** Epoch millis of the last successful registry check. */
  lastCheck: number;
  /** Latest version string seen on the registry. */
  latest: string;
}

/** Parse `major.minor.patch` (ignoring any pre-release/build suffix). */
function parseVersion(v: string): [number, number, number] | null {
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(v || '');
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** True when `a` is a strictly newer release than `b` (pre-release ignored). */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return false;
  for (let i = 0; i < 3; i++) {
    if (pa[i] > pb[i]) return true;
    if (pa[i] < pb[i]) return false;
  }
  return false;
}

function readCache(): UpdateCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')) as Partial<UpdateCache>;
    if (typeof parsed.lastCheck === 'number' && typeof parsed.latest === 'string') {
      return { lastCheck: parsed.lastCheck, latest: parsed.latest };
    }
  } catch {
    /* no cache yet / unreadable — ignore */
  }
  return null;
}

function writeCache(cache: UpdateCache): void {
  try {
    fs.mkdirSync(configDir(), { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache), 'utf8');
  } catch {
    /* best effort; a failed cache write just means we check again next time */
  }
}

/** True when the notifier should stay silent (CI, piped output, opt-out). */
function disabled(): boolean {
  if (process.env.NO_UPDATE_NOTIFIER) return true;
  if (process.env.CI) return true;
  // Only nag in an interactive terminal so scripts/pipes stay clean.
  if (!process.stderr.isTTY) return true;
  return false;
}

/** Fetch the latest published version from the npm registry (best effort). */
function fetchLatest(onDone: (latest: string | null) => void, background = true): void {
  let settled = false;
  const finish = (v: string | null): void => {
    if (settled) return;
    settled = true;
    onDone(v);
  };
  try {
    const req = https.get(
      `https://registry.npmjs.org/${PKG}/latest`,
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers: {
          // Ask for the slim "corgi" document to minimise the payload.
          Accept: 'application/vnd.npm.install-v1+json, application/json',
          'User-Agent': `${PKG} update-check`,
        },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          finish(null);
          return;
        }
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
          if (body.length > 1_000_000) req.destroy(); // guard against a runaway body
        });
        res.on('end', () => {
          try {
            const version = (JSON.parse(body) as { version?: string }).version;
            finish(typeof version === 'string' ? version : null);
          } catch {
            finish(null);
          }
        });
      }
    );
    req.on('error', () => finish(null));
    req.on('timeout', () => req.destroy());
    // A background check must not keep an otherwise-finished command alive; an
    // explicit `leetcode update` awaits the result, so there we keep the socket
    // ref'd so the process stays alive until the request resolves.
    if (background) req.on('socket', (socket) => socket.unref());
  } catch {
    finish(null);
  }
}

/**
 * Resolve the latest published version (or null if the registry is
 * unreachable). Used by the explicit `leetcode update` command, which awaits
 * the result — so unlike the background check this keeps the socket ref'd.
 */
export function getLatestVersion(): Promise<string | null> {
  return new Promise((resolve) => fetchLatest(resolve, false));
}

let noticePrinted = false;

/** Print the "update available" notice once, using the cached latest version. */
function printNotice(current: string, latest: string): void {
  if (noticePrinted) return;
  noticePrinted = true;
  process.stderr.write(
    '\n' +
      pc.yellow('▲ Update available: ') +
      pc.dim(current) +
      pc.dim(' → ') +
      pc.green(latest) +
      '\n' +
      '  Run ' +
      pc.cyan('leetcode update') +
      ' (or ' +
      pc.cyan(`npm i -g ${PKG}`) +
      ') to upgrade.\n\n'
  );
}

/**
 * Wire up the update notifier. Safe to call unconditionally at startup:
 * - reads the cached latest version and, on process exit, prints a notice if a
 *   newer version than `currentVersion` is known;
 * - if the cache is missing or older than a day, kicks off a background refresh
 *   (with an unref'd socket) so the next run has fresh data — and, when that
 *   refresh finishes before this process exits (e.g. network commands), the
 *   notice can even appear on this run.
 */
export function checkForUpdates(currentVersion: string): void {
  try {
    if (disabled()) return;
    if (!parseVersion(currentVersion)) return; // dev/unknown build — skip

    const cache = readCache();
    const stale = !cache || Date.now() - cache.lastCheck > CHECK_INTERVAL_MS;

    if (stale) {
      fetchLatest((latest) => {
        if (latest) writeCache({ lastCheck: Date.now(), latest });
      });
    }

    // Print at exit so the notice lands after the command's own output (the
    // most visible spot) and reflects the freshest cache available by then.
    process.once('exit', () => {
      try {
        const latest = readCache()?.latest;
        if (latest && isNewerVersion(latest, currentVersion)) {
          printNotice(currentVersion, latest);
        }
      } catch {
        /* never let the notifier break shutdown */
      }
    });
  } catch {
    /* the notifier must never interfere with the actual command */
  }
}
