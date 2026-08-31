import blessed from 'blessed';
import { StringDecoder } from 'string_decoder';
import { highlightLine, blockStateAfter, getThemeUi, ThemeUi } from './highlight';
import { readClipboard, writeClipboard } from './clipboard';

export type EditorMode = 'insert' | 'normal' | 'visual' | 'visual-line';

export interface EditorBehavior {
  /** When set, Enter calls this instead of inserting a newline (single-line inputs). */
  onSubmit?: (value: string) => void;
  /** Show a line-number gutter. */
  gutter?: boolean;
  /** Enable syntax highlighting (requires `lang`). */
  highlight?: boolean;
  /** LeetCode language slug used for highlighting. */
  lang?: string;
  /** Syntax color theme name (see highlight.ts THEMES). */
  theme?: string;
  /** Auto-close brackets/quotes and enable smart dedent on `}`. */
  autoClose?: boolean;
  /** Start with vim key bindings enabled. */
  vim?: boolean;
  /** Report the current mode / command line to the host (for the status bar). */
  onStatus?: (text: string) => void;
  /** Invoked by the vim `:w` command. */
  onSave?: () => void;
  /** Invoked by the vim `:q` / `:wq` command. */
  onQuit?: () => void;
  /**
   * Optional coalesced-paint hook. When provided, the editor requests a screen
   * repaint through this instead of calling `screen.render()` directly, so
   * multiple synchronous renders in one key event collapse into a single paint.
   * The host is responsible for placing the caret after painting.
   */
  requestRender?: () => void;
}

interface Snapshot {
  lines: string[];
  cx: number;
  cy: number;
}

const PAIRS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const QUOTES = new Set(['"', "'", '`']);
const CLOSERS = new Set([')', ']', '}']);

/**
 * Longest suffix of `s` that is a (proper) prefix of `marker` — used to hold
 * back the tail of a data chunk that might be the first bytes of a bracketed-
 * paste marker split across chunk boundaries. Returns '' when there is none.
 */
function tailPrefix(s: string, marker: string): string {
  const max = Math.min(s.length, marker.length - 1);
  for (let k = max; k > 0; k--) {
    if (s.slice(s.length - k) === marker.slice(0, k)) return s.slice(s.length - k);
  }
  return '';
}

/**
 * A real multi-line code editor built on a blessed box, with optional vim key
 * bindings, syntax highlighting, a line-number gutter, auto-closing brackets
 * and language-aware indentation.
 *
 * blessed's built-in `textarea` is append-only and grabs keys, so it cannot be
 * used to edit code; this widget maintains its own buffer and caret and does
 * NOT grab keys, letting screen-level Ctrl shortcuts still fire.
 */
export class CodeEditor {
  readonly box: blessed.Widgets.BoxElement;
  private lines: string[] = [''];
  private cx = 0; // caret column within the line
  private cy = 0; // caret row (line index)
  private top = 0; // first visible line
  private left = 0; // first visible column
  private readonly tabWidth = 4;
  private readonly ui: ThemeUi;
  // Self-validating per-line block-state cache (multi-line comment / string
  // nesting). `blkCache[k]` is only trusted when its `text` still matches
  // `lines[k]` and its incoming state `in` matches — so edits and line shifts
  // recompute lazily without any explicit invalidation. Removes the O(n)
  // tokenize prefix scan that otherwise ran on every render/keystroke.
  private blkCache: Array<{ text: string; in: number; out: number }> = [];
  // Monotonic edit counter (bumped on every buffer mutation via markDirty) used
  // to invalidate render-time memos such as the bracket-match cache below.
  private editRev = 0;
  private bracketCache: {
    rev: number;
    y: number;
    x: number;
    result: { y: number; x: number } | null;
  } | null = null;

  // Vim state.
  private vimEnabled = false;
  private mode: EditorMode = 'insert';
  private pending = ''; // multi-key operator buffer (d, y, c, g, r)
  private cmdline: string | null = null; // ':' command buffer (null when inactive)
  private register = '';
  private registerLinewise = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  // Non-vim undo coalescing: tracks the kind of the current contiguous edit run
  // so each Ctrl-Z reverts a whole run (a word typed, a burst of deletes) rather
  // than a single character. Reset to '' whenever the caret moves without an edit.
  private pendingEditKind: '' | 'insert' | 'delete' = '';
  private vax = 0; // visual anchor column
  private vay = 0; // visual anchor row
  // Non-vim (default mode) selection: when true, an active selection spans the
  // half-open range from the anchor (vay,vax) to the caret (cy,cx). Extended
  // with Shift+arrows/Home/End/PageUp/Down; cleared by an unshifted move, an
  // edit, or Escape. This is independent of vim visual mode.
  private selecting = false;
  private lastNewlineTs = 0; // timestamp of last processed newline, to coalesce CRLF halves
  private lastNewlineName = ''; // key name of last processed newline (return/enter/linefeed)
  private pasting = false; // true while consuming/echoing a bracketed-paste chunk
  private pasteCapturing = false; // true while raw text is being captured between markers
  private pasteRaw = ''; // accumulates raw pasted bytes across data chunks
  private pasteCarry = ''; // trailing bytes that may be a split START/END marker
  private pasteGen = 0; // generation counter so a stale re-enable can't clear a newer paste
  private pasteTimer: ReturnType<typeof setTimeout> | null = null; // safety net for a paste that never ends
  private readonly pasteDecoder = new StringDecoder('utf8'); // UTF-8 safe across chunk splits
  private lastFind: { cmd: string; ch: string } | null = null; // for ; and ,
  private lastDot: (() => void) | null = null; // last change, for the . command

  constructor(
    private screen: blessed.Widgets.Screen,
    options: blessed.Widgets.BoxOptions,
    private onDirty: () => void,
    private behavior: EditorBehavior = {}
  ) {
    this.vimEnabled = !!behavior.vim;
    this.mode = this.vimEnabled ? 'normal' : 'insert';
    this.ui = getThemeUi(behavior.theme);
    this.box = blessed.box({
      ...options,
      tags: !!behavior.highlight,
      scrollable: false,
      mouse: true,
      clickable: true,
      input: true,
    });
    (this.box as unknown as { keyable: boolean }).keyable = true;

    this.box.on('keypress', (ch: string, key: blessed.Widgets.Events.IKeyEventArg) => {
      this.handleKey(ch, key);
    });
    // Intercept the raw input stream *before* blessed parses it so we can pull
    // pasted text straight out of the bracketed-paste wrapper (ESC[200~ … ESC[201~).
    // blessed 0.1.81 silently drops those markers and would otherwise deliver
    // the paste as individual keystrokes, which triggers auto-indent/auto-close
    // and "staircases" the block. prependListener guarantees we run ahead of
    // blessed's own data handler for each chunk.
    const rawInput = (this.screen.program as unknown as {
      input?: NodeJS.EventEmitter & { prependListener?: (e: string, cb: (d: unknown) => void) => void };
    }).input;
    if (rawInput && typeof rawInput.prependListener === 'function') {
      rawInput.prependListener('data', (data: unknown) => this.onRawInput(data));
    }
    this.box.on('click', () => {
      this.box.focus();
      this.render();
    });
    // Enable terminal "bracketed paste" while the editor is focused so pasted
    // text arrives wrapped in ESC[200~ ... ESC[201~ and can be inserted
    // literally, instead of as individual keystrokes that trigger auto-indent
    // and auto-close (which "staircase" a pasted block).
    this.box.on('focus', () => this.setBracketedPaste(true));
    this.box.on('blur', () => {
      this.setBracketedPaste(false);
      // A paste in flight when focus moves away can never see its END marker
      // here (onRawInput early-returns when unfocused). Drop the partial paste
      // so `pasting` can't stay stuck true and freeze the editor.
      this.resetPasteState();
    });
    this.box.on('wheeldown', () => {
      this.pageMove(3);
      this.render();
    });
    this.box.on('wheelup', () => {
      this.pageMove(-3);
      this.render();
    });
  }

  focus(): void {
    this.box.focus();
    this.emitStatus();
    this.render();
  }

  isFocused(): boolean {
    return this.screen.focused === this.box;
  }

  getValue(): string {
    return this.lines.join('\n');
  }

  /**
   * Normalize external text into buffer lines: CRLF/lone-CR to \n and real tabs
   * expanded to spaces, so the buffer column always matches the rendered column
   * (typed tabs already insert spaces), keeping the Ln/Col indicator and caret
   * placement honest. Always returns at least one line.
   */
  private normalizeToLines(value: string): string[] {
    const lines = value
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .replace(/\t/g, ' '.repeat(this.tabWidth))
      .split('\n');
    return lines.length === 0 ? [''] : lines;
  }

