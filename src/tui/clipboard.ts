import { spawnSync } from 'child_process';

/**
 * Best-effort OS clipboard bridge. The editor keeps its own internal register
 * as the source of truth, but on copy/cut we also push the text to the system
 * clipboard and on paste we prefer the system clipboard — so code can be moved
 * between the editor and other applications.
 *
 * Every call is wrapped in try/catch and returns a falsy value when the
 * platform clipboard tool is missing (headless CI, minimal Linux, etc.), so
 * callers transparently fall back to the internal register.
 */

interface ClipCommand {
  cmd: string;
  args: string[];
}

function writeCommands(): ClipCommand[] {
  switch (process.platform) {
    case 'win32':
      return [{ cmd: 'clip', args: [] }];
    case 'darwin':
      return [{ cmd: 'pbcopy', args: [] }];
    default:
      return [
        { cmd: 'wl-copy', args: [] },
        { cmd: 'xclip', args: ['-selection', 'clipboard'] },
        { cmd: 'xsel', args: ['--clipboard', '--input'] },
      ];
  }
}

function readCommands(): ClipCommand[] {
  switch (process.platform) {
    case 'win32':
      return [{ cmd: 'powershell', args: ['-NoProfile', '-Command', 'Get-Clipboard'] }];
    case 'darwin':
      return [{ cmd: 'pbpaste', args: [] }];
    default:
      return [
        { cmd: 'wl-paste', args: ['--no-newline'] },
        { cmd: 'xclip', args: ['-selection', 'clipboard', '-o'] },
        { cmd: 'xsel', args: ['--clipboard', '--output'] },
      ];
  }
}

/** Copy `text` to the OS clipboard. Returns true on success. */
export function writeClipboard(text: string): boolean {
  for (const { cmd, args } of writeCommands()) {
    try {
      const r = spawnSync(cmd, args, { input: text, encoding: 'utf8', windowsHide: true });
      if (!r.error && r.status === 0) return true;
    } catch {
      /* try the next candidate */
    }
  }
  return false;
}

/** Read text from the OS clipboard, or null when unavailable. */
export function readClipboard(): string | null {
  for (const { cmd, args } of readCommands()) {
    try {
      const r = spawnSync(cmd, args, { encoding: 'utf8', windowsHide: true });
      if (!r.error && r.status === 0 && typeof r.stdout === 'string') {
        // Normalise CRLF and drop the single trailing newline that tools like
        // `Get-Clipboard` append, without touching intentional inner newlines.
        return r.stdout.replace(/\r\n/g, '\n').replace(/\n$/, '');
      }
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}
