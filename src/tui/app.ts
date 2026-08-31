import blessed from 'blessed';
import { spawn } from 'child_process';
import { LeetCodeClient } from '../api/client';
import { Problem } from '../api/types';
import type { JudgeResult } from '../api/types';
import { htmlToText } from '../render';
import {
  parseSolutionFile,
  writeCodeRegion,
  exportSolutionCode,
  defaultExportPath,
} from '../solution';
import { formatRunResult, formatSubmitResult } from '../results';
import { CodeEditor } from './editor';
import { configureColors, getThemeUi } from './highlight';
import { loadConfig, recordSolved, recordSolveTime, recordTimeSpent, formatDuration, computeStats } from '../config';
import { acceptedBannerTags, encouragementTags, welcomeTags, newlyUnlocked } from './fun';
import { syncSolvedSolution } from '../util/gitsync';

export interface TuiParams {
  client: LeetCodeClient;
  problem: Problem;
  filePath: string;
}

const HELP =
  '{cyan-fg}{bold}⇧Tab{/bold}{/cyan-fg} pane  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^R{/bold}{/cyan-fg} run  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^S{/bold}{/cyan-fg} submit  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^T{/bold}{/cyan-fg} test  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F3{/bold}{/cyan-fg} hint  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F4{/bold}{/cyan-fg} reset  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^A{/bold}{/cyan-fg} save-as  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^W{/bold}{/cyan-fg} save  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F2{/bold}{/cyan-fg} vim  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^F{/bold}{/cyan-fg} zoom  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^P{/bold}{/cyan-fg} pause  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}?{/bold}{/cyan-fg}{grey-fg}/{/grey-fg}{cyan-fg}{bold}F1{/bold}{/cyan-fg} help  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^Q{/bold}{/cyan-fg} quit';

const HELP_OVERLAY =
  '{center}{bold}{cyan-fg}⚡ LeetCode TUI — Keys{/cyan-fg}{/bold}{/center}\n\n' +
  '  {yellow-fg}{bold}Solve{/bold}{/yellow-fg}\n' +
  '    {cyan-fg}Ctrl-R{/cyan-fg}   Run against sample (or custom) tests\n' +
  '    {cyan-fg}Ctrl-S{/cyan-fg}   Submit\n' +
  '    {cyan-fg}Ctrl-T{/cyan-fg}   Open/close the custom testcase editor\n' +
  '    {cyan-fg}F3{/cyan-fg}       Reveal the next hint\n\n' +
  '  {yellow-fg}{bold}Editor{/bold}{/yellow-fg}\n' +
  '    {cyan-fg}F2{/cyan-fg}       Toggle vim mode\n' +
  '    {cyan-fg}F4{/cyan-fg}       Reset editor to starter code\n' +
  '    {cyan-fg}Ctrl-Z/Y{/cyan-fg} Undo / redo\n' +
  '    {cyan-fg}Shift+↑↓←→{/cyan-fg} Select text (also Shift+Home/End/PgUp/PgDn)\n' +
  '    {cyan-fg}Ctrl-C{/cyan-fg}   Copy selection   {cyan-fg}Ctrl-V{/cyan-fg} Paste\n' +
  '    {cyan-fg}Ctrl-X{/cyan-fg}   Cut selection (or delete current line)\n' +
  '    {cyan-fg}Ctrl-E{/cyan-fg}   Edit in $EDITOR and come back\n\n' +
  '  {yellow-fg}{bold}Files & panes{/bold}{/yellow-fg}\n' +
  '    {cyan-fg}Shift-Tab/F6{/cyan-fg}  Cycle panes (then scroll with ↑↓/PgUp/PgDn/Home/End/g/G)\n' +
  '    {cyan-fg}Ctrl-F{/cyan-fg}   Maximize / restore the focused pane (zoom)\n' +
  '    {cyan-fg}Ctrl-↑/↓{/cyan-fg}      Scroll the Output pane from anywhere\n' +
  '    {cyan-fg}Ctrl-W{/cyan-fg}   Save file    {cyan-fg}Ctrl-A{/cyan-fg} Save solution as…\n\n' +
  '  {yellow-fg}{bold}Timer{/bold}{/yellow-fg}\n' +
  '    {cyan-fg}Ctrl-P{/cyan-fg}   Pause / resume the problem timer\n\n' +
  '  {yellow-fg}{bold}Session{/bold}{/yellow-fg}\n' +
  '    {cyan-fg}Ctrl-Q{/cyan-fg}   Quit (saves first)\n\n' +
  '{center}{grey-fg}Press F1 or Esc to close{/grey-fg}{/center}';

const SPINNER = ['|', '/', '-', '\\'];