  setValue(value: string): void {
    this.lines = this.normalizeToLines(value);
    this.blkCache = [];
    this.bracketCache = null;
    this.cy = Math.min(this.cy, this.lines.length - 1);
    this.cx = Math.min(this.cx, this.lines[this.cy].length);
    this.undoStack = [];
    this.redoStack = [];
    this.pendingEditKind = '';
    this.render();
  }

  /**
   * Replace the whole buffer but keep it undoable (Ctrl-Z restores the prior
   * content). Used to reset the editor back to the original starter code.
   */
  resetTo(value: string): void {
    this.pushUndo();
    this.lines = this.normalizeToLines(value);
    this.blkCache = [];
    this.cy = 0;
    this.cx = 0;
    this.top = 0;
    this.left = 0;
    this.pendingEditKind = '';
    this.markDirty();
    this.emitStatus();
    this.render();
  }

  /** Delete the line the caret is on (bound to Ctrl-X in the main editor). */
  deleteCurrentLine(): void {
    this.pushUndo();
    this.register = this.lines[this.cy] + '\n';
    this.registerLinewise = true;
    this.lines.splice(this.cy, 1);
    if (this.lines.length === 0) this.lines = [''];
    if (this.cy >= this.lines.length) this.cy = this.lines.length - 1;
    this.cx = Math.min(this.cx, this.lines[this.cy].length);
    this.markDirty();
    this.emitStatus();
    this.render();
  }

