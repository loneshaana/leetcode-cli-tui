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
import { loadConfig, recordSolved, recordSolveTime, computeStats } from '../config';
import { acceptedBannerTags, encouragementTags, welcomeTags, newlyUnlocked } from './fun';

export interface TuiParams {
  client: LeetCodeClient;
  problem: Problem;
  filePath: string;
}

const HELP =
  '{cyan-fg}{bold}Tab{/bold}{/cyan-fg} pane  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^R{/bold}{/cyan-fg} run  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^S{/bold}{/cyan-fg} submit  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^T{/bold}{/cyan-fg} test  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F3{/bold}{/cyan-fg} hint  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F4{/bold}{/cyan-fg} reset  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^A{/bold}{/cyan-fg} save-as  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^W{/bold}{/cyan-fg} save  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}F2{/bold}{/cyan-fg} vim  {grey-fg}·{/grey-fg}  ' +
  '{cyan-fg}{bold}^Q{/bold}{/cyan-fg} quit';

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
      width: '50%',
      bottom: 5,
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      vi: true,
      tags: true,
      scrollbar: { ch: ' ', track: { bg: 'grey' }, style: { bg: 'cyan' } },
      style: { border: { fg: 'blue' }, focus: { border: { fg: 'cyan' } } },
      content: buildDescription(problem),
    });

    // Colored metadata (difficulty + tags) pinned at the bottom of the left pane.
    blessed.box({
      parent: screen,
      label: ' ℹ Info ',
      left: 0,
      bottom: 1,
      width: '50%',
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
        left: '50%',
        width: '50%',
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
      left: '50%',
      width: '50%',
      bottom: 1,
      border: { type: 'line' },
      scrollable: true,
      alwaysScroll: true,
      keys: true,
      mouse: true,
      vi: true,
      tags: true,
      scrollbar: { ch: ' ', style: { bg: 'cyan' } },
      style: { border: { fg: 'magenta' }, focus: { border: { fg: 'yellow' } } },
      content: 'Ready. Ctrl-R runs the sample tests, Ctrl-S submits.',
    });

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
    const startTs = Date.now();

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
      const s = Math.floor((Date.now() - startTs) / 1000);
      const m = Math.floor(s / 60);
      return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    }

    function renderStatusBar(): void {
      const time = `{yellow-fg}{bold}⏱ ${clock()}{/bold}{/yellow-fg}`;
      const mode = vimStatus
        ? ` {yellow-bg}{black-fg} ${vimStatus} {/black-fg}{/yellow-bg}`
        : '';
      const flag = dirty
        ? ` {red-fg}●{/red-fg}{grey-fg} unsaved{/grey-fg}`
        : ` {green-fg}●{/green-fg}{grey-fg} saved{/grey-fg}`;
      status.setContent(` ${time}${mode}${flag}  {grey-fg}│{/grey-fg}  ${HELP} `);
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
      dataInput: string
    ): { cases: string[]; argsPerCase: number } {
      const norm = (v: string[] | string | undefined): string[] =>
        !v ? [] : Array.isArray(v) ? v : [v];
      const got = norm(r.code_answer);
      const expected = norm(r.expected_code_answer);
      const n = Math.max(got.length, expected.length);
      if (n === 0 || expected.length === 0) return { cases: [], argsPerCase: 0 };
      const inputs = dataInput ? dataInput.replace(/\s+$/, '').split('\n') : [];
      if (inputs.length === 0 || inputs.length % n !== 0) return { cases: [], argsPerCase: 0 };
      const argsPerCase = inputs.length / n;
      const cases: string[] = [];
      for (let i = 0; i < n; i++) {
        if ((got[i] ?? '') !== (expected[i] ?? '')) {
          cases.push(inputs.slice(i * argsPerCase, (i + 1) * argsPerCase).join('\n'));
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
        const table = buildRunTable(result, dataInput);
        if (table) setRichOutput(table);
        else setOutput(formatRunResult(result, { color: false }));
        if (result.correct_answer !== true) {
          const { cases, argsPerCase } = collectFailingRunCases(result, dataInput);
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
      saveCode();
      startSpinner('Submitting...');
      setOutput('Submitting to LeetCode...');
      try {
        const { submission_id } = await client.submit({
          slug: problem.titleSlug,
          questionId: problem.questionId,
          lang: langOf(filePath),
          code: editor.getValue(),
        });
        const result = await client.waitForResult(submission_id, (state) =>
          setOutput(`Judging (${state})...`)
        );
        const body = formatSubmitResult(result, { color: false });
        if (result.status_msg === 'Accepted') {
          const before = computeStats();
          const solved = recordSolved(problem.titleSlug, problem.difficulty);
          const elapsed = Math.floor((Date.now() - startTs) / 1000);
          const { best, isPB } = recordSolveTime(problem.titleSlug, elapsed);
          const badges = newlyUnlocked(before, computeStats());
          if (loadConfig().bell !== false) screen.program.bell();
          setRichOutput(
            acceptedBannerTags(solved, { seconds: elapsed, best, isPB, badges }) + blessed.escape(body)
          );
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
      if (dirty) saveCode();
      screen.program.showCursor();
      screen.destroy();
      resolve();
    }

    descBox.on('click', () => focusPane(0));
    outputBox.on('click', () => focusPane(2));

    // Global shortcuts. Bound at screen level; the custom editor does NOT grab
    // keys (unlike blessed's textarea), so these fire even while editing.
    screen.key(['C-q', 'C-c'], quit);
    screen.key(['C-r'], () => void doRun());
    screen.key(['C-s'], () => void doSubmit());
    screen.key(['C-w'], () => saveCode());
    screen.key(['C-e'], () => externalEdit());
    screen.key(['C-t'], () => (tcOpen ? closeTestcase(true) : openTestcase()));
    screen.key(['C-a'], () => (saveOpen ? closeSave() : openSave()));
    screen.key(['escape'], () => {
      if (tcOpen) closeTestcase(true);
      else if (saveOpen) closeSave();
    });
    screen.key(['C-x'], () => {
      if (tcOpen) {
        tcEditor.setValue('');
        tcEditor.focus();
        refresh();
      } else if (!saveOpen && editor.isFocused()) {
        editor.deleteCurrentLine();
      }
    });
    screen.key(['C-z'], () => {
      if (!tcOpen && !saveOpen && editor.isFocused()) editor.undoAction();
    });
    screen.key(['C-y'], () => {
      if (!tcOpen && !saveOpen && editor.isFocused()) editor.redoAction();
    });
    screen.key(['S-tab'], () => {
      if (!tcOpen && !saveOpen) focusPane(current + 1);
    });
    screen.key(['f6'], () => {
      if (!tcOpen && !saveOpen) focusPane(current + 1);
    });
    screen.key(['f2'], () => {
      editor.setVim(!editor.isVim());
      if (!editor.isVim()) setVimStatus('');
      focusPane(1);
      setOutput(editor.isVim() ? 'Vim mode ON (Esc = normal, i = insert, :w save, :q quit)' : 'Vim mode OFF');
    });
    screen.key(['f3'], () => {
      if (!tcOpen && !saveOpen) showNextHint();
    });
    screen.key(['f4'], () => {
      if (!tcOpen && !saveOpen) resetEditor();
    });

    // Initial paint, then load code and focus the editor.
    screen.render();
    editor.setValue(readCode(filePath));
    focusPane(1);
    resetStatus();
    setRichOutput(welcomeTags(`${problem.frontendId}. ${problem.title}`));
    clockTimer = setInterval(() => {
      if (!busy) renderStatusBar();
    }, 1000);
  });
}

/**
 * Render an interpret (run) result as a colorful per-testcase table using
 * blessed tags. Returns null for compile/runtime errors (caller falls back to
 * the plain formatter) so those show their full message.
 */
function buildRunTable(r: JudgeResult, dataInput: string): string | null {
  if (r.compile_error || r.full_compile_error || r.runtime_error || r.full_runtime_error) {
    return null;
  }
  const norm = (v: string[] | string | undefined): string[] =>
    !v ? [] : Array.isArray(v) ? v : [v];
  const got = norm(r.code_answer);
  const expected = norm(r.expected_code_answer);
  const stdoutList = norm(r.std_output_list);
  const stdout = norm(r.std_output);
  const inputs = dataInput ? dataInput.split('\n') : [];
  const n = Math.max(got.length, expected.length);
  if (n === 0) return null;

  const W = { idx: 4, res: 8, out: 26, exp: 26 };
  const cell = (s: string, w: number): string => {
    let str = String(s ?? '').replace(/\s+/g, ' ');
    if (str.length > w - 1) str = str.slice(0, w - 2) + '…';
    return str.padEnd(w);
  };

  const ok = r.correct_answer === true;
  const lines: string[] = [];
  lines.push(
    ok
      ? '{green-fg}{bold}✓ Sample tests passed{/bold}{/green-fg}'
      : '{red-fg}{bold}✗ Wrong Answer{/bold}{/red-fg}'
  );
  lines.push('');
  const header = cell('#', W.idx) + cell('Result', W.res) + cell('Got', W.out) + cell('Expected', W.exp);
  lines.push('{bold}' + blessed.escape(header) + '{/bold}');
  for (let i = 0; i < n; i++) {
    const g = got[i] ?? '';
    const e = expected[i] ?? '';
    const pass = g === e;
    const row =
      cell(String(i + 1), W.idx) +
      cell(pass ? '✓ pass' : '✗ FAIL', W.res) +
      cell(g, W.out) +
      cell(e, W.exp);
    const color = pass ? 'green-fg' : 'red-fg';
    lines.push(`{${color}}` + blessed.escape(row) + `{/${color}}`);
    if (inputs[i]) {
      lines.push('{grey-fg}' + blessed.escape('    in: ' + inputs[i].replace(/\s+/g, ' ')) + '{/grey-fg}');
    }
    const caseLog = stdoutList[i];
    if (caseLog && caseLog.trim()) {
      const logLines = caseLog.replace(/\n+$/, '').split('\n');
      logLines.forEach((ll, li) => {
        const prefix = li === 0 ? '   log: ' : '        ';
        lines.push('{cyan-fg}' + blessed.escape(prefix + ll) + '{/cyan-fg}');
      });
    }
  }
  // Fall back to the aggregate stdout only when there is no per-case list.
  const extraStdout = (stdoutList.length ? [] : stdout).filter(Boolean);
  if (extraStdout.length) {
    lines.push('');
    lines.push('{grey-fg}' + blessed.escape('stdout: ' + extraStdout.join(' | ')) + '{/grey-fg}');
  }
  if (r.status_runtime) {
    lines.push('{grey-fg}' + blessed.escape('runtime: ' + r.status_runtime) + '{/grey-fg}');
  }
  return lines.join('\n');
}

function buildHeader(problem: Problem, lang: string): string {
  const sep = '{grey-fg}│{/grey-fg}';
  const id = blessed.escape(`${problem.frontendId}. ${problem.title}`);
  const diff = colorDifficulty(problem.difficulty);
  return (
    ` {yellow-fg}{bold}⚡ LeetCode{/bold}{/yellow-fg}  ${sep}  ` +
    `{white-fg}{bold}${id}{/bold}{/white-fg}  ${sep}  ${diff}  ${sep}  ` +
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