export function runTui(params: TuiParams): Promise<void> {
  const { client, problem, filePath } = params;

  return new Promise<void>((resolve) => {
    const screen = blessed.screen({
      smartCSR: true,
      title: `LeetCode ${problem.frontendId}. ${problem.title}`,
      fullUnicode: true,
      autoPadding: true,
    });

    // Match syntax colours to the terminal's real capability. blessed@0.1.x
    // downsamples truecolor hex to the terminal palette; on 8-colour terminals
    // (e.g. Windows with no TERM/COLORTERM) dim comment colours collapse to
    // black and become invisible, so fall back to a named-colour palette.
    configureColors((screen.program as unknown as { tput?: { colors?: number } }).tput?.colors);

    blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'white', bg: '#30365a' },
      content: buildHeader(problem, langOf(filePath)),
    });

    const descBox = blessed.box({
      parent: screen,
      label: ' 📄 Problem ',
      top: 1,
      left: 0,
      width: '40%',
      bottom: 5,
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      keyable: true,
      mouse: true,
      vi: true,
      tags: true,
      scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'cyan' } },
      style: { border: { fg: 'blue' }, focus: { border: { fg: 'cyan' } } },
      content: buildDescription(problem),
    });

    // Colored metadata (difficulty + tags) pinned at the bottom of the left pane.
    const infoBox = blessed.box({
      parent: screen,
      label: ' ℹ Info ',
      left: 0,
      bottom: 1,
      width: '40%',
      height: 4,
      border: { type: 'line' },
      tags: true,
      style: { border: { fg: 'blue' } },
      content: buildMeta(problem),
    });

    const editor = new CodeEditor(
      screen,
      {
        parent: screen,
        label: ' 📝 Editor ',
        top: 1,
        left: '40%',
        width: '60%',
        height: '70%-1',
        border: { type: 'line' },
        style: { border: { fg: 'green' }, focus: { border: { fg: 'green' } } },
      },
      () => markDirty(),
      {
        gutter: true,
        highlight: true,
        lang: langOf(filePath),
        theme: loadConfig().theme,
        autoClose: true,
        vim: loadConfig().vim === true,
        onStatus: (text) => setVimStatus(text),
        onSave: () => saveCode(),
        onQuit: () => quit(),
      }
    );

    const outputBox = blessed.box({
      parent: screen,
      label: ' ▶ Output ',
      top: '70%',
      left: '40%',
      width: '60%',
      bottom: 1,
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      keyable: true,
      mouse: true,
      vi: true,
      tags: true,
      scrollbar: { ch: ' ', style: { bg: 'cyan' } },
      style: { border: { fg: 'magenta' }, focus: { border: { fg: 'yellow' } } },
      content: 'Ready. Ctrl-R runs the sample tests, Ctrl-S submits.',
    });

    // blessed's scrollable box only binds ↑/↓/j/k/g/G/Ctrl-U/D/B/F — it never
    // wires PageUp/PageDown/Home/End. Add them so the Problem and Output panes
    // scroll with the keys the help advertises when they hold focus.
    function wirePageKeys(bx: blessed.Widgets.BoxElement): void {
      bx.on('keypress', (_ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
        const page = Math.max(1, (bx.height as number) - (bx as unknown as { iheight: number }).iheight);
        const b = bx as unknown as {
          scroll(n: number): void;
          scrollTo(n: number): void;
          getScrollHeight(): number;
        };
        if (key.name === 'pageup') b.scroll(-page);
        else if (key.name === 'pagedown') b.scroll(page);
        else if (key.name === 'home') b.scrollTo(0);
        else if (key.name === 'end') b.scrollTo(b.getScrollHeight());
        else return;
        screen.render();
      });
    }
    wirePageKeys(descBox);
    wirePageKeys(outputBox);

    const status = blessed.box({
      parent: screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      tags: true,
      style: { fg: 'white', bg: '#26263b' },
      content: HELP,
    });

    // ---- Keybinding help overlay (hidden until "?") ------------------------
    const helpPopup = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: 60,
      height: 28,
      border: { type: 'line' },
      tags: true,
      padding: { left: 1, right: 1 },
      style: { border: { fg: 'cyan' }, bg: 'black' },
      content: HELP_OVERLAY,
    });
    let helpOpen = false;
    function toggleHelp(): void {
      helpOpen = !helpOpen;
      if (helpOpen) {
        helpPopup.show();
        helpPopup.setFront();
        // Focus the overlay so keystrokes don't fall through to the editor.
        helpPopup.focus();
        screen.program.hideCursor();
        screen.render();
      } else {
        helpPopup.hide();
        focusPane(current);
      }
    }

    // ---- Custom testcase popup (hidden until Ctrl-T) -----------------------
    const tcPopup = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '60%',
      border: { type: 'line' },
      label: ' 🧪 Custom testcase (Ctrl-R run · Esc save & close · Ctrl-X clear) ',
      style: { border: { fg: 'magenta' } },
    });
    blessed.box({
      parent: tcPopup,
      bottom: 0,
      left: 1,
      height: 1,
      width: '100%-3',
      tags: false,
      style: { fg: 'grey' },
      content: 'One argument per line, matching the example format. Empty = use the sample tests.',
    });
    const tcEditor = new CodeEditor(
      screen,
      {
        parent: tcPopup,
        top: 0,
        left: 0,
        width: '100%-2',
        height: '100%-3',
      },
      () => screen.render()
    );

    /** null = use the problem's example test cases. */
    let customTestcase: string | null = null;
    let tcOpen = false;

    // ---- "Save solution as" popup (hidden until Ctrl-A) --------------------
    const savePopup = blessed.box({
      parent: screen,
      hidden: true,
      top: 'center',
      left: 'center',
      width: '70%',
      height: 6,
      border: { type: 'line' },
      label: ' 💾 Save solution to file (Enter = save · Esc = cancel) ',
      style: { border: { fg: 'green' } },
    });
    blessed.box({
      parent: savePopup,
      bottom: 0,
      left: 1,
      height: 1,
      width: '100%-3',
      tags: false,
      style: { fg: 'grey' },
      content: 'Writes the clean solution code (no metadata/description) to this path.',
    });
    let saveOpen = false;
    const pathEditor = new CodeEditor(
      screen,
      { parent: savePopup, top: 1, left: 1, width: '100%-3', height: 1 },
      () => screen.render(),
      { onSubmit: (value) => confirmSave(value) }
    );

    const focusables: Array<() => void> = [
      () => descBox.focus(),
      () => editor.focus(),
      () => outputBox.focus(),
    ];
    let current = 1;
    let dirty = false;
    let busy = false;
    let hintIdx = 0;
    let vimStatus = '';
    let spinnerTimer: NodeJS.Timeout | null = null;
    let clockTimer: NodeJS.Timeout | null = null;
    // Pausable, persisted timer. `baseElapsed` is time carried over from prior
    // sessions on this problem.
    const timerSlug = problem.titleSlug;
    const baseElapsed = loadConfig().timeSpent?.[timerSlug] ?? 0;
    // Track in milliseconds so sub-second running segments aren't lost each time
    // the timer is paused (flooring only happens when we expose/persist whole
    // seconds). `accumulatedMs` holds completed segments; `runningSince` marks
    // the current running segment start (null = paused).
    let accumulatedMs = 0;
    let runningSince: number | null = Date.now();
    let timerFlushTick = 0;

    function sessionSeconds(): number {
      const liveMs = runningSince ? Date.now() - runningSince : 0;
      return Math.floor((accumulatedMs + liveMs) / 1000);
    }
    function totalSeconds(): number {
      return baseElapsed + sessionSeconds();
    }
    function persistTime(): void {
      recordTimeSpent(timerSlug, totalSeconds());
    }
    function pauseTimer(): void {
      if (runningSince) {
        accumulatedMs += Date.now() - runningSince;
        runningSince = null;
        persistTime();
      }
    }
    function resumeTimer(): void {
      if (!runningSince) runningSince = Date.now();
    }
    function toggleTimer(): void {
      if (runningSince) {
        pauseTimer();
        setOutput('⏸  Timer paused. Press ^P to resume.');
      } else {
        resumeTimer();
        setOutput('▶  Timer resumed.');
      }
      renderStatusBar();
    }

    function refresh(): void {
      screen.render();
      placeCaret();
    }

    function placeCaret(): void {
      if (tcOpen && tcEditor.isFocused()) tcEditor.placeCaret();
      else if (saveOpen && pathEditor.isFocused()) pathEditor.placeCaret();
      else if (editor.isFocused()) editor.placeCaret();
      else screen.program.hideCursor();
    }

    function openSave(): void {
      saveOpen = true;
      pathEditor.setValue(defaultExportPath(filePath, parseSolutionFile(filePath).meta));
      savePopup.show();
      savePopup.setFront();
      pathEditor.focus();
      refresh();
    }

    function closeSave(): void {
      saveOpen = false;
      savePopup.hide();
      focusPane(1);
    }

    function confirmSave(rawPath: string): void {
      const target = rawPath.trim();
      if (!target) {
        closeSave();
        return;
      }
      try {
        exportSolutionCode(editor.getValue(), target);
        closeSave();
        setOutput('Saved solution to:\n' + target);
      } catch (err) {
        closeSave();
        setOutput('Save failed:\n' + (err as Error).message);
      }
    }

    function resetStatus(): void {
      renderStatusBar();
    }

    function clock(): string {
      return formatDuration(totalSeconds());
    }

    function renderStatusBar(): void {
      const paused = runningSince === null;
      const time = paused
        ? `{grey-fg}{bold}⏸ ${clock()} paused{/bold}{/grey-fg}`
        : `{yellow-fg}{bold}⏱ ${clock()}{/bold}{/yellow-fg}`;
      const pb = loadConfig().bestTimes?.[timerSlug];
      const best = pb ? ` {grey-fg}·{/grey-fg} {magenta-fg}best ${formatDuration(pb)}{/magenta-fg}` : '';
      const pos = editor.isFocused()
        ? (() => {
            const c = editor.cursorPosition();
            return ` {grey-fg}·{/grey-fg} {cyan-fg}Ln ${c.line}/${c.lines}, Col ${c.col}{/cyan-fg}`;
          })()
        : '';
      const mode = vimStatus
        ? ` {yellow-bg}{black-fg} ${vimStatus} {/black-fg}{/yellow-bg}`
        : '';
      const flag = dirty
        ? ` {red-fg}●{/red-fg}{grey-fg} unsaved{/grey-fg}`
        : ` {green-fg}●{/green-fg}{grey-fg} saved{/grey-fg}`;
      status.setContent(` ${time}${best}${pos}${mode}${flag}  {grey-fg}│{/grey-fg}  ${HELP} `);
      screen.render();
      placeCaret();
    }

    function setVimStatus(text: string): void {
      vimStatus = text;
      renderStatusBar();
    }

    function markDirty(): void {
      if (!dirty) {
        dirty = true;
        resetStatus();
      }
    }

    function setOutput(text: string): void {
      outputBox.setContent(blessed.escape(text));
      outputBox.setScroll(0);
      refresh();
    }

    function setRichOutput(markup: string): void {
      outputBox.setContent(markup);
      outputBox.setScroll(0);
      refresh();
    }

    function showNextHint(): void {
      const hints = problem.hints ?? [];
      if (hints.length === 0) {
        setRichOutput('{yellow-fg}This problem has no hints. You’ve got this! 💪{/yellow-fg}');
        return;
      }
      if (hintIdx >= hints.length) {
        setRichOutput(
          `{magenta-fg}{bold}All ${hints.length} hint(s) shown.{/bold}{/magenta-fg} ` +
            '{grey-fg}Press F3 to start over.{/grey-fg}'
        );
        hintIdx = 0;
        return;
      }
      const n = hintIdx + 1;
      const text = htmlToText(hints[hintIdx]).trim();
      hintIdx++;
      setRichOutput(
        `{yellow-fg}{bold}💡 Hint ${n}/${hints.length}{/bold}{/yellow-fg}\n\n` +
          `{white-fg}${blessed.escape(text)}{/white-fg}\n\n` +
          (hintIdx < hints.length
            ? '{grey-fg}Press F3 for the next hint.{/grey-fg}'
            : '{grey-fg}That was the last hint — good luck!{/grey-fg}')
      );
    }

    function focusPane(i: number): void {
      current = (i + focusables.length) % focusables.length;
      focusables[current]();
      refresh();
    }

    // ---- Pane maximize / "zoom" (tmux-style) -------------------------------
    // The default 3-pane split leaves the editor cramped. Ctrl-F maximizes the
    // focused pane to fill the whole work area (between the header and status
    // bar); pressing it again restores the split. While zoomed, pane cycling
    // moves the maximize to the newly-focused pane instead of showing the
    // split.
    const zoomBoxes: blessed.Widgets.BoxElement[] = [
      descBox,
      infoBox,
      editor.box,
      outputBox,
    ];
    const savedPos = new Map<blessed.Widgets.BoxElement, unknown>();
    let zoomedEl: blessed.Widgets.BoxElement | null = null;

    function currentBox(): blessed.Widgets.BoxElement {
      return current === 0 ? descBox : current === 2 ? outputBox : editor.box;
    }
    function applyZoom(target: blessed.Widgets.BoxElement): void {
      for (const el of zoomBoxes) {
        if (!savedPos.has(el)) savedPos.set(el, el.position);
        if (el === target) {
          (el as unknown as { position: unknown }).position = {
            left: 0,
            right: 0,
            top: 1,
            bottom: 1,
          };
          el.show();
        } else {
          el.hide();
        }
      }
      zoomedEl = target;
    }
    function unzoom(): void {
      for (const el of zoomBoxes) {
        const p = savedPos.get(el);
        if (p) (el as unknown as { position: unknown }).position = p;
        el.show();
      }
      savedPos.clear();
      zoomedEl = null;
    }
    function toggleZoom(): void {
      if (helpOpen || tcOpen || saveOpen) return;
      if (zoomedEl) unzoom();
      else applyZoom(currentBox());
      focusPane(current); // re-render the focused pane (esp. the editor) at its new size
    }
    function isZoomed(): boolean {
      return zoomedEl !== null;
    }
    // Move the maximize to whichever pane is now focused (used while cycling
    // panes with Shift-Tab / F6 in the zoomed state).
    function rezoomCurrent(): void {
      applyZoom(currentBox());
      focusPane(current);
    }

    function saveCode(): void {
      writeCodeRegion(filePath, editor.getValue());
      dirty = false;
      resetStatus();
    }

    function resetEditor(): void {
      editor.resetTo(starterCode(problem, filePath));
      saveCode();
      focusPane(1);
      setOutput('Editor reset to the original starter code. Press Ctrl-Z to undo.');
    }

    function startSpinner(label: string): void {
      let i = 0;
      stopSpinner();
      spinnerTimer = setInterval(() => {
        status.setContent(` {cyan-fg}{bold}${SPINNER[i++ % SPINNER.length]}{/bold}{/cyan-fg} {white-fg}${label}{/white-fg} `);
        screen.render();
      }, 120);
    }

    function stopSpinner(): void {
      if (spinnerTimer) {
        clearInterval(spinnerTimer);
        spinnerTimer = null;
      }
    }

    function openTestcase(): void {
      tcOpen = true;
      tcEditor.setValue(customTestcase ?? problem.exampleTestcases ?? '');
      tcPopup.show();
      tcPopup.setFront();
      tcEditor.focus();
      refresh();
    }

    function closeTestcase(save: boolean): void {
      if (save) {
        const val = tcEditor.getValue().replace(/\s+$/, '');
        customTestcase = val.trim() === '' ? null : val;
      }
      tcOpen = false;
      tcPopup.hide();
      focusPane(1);
    }

    const normalizeCase = (c: string): string =>
      c.split('\n').map((s) => s.trim()).join('\n').trim();

    // Split a testcase blob into per-case chunks of `argsPerCase` lines each.
    function splitCases(blob: string, argsPerCase: number): string[] {
      if (argsPerCase <= 0) return [];
      const lines = blob.replace(/\s+$/, '').split('\n');
      const cases: string[] = [];
      for (let i = 0; i + argsPerCase <= lines.length; i += argsPerCase) {
        cases.push(lines.slice(i, i + argsPerCase).join('\n'));
      }
      return cases;
    }

    /**
     * Merge failing testcases into the manual/custom testcase set, skipping any
     * that are already present. Returns how many new cases were added.
     */
    function addFailingCases(newCases: string[], argsPerCase: number): number {
      if (argsPerCase <= 0) return 0;
      const base = (customTestcase ?? problem.exampleTestcases ?? '').replace(/\s+$/, '');
      const existing = base ? splitCases(base, argsPerCase) : [];
      const seen = new Set(existing.map(normalizeCase));
      let added = 0;
      for (const raw of newCases) {
        const c = raw.replace(/\r\n/g, '\n').replace(/\s+$/, '');
        if (!c.trim() || seen.has(normalizeCase(c))) continue;
        existing.push(c);
        seen.add(normalizeCase(c));
        added++;
      }
      if (added > 0) {
        customTestcase = existing.join('\n');
        if (tcOpen) tcEditor.setValue(customTestcase);
      }
      return added;
    }

    // Failing cases from a run (interpret) result, paired with args-per-case.
    function collectFailingRunCases(
      r: JudgeResult,
      dataInput: string,
      paramCount = 0
    ): { cases: string[]; argsPerCase: number } {
      const norm = (v: string[] | string | undefined): string[] =>
        !v ? [] : Array.isArray(v) ? v : [v];
      const got = norm(r.code_answer);
      const expected = norm(r.expected_code_answer);
      const outCount = Math.max(got.length, expected.length);
      if (outCount === 0 || expected.length === 0) return { cases: [], argsPerCase: 0 };
      const inputs = dataInput ? dataInput.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n') : [];
      // The judge produces one output per executed case, so `outCount` is the
      // authoritative case count. Use metadata's parameter count only to slice
      // each case's arguments — never to change how many cases there are (that
      // could otherwise invent a phantom case from a stray input line-group).
      let argsPerCase: number;
      const n = outCount;
      if (paramCount > 0 && inputs.length > 0 && inputs.length % paramCount === 0) {
        argsPerCase = paramCount;
      } else {
        if (inputs.length === 0 || inputs.length % n !== 0) return { cases: [], argsPerCase: 0 };
        argsPerCase = inputs.length / n;
      }
      const cases: string[] = [];
      for (let i = 0; i < n; i++) {
        if ((got[i] ?? '') !== (expected[i] ?? '')) {
          const slice = inputs.slice(i * argsPerCase, (i + 1) * argsPerCase);
          if (slice.length) cases.push(slice.join('\n'));
        }
      }
      return { cases, argsPerCase };
    }

    function noteAddedCases(added: number): void {
      const msg =
        `\n{yellow-fg}➕ Added ${added} failing testcase${added > 1 ? 's' : ''} ` +
        `to your custom tests — press Ctrl-T to view.{/yellow-fg}`;
      outputBox.setContent(outputBox.getContent() + msg);
      refresh();
    }

    async function doRun(): Promise<void> {
      if (busy) return;
      busy = true;
      if (isZoomed()) toggleZoom(); // reveal the Output pane so results are visible
      saveCode();
      const usingCustom = customTestcase !== null;
      const dataInput = customTestcase ?? problem.exampleTestcases ?? problem.sampleTestCase ?? '';
      startSpinner(usingCustom ? 'Running custom testcase...' : 'Running sample tests...');
      setOutput(`Running against ${usingCustom ? 'your custom' : 'the sample'} test cases...`);
      try {
        const { interpret_id } = await client.interpret({
          slug: problem.titleSlug,
          questionId: problem.questionId,
          lang: langOf(filePath),
          code: editor.getValue(),
          dataInput,
        });
        const result = await client.waitForResult(interpret_id, (state) =>
          setOutput(`Judging (${state})...`)
        );
        const paramNames = parseParamNames(problem.metaData);
        const table = buildRunTable(result, dataInput, paramNames);
        if (table) setRichOutput(table);
        else setOutput(formatRunResult(result, { color: false }));
        if (result.correct_answer !== true) {
          const { cases, argsPerCase } = collectFailingRunCases(
            result,
            dataInput,
            paramNames ? paramNames.length : 0
          );
          const added = addFailingCases(cases, argsPerCase);
          if (added > 0) noteAddedCases(added);
        }
      } catch (err) {
        setOutput('Run failed:\n' + (err as Error).message);
      } finally {
        busy = false;
        stopSpinner();
        resetStatus();
      }
    }

    async function doSubmit(): Promise<void> {
      if (busy) return;
      busy = true;
      if (isZoomed()) toggleZoom(); // reveal the Output pane so results are visible
      saveCode();
      const submittedCode = editor.getValue();
      startSpinner('Submitting...');
      setOutput('Submitting to LeetCode...');
      try {
        const { submission_id } = await client.submit({
          slug: problem.titleSlug,
          questionId: problem.questionId,
          lang: langOf(filePath),
          code: submittedCode,
        });
        const result = await client.waitForResult(
          submission_id,
          (state) => setOutput(`Judging (${state})...`),
          60000
        );
        const body = formatSubmitResult(result, { color: false });
        if (result.status_msg === 'Accepted') {
          const before = computeStats();
          const solved = recordSolved(problem.titleSlug, problem.difficulty);
          const elapsed = sessionSeconds();
          persistTime();
          const { best, isPB } = recordSolveTime(problem.titleSlug, elapsed);
          const badges = newlyUnlocked(before, computeStats());
          if (loadConfig().bell !== false) screen.program.bell();
          // Show the celebration banner immediately — git work must never block it.
          const bannerBase = acceptedBannerTags(solved, { seconds: elapsed, best, isPB, badges });
          const bodyEsc = blessed.escape(body);
          setRichOutput(bannerBase + bodyEsc);
          const sync = await syncSolvedSolution({
            frontendId: problem.frontendId,
            slug: problem.titleSlug,
            title: problem.title,
            lang: langOf(filePath),
            difficulty: problem.difficulty,
            sourceFile: filePath,
            code: submittedCode,
          });
          let syncTag = '';
          if (sync.status === 'committed' && !sync.pushFailed) {
            const note = `git: committed${sync.pushed ? ' & pushed' : ''}`;
            syncTag = `{green-fg}${blessed.escape(note)}{/green-fg}\n`;
          } else if (sync.status === 'committed' && sync.pushFailed) {
            const note = 'git: committed locally, push failed — ' + (sync.detail || '');
            syncTag = `{yellow-fg}${blessed.escape(note)}{/yellow-fg}\n`;
          } else if (sync.status === 'error') {
            syncTag = `{yellow-fg}${blessed.escape('git sync skipped: ' + (sync.detail || ''))}{/yellow-fg}\n`;
          }
          if (syncTag) setRichOutput(bannerBase + syncTag + bodyEsc);
        } else if (result.compile_error || result.full_compile_error) {
          setOutput(body);
        } else {
          setRichOutput(encouragementTags() + blessed.escape(body));
          if (result.last_testcase && result.last_testcase.trim()) {
            const lt = result.last_testcase.replace(/\r\n/g, '\n');
            const added = addFailingCases([lt], lt.split('\n').length);
            if (added > 0) noteAddedCases(added);
          }
        }
      } catch (err) {
        setOutput('Submit failed:\n' + (err as Error).message);
      } finally {
        busy = false;
        stopSpinner();
        resetStatus();
      }
    }

    function externalEdit(): void {
      saveCode();
      const editorCmd =
        process.env.VISUAL ||
        process.env.EDITOR ||
        (process.platform === 'win32' ? 'notepad' : 'vi');
      const parts = editorCmd.split(' ');
      const bin = parts[0];
      const args = [...parts.slice(1), filePath];
      screen.program.hideCursor();
      try {
        // blessed suspends/restores the alt-screen around the child process.
        (screen as unknown as { spawn: (c: string, a: string[]) => ReturnType<typeof spawn> })
          .spawn(bin, args)
          .on('exit', () => {
            try {
              editor.setValue(readCode(filePath));
            } catch {
              /* ignore */
            }
            focusPane(1);
          });
      } catch (err) {
        setOutput('Could not open external editor: ' + (err as Error).message);
        focusPane(1);
      }
    }

    function quit(): void {
      stopSpinner();
      if (clockTimer) {
        clearInterval(clockTimer);
        clockTimer = null;
      }
      try {
        persistTime();
        if (dirty) saveCode();
      } catch {
        // Never let a failed save block teardown — restore the terminal first.
      } finally {
        // Restore the terminal: disable bracketed paste (DECRST 2004) so the
        // user's shell doesn't receive literal ESC[200~ markers on its next
        // paste, then show the cursor and tear down.
        try {
          (screen.program as unknown as { resetMode?: (p: string) => void }).resetMode?.('?2004');
        } catch {
          /* ignore: terminal may not support mode changes */
        }
        screen.program.showCursor();
        screen.destroy();
        resolve();
      }
    }

    descBox.on('click', () => focusPane(0));
    outputBox.on('click', () => focusPane(2));

    // Global shortcuts. Bound at screen level; the custom editor does NOT grab
    // keys (unlike blessed's textarea), so these fire even while editing.
    screen.key(['C-q'], quit);
    screen.key(['C-c'], () => {
      // When the editor has an active selection, Ctrl-C copies it instead of
      // quitting. Ctrl-Q always quits regardless.
      if (editor.isFocused() && !tcOpen && !saveOpen && !helpOpen && editor.hasSelection()) {
        editor.copySelection();
        return;
      }
      quit();
    });
    screen.key(['C-r'], () => {
      if (saveOpen || helpOpen) return;
      // Running from the testcase popup: save & close it first so the current
      // testcase is used and the output pane is actually visible.
      if (tcOpen) closeTestcase(true);
      void doRun();
    });
    screen.key(['C-s'], () => {
      if (saveOpen || tcOpen || helpOpen) return;
      void doSubmit();
    });
    screen.key(['C-w'], () => {
      if (helpOpen || saveOpen) return;
      saveCode();
    });
    screen.key(['f1'], () => {
      if (!tcOpen && !saveOpen) toggleHelp();
    });
    screen.key(['?'], () => {
      // Bare "?" is a literal character in the editor, so only treat it as the
      // help toggle when a non-editor pane (Problem/Output) has focus.
      if (!editor.isFocused() && !tcOpen && !saveOpen) toggleHelp();
    });
    screen.key(['C-p'], () => {
      if (!saveOpen && !helpOpen) toggleTimer();
    });
    screen.key(['C-e'], () => {
      if (!tcOpen && !saveOpen && !helpOpen) externalEdit();
    });
    screen.key(['C-t'], () => {
      if (helpOpen || saveOpen) return;
      return tcOpen ? closeTestcase(true) : openTestcase();
    });
    screen.key(['C-a'], () => {
      if (helpOpen || tcOpen) return;
      return saveOpen ? closeSave() : openSave();
    });
    screen.key(['escape'], () => {
      if (helpOpen) toggleHelp();
      else if (tcOpen) closeTestcase(true);
      else if (saveOpen) closeSave();
    });
    screen.key(['C-x'], () => {
      if (helpOpen) return;
      if (tcOpen) {
        tcEditor.setValue('');
        tcEditor.focus();
        refresh();
      } else if (!saveOpen && editor.isFocused()) {
        // Cut an active selection; otherwise fall back to deleting the line.
        if (editor.hasSelection()) editor.cutSelection();
        else editor.deleteCurrentLine();
      }
    });
    screen.key(['C-z'], () => {
      if (!tcOpen && !saveOpen && !helpOpen && editor.isFocused()) editor.undoAction();
    });
    screen.key(['C-y'], () => {
      if (!tcOpen && !saveOpen && !helpOpen && editor.isFocused()) editor.redoAction();
    });
    // Scroll the Output pane from anywhere (the editor ignores Ctrl keys, so
    // these never conflict with editing). Handy while reading long run/submit
    // output without leaving the editor.
    const scrollOutput = (n: number): void => {
      if (helpOpen || saveOpen) return;
      (outputBox as unknown as { scroll(n: number): void }).scroll(n);
      screen.render();
    };
    screen.key(['C-up'], () => scrollOutput(-1));
    screen.key(['C-down'], () => scrollOutput(1));
    screen.key(['S-tab'], () => {
      if (!tcOpen && !saveOpen && !helpOpen) {
        focusPane(current + 1);
        if (isZoomed()) rezoomCurrent();
      }
    });
    screen.key(['f6'], () => {
      if (!tcOpen && !saveOpen && !helpOpen) {
        focusPane(current + 1);
        if (isZoomed()) rezoomCurrent();
      }
    });
    screen.key(['C-f'], () => {
      toggleZoom();
    });
    screen.key(['f2'], () => {
      if (helpOpen || tcOpen || saveOpen) return;
      editor.setVim(!editor.isVim());
      if (!editor.isVim()) setVimStatus('');
      focusPane(1);
      setOutput(editor.isVim() ? 'Vim mode ON (Esc = normal, i = insert, :w save, :q quit)' : 'Vim mode OFF');
    });
    screen.key(['f3'], () => {
      if (!tcOpen && !saveOpen && !helpOpen) showNextHint();
    });
    screen.key(['f4'], () => {
      if (!tcOpen && !saveOpen && !helpOpen) resetEditor();
    });

    // Initial paint, then load code and focus the editor.
    screen.render();
    editor.setValue(readCode(filePath));
    focusPane(1);
    resetStatus();
    setRichOutput(welcomeTags(`${problem.frontendId}. ${problem.title}`));
    clockTimer = setInterval(() => {
      if (busy) return;
      renderStatusBar();
      // Periodically flush the timer so an abrupt terminal close (crash, closed
      // window) loses at most ~15s of the active session rather than all of it.
      timerFlushTick = (timerFlushTick + 1) % 15;
      if (timerFlushTick === 0 && runningSince) persistTime();
    }, 1000);
  });
}

