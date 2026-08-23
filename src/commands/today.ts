interface TodayOptions {
  lang?: string;
  open?: boolean;
  gen?: boolean;
  overwrite?: boolean;
  tui?: boolean;
}

/**
 * Fetch today's LeetCode daily challenge. By default this mirrors `show daily`
 * (fetch + generate a solution file); with `--tui` it opens the split-pane TUI.
 * Both paths reuse the already-tested `resolveProblem("daily")` resolution.
 *
 * Command modules are imported lazily so the non-TUI path never pulls in the
 * heavy `blessed` dependency that the TUI needs.
 */
export async function todayCommand(opts: TodayOptions): Promise<void> {
  if (opts.tui) {
    // These only make sense for the default file-generation mode; flag them so
    // the user isn't silently surprised (the TUI always keeps a solution file).
    const conflicts: string[] = [];
    if (opts.open) conflicts.push('--open');
    if (opts.gen === false) conflicts.push('--no-gen');
    if (opts.overwrite) conflicts.push('--overwrite');
    if (conflicts.length) {
      throw new Error(`${conflicts.join(', ')} cannot be combined with --tui.`);
    }
    const { tuiCommand } = await import('./tui.js');
    await tuiCommand('daily', { lang: opts.lang });
    return;
  }
  const { showCommand } = await import('./show.js');
  await showCommand('daily', {
    lang: opts.lang,
    open: opts.open,
    gen: opts.gen,
    overwrite: opts.overwrite,
  });
}
