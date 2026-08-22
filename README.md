# leetcode-cli-tui

<img width="1198" height="797" alt="image" src="https://github.com/user-attachments/assets/adf6ce87-cca9-4c2f-bc90-6fe4306153a8" />


Work with LeetCode problems entirely from your terminal: **fetch** a problem, edit it
in a **split-pane TUI** (problem description on the left, code editor on the right), and
**run** the sample tests and **submit** — all without leaving the CLI.

Built with Node.js + TypeScript. Default solution language is **Java** (configurable).

## Install

```bash
npm install
npm run build
npm link          # optional: makes the `leetcode` command available globally
```

If you don't `npm link`, run commands as `node dist/index.js <command>`.

## Log in

LeetCode has no official public API, so the tool needs your browser session cookies
(`LEETCODE_SESSION` + `csrftoken`).

```bash
leetcode login             # opens LeetCode in your OS default browser, then prompts for cookies
leetcode login --no-open   # don't open a browser, just print the URL
leetcode login --force     # re-login even if a valid session already exists
```

On the first login your cookies are validated and saved. On later runs `leetcode login`
first checks the saved session: if it is still valid you stay logged in (no prompt);
if it has expired you're asked to log in again. New cookies are only saved after they
successfully authenticate.

After you sign in:

1. Open DevTools (F12) → Application (or Storage) → Cookies → `https://leetcode.com`.
2. Copy the values of `LEETCODE_SESSION` and `csrftoken`.
3. Paste them at the prompt.

Cookies are stored in `~/.leetcode-cli/config.json`. No headless/embedded browser is
used — `login` just launches your normal default browser via the OS.

## Commands

```bash
leetcode list                       # browse problems
leetcode list -d medium -q graph    # filter by difficulty / keyword
leetcode list --todo                # only unsolved

leetcode show two-sum               # fetch + generate a solution file
leetcode show 1                     # by frontend id
leetcode show daily                 # today's daily challenge
leetcode show two-sum -L python3    # override language
leetcode show two-sum -o            # also print the description

leetcode tui two-sum                # <-- the split-pane editor experience
leetcode edit two-sum               # alias for tui

leetcode run  <file>                # run against the sample test cases
leetcode submit <file>              # submit
leetcode export <file>              # save clean solution code to a file (alias: save)
leetcode export <file> -o out.java  # ...to a specific path

leetcode config                     # view settings
leetcode config -L cpp              # set default language
leetcode config -w D:\lc            # set workspace directory
leetcode config --theme dracula     # editor syntax theme
leetcode config --tags off          # hide topic tags + difficulty (avoid spoilers)

leetcode stats                      # solved count, streaks & difficulty breakdown
leetcode random                     # pick a random problem (alias: rand)
leetcode random -d hard --todo      # random unsolved hard problem
leetcode review                     # which solved problems are due to revisit
leetcode review --all               # the full spaced-repetition schedule
```

Solution files are written to the workspace (default `~/leetcode-workspace`) as
`<id>-<slug>.<ext>`, e.g. `1-two-sum.java`.

## The TUI

`leetcode tui <problem>` opens a full-screen workspace with a branded **header bar** at the
top (⚡ LeetCode · problem id & title · color-coded difficulty · language), a segmented
**status footer** at the bottom (elapsed timer, a saved/unsaved `●` indicator, and a colored
key-hint strip), and four accent-bordered panes:

- **📄 Problem** (left) — the **syntax-colored** problem description (scrollable): a cyan title,
  cyan headings, green example/code blocks, yellow inline `code` and white **bold** text.
- **ℹ Info** (bottom left) — a panel pinned under the description showing the **difficulty**
  (green/yellow/red) and **tags**.
- **📝 Editor** (top right) — a code editor pre-filled with the starter code.
- **▶ Output** (bottom right) — run/submit output.

Keybindings:

| Key | Action |
| --- | --- |
| Arrow keys / Home / End / PageUp / PageDown | Move the cursor in the editor |
| `Shift-Tab` (or `F6`) | Switch focus between panes |
| Mouse click | Focus a pane |
| `Ctrl-R` | Run against the sample tests (or your custom testcase) |
| `Ctrl-S` | Submit |
| `Ctrl-T` | Open/close the **custom testcase** editor |
| `F3` | Reveal the next **hint** for the problem |
| `F4` | **Reset the editor** back to the original starter code (undoable with `Ctrl-Z`) |
| `Ctrl-A` | **Save the solution to a file** (clean code) |
| `Ctrl-X` | Delete the current line |
| `Ctrl-Z` / `Ctrl-Y` | Undo / redo |
| `Ctrl-W` | Save the file |
| `Ctrl-E` | Open the code in your `$EDITOR` (vim/VS Code/…) and come back |
| `F2` | Toggle **vim key bindings** on/off |
| `Ctrl-Q` | Quit (saves first) |

The editor is a real multi-line editor with **syntax highlighting**, a **colorful
line-number gutter** (the current line's number is highlighted in yellow, the rest in
cyan; vim-style `~` marks the rows past the end of the file), a visible terminal cursor you
can move anywhere, **auto-closing** brackets and quotes, and **language-aware indentation** —
pressing Enter keeps the current indentation and adds a level after `{`, `(`, `[` or a
trailing `:`; pressing Enter between `{` and `}` splits the block onto its own lines; typing
a closing `}` de-indents it. `Tab` inserts 4 spaces — or, when the caret follows a snippet
keyword at the start of a line, expands a **code snippet** (`for`, `while`, `if`, `def`/`class`/`main`
in Python; `for`, `while`, `if`, `main` in C/C++/Java/JS/TS/Go/Rust) and drops the caret in the
right spot. For heavy editing you can always jump
to your own editor with `Ctrl-E`. Mouse is supported — click a pane to focus it, and scroll
the wheel to move through both the problem description and the editor.