/**
 * Render an interpret (run) result as a colorful per-testcase table using
 * blessed tags. Returns null for compile/runtime errors (caller falls back to
 * the plain formatter) so those show their full message.
 */
/**
 * Parse the problem's `metaData` JSON to recover the ordered parameter names
 * for a normal (function-signature) problem. This is the authoritative source
 * for how many input lines belong to each test case: LeetCode feeds one line
 * per parameter, so `params.length` is the args-per-case. Returns null for
 * class/design problems (no flat `params` array) or unparseable metadata, in
 * which case callers fall back to deriving the count from the output arrays.
 */
function parseParamNames(metaData: string | undefined): string[] | null {
  if (!metaData) return null;
  try {
    const m = JSON.parse(metaData) as { params?: Array<{ name?: unknown }> };
    if (Array.isArray(m.params) && m.params.length > 0) {
      return m.params.map((p) => (typeof p?.name === 'string' ? p.name : ''));
    }
  } catch {
    /* ignore malformed metadata */
  }
  return null;
}

function buildRunTable(
  r: JudgeResult,
  dataInput: string,
  paramNames?: string[] | null
): string | null {
  if (r.compile_error || r.full_compile_error || r.runtime_error || r.full_runtime_error) {
    return null;
  }
  const norm = (v: string[] | string | undefined): string[] =>
    !v ? [] : Array.isArray(v) ? v : [v];
  const got = norm(r.code_answer);
  const expected = norm(r.expected_code_answer);
  const stdoutList = norm(r.std_output_list);
  const stdout = norm(r.std_output);
  // Normalise the input blob the same way `collectFailingRunCases` does: a
  // trailing newline (LeetCode's example testcases and custom input usually end
  // with one) would otherwise add an empty element, breaking the even division
  // below so `argsPerCase` falls back to 1 and multi-argument inputs get mixed
  // across cases.
  const inputs = dataInput
    ? dataInput.replace(/\r\n/g, '\n').replace(/\s+$/, '').split('\n')
    : [];
  const outCount = Math.max(got.length, expected.length);

  // The judge runs exactly one case per output entry, so `outCount` is the
  // authoritative number of test cases — always render that many, never more
  // (using the input line-count could invent a phantom case when the input
  // blob has a stray extra line-group). Metadata's parameter count is used
  // only to slice each case's arguments; it must not change the case count.
  const paramCount = paramNames && paramNames.length ? paramNames.length : 0;
  const n = outCount;
  let argsPerCase: number;
  if (paramCount > 0 && inputs.length > 0 && inputs.length % paramCount === 0) {
    argsPerCase = paramCount;
  } else {
    argsPerCase =
      inputs.length > 0 && n > 0 && inputs.length % n === 0 ? inputs.length / n : 1;
  }
  if (n === 0) return null;

  const caseInputs = (i: number): string[] =>
    argsPerCase === 1
      ? inputs[i] !== undefined ? [inputs[i]] : []
      : inputs.slice(i * argsPerCase, (i + 1) * argsPerCase);

  const passCount = (() => {
    let p = 0;
    for (let i = 0; i < n; i++) if ((got[i] ?? '') === (expected[i] ?? '')) p++;
    return p;
  })();

  const ok = r.correct_answer === true;
  const lines: string[] = [];

  // Muted labels use a visible, theme-aware accent instead of grey (which is
  // near-invisible on several themes/terminals).
  const labelColor = getThemeUi(loadConfig().theme).label;

  // Continuation indent lines up wrapped/extra values under the value column.
  const LABEL_W = 11;
  const pad = ' '.repeat(2 + LABEL_W + 1);
  // Emit a labelled field. The first value line sits next to the label; any
  // further lines (multi-arg inputs, multi-line values) are indented to match.
  // Empty values are shown as a dim "(empty)" placeholder so a blank answer
  // (e.g. an empty-string result) still reads as a clearly labelled field
  // rather than looking like a rendering gap.
  const field = (label: string, values: string[], colorTag?: string): void => {
    const open = colorTag ? `{${colorTag}}` : '';
    const close = colorTag ? `{/${colorTag}}` : '';
    const shown = values.length ? values : [''];
    shown.forEach((v, li) => {
      const head =
        li === 0
          ? `  {${labelColor}-fg}{bold}` + label.padEnd(LABEL_W) + `{/bold}{/${labelColor}-fg} `
          : pad;
      const body =
        v === '' ? '{grey-fg}(empty){/grey-fg}' : open + blessed.escape(v) + close;
      lines.push(head + body);
    });
  };

  lines.push(
    ok
      ? `{green-fg}{bold}✓ Sample tests passed{/bold}{/green-fg}  {${labelColor}-fg}{bold}(${passCount}/${n}){/bold}{/${labelColor}-fg}`
      : `{red-fg}{bold}✗ Wrong Answer{/bold}{/red-fg}  {${labelColor}-fg}{bold}(${passCount}/${n} passed){/bold}{/${labelColor}-fg}`
  );

  for (let i = 0; i < n; i++) {
    const g = got[i] ?? '';
    const e = expected[i] ?? '';
    const pass = g === e;
    lines.push('');
    lines.push(
      `{bold}Case ${i + 1}{/bold}  ` +
        (pass ? '{green-fg}✓ pass{/green-fg}' : '{red-fg}✗ FAIL{/red-fg}')
    );
    const ci = caseInputs(i).filter((s) => s !== undefined);
    if (ci.length) {
      // Prefix each argument with its parameter name (from metadata) so a
      // multi-argument case reads clearly, e.g. `s = "abc"`, `target = "bba"`.
      const labelled = ci.map((v, k) => {
        const name = paramNames && paramNames[k];
        return name ? `${name} = ${v}` : v;
      });
      field('Input', labelled);
    }
    // On a pass both values match, so a single neutral line is clearer. On a
    // failure, colour Output red and Expected green to spotlight the diff.
    field('Your Output', [g], pass ? undefined : 'red-fg');
    field('Expected', [e], pass ? undefined : 'green-fg');
    const caseLog = stdoutList[i];
    if (caseLog && caseLog.trim()) {
      field('Log', caseLog.replace(/\n+$/, '').split('\n'), 'cyan-fg');
    }
  }
  // Fall back to the aggregate stdout only when there is no per-case list.
  const extraStdout = (stdoutList.length ? [] : stdout).filter(Boolean);
  if (extraStdout.length) {
    lines.push('');
    lines.push(`{${labelColor}-fg}` + blessed.escape('stdout: ' + extraStdout.join(' | ')) + `{/${labelColor}-fg}`);
  }
  if (r.status_runtime) {
    lines.push(`{${labelColor}-fg}` + blessed.escape('runtime: ' + r.status_runtime) + `{/${labelColor}-fg}`);
  }
  return lines.join('\n');
}

