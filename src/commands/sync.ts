import pc from 'picocolors';
import { loadConfig } from '../config';
import { initSyncRepo, syncPending, syncDir, isGitRepo } from '../util/gitsync';
import * as log from '../util/log';

interface SyncOptions {
  init?: boolean;
  message?: string;
}

export async function syncCommand(opts: SyncOptions): Promise<void> {
  const config = loadConfig();
  const dir = syncDir(config);

  if (opts.init) {
    const res = await initSyncRepo(config);
    if (!res.ok) {
      log.error(`git init failed in ${res.dir}: ${res.detail}`);
      process.exitCode = 1;
      return;
    }
    log.success(`${res.dir}: ${res.detail}`);
    process.stdout.write(
      '\nNext steps:\n' +
        `  1. Create an empty repo on GitHub (e.g. leetcode-solutions).\n` +
        `  2. cd ${dir}\n` +
        `  3. git remote add origin <your-repo-url>\n` +
        `  4. Enable auto-sync: ${pc.cyan('leetcode config --git-sync on')}\n` +
        `\nThat's it — the first Accepted solution (or ${pc.cyan('leetcode sync')}) will make\n` +
        `the initial commit and push, setting the upstream automatically.\n`
    );
    return;
  }

  if (!(await isGitRepo(dir))) {
    log.error(
      `${dir} is not a git repository. Run "leetcode sync --init" to set it up, then add a remote.`
    );
    process.exitCode = 1;
    return;
  }

  log.info(`Syncing pending solutions in ${dir}...`);
  const res = await syncPending(opts.message, config);
  if (res.status === 'committed') {
    log.success(`git: committed${res.pushed ? ' & pushed' : ''}` + (res.detail ? ` — ${res.detail}` : ''));
    if (res.status === 'committed' && res.pushed === false && res.detail) {
      process.exitCode = 1;
    }
  } else if (res.status === 'nochange') {
    log.info('Nothing to sync — working tree is clean.');
  } else {
    log.error(`git sync failed: ${res.detail}`);
    process.exitCode = 1;
  }
}
