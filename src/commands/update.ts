import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import pc from 'picocolors';
import * as log from '../util/log';
import { getLatestVersion, isNewerVersion } from '../util/update';

const PKG = 'leetcode-cli-tui';

export interface UpdateOptions {
  /** Only report whether an update exists; don't install it. */
  check?: boolean;
}

/** Read this install's version from its own package.json. */
function currentVersion(): string {
  try {
    const raw = readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** `leetcode update` — check npm for a newer release and upgrade in place. */
export async function updateCommand(opts: UpdateOptions): Promise<void> {
  const current = currentVersion();
  log.info(`Current version: ${pc.bold(current)}`);
  log.info('Checking npm for the latest version…');

  const latest = await getLatestVersion();
  if (!latest) {
    log.warn('Could not reach the npm registry (offline or blocked).');
    log.info(`Try again later, or upgrade manually: ${pc.cyan(`npm i -g ${PKG}`)}`);
    process.exitCode = 1;
    return;
  }

  if (!isNewerVersion(latest, current)) {
    log.success(`You're already on the latest version (${pc.bold(latest)}).`);
    return;
  }

  log.info(`Update available: ${pc.dim(current)} ${pc.dim('→')} ${pc.green(latest)}`);

  if (opts.check) {
    log.info(`Run ${pc.cyan('leetcode update')} to upgrade.`);
    return;
  }

  log.info(`Upgrading globally via ${pc.cyan(`npm i -g ${PKG}@latest`)} …`);
  const code = await runNpmInstall();
  if (code === 0) {
    log.success(`Updated to ${pc.bold(latest)}. Open a new terminal to use it.`);
  } else {
    log.error(`Upgrade failed (npm exited with code ${code}).`);
    log.info(
      'If this is a permissions error, re-run with elevated privileges or use a Node ' +
        'version manager (nvm/fnm/volta).'
    );
    process.exitCode = 1;
  }
}

/** Run the global npm install, streaming npm's own output to the user. */
function runNpmInstall(): Promise<number> {
  return new Promise((resolve) => {
    // `shell: true` resolves `npm`/`npm.cmd` across platforms.
    const child = spawn('npm', ['install', '-g', `${PKG}@latest`], {
      stdio: 'inherit',
      shell: true,
    });
    child.on('error', (err) => {
      log.error(err.message);
      resolve(1);
    });
    child.on('close', (code) => resolve(code ?? 1));
  });
}