function buildHeader(problem: Problem, lang: string): string {
  const sep = '{grey-fg}│{/grey-fg}';
  const id = blessed.escape(`${problem.frontendId}. ${problem.title}`);
  const diffSeg = loadConfig().tags === false ? '' : `${colorDifficulty(problem.difficulty)}  ${sep}  `;
  return (
    ` {yellow-fg}{bold}⚡ LeetCode{/bold}{/yellow-fg}  ${sep}  ` +
    `{white-fg}{bold}${id}{/bold}{/white-fg}  ${sep}  ${diffSeg}` +
    `{cyan-fg}${blessed.escape(lang)}{/cyan-fg}`
  );
}

function buildDescription(problem: Problem): string {
  const title = blessed.escape(`${problem.frontendId}. ${problem.title}`);
  const url = blessed.escape(`https://leetcode.com/problems/${problem.titleSlug}/`);
  const head = [
    `{cyan-fg}{bold}${title}{/bold}{/cyan-fg}`,
    `{blue-fg}${url}{/blue-fg}`,
    '',
    '',
  ].join('\n');
  return head + colorizeDescription(htmlToText(problem.content));
}

/**
 * Turn the markdown-ish problem text into colorful blessed markup: headings in
 * cyan, fenced code/examples in green, inline `code` in yellow, **bold** in
 * white, and the Input/Output/Explanation/Constraints labels in magenta.
 * Every literal character is passed through blessed.escape so code braces never
 * corrupt the tag rendering.
 */
