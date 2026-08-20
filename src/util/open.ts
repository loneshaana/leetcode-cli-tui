import { spawn } from 'child_process';

/** Open a URL in the user's default browser, based on the OS. Best-effort. */
export function openBrowser(url: string): void {
  const platform = process.platform;
  try {
    if (platform === 'win32') {
      // `start` is a cmd builtin; the empty "" is the window title argument.
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // Ignore; caller prints a fallback message with the URL.
  }
}
