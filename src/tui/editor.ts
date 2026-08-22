import blessed from 'blessed';
import { highlightLine } from './highlight';

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

  // Vim state.
  private vimEnabled = false;
  private mode: EditorMode = 'insert';
  private pending = ''; // multi-key operator buffer (d, y, c, g, r)
  private cmdline: string | null = null; // ':' command buffer (null when inactive)
  private register = '';
  private registerLinewise = false;
  private undoStack: Snapshot[] = [];
  private redoStack: Snapshot[] = [];
  private vax = 0; // visual anchor column
  private vay = 0; // visual anchor row
  private lastNewlineTs = 0; // timestamp of last processed newline, to coalesce CRLF halves
  private lastNewlineName = ''; // key name of last processed newline (return/enter/linefeed)
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
    this.box.on('click', () => {
      this.box.focus();
      this.render();
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

  setValue(value: string): void {
    this.lines = value.replace(/\r\n/g, '\n').split('\n');
    if (this.lines.length === 0) this.lines = [''];
    this.cy = Math.min(this.cy, this.lines.length - 1);
    this.cx = Math.min(this.cx, this.lines[this.cy].length);
    this.undoStack = [];
    this.redoStack = [];
    this.render();
  }

  /**
   * Replace the whole buffer but keep it undoable (Ctrl-Z restores the prior
   * content). Used to reset the editor back to the original starter code.
   */
  resetTo(value: string): void {
    this.pushUndo();
    this.lines = value.replace(/\r\n/g, '\n').split('\n');
    if (this.lines.length === 0) this.lines = [''];
    this.cy = 0;
    this.cx = 0;
    this.top = 0;
    this.left = 0;
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
    this.clampNormal();
    this.emitStatus();
    this.render();
  }

  /** Public redo, for a Ctrl-Y binding. */
  redoAction(): void {
    this.redo();
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

  render(): void {
    const H = this.innerHeight();
    const gutter = this.gutterWidth();
    const W = this.innerWidth() - gutter;
    if (H <= 0 || W <= 0) {
      this.screen.render();
      return;
    }

    if (this.cy < this.top) this.top = this.cy;
    if (this.cy >= this.top + H) this.top = this.cy - H + 1;
    if (this.cx < this.left) this.left = this.cx;
    if (this.cx >= this.left + W) this.left = this.cx - W + 1;
    if (this.left < 0) this.left = 0;

    const useTags = !!this.behavior.highlight;
    const digits = gutter > 0 ? gutter - 1 : 0;
    const sel = this.selectionBounds();
    const rows: string[] = [];

    // Matching-bracket highlight: when the caret sits on a bracket, find its
    // partner so both ends can be underlined as the rows are rendered.
    let bm: { ay: number; ax: number; by: number; bx: number } | null = null;
    if (useTags && !sel) {
      const cur = this.lines[this.cy]?.[this.cx];
      if (cur && '()[]{}'.includes(cur)) {
        const m = this.bracketMatch(this.cy, this.cx);
        if (m) bm = { ay: this.cy, ax: this.cx, by: m.y, bx: m.x };
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
        body = this.behavior.lang
          ? highlightLine(raw, this.behavior.lang, this.behavior.theme)
          : blessed.escape(raw);
        if (bm) {
          if (idx === bm.ay) body = this.overlayVisibleCol(body, bm.ax - this.left);
          if (idx === bm.by) body = this.overlayVisibleCol(body, bm.bx - this.left);
        }
      } else {
        body = raw;
      }

      if (gutter > 0) {
        const num = String(idx + 1).padStart(digits) + ' ';
        if (!useTags) {
          rows.push(num + body);
        } else if (idx === this.cy) {
          rows.push(`{yellow-fg}{bold}${num}{/bold}{/yellow-fg}` + body);
        } else {
          rows.push(`{cyan-fg}${num}{/cyan-fg}` + body);
        }
      } else {
        rows.push(body);
      }
    }

    this.box.setContent(rows.join('\n'));
    this.screen.render();
    this.placeCaret();
  }

  /**
   * Wrap the character at visible column `col` of an already-highlighted,
   * blessed-tag string with an underline highlight, without disturbing the
   * surrounding markup. `{open}` / `{close}` escapes count as one visible
   * column each; every other `{…}` token is treated as zero-width.
   */
  private overlayVisibleCol(s: string, col: number): string {
    if (col < 0) return s;
    const open = '{underline}{blue-bg}';
    const close = '{/blue-bg}{/underline}';
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

  /** Render a row that intersects the visual selection, using reverse video. */
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
      endCol = (idx === sel.ey ? sel.ex : lineLen) + 1; // inclusive caret
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
    this.onDirty();
  }

  // ---- key dispatch ------------------------------------------------------

  private handleKey(ch: string, key: blessed.Widgets.Events.IKeyEventArg): void {
    if (!key) return;

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

    // Let global Ctrl/Meta shortcuts (run/submit/save/quit) pass through.
    if (key.ctrl || key.meta) return;

    if (this.vimEnabled && this.mode !== 'insert') {
      this.handleVim(ch, key);
      return;
    }

    // Insert mode (also the only mode when vim is disabled).
    if (this.vimEnabled && key.name === 'escape') {
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
    switch (key.name) {
      case 'up':
        this.moveUp();
        break;
      case 'down':
        this.moveDown();
        break;
      case 'left':
        this.moveLeft();
        break;
      case 'right':
        this.moveRight();
        break;
      case 'home':
        this.cx = 0;
        break;
      case 'end':
        this.cx = this.lines[this.cy].length;
        break;
      case 'pageup':
        this.pageMove(-this.innerHeight());
        break;
      case 'pagedown':
        this.pageMove(this.innerHeight());
        break;
      case 'enter':
      case 'return':
        if (this.behavior.onSubmit) {
          this.behavior.onSubmit(this.getValue());
          return;
        }
        this.insertNewline();
        break;
      case 'backspace':
        this.backspace();
        break;
      case 'delete':
        this.deleteForward();
        break;
      case 'tab':
        if (!this.tryExpandSnippet()) this.insert(' '.repeat(this.tabWidth));
        break;
      case 'space':
        this.insert(' ');
        break;
      default:
        if (ch && ch.length === 1 && ch >= ' ') {
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
        this.wordForward();
        const to = this.cy === this.vay ? this.cx : line.length;
        this.cx = save;
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
      this.lines[this.cy] = line.slice(0, at) + this.register + line.slice(at);
      this.cx = at + this.register.length - 1;
    }
    this.markDirty();
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