function colorizeDescription(md: string): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let inCode = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      inCode = !inCode;
      out.push(`{grey-fg}${blessed.escape(line)}{/grey-fg}`);
      continue;
    }
    if (inCode) {
      out.push(`{green-fg}${blessed.escape(line)}{/green-fg}`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push(`{cyan-fg}{bold}${blessed.escape(heading[2])}{/bold}{/cyan-fg}`);
      continue;
    }
    out.push(colorizeInline(line));
  }
  return out.join('\n');
}

function colorizeInline(line: string): string {
  // Split on inline-code spans so backtick content is colored verbatim.
  let s = line
    .split(/(`[^`]+`)/g)
    .map((part) => {
      if (/^`[^`]+`$/.test(part)) {
        return `{yellow-fg}${blessed.escape(part.slice(1, -1))}{/yellow-fg}`;
      }
      // Within non-code text, color **bold** spans and escape the rest.
      return part
        .split(/(\*\*[^*]+\*\*)/g)
        .map((seg) => {
          const b = seg.match(/^\*\*([^*]+)\*\*$/);
          return b
            ? `{white-fg}{bold}${blessed.escape(b[1])}{/bold}{/white-fg}`
            : blessed.escape(seg);
        })
        .join('');
    })
    .join('');
  // Highlight the common example labels at the start of a line.
  s = s.replace(
    /^(\s*)(Example\s*\d*|Input|Output|Explanation|Constraints|Follow-up|Note)(:)/i,
    (_m, sp, label, colon) => `${sp}{magenta-fg}{bold}${label}${colon}{/bold}{/magenta-fg}`
  );
  return s;
}

