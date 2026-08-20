import { updateConfig, loadConfig, StoredCookies } from '../config';
import { LeetCodeClient } from '../api/client';
import * as log from '../util/log';
import { promptSequence } from '../util/prompt';
import { openBrowser } from '../util/open';

interface LoginOptions {
  /** Do not open the browser automatically. */
  open?: boolean; // commander sets this false when --no-open is passed
  /** Re-login even if a valid session already exists. */
  force?: boolean;
}

const LOGIN_URL = 'https://leetcode.com/accounts/login/';

/**
 * Validate stored cookies against LeetCode.
 *
 * Returns the username if the session is still valid, or null if there are no
 * cookies, the session expired, or the check could not be completed.
 */
export async function validateStoredSession(
  cookies: StoredCookies | undefined
): Promise<{ username: string } | null> {
  if (!cookies || !cookies.session) return null;
  try {
    const user = await new LeetCodeClient(cookies).getCurrentUser();
    return user ? { username: user.username } : null;
  } catch {
    return null;
  }
}

/**
 * Log in to LeetCode and capture the session cookies.
 *
 * On first use this opens the default browser and stores the pasted cookies.
 * On subsequent runs the saved cookies are validated first: if they are still
 * valid we keep using them, otherwise we prompt for a fresh login.
 */
export async function loginCommand(opts: LoginOptions): Promise<void> {
  const existing = loadConfig().cookies;

  if (!opts.force) {
    const valid = await validateStoredSession(existing);
    if (valid) {
      log.success(
        valid.username
          ? `Already logged in as ${valid.username}. Session is valid.`
          : 'Already logged in. Session is valid.'
      );
      log.info('Run "leetcode login --force" to sign in with a different account.');
      return;
    }
    if (existing && existing.session) {
      log.warn('Your saved session has expired. Please log in again.');
    }
  }

  if (opts.open !== false) {
    log.info('Opening LeetCode in your default browser...');
    openBrowser(LOGIN_URL);
  } else {
    log.info(`Open this URL and sign in: ${LOGIN_URL}`);
  }

  process.stderr.write(
    [
      '',
      'After signing in, copy your session cookies:',
      '  1. Open DevTools (F12) > Application (or Storage) > Cookies > https://leetcode.com',
      '  2. Copy the value of "LEETCODE_SESSION" and "csrftoken".',
      '',
    ].join('\n')
  );

  const [session, csrftoken] = await promptSequence(['LEETCODE_SESSION: ', 'csrftoken: ']);
  if (!session || !csrftoken) {
    log.error('Both LEETCODE_SESSION and csrftoken are required.');
    process.exitCode = 1;
    return;
  }

  const candidate: StoredCookies = {
    session,
    csrftoken,
    capturedAt: new Date().toISOString(),
  };

  log.info('Validating session...');
  const valid = await validateStoredSession(candidate);
  if (!valid) {
    log.error('Those cookies did not authenticate. Nothing was saved. Please try again.');
    process.exitCode = 1;
    return;
  }

  updateConfig({ cookies: candidate });
  const cfg = loadConfig();
  log.success(valid.username ? `Session saved. Logged in as ${valid.username}.` : 'Session saved.');
  log.info(`Default language: ${cfg.lang}   Workspace: ${cfg.workspace}`);
}