  /** Public undo, for a Ctrl-Z binding (works in vim and non-vim modes). */
  undoAction(): void {
    this.undo();
    this.pendingEditKind = '';
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  /** Public redo, for a Ctrl-Y binding. */
  redoAction(): void {
    this.redo();
    this.pendingEditKind = '';
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  /** Enable or disable vim key bindings at runtime. */
  setVim(enabled: boolean): void {
    this.vimEnabled = enabled;
    this.mode = enabled ? 'normal' : 'insert';
    this.pending = '';
    this.cmdline = null;
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  isVim(): boolean {
    return this.vimEnabled;
  }

  /** 1-based cursor line/column and total line count, for a status indicator. */
  cursorPosition(): { line: number; col: number; lines: number } {
    return { line: this.cy + 1, col: this.cx + 1, lines: this.lines.length };
  }

  /** A short description of the current mode for the status bar. */
  statusText(): string {
    if (!this.vimEnabled) return '';
    if (this.cmdline !== null) return ':' + this.cmdline;
    switch (this.mode) {
      case 'insert':
        return '-- INSERT --';
      case 'visual':
        return '-- VISUAL --';
      case 'visual-line':
        return '-- VISUAL LINE --';
      default:
        return '-- NORMAL --' + (this.pending ? ' ' + this.pending : '');
    }
  }

  private emitStatus(): void {
    if (this.behavior.onStatus) this.behavior.onStatus(this.statusText());
  }

  // ---- rendering ---------------------------------------------------------

  private gutterWidth(): number {
    if (!this.behavior.gutter) return 0;
    const digits = Math.max(3, String(this.lines.length).length);
    return digits + 1;
  }

  /**
   * Block-comment / multi-line-string state after line `idx`, given the state
   * `inBlk` entering it. Uses the self-validating cache so unchanged lines cost
   * only a string reference compare instead of a full re-tokenize.
   */
  private blockOut(idx: number, line: string, inBlk: number, lang: string): number {
    const c = this.blkCache[idx];
    if (c && c.text === line && c.in === inBlk) return c.out;
    const out = blockStateAfter(line, lang, inBlk);
    this.blkCache[idx] = { text: line, in: inBlk, out };
    return out;
  }

  render(): void {
    const H = this.innerHeight();
    const gutter = this.gutterWidth();
    const W = this.innerWidth() - gutter;
    if (H <= 0 || W <= 0) {
      if (this.behavior.requestRender) this.behavior.requestRender();
      else this.screen.render();
      return;
    }

    if (this.cy < this.top) this.top = this.cy;
    if (this.cy >= this.top + H) this.top = this.cy - H + 1;
    if (this.cx < this.left) this.left = this.cx;
    if (this.cx >= this.left + W) this.left = this.cx - W + 1;
    if (this.left < 0) this.left = 0;

    const useTags = !!this.behavior.highlight;
    const digits = gutter > 0 ? gutter - 1 : 0;
    const sel = this.renderSelection();
    const rows: string[] = [];

    // Matching-bracket highlight: when the caret sits on a bracket, find its
    // partner so both ends can be underlined as the rows are rendered.
    let bm: { ay: number; ax: number; by: number; bx: number } | null = null;
    if (useTags && !sel) {
      const cur = this.lines[this.cy]?.[this.cx];
      if (cur && '()[]{}'.includes(cur)) {
        // Bracket matching can scan to EOF/BOF for an unbalanced bracket; memoise
        // by edit revision + caret so idle re-renders (e.g. the 1s clock) don't
        // rescan the buffer while the caret rests on a bracket.
        const cache = this.bracketCache;
        let m: { y: number; x: number } | null;
        if (cache && cache.rev === this.editRev && cache.y === this.cy && cache.x === this.cx) {
          m = cache.result;
        } else {
          m = this.bracketMatch(this.cy, this.cx);
          this.bracketCache = { rev: this.editRev, y: this.cy, x: this.cx, result: m };
        }
        if (m) bm = { ay: this.cy, ax: this.cx, by: m.y, bx: m.x };
      }
    }

    // Multi-line block state (block comments / triple-quoted strings) must be
    // carried across lines. Fast-forward from the top of the file to the first
    // visible row, then advance it row-by-row so blocks colour correctly even
    // when they open above the viewport.
    const lang = this.behavior.lang;
    let blk = -1;
    if (useTags && lang) {
      for (let k = 0; k < this.top && k < this.lines.length; k++) {
        blk = this.blockOut(k, this.lines[k], blk, lang);
      }
    }

    for (let i = 0; i < H; i++) {
      const idx = this.top + i;
      const line = this.lines[idx];

      if (line === undefined) {
        // Past end-of-file: show a vim-style tilde in the gutter (when enabled)
        // so trailing empty rows read as "no line here", not blank code.
        if (gutter > 0 && this.vimEnabled) {
          rows.push(useTags ? '{blue-fg}~{/blue-fg}' : '~');
        } else {
          rows.push('');
        }
        continue;
      }

      const raw = line.substr(this.left, W);
      let body: string;
      const rowSel = sel && idx >= sel.sy && idx <= sel.ey ? sel : null;
      if (rowSel) {
        body = this.renderSelectedRow(raw, idx, rowSel, line.length, useTags);
      } else if (useTags) {
        body = lang
          ? highlightLine(line, lang, this.behavior.theme, this.left, this.left + W, blk)
          : blessed.escape(raw);
        if (bm) {
          if (idx === bm.ay) body = this.overlayVisibleCol(body, bm.ax - this.left);
          if (idx === bm.by) body = this.overlayVisibleCol(body, bm.bx - this.left);
        }
      } else {
        body = raw;
      }

      // Advance block state for the next row (also across selected rows, which
      // are rendered without highlighting).
      if (useTags && lang) blk = this.blockOut(idx, line, blk, lang);

      if (gutter > 0) {
        const num = String(idx + 1).padStart(digits) + ' ';
        if (!useTags) {
          rows.push(num + body);
        } else if (idx === this.cy) {
          rows.push(`{${this.ui.gutterActive}-fg}{bold}${num}{/bold}{/${this.ui.gutterActive}-fg}` + body);
        } else {
          rows.push(`{${this.ui.gutter}-fg}${num}{/${this.ui.gutter}-fg}` + body);
        }
      } else {
        rows.push(body);
      }
    }

    this.box.setContent(rows.join('\n'));
    if (this.behavior.requestRender) {
      this.behavior.requestRender();
    } else {
      this.screen.render();
      this.placeCaret();
    }
  }

  /**
   * Wrap the character at visible column `col` of an already-highlighted,
   * blessed-tag string with an underline highlight, without disturbing the
   * surrounding markup. `{open}` / `{close}` escapes count as one visible
   * column each; every other `{…}` token is treated as zero-width.
   */
  private overlayVisibleCol(s: string, col: number): string {
    if (col < 0) return s;
    const open = `{underline}{${this.ui.bracket}-bg}`;
    const close = `{/${this.ui.bracket}-bg}{/underline}`;
    let out = '';
    let visible = 0;
    let i = 0;
    const n = s.length;
    while (i < n) {
      if (s[i] === '{') {
        const end = s.indexOf('}', i);
        if (end === -1) {
          out += s.slice(i);
          break;
        }
        const token = s.slice(i, end + 1);
        if (token === '{open}' || token === '{close}') {
          out += visible === col ? open + token + close : token;
          visible++;
        } else {
          out += token;
        }
        i = end + 1;
      } else {
        out += visible === col ? open + s[i] + close : s[i];
        visible++;
        i++;
      }
    }
    return out;
  }

  /** Render a row that intersects the selection, using reverse video. `sel`
   * uses HALF-OPEN column semantics: `ex` is exclusive on the end row. */
  private renderSelectedRow(
    raw: string,
    idx: number,
    sel: { sy: number; sx: number; ey: number; ex: number; linewise: boolean },
    lineLen: number,
    useTags: boolean
  ): string {
    let startCol: number;
    let endCol: number; // exclusive
    if (sel.linewise) {
      startCol = 0;
      endCol = lineLen;
    } else {
      startCol = idx === sel.sy ? sel.sx : 0;
      // On the last row stop at the exclusive end; on earlier rows extend one
      // past the content so the wrapped newline reads as selected.
      endCol = idx === sel.ey ? sel.ex : lineLen + 1;
    }
    const vs = Math.max(0, Math.min(raw.length, startCol - this.left));
    const ve = Math.max(0, Math.min(raw.length, endCol - this.left));
    const before = raw.slice(0, vs);
    const mid = raw.slice(vs, ve);
    const after = raw.slice(ve);
    if (!useTags) return before + mid + after;
    const esc = blessed.escape;
    return esc(before) + '{inverse}' + esc(mid || ' ') + '{/inverse}' + esc(after);
  }

  placeCaret(): void {
    const program = this.screen.program;
    if (!this.isFocused()) {
      program.hideCursor();
      return;
    }
    const atop = (this.box as unknown as { atop: number }).atop;
    const aleft = (this.box as unknown as { aleft: number }).aleft;
    const itop = (this.box as unknown as { itop: number }).itop;
    const ileft = (this.box as unknown as { ileft: number }).ileft;
    if (atop === undefined || aleft === undefined) return;
    const y = atop + itop + (this.cy - this.top);
    const x = aleft + ileft + this.gutterWidth() + (this.cx - this.left);
    program.cup(y, x);
    program.showCursor();
  }

  private innerHeight(): number {
    const h = this.box.height as unknown as number;
    return h - (this.box as unknown as { iheight: number }).iheight;
  }

  private innerWidth(): number {
    const w = this.box.width as unknown as number;
    return w - (this.box as unknown as { iwidth: number }).iwidth;
  }

  private markDirty(): void {
    this.editRev++;
    this.onDirty();
  }

  // ---- key dispatch ------------------------------------------------------

  private handleKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (!key) return;

    // While a bracketed paste is being consumed from the raw input stream (see
    // onRawInput), blessed still emits keypress events for every pasted
    // character. Drop them here — the paste text is inserted verbatim by
    // onRawInput, so echoing these would double it (and staircase the indent).
    if (this.pasting) return;

    // Shift-Tab is the app's pane-cycle shortcut (bound at screen level). The
    // focused editor also receives the keypress, so ignore it here — otherwise
    // it would be treated as a plain Tab and indent/insert spaces while cycling.
    if (key.name === 'tab' && key.shift) return;

    // Coalesce a Windows CRLF into a single Enter. One physical Enter emits a
    // "return"/\r + "enter"/\n pair in the same tick (two *different* key
    // names). Swallow the second half only when it is a differently-named
    // newline arriving within a few ms — so genuinely repeated newlines with
    // the *same* name (e.g. pasting multi-line text, or key-repeat) are kept.
    if (key.name === 'return' || key.name === 'enter' || key.name === 'linefeed') {
      const now = Date.now();
      if (
        now - this.lastNewlineTs < 20 &&
        this.lastNewlineName &&
        this.lastNewlineName !== key.name
      ) {
        this.lastNewlineTs = 0;
        this.lastNewlineName = '';
        return;
      }
      this.lastNewlineTs = now;
      this.lastNewlineName = key.name;
    }

    // A ':' command line captures everything until Enter/Escape.
    if (this.cmdline !== null) {
      this.handleCmdline(ch, key);
      return;
    }

    // Ctrl-V pastes the OS clipboard (or the internal register) at the caret,
    // in every mode. Handled before the generic Ctrl passthrough below.
    if (key.ctrl && !key.meta && key.name === 'v') {
      this.pasteClipboard();
      return;
    }

    // Let global Ctrl/Meta shortcuts (run/submit/save/quit) pass through.
    if (key.ctrl || key.meta) return;

    if (this.vimEnabled && this.mode !== 'insert') {
      this.handleVim(ch, key);
      return;
    }

    // Insert mode (also the only mode when vim is disabled).
    if (this.vimEnabled && key.name === 'escape') {
      this.selecting = false;
      this.mode = 'normal';
      if (this.cx > 0) this.cx--;
      this.clampNormal();
      this.emitStatus();
      this.render();
      return;
    }
    this.handleInsert(ch, key);
  }

  private handleInsert(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    // Escape clears an active (non-vim) selection.
    if (key.name === 'escape') {
      if (this.selecting) {
        this.selecting = false;
        this.render();
      }
      return;
    }

    // Selection handling. Shift + a motion key extends/starts a selection;
    // an unshifted motion collapses it. `key.full` (e.g. "S-up") is checked as
    // a fallback for terminals that don't set `key.shift` on arrows.
    const NAV = ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'];
    const shift =
      !!key.shift || (typeof key.full === 'string' && key.full.startsWith('S-'));
    if (NAV.includes(key.name)) {
      if (shift) {
        if (!this.selecting) {
          this.vay = this.cy;
          this.vax = this.cx;
          this.selecting = true;
        }
      } else {
        this.selecting = false;
      }
    } else if (this.selecting) {
      // A text-editing key replaces the current selection.
      const printable = !!ch && ch.length === 1 && ch >= ' ';
      if (key.name === 'backspace' || key.name === 'delete') {
        this.deleteSelectedText(false);
        this.render();
        return;
      }
      if (
        key.name === 'enter' ||
        key.name === 'return' ||
        key.name === 'tab' ||
        key.name === 'space' ||
        printable
      ) {
        this.deleteSelectedText(false);
        // Fold the upcoming insertion into the same undo step as the delete.
        this.pendingEditKind = 'insert';
      }
    }

    switch (key.name) {
      case 'up':
        this.moveUp();
        this.breakEditRun();
        break;
      case 'down':
        this.moveDown();
        this.breakEditRun();
        break;
      case 'left':
        this.moveLeft();
        this.breakEditRun();
        break;
      case 'right':
        this.moveRight();
        this.breakEditRun();
        break;
      case 'home':
        this.cx = 0;
        this.breakEditRun();
        break;
      case 'end':
        this.cx = this.lines[this.cy].length;
        this.breakEditRun();
        break;
      case 'pageup':
        this.pageMove(-this.innerHeight());
        this.breakEditRun();
        break;
      case 'pagedown':
        this.pageMove(this.innerHeight());
        this.breakEditRun();
        break;
      case 'enter':
      case 'return':
        if (this.behavior.onSubmit) {
          this.behavior.onSubmit(this.getValue());
          return;
        }
        this.captureEdit('insert');
        this.insertNewline();
        this.breakEditRun();
        break;
      case 'backspace':
        this.captureEdit('delete');
        this.backspace();
        break;
      case 'delete':
        this.captureEdit('delete');
        this.deleteForward();
        break;
      case 'tab':
        if (!this.tryExpandSnippet()) {
          this.captureEdit('insert');
          this.insert(' '.repeat(this.tabWidth));
        } else {
          this.breakEditRun();
        }
        break;
      case 'space':
        this.captureEdit('insert');
        this.insert(' ');
        break;
      default:
        if (ch && ch.length === 1 && ch >= ' ') {
          this.captureEdit('insert');
          this.typeChar(ch);
        } else {
          return;
        }
    }
    this.render();
  }

  // ---- editing primitives ------------------------------------------------

  private moveUp(): void {
    if (this.cy > 0) {
      this.cy--;
      this.cx = Math.min(this.cx, this.lines[this.cy].length);
    }
  }

  private moveDown(): void {
    if (this.cy < this.lines.length - 1) {
      this.cy++;
      this.cx = Math.min(this.cx, this.lines[this.cy].length);
    }
  }

  private moveLeft(): void {
    if (this.cx > 0) {
      this.cx--;
    } else if (this.cy > 0) {
      this.cy--;
      this.cx = this.lines[this.cy].length;
    }
  }

  private moveRight(): void {
    if (this.cx < this.lines[this.cy].length) {
      this.cx++;
    } else if (this.cy < this.lines.length - 1) {
      this.cy++;
      this.cx = 0;
    }
  }

  private pageMove(delta: number): void {
    this.cy = Math.max(0, Math.min(this.lines.length - 1, this.cy + delta));
    this.cx = Math.min(this.cx, this.lines[this.cy].length);
  }

  /** Insert a single typed character, with optional auto-close handling. */
  private typeChar(ch: string): void {
    if (this.behavior.autoClose) {
      const line = this.lines[this.cy];
      const after = line.charAt(this.cx);

      // Type over an existing closing char / quote instead of duplicating it.
      if ((CLOSERS.has(ch) || QUOTES.has(ch)) && after === ch) {
        this.cx++;
        return;
      }
      // Smart dedent: typing a closer on an all-whitespace prefix pulls it back.
      if (CLOSERS.has(ch)) {
        const before = line.slice(0, this.cx);
        if (/^\s+$/.test(before) && before.length >= this.tabWidth) {
          this.lines[this.cy] = before.slice(0, before.length - this.tabWidth) + line.slice(this.cx);
          this.cx -= this.tabWidth;
        }
      }
      // Auto-close an opening bracket or quote.
      if (PAIRS[ch]) {
        this.insert(ch + PAIRS[ch]);
        this.cx--;
        return;
      }
      if (QUOTES.has(ch) && after !== ch) {
        const prev = this.lines[this.cy].charAt(this.cx - 1);
        // Avoid pairing inside identifiers/apostrophes like it's.
        if (!/[A-Za-z0-9_]/.test(prev)) {
          this.insert(ch + ch);
          this.cx--;
          return;
        }
      }
    }
    this.insert(ch);
  }

  private insert(text: string): void {
    const line = this.lines[this.cy];
    this.lines[this.cy] = line.slice(0, this.cx) + text + line.slice(this.cx);
    this.cx += text.length;
    this.markDirty();
  }

  /** Snippet templates keyed by language family. `$0` marks the caret. */
  private snippetFor(word: string): string | null {
    const lang = (this.behavior.lang || '').toLowerCase();
    const py = lang.includes('python');
    const cLike =
      lang === 'c' ||
      lang.includes('cpp') ||
      lang.includes('c++') ||
      lang.includes('java') ||
      lang.includes('script') || // javascript / typescript
      lang.includes('csharp') ||
      lang === 'go' ||
      lang.includes('golang') ||
      lang.includes('rust');

    if (py) {
      const table: Record<string, string> = {
        for: 'for i in range($0):\n    pass',
        while: 'while $0:\n    pass',
        def: 'def $0():\n    pass',
        if: 'if $0:\n    pass',
        class: 'class $0:\n    pass',
        main: 'if __name__ == "__main__":\n    $0',
      };
      return table[word] ?? null;
    }

    if (cLike) {
      const go = lang === 'go' || lang.includes('golang');
      const table: Record<string, string> = {
        for: go
          ? 'for i := 0; i < $0; i++ {\n    \n}'
          : 'for (int i = 0; i < $0; i++) {\n    \n}',
        while: go ? 'for $0 {\n    \n}' : 'while ($0) {\n    \n}',
        if: go ? 'if $0 {\n    \n}' : 'if ($0) {\n    \n}',
        main: go
          ? 'func main() {\n    $0\n}'
          : lang.includes('java')
            ? 'public static void main(String[] args) {\n    $0\n}'
            : lang.includes('script')
              ? 'function main() {\n    $0\n}'
              : 'int main() {\n    $0\n    return 0;\n}',
      };
      return table[word] ?? null;
    }
    return null;
  }

  /** Expand a snippet keyword before the caret via Tab; false if none matched. */
  private tryExpandSnippet(): boolean {
    const line = this.lines[this.cy];
    const before = line.slice(0, this.cx);
    const after = line.slice(this.cx);
    const m = before.match(/^(\s*)([A-Za-z_]+)$/);
    if (!m || after.trim() !== '') return false;
    const indent = m[1];
    const tmpl = this.snippetFor(m[2]);
    if (!tmpl) return false;

    this.pushUndo();
    const parts = tmpl.split('\n');
    const built: string[] = [];
    let caretLine = 0;
    let caretCol = indent.length;
    for (let i = 0; i < parts.length; i++) {
      let seg = indent + parts[i];
      const idx = seg.indexOf('$0');
      if (idx >= 0) {
        caretLine = i;
        caretCol = idx;
        seg = seg.replace('$0', '');
      }
      built.push(seg);
    }
    built[built.length - 1] += after;
    this.lines.splice(this.cy, 1, ...built);
    this.cy += caretLine;
    this.cx = caretCol;
    this.markDirty();
    return true;
  }

  private insertNewline(): void {
    const line = this.lines[this.cy];
    const before = line.slice(0, this.cx);
    const after = line.slice(this.cx);
    const baseIndent = (before.match(/^\s*/) || [''])[0];
    const trimmedBefore = before.replace(/\s+$/, '');
    const opener = trimmedBefore.slice(-1);
    const pairs: Record<string, string> = { '{': '}', '(': ')', '[': ']' };
    const opensBlock =
      opener === '{' || opener === '(' || opener === '[' || trimmedBefore.endsWith(':');
    const extra = opensBlock ? ' '.repeat(this.tabWidth) : '';
    const nextChar = after.replace(/^\s*/, '').charAt(0);

    if (opensBlock && pairs[opener] && nextChar === pairs[opener]) {
      this.lines.splice(this.cy, 1, before, baseIndent + extra, baseIndent + after);
    } else {
      this.lines.splice(this.cy, 1, before, baseIndent + extra + after);
    }
    this.cy++;
    this.cx = (baseIndent + extra).length;
    this.markDirty();
  }

  private backspace(): void {
    if (this.behavior.autoClose && this.cx > 0) {
      const line = this.lines[this.cy];
      const b = line.charAt(this.cx - 1);
      const a = line.charAt(this.cx);
      // Delete an empty auto-inserted pair in one keystroke.
      if ((PAIRS[b] && a === PAIRS[b]) || (QUOTES.has(b) && a === b)) {
        this.lines[this.cy] = line.slice(0, this.cx - 1) + line.slice(this.cx + 1);
        this.cx--;
        this.markDirty();
        return;
      }
    }
    if (this.cx > 0) {
      const line = this.lines[this.cy];
      this.lines[this.cy] = line.slice(0, this.cx - 1) + line.slice(this.cx);
      this.cx--;
      this.markDirty();
    } else if (this.cy > 0) {
      const prev = this.lines[this.cy - 1];
      const cur = this.lines[this.cy];
      this.cx = prev.length;
      this.lines[this.cy - 1] = prev + cur;
      this.lines.splice(this.cy, 1);
      this.cy--;
      this.markDirty();
    }
  }

  private deleteForward(): void {
    const line = this.lines[this.cy];
    if (this.cx < line.length) {
      this.lines[this.cy] = line.slice(0, this.cx) + line.slice(this.cx + 1);
      this.markDirty();
    } else if (this.cy < this.lines.length - 1) {
      this.lines[this.cy] = line + this.lines[this.cy + 1];
      this.lines.splice(this.cy + 1, 1);
      this.markDirty();
    }
  }

  // ---- undo --------------------------------------------------------------

  private snapshot(): Snapshot {
    return { lines: this.lines.slice(), cx: this.cx, cy: this.cy };
  }

  private pushUndo(): void {
    this.undoStack.push(this.snapshot());
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /**
   * Snapshot the buffer before an edit in non-vim mode, coalescing a contiguous
   * run of the same edit `kind` into a single undo step. In vim mode undo is
   * driven by `enterInsert`/operators, so this is a no-op there.
   */
  private captureEdit(kind: 'insert' | 'delete'): void {
    if (this.vimEnabled) return;
    if (this.pendingEditKind !== kind) {
      this.pushUndo();
      this.pendingEditKind = kind;
    }
  }

  /** Break the current edit run so the next edit starts a fresh undo step. */
  private breakEditRun(): void {
    this.pendingEditKind = '';
  }

  private undo(): void {
    const snap = this.undoStack.pop();
    if (!snap) return;
    this.redoStack.push(this.snapshot());
    this.lines = snap.lines.slice();
    this.cy = Math.min(snap.cy, this.lines.length - 1);
    this.cx = Math.min(snap.cx, this.lines[this.cy].length);
    this.markDirty();
  }

  private redo(): void {
    const snap = this.redoStack.pop();
    if (!snap) return;
    this.undoStack.push(this.snapshot());
    this.lines = snap.lines.slice();
    this.cy = Math.min(snap.cy, this.lines.length - 1);
    this.cx = Math.min(snap.cx, this.lines[this.cy].length);
    this.markDirty();
  }

  // ---- vim ---------------------------------------------------------------

  private clampNormal(): void {
    if (!this.vimEnabled || this.mode === 'insert') return;
    const len = this.lines[this.cy].length;
    const max = this.mode === 'normal' ? Math.max(0, len - 1) : len;
    if (this.cx > max) this.cx = max;
    if (this.cx < 0) this.cx = 0;
  }

  private enterInsert(): void {
    this.pushUndo();
    this.mode = 'insert';
    this.pending = '';
    this.emitStatus();
  }

  private selectionBounds(): {
    sy: number;
    sx: number;
    ey: number;
    ex: number;
    linewise: boolean;
  } | null {
    if (this.mode !== 'visual' && this.mode !== 'visual-line') return null;
    const linewise = this.mode === 'visual-line';
    let sy = this.vay;
    let sx = this.vax;
    let ey = this.cy;
    let ex = this.cx;
    if (sy > ey || (sy === ey && sx > ex)) {
      [sy, ey] = [ey, sy];
      [sx, ex] = [ex, sx];
    }
    return { sy, sx, ey, ex, linewise };
  }

  /**
   * Ordered half-open bounds of the non-vim (default-mode) selection, or null
   * when there is none / it is empty. `bx` is exclusive.
   */
  private insertSel(): { ay: number; ax: number; by: number; bx: number } | null {
    if (!this.selecting) return null;
    let ay = this.vay;
    let ax = this.vax;
    let by = this.cy;
    let bx = this.cx;
    if (ay > by || (ay === by && ax > bx)) {
      [ay, by] = [by, ay];
      [ax, bx] = [bx, ax];
    }
    if (ay === by && ax === bx) return null;
    return { ay, ax, by, bx };
  }

  /**
   * Unified selection descriptor for rendering, in HALF-OPEN column semantics
   * (`ex` exclusive on the end row). Covers both the default-mode selection and
   * vim visual mode (whose bounds are inclusive, so `ex` is bumped by one).
   */
  private renderSelection():
    | { sy: number; sx: number; ey: number; ex: number; linewise: boolean }
    | null {
    const is = this.insertSel();
    if (is) return { sy: is.ay, sx: is.ax, ey: is.by, ex: is.bx, linewise: false };
    const vb = this.selectionBounds();
    if (vb) return { sy: vb.sy, sx: vb.sx, ey: vb.ey, ex: vb.ex + 1, linewise: vb.linewise };
    return null;
  }

  /** Extract the text of a half-open range without modifying the buffer. */
  private rangeText(ay: number, ax: number, by: number, bx: number): string {
    if (ay === by) return this.lines[ay].slice(ax, bx);
    const first = this.lines[ay].slice(ax);
    const mid = this.lines.slice(ay + 1, by);
    const last = this.lines[by].slice(0, bx);
    return [first, ...mid, last].join('\n');
  }

  /**
   * Remove a half-open range from the buffer, place the caret at its start and
   * return the removed text. Does not push undo (callers do).
   */
  private removeRange(ay: number, ax: number, by: number, bx: number): string {
    const text = this.rangeText(ay, ax, by, bx);
    if (ay === by) {
      this.lines[ay] = this.lines[ay].slice(0, ax) + this.lines[ay].slice(bx);
    } else {
      const head = this.lines[ay].slice(0, ax);
      const tail = this.lines[by].slice(bx);
      this.lines.splice(ay, by - ay + 1, head + tail);
    }
    this.cy = ay;
    this.cx = ax;
    return text;
  }

  /** Delete the active default-mode selection, optionally into the register. */
  private deleteSelectedText(setRegister: boolean): void {
    const sel = this.insertSel();
    if (!sel) return;
    this.pushUndo();
    const text = this.removeRange(sel.ay, sel.ax, sel.by, sel.bx);
    if (setRegister) {
      this.register = text;
      this.registerLinewise = false;
    }
    this.selecting = false;
    this.breakEditRun();
    this.markDirty();
    this.emitStatus();
  }

  /** True when any selection (default-mode or vim visual) is active. */
  hasSelection(): boolean {
    return this.insertSel() !== null || this.selectionBounds() !== null;
  }

  /** Copy the current selection to the register and OS clipboard. */
  copySelection(): void {
    const sel = this.insertSel();
    if (sel) {
      const text = this.rangeText(sel.ay, sel.ax, sel.by, sel.bx);
      this.register = text;
      this.registerLinewise = false;
      writeClipboard(text);
      this.render(); // selection stays highlighted
      return;
    }
    if (this.selectionBounds()) {
      // Vim visual mode: reuse the existing yank, then mirror to the clipboard.
      this.yankSelection();
      writeClipboard(this.register);
    }
  }

  /** Cut the current selection to the register and OS clipboard. */
  cutSelection(): void {
    const sel = this.insertSel();
    if (sel) {
      this.deleteSelectedText(true);
      writeClipboard(this.register);
      this.render();
      return;
    }
    if (this.selectionBounds()) {
      this.deleteSelection(false);
      writeClipboard(this.register);
      this.render();
    }
  }

  /** Toggle terminal bracketed-paste mode (DECSET/DECRST 2004). */
  private setBracketedPaste(on: boolean): void {
    try {
      const program = this.screen.program as unknown as {
        setMode?: (p: string) => void;
        resetMode?: (p: string) => void;
      };
      if (on) program.setMode?.('?2004');
      else program.resetMode?.('?2004');
    } catch {
      /* terminal may not support mode changes; ignore */
    }
  }

  /**
   * Raw input-stream handler (runs before blessed's key parser). Detects the
   * bracketed-paste wrapper ESC[200~ … ESC[201~, captures the enclosed text
   * verbatim (across multiple data chunks if needed) and inserts it at the
   * caret, while flagging `pasting` so blessed's echoed keystrokes are dropped.
   */
  private onRawInput(data: unknown): void {
    if (!this.isFocused()) return;
    let chunk: string;
    if (typeof data === 'string') chunk = data;
    else if (Buffer.isBuffer(data)) chunk = this.pasteDecoder.write(data);
    else return;

    const START = '\x1b[200~';
    const END = '\x1b[201~';
    let s = this.pasteCarry + chunk;
    this.pasteCarry = '';

    while (s.length > 0) {
      if (!this.pasteCapturing) {
        const i = s.indexOf(START);
        if (i === -1) {
          // Hold back a trailing partial START so a marker split across data
          // chunks is still recognized next time (these bytes are also handled
          // by blessed independently, so nothing is lost if it isn't a marker).
          this.pasteCarry = tailPrefix(s, START);
          return;
        }
        s = s.slice(i + START.length);
        this.pasteCapturing = true;
        this.pasting = true; // drop the keystrokes blessed will echo for this paste
        this.pasteRaw = '';
      }
      const j = s.indexOf(END);
      if (j === -1) {
        // Commit all but a possible partial END, which we carry to the next chunk.
        const keep = tailPrefix(s, END);
        this.pasteRaw += keep ? s.slice(0, s.length - keep.length) : s;
        this.pasteCarry = keep;
        this.armPasteTimer();
        return;
      }
      this.pasteRaw += s.slice(0, j);
      s = s.slice(j + END.length);
      this.finishPaste();
    }
  }

  /** Commit the captured paste and schedule re-enabling normal typing. */
  private finishPaste(): void {
    if (this.pasteTimer) {
      clearTimeout(this.pasteTimer);
      this.pasteTimer = null;
    }
    this.pasteCapturing = false;
    const text = this.pasteRaw;
    this.pasteRaw = '';
    this.insertPasteText(text);
    // Keep `pasting` true until blessed finishes echoing this chunk's keys (its
    // data handler runs synchronously right after ours), then re-enable typing.
    // The generation guard stops a stale callback from clearing a newer paste.
    const gen = ++this.pasteGen;
    setImmediate(() => {
      if (this.pasteGen === gen && !this.pasteCapturing) this.pasting = false;
    });
  }

  /** Arm a safety timer that recovers if a paste's END marker never arrives. */
  private armPasteTimer(): void {
    if (this.pasteTimer) clearTimeout(this.pasteTimer);
    this.pasteTimer = setTimeout(() => {
      this.pasteTimer = null;
      if (!this.pasteCapturing) return;
      // Insert whatever we captured (dropping any dangling partial END) so the
      // editor never gets stuck ignoring input.
      this.pasteCapturing = false;
      const text = this.pasteRaw;
      this.pasteRaw = '';
      this.pasteCarry = '';
      this.insertPasteText(text);
      this.pasting = false;
    }, 250);
  }

  /** Abandon any in-flight paste and restore normal typing (used on blur). */
  private resetPasteState(): void {
    if (this.pasteTimer) {
      clearTimeout(this.pasteTimer);
      this.pasteTimer = null;
    }
    this.pasteCapturing = false;
    this.pasting = false;
    this.pasteRaw = '';
    this.pasteCarry = '';
    this.pasteGen++;
  }

  /**
   * Normalize pasted text to the editor's buffer invariant: LF-only newlines and
   * tabs expanded to spaces (the buffer never stores '\r' or '\t' — see
   * normalizeToLines). Single-line inputs (onSubmit set) drop newlines entirely.
   */
  private normalizePasted(raw: string): string {
    let text = raw.replace(/\r\n?/g, '\n').replace(/\t/g, ' '.repeat(this.tabWidth));
    if (this.behavior.onSubmit) text = text.replace(/\n+/g, ' ');
    return text;
  }

  /** Insert paste text verbatim at the caret as a single undo step. */
  private insertPasteText(raw: string): void {
    const text = this.normalizePasted(raw);
    if (!text) return;
    this.pushUndo();
    const sel = this.insertSel();
    if (sel) {
      this.removeRange(sel.ay, sel.ax, sel.by, sel.bx);
      this.selecting = false;
    }
    const end = this.insertTextAt(this.cy, this.cx, text);
    this.cy = end.ey;
    this.cx = end.ex;
    this.breakEditRun();
    this.clampNormal();
    this.markDirty();
    this.emitStatus();
    this.render();
  }

  /** Paste the OS clipboard (falling back to the register) at the caret. */
  pasteClipboard(): void {
    const clip = readClipboard();
    const source = clip && clip.length ? clip : this.register;
    if (!source) return;
    const text = this.normalizePasted(source);
    if (!text) return;
    this.pushUndo();
    const sel = this.insertSel();
    if (sel) {
      this.removeRange(sel.ay, sel.ax, sel.by, sel.bx);
      this.selecting = false;
    }
    const end = this.insertTextAt(this.cy, this.cx, text);
    this.cy = end.ey;
    this.cx = end.ex;
    this.breakEditRun();
    this.clampNormal();
    this.markDirty();
    this.emitStatus();
    this.render();
  }

  private handleVim(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    const name = key.name;
    if (name === 'escape') {
      this.mode = 'normal';
      this.pending = '';
      this.clampNormal();
      this.emitStatus();
      this.render();
      return;
    }

    // Pending operators / two-key commands.
    if (this.pending) {
      this.handlePending(ch, key);
      return;
    }

    if (this.mode === 'visual' || this.mode === 'visual-line') {
      if (this.handleVisual(ch, key)) return;
    }

    // Motions shared by normal & visual modes.
    if (this.applyMotion(ch, name)) {
      this.clampNormal();
      this.emitStatus();
      this.render();
      return;
    }

    if (this.mode === 'visual' || this.mode === 'visual-line') return;

    // Normal-mode commands.
    switch (ch) {
      case 'i':
        this.enterInsert();
        break;
      case 'a':
        if (this.cx < this.lines[this.cy].length) this.cx++;
        this.enterInsert();
        break;
      case 'A':
        this.cx = this.lines[this.cy].length;
        this.enterInsert();
        break;
      case 'I':
        this.cx = this.firstNonBlank(this.cy);
        this.enterInsert();
        break;
      case 'o':
        this.openLine(false);
        break;
      case 'O':
        this.openLine(true);
        break;
      case 'x':
        this.deleteUnderCaret();
        this.lastDot = () => this.deleteUnderCaret();
        break;
      case 'D':
        this.deleteToLineEnd(false);
        break;
      case 'C':
        this.deleteToLineEnd(true);
        break;
      case 'p':
        this.paste(true);
        this.lastDot = () => this.paste(true);
        break;
      case 'P':
        this.paste(false);
        this.lastDot = () => this.paste(false);
        break;
      case '.':
        if (this.lastDot) {
          this.lastDot();
          this.clampNormal();
        }
        this.emitStatus();
        this.render();
        return;
      case 'u':
        this.undo();
        break;
      case 'v':
        this.startVisual('visual');
        break;
      case 'V':
        this.startVisual('visual-line');
        break;
      case 'd':
      case 'y':
      case 'c':
      case 'g':
      case 'r':
      case 'f':
      case 'F':
      case 't':
      case 'T':
      case '>':
      case '<':
        this.pending = ch;
        this.emitStatus();
        return;
      case ':':
        this.cmdline = '';
        this.emitStatus();
        this.render();
        return;
      default:
        return; // ignore unknown keys
    }
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  private handlePending(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    const op = this.pending;
    this.pending = '';

    if (op === 'g') {
      if (ch === 'g') {
        this.cy = 0;
        this.clampNormal();
      }
      this.emitStatus();
      this.render();
      return;
    }

    if (op === 'r') {
      if (ch && ch.length === 1 && ch >= ' ') {
        const rc = ch;
        this.replaceCharAtCaret(rc);
        this.lastDot = () => this.replaceCharAtCaret(rc);
      }
      this.emitStatus();
      this.render();
      return;
    }

    // Standalone find-char motions: f/F/t/T followed by a target char.
    if (op === 'f' || op === 'F' || op === 't' || op === 'T') {
      if (ch && ch.length === 1) {
        this.doFind(op, ch);
        this.lastFind = { cmd: op, ch };
      }
      this.emitStatus();
      this.render();
      return;
    }

    // Indent / outdent the current line: >> and <<.
    if (op === '>' || op === '<') {
      if (ch === op) {
        const dir = op === '>' ? 1 : -1;
        this.indentLine(this.cy, dir);
        this.lastDot = () => this.indentLine(this.cy, dir);
      }
      this.emitStatus();
      this.render();
      return;
    }

    // Operator + find target already collected (e.g. df, dt, dF, dT).
    if (op.length === 2 && 'ftFT'.includes(op[1])) {
      const base = op[0];
      const cmd = op[1];
      if (ch && ch.length === 1) {
        const range = this.findMotionRange(cmd, ch);
        if (range) {
          this.operateChars(base, range.from, range.to);
          if (base === 'd') {
            const t = ch;
            this.lastDot = () => {
              const r = this.findMotionRange(cmd, t);
              if (r) this.operateChars('d', r.from, r.to);
            };
          }
        }
      }
      this.emitStatus();
      this.render();
      return;
    }

    // Operator followed by an f/t motion: wait for the target char (e.g. "df").
    if ((op === 'd' || op === 'y' || op === 'c') && 'ftFT'.includes(ch)) {
      this.pending = op + ch;
      this.emitStatus();
      return;
    }

    // Operators d / y / c.
    const linewise = ch === op; // dd, yy, cc
    if (linewise) {
      this.operateLines(op, this.cy, this.cy);
      if (op === 'd') this.lastDot = () => this.operateLines('d', this.cy, this.cy);
    } else {
      const range = this.motionColRange(ch, key.name, op === 'c');
      if (range) {
        this.operateChars(op, range.from, range.to);
        if (op === 'd') {
          const mch = ch;
          const mname = key.name;
          this.lastDot = () => {
            const r = this.motionColRange(mch, mname, false);
            if (r) this.operateChars('d', r.from, r.to);
          };
        }
      } else {
        this.emitStatus();
        this.render();
        return;
      }
    }
    this.emitStatus();
    this.render();
  }

  private handleVisual(ch: string, key: blessed.Widgets.Events.IKeyEventArg): boolean {
    switch (ch) {
      case 'd':
      case 'x':
        this.deleteSelection(false);
        return true;
      case 'y':
        this.yankSelection();
        return true;
      case 'c':
        this.deleteSelection(true);
        return true;
      case 'v':
        this.mode = this.mode === 'visual' ? 'normal' : 'visual';
        this.clampNormal();
        this.emitStatus();
        this.render();
        return true;
      case 'V':
        this.mode = this.mode === 'visual-line' ? 'normal' : 'visual-line';
        this.clampNormal();
        this.emitStatus();
        this.render();
        return true;
      default:
        return false;
    }
    void key;
  }

  /** Movement shared by normal & visual modes. Returns true if handled. */
  private applyMotion(ch: string, name: string): boolean {
    switch (ch) {
      case 'h':
        if (this.cx > 0) this.cx--;
        return true;
      case 'l':
        if (this.cx < this.lines[this.cy].length) this.cx++;
        return true;
      case 'j':
        if (this.cy < this.lines.length - 1) this.cy++;
        return true;
      case 'k':
        if (this.cy > 0) this.cy--;
        return true;
      case '0':
        this.cx = 0;
        return true;
      case '$':
        this.cx = Math.max(0, this.lines[this.cy].length - 1);
        return true;
      case '^':
        this.cx = this.firstNonBlank(this.cy);
        return true;
      case 'w':
        this.wordForward();
        return true;
      case 'b':
        this.wordBackward();
        return true;
      case 'e':
        this.wordEnd();
        return true;
      case 'G':
        this.cy = this.lines.length - 1;
        return true;
      case '%': {
        const m = this.bracketMatch(this.cy, this.cx);
        if (m) {
          this.cy = m.y;
          this.cx = m.x;
        }
        return true;
      }
      case ';':
        if (this.lastFind) this.doFind(this.lastFind.cmd, this.lastFind.ch);
        return true;
      case ',':
        if (this.lastFind) {
          const rev = { f: 'F', F: 'f', t: 'T', T: 't' }[this.lastFind.cmd] ?? this.lastFind.cmd;
          this.doFind(rev, this.lastFind.ch);
        }
        return true;
      default:
        break;
    }
    switch (name) {
      case 'left':
        if (this.cx > 0) this.cx--;
        return true;
      case 'right':
        if (this.cx < this.lines[this.cy].length) this.cx++;
        return true;
      case 'up':
        if (this.cy > 0) this.cy--;
        return true;
      case 'down':
        if (this.cy < this.lines.length - 1) this.cy++;
        return true;
      default:
        return false;
    }
  }

  /** Replace the character under the caret with `ch` (used by `r` and `.`). */
  private replaceCharAtCaret(ch: string): void {
    const line = this.lines[this.cy];
    if (this.cx < line.length) {
      this.pushUndo();
      this.lines[this.cy] = line.slice(0, this.cx) + ch + line.slice(this.cx + 1);
      this.markDirty();
    }
  }

  /** Column reached by an f/F/t/T search on the current line, or null. */
  private findCharCol(cmd: string, target: string): number | null {
    const line = this.lines[this.cy];
    if (cmd === 'f') {
      for (let i = this.cx + 1; i < line.length; i++) if (line[i] === target) return i;
    } else if (cmd === 'F') {
      for (let i = this.cx - 1; i >= 0; i--) if (line[i] === target) return i;
    } else if (cmd === 't') {
      for (let i = this.cx + 1; i < line.length; i++) if (line[i] === target) return i - 1;
    } else if (cmd === 'T') {
      for (let i = this.cx - 1; i >= 0; i--) if (line[i] === target) return i + 1;
    }
    return null;
  }

  private doFind(cmd: string, target: string): boolean {
    const col = this.findCharCol(cmd, target);
    if (col === null) return false;
    this.cx = col;
    this.clampNormal();
    return true;
  }

  /** Column range deleted/changed by an operator + f/t motion (e.g. df,). */
  private findMotionRange(cmd: string, target: string): { from: number; to: number } | null {
    const col = this.findCharCol(cmd, target);
    if (col === null) return null;
    if (cmd === 'f' || cmd === 't') return { from: this.cx, to: col + 1 };
    return { from: col, to: this.cx };
  }

  /** Indent (dir>0) or outdent (dir<0) a line by one tab width. */
  private indentLine(y: number, dir: number): void {
    this.pushUndo();
    if (dir > 0) {
      this.lines[y] = ' '.repeat(this.tabWidth) + this.lines[y];
    } else {
      const lead = (this.lines[y].match(/^ */) || [''])[0].length;
      const remove = Math.min(this.tabWidth, lead);
      this.lines[y] = this.lines[y].slice(remove);
    }
    this.cx = this.firstNonBlank(y);
    this.markDirty();
  }

  private firstNonBlank(y: number): number {
    const m = this.lines[y].match(/^\s*/);
    return m ? m[0].length : 0;
  }

  /**
   * Vim `%`: find the bracket matching the one at (y, x). If the caret is not on
   * a bracket, the first bracket to the right on the same line is used as the
   * start (like vim). Returns the matching position, or null if unbalanced.
   */
  private bracketMatch(y: number, x: number): { y: number; x: number } | null {
    const open = '([{';
    const close = ')]}';
    const line = this.lines[y];
    let ch = line[x] ?? '';
    let sx = x;
    if (open.indexOf(ch) < 0 && close.indexOf(ch) < 0) {
      const rel = line.slice(x).search(/[()[\]{}]/);
      if (rel < 0) return null;
      sx = x + rel;
      ch = line[sx];
    }
    const oi = open.indexOf(ch);
    if (oi >= 0) {
      const target = close[oi];
      let depth = 0;
      for (let yy = y; yy < this.lines.length; yy++) {
        const l = this.lines[yy];
        for (let xx = yy === y ? sx : 0; xx < l.length; xx++) {
          const c = l[xx];
          if (c === ch) depth++;
          else if (c === target && --depth === 0) return { y: yy, x: xx };
        }
      }
      return null;
    }
    const ci = close.indexOf(ch);
    if (ci >= 0) {
      const target = open[ci];
      let depth = 0;
      for (let yy = y; yy >= 0; yy--) {
        const l = this.lines[yy];
        for (let xx = yy === y ? sx : l.length - 1; xx >= 0; xx--) {
          const c = l[xx];
          if (c === ch) depth++;
          else if (c === target && --depth === 0) return { y: yy, x: xx };
        }
      }
      return null;
    }
    return null;
  }

  private isWordChar(c: string): boolean {
    return /[A-Za-z0-9_]/.test(c);
  }

  private wordForward(): void {
    const line = this.lines[this.cy];
    let i = this.cx;
    const n = line.length;
    if (i >= n) {
      if (this.cy < this.lines.length - 1) {
        this.cy++;
        this.cx = 0;
      }
      return;
    }
    const startWord = this.isWordChar(line[i]);
    while (i < n && this.isWordChar(line[i]) === startWord && line[i] !== ' ') i++;
    while (i < n && line[i] === ' ') i++;
    this.cx = i;
  }

  private wordBackward(): void {
    const line = this.lines[this.cy];
    let i = this.cx;
    if (i === 0) {
      if (this.cy > 0) {
        this.cy--;
        this.cx = this.lines[this.cy].length;
      }
      return;
    }
    i--;
    while (i > 0 && line[i] === ' ') i--;
    while (i > 0 && this.isWordChar(line[i - 1])) i--;
    this.cx = i;
  }

  private wordEnd(): void {
    const line = this.lines[this.cy];
    let i = this.cx + 1;
    const n = line.length;
    while (i < n && line[i] === ' ') i++;
    while (i + 1 < n && this.isWordChar(line[i + 1])) i++;
    this.cx = Math.min(i, Math.max(0, n - 1));
  }

  /** Column range for an operator+motion on the current line. */
  private motionColRange(
    ch: string,
    name: string,
    isChange: boolean
  ): { from: number; to: number } | null {
    const line = this.lines[this.cy];
    const start = this.cx;
    switch (ch) {
      case 'w': {
        if (isChange) {
          // cw acts like ce: to end of current word.
          let i = this.cx;
          while (i < line.length && this.isWordChar(line[i])) i++;
          return { from: start, to: Math.max(i, start + 1) };
        }
        const save = this.cx;
        const saveY = this.cy;
        this.wordForward();
        const to = this.cy === saveY ? this.cx : line.length;
        this.cx = save;
        this.cy = saveY;
        return { from: start, to: Math.max(to, start) };
      }
      case 'e': {
        const save = this.cx;
        this.wordEnd();
        const to = this.cx + 1;
        this.cx = save;
        return { from: start, to };
      }
      case '$':
        return { from: start, to: line.length };
      case '0':
        return { from: 0, to: start };
      default:
        void name;
        return null;
    }
  }

  private startVisual(mode: 'visual' | 'visual-line'): void {
    this.mode = mode;
    this.vax = this.cx;
    this.vay = this.cy;
    this.emitStatus();
    this.render();
  }

  private openLine(above: boolean): void {
    this.pushUndo();
    const y = above ? this.cy : this.cy + 1;
    const indent = (this.lines[this.cy].match(/^\s*/) || [''])[0];
    this.lines.splice(y, 0, indent);
    this.cy = y;
    this.cx = indent.length;
    this.mode = 'insert';
    this.markDirty();
    this.emitStatus();
  }

  private deleteUnderCaret(): void {
    const line = this.lines[this.cy];
    if (this.cx < line.length) {
      this.pushUndo();
      this.register = line.charAt(this.cx);
      this.registerLinewise = false;
      this.lines[this.cy] = line.slice(0, this.cx) + line.slice(this.cx + 1);
      this.clampNormal();
      this.markDirty();
    }
  }

  private deleteToLineEnd(change: boolean): void {
    this.pushUndo();
    const line = this.lines[this.cy];
    this.register = line.slice(this.cx);
    this.registerLinewise = false;
    this.lines[this.cy] = line.slice(0, this.cx);
    if (change) this.mode = 'insert';
    else this.clampNormal();
    this.markDirty();
    this.emitStatus();
  }

  private operateLines(op: string, y1: number, y2: number): void {
    this.register = this.lines.slice(y1, y2 + 1).join('\n') + '\n';
    this.registerLinewise = true;
    if (op === 'y') return;
    this.pushUndo();
    this.lines.splice(y1, y2 - y1 + 1);
    if (this.lines.length === 0) this.lines = [''];
    if (op === 'c') {
      const indent = '';
      this.lines.splice(y1, 0, indent);
      this.cy = y1;
      this.cx = 0;
      this.mode = 'insert';
    } else {
      this.cy = Math.min(y1, this.lines.length - 1);
      this.cx = this.firstNonBlank(this.cy);
    }
    this.markDirty();
  }

  private operateChars(op: string, from: number, to: number): void {
    const line = this.lines[this.cy];
    const a = Math.max(0, Math.min(from, to));
    const b = Math.min(line.length, Math.max(from, to));
    this.register = line.slice(a, b);
    this.registerLinewise = false;
    if (op === 'y') {
      this.cx = a;
      return;
    }
    this.pushUndo();
    this.lines[this.cy] = line.slice(0, a) + line.slice(b);
    this.cx = a;
    if (op === 'c') this.mode = 'insert';
    else this.clampNormal();
    this.markDirty();
  }

  private deleteSelection(change: boolean): void {
    const sel = this.selectionBounds();
    if (!sel) return;
    this.pushUndo();
    if (sel.linewise) {
      this.register = this.lines.slice(sel.sy, sel.ey + 1).join('\n') + '\n';
      this.registerLinewise = true;
      this.lines.splice(sel.sy, sel.ey - sel.sy + 1);
      if (this.lines.length === 0) this.lines = [''];
      if (change) {
        this.lines.splice(sel.sy, 0, '');
        this.cy = sel.sy;
        this.cx = 0;
        this.mode = 'insert';
      } else {
        this.cy = Math.min(sel.sy, this.lines.length - 1);
        this.cx = this.firstNonBlank(this.cy);
        this.mode = 'normal';
      }
    } else {
      const endEx = sel.ex + 1;
      if (sel.sy === sel.ey) {
        const line = this.lines[sel.sy];
        this.register = line.slice(sel.sx, endEx);
        this.lines[sel.sy] = line.slice(0, sel.sx) + line.slice(endEx);
      } else {
        const first = this.lines[sel.sy];
        const last = this.lines[sel.ey];
        const head = first.slice(0, sel.sx);
        const tail = last.slice(endEx);
        const mid = [first.slice(sel.sx), ...this.lines.slice(sel.sy + 1, sel.ey), last.slice(0, endEx)];
        this.register = mid.join('\n');
        this.lines.splice(sel.sy, sel.ey - sel.sy + 1, head + tail);
      }
      this.registerLinewise = false;
      this.cy = sel.sy;
      this.cx = sel.sx;
      this.mode = change ? 'insert' : 'normal';
      if (!change) this.clampNormal();
    }
    this.markDirty();
    this.emitStatus();
  }

  private yankSelection(): void {
    const sel = this.selectionBounds();
    if (!sel) return;
    if (sel.linewise) {
      this.register = this.lines.slice(sel.sy, sel.ey + 1).join('\n') + '\n';
      this.registerLinewise = true;
    } else {
      const endEx = sel.ex + 1;
      if (sel.sy === sel.ey) {
        this.register = this.lines[sel.sy].slice(sel.sx, endEx);
      } else {
        const first = this.lines[sel.sy].slice(sel.sx);
        const last = this.lines[sel.ey].slice(0, endEx);
        this.register = [first, ...this.lines.slice(sel.sy + 1, sel.ey), last].join('\n');
      }
      this.registerLinewise = false;
    }
    this.cy = sel.sy;
    this.cx = sel.sx;
    this.mode = 'normal';
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  private paste(after: boolean): void {
    if (!this.register) return;
    this.pushUndo();
    if (this.registerLinewise) {
      const text = this.register.replace(/\n$/, '');
      const newLines = text.split('\n');
      const at = after ? this.cy + 1 : this.cy;
      this.lines.splice(at, 0, ...newLines);
      this.cy = at;
      this.cx = this.firstNonBlank(this.cy);
    } else {
      const line = this.lines[this.cy];
      const at = after ? Math.min(line.length, this.cx + 1) : this.cx;
      const end = this.insertTextAt(this.cy, at, this.register);
      this.cy = end.ey;
      this.cx = Math.max(0, end.ex - 1); // vim places the caret on the last pasted char
    }
    this.markDirty();
  }

  /**
   * Insert `text` (which may contain newlines) at (cy, cx), splitting it across
   * logical lines so the buffer invariant "no line contains a newline" holds.
   * Returns the caret position just past the inserted text.
   */
  private insertTextAt(cy: number, cx: number, text: string): { ey: number; ex: number } {
    const parts = text.split('\n');
    const line = this.lines[cy];
    const head = line.slice(0, cx);
    const tail = line.slice(cx);
    if (parts.length === 1) {
      this.lines[cy] = head + parts[0] + tail;
      return { ey: cy, ex: cx + parts[0].length };
    }
    const newLines = [head + parts[0]];
    for (let k = 1; k < parts.length - 1; k++) newLines.push(parts[k]);
    const last = parts[parts.length - 1];
    newLines.push(last + tail);
    this.lines.splice(cy, 1, ...newLines);
    return { ey: cy + parts.length - 1, ex: last.length };
  }

  // ---- ':' command line --------------------------------------------------

  private handleCmdline(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (key.name === 'escape') {
      this.cmdline = null;
      this.emitStatus();
      this.render();
      return;
    }
    if (key.name === 'enter' || key.name === 'return') {
      const cmd = (this.cmdline || '').trim();
      this.cmdline = null;
      this.runExCommand(cmd);
      return;
    }
    if (key.name === 'backspace') {
      if (this.cmdline && this.cmdline.length > 0) {
        this.cmdline = this.cmdline.slice(0, -1);
      } else {
        this.cmdline = null;
      }
      this.emitStatus();
      this.render();
      return;
    }
    if (ch && ch.length === 1 && ch >= ' ') {
      this.cmdline += ch;
      this.emitStatus();
      this.render();
    }
  }

  private runExCommand(cmd: string): void {
    if (cmd === 'w' || cmd === 'write') {
      if (this.behavior.onSave) this.behavior.onSave();
    } else if (cmd === 'q' || cmd === 'quit') {
      if (this.behavior.onQuit) this.behavior.onQuit();
      return;
    } else if (cmd === 'wq' || cmd === 'x') {
      if (this.behavior.onSave) this.behavior.onSave();
      if (this.behavior.onQuit) this.behavior.onQuit();
      return;
    }
    this.emitStatus();
    this.render();
  }
}