/** Colored difficulty + tags line for the bottom info panel. */
function buildMeta(problem: Problem): string {
  if (loadConfig().tags === false) {
    // Tags off hides both the tags and the difficulty (an approach spoiler).
    return '{grey-fg}Difficulty & tags hidden — show with: leetcode config --tags on{/grey-fg}';
  }
  const diff = colorDifficulty(problem.difficulty);
  const paid = problem.isPaidOnly ? '  {red-fg}[Premium]{/red-fg}' : '';
  const tags = problem.topicTags.length
    ? problem.topicTags.map((t) => `{cyan-fg}${blessed.escape(t.name)}{/cyan-fg}`).join('  ')
    : '{grey-fg}none{/grey-fg}';
  return `{bold}Difficulty:{/bold} ${diff}${paid}\n{bold}Tags:{/bold} ${tags}`;
}

function colorDifficulty(d: string): string {
  switch ((d || '').toLowerCase()) {
    case 'easy':
      return `{green-fg}{bold}${d}{/bold}{/green-fg}`;
    case 'medium':
      return `{yellow-fg}{bold}${d}{/bold}{/yellow-fg}`;
    case 'hard':
      return `{red-fg}{bold}${d}{/bold}{/red-fg}`;
    default:
      return d;
  }
}

function readCode(filePath: string): string {
  try {
    return parseSolutionFile(filePath).code;
  } catch {
    return '';
  }
}

/** The original starter code for the file's language, straight from the problem. */
function starterCode(problem: Problem, filePath: string): string {
  const lang = langOf(filePath);
  const snippet = problem.codeSnippets.find((s) => s.langSlug === lang);
  return (snippet ? snippet.code : readCode(filePath)).replace(/\r\n/g, '\n').replace(/\n+$/, '');
}

function langOf(filePath: string): string {
  return parseSolutionFile(filePath).meta.lang;
}