### Vim mode

Press `F2` to toggle vim key bindings (or make it the default with
`leetcode config --vim on`). It supports the everyday subset:

- Modes: **normal**, **insert** (`i` `a` `A` `I` `o` `O`), **visual** (`v`) and **visual line** (`V`); `Esc` returns to normal. The current mode is shown in the status bar.
- Motions: `h` `j` `k` `l`, `w` `b` `e`, `0` `^` `$`, `gg` `G`, `%` (jump to the matching bracket), `f` `t` `F` `T` + `;` `,` (find char on the line) — arrow keys work too.
- Editing: `x`, `D`, `C`, `r<char>`, `dd` `yy` `cc`, operator + motion (`dw` `cw` `d$` `y$` `df,` `dt)` …), `>>` / `<<` (indent), `p` / `P`, `u` to undo, and `.` to repeat the last change.
- Ex commands: `:w` saves, `:q` quits, `:wq` saves and quits.

Outside vim mode you can also undo/redo with `Ctrl-Z` / `Ctrl-Y`.

### Custom test cases

Press `Ctrl-T` to open a popup where you can type your own input (one argument per line,
in the same format as the problem's examples). `Ctrl-R` then runs against it. Inside the
popup: `Esc` saves & closes, `Ctrl-X` clears it (empty = fall back to the sample tests).

Whenever a **run or submit fails**, the exact input(s) it failed on are **automatically
added to your custom test cases** (deduplicated, so nothing is added twice). You'll see a
note in the output pane — open the popup with `Ctrl-T` to inspect them, and every following
`Ctrl-R` re-runs against your growing set of failing cases until they all pass.

From the plain CLI you can pass a custom testcase to `run`:

```bash
leetcode run <file> -t "[2,7,11,15]\n9"
```

### Saving solutions

- `Ctrl-W` in the TUI (and every run/submit) saves your work back into the workspace
  solution file, which keeps the metadata header + problem description.
- `Ctrl-A` in the TUI, or `leetcode export <file>` / `leetcode save <file>`, writes just
  the **clean solution code** (no metadata/description) — handy for archiving accepted
  answers. The default target is `<workspace>/solutions/<id>-<slug>.<ext>`; override it
  with the popup path field or `-o <path>`.

> Tip: prefer your own editor? Skip the TUI. Use `leetcode show <slug>` to generate the
> file, edit it in VS Code / vim, then `leetcode run` / `leetcode submit` from the terminal.

### Made to be fun

Coding should feel good, so the CLI adds a few bits of delight:

- A friendly **welcome banner** with a random tip greets you when the TUI opens.
- Getting **Accepted** pops a confetti celebration banner (in the TUI and the plain
  `leetcode submit` output) with a random cheer.
- A near miss shows a quick **encouragement** instead of just a wall of red.
- Every accepted problem bumps your **solved counter** (stored in the config) so you can
  watch your streak grow.
- A live **session timer** ticks away in the status bar while you work.
- Getting Accepted also reports your **solve time**, flags a new **personal best** (⚡), and
  can **ring the terminal bell** (toggle with `leetcode config --bell off`).
- Unlock **achievement badges** as you rack up solves, streaks and fast finishes — earned
  badges show on the accepted banner and in `leetcode stats`.
- **Run results** come back as a colored per-test-case table (green pass / red fail) so you
  can see exactly which case broke.
- Stuck? Press **F3** in the TUI to reveal the problem's hints one at a time.
- Pick your **syntax theme** with `leetcode config --theme <default|dracula|monokai|solarized|neon|mono>`.
- Prefer to solve without hints? Turn off `tags` with `leetcode config --tags off` to **hide both
  the topic tags and the difficulty** (in the TUI header + Info panel and in `leetcode show`). Both
  are shown by default.
- `leetcode random` rolls the dice for a fresh problem; `leetcode review` uses
  **spaced repetition** to remind you which solved problems are due for another look.
- `leetcode stats` shows your **daily streak** (🔥), best streak, today's count and a colored
  **Easy / Medium / Hard** breakdown of everything you've solved.

## How a solution file is structured

Each generated file has a metadata header, the problem description as a comment, and the
editable code between markers. Only the code **between the markers** is sent to LeetCode:

```java
// LEETCODE-META slug=two-sum; questionId=1; frontendId=1; lang=java
// 1. Two Sum  [Easy]
/* ...description... */
// LEETCODE-CODE-START
class Solution { ... }   // <-- your code
// LEETCODE-CODE-END
```

## Notes

- If a request returns `403`, your session expired — run `leetcode login` again.
- Premium (paid-only) problems require an active subscription; content may be unavailable.

## Releasing

The package is published to npm by **GitHub Actions** (`.github/workflows/publish.yml`)
using npm **Trusted Publishing (OIDC)** — **no npm token is stored anywhere**. GitHub mints a
short-lived credential for each run, and npm records build **provenance** automatically.

This requires a one-time **Trusted Publisher** configured on npmjs.com
(package → **Settings → Trusted Publisher → GitHub Actions**, org `loneshaana`,
repo `leetcode-cli-tui`, workflow `publish.yml`).

To publish a new version:

```bash
npm version patch   # or minor / major — bumps package.json and tags
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

Publishing the release triggers the workflow (`npm ci` → `npm run build` →
`npm publish`), authenticated via OIDC. You can also run it manually from
**Actions → Publish to npm → Run workflow**.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for planned and shipped features.

