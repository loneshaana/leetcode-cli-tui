# leetcode-cli-tui

[![npm version](https://img.shields.io/npm/v/leetcode-cli-tui.svg)](https://www.npmjs.com/package/leetcode-cli-tui)
[![node](https://img.shields.io/node/v/leetcode-cli-tui.svg)](https://nodejs.org)
[![license](https://img.shields.io/npm/l/leetcode-cli-tui.svg)](LICENSE)

Solve LeetCode problems without leaving your terminal. Fetch a problem, edit it in a
split-pane TUI (description on the left, code editor on the right), then run the sample
tests and submit — all from the command line.

<img width="1199" height="804" alt="leetcode-cli-tui screenshot" src="https://github.com/user-attachments/assets/13d0c613-387b-4434-96bf-120e264b6cd5" />

Built with Node.js + TypeScript. Default solution language is **Java** (configurable).

## Contents

- [Features](#features)
- [Install](#install)
- [Quick start](#quick-start)
- [Logging in](#logging-in)
- [Using the TUI](#using-the-tui)
- [Commands](#commands)
- [Configuration](#configuration)
- [Language support (SQL / Pandas)](#language-support-sql--pandas)
- [Solution file format](#solution-file-format)
- [Troubleshooting](#troubleshooting)
- [Reporting issues](#reporting-issues)
- [Contributing](#contributing)
- [Roadmap](#roadmap)
- [License](#license)

## Features

- **Split-pane TUI** — problem description, info panel, code editor and run/submit output
  in one full-screen workspace.
- **Real code editor** — syntax highlighting, a line-number gutter, auto-closing brackets,
  language-aware indentation, code-snippet expansion, undo/redo, and an optional **vim mode**.
- **Multi-line selection & OS clipboard** — select with `Shift`+motion, then copy/cut/paste
  (`Ctrl-C`/`X`/`V`) to and from your system clipboard. Pasted code lands **verbatim**.
- **Run & submit inline** — test against the samples or your own cases and submit, with a
  clear, labeled, color-coded results table.
- **Custom test cases** — add your own inputs; failing cases are captured automatically so
  you can iterate until they pass.
- **Every LeetCode language** — including **SQL** (MySQL/PostgreSQL/MS SQL/Oracle) and
  **Pandas** problems, auto-detected when a problem has no general-purpose starter code.
- **Progress & motivation** — persisted per-problem timer, solve streaks, difficulty
  breakdown, achievement badges, and a spaced-repetition review schedule.
- **Themes** — pick a syntax theme (`default`, `dracula`, `monokai`, `solarized`, `neon`, `mono`).
- **Self-updating** — a `leetcode update` command plus an unobtrusive "new version available"
  notice.

## Install

### From npm (recommended)

```bash
npm install -g leetcode-cli-tui
```

This puts a `leetcode` command on your `PATH`, available in any **new** terminal:

```bash
leetcode --help
leetcode tui two-sum
```

> Requires **Node.js >= 18**. Already-open terminals may need a reload to see the command
> (`hash -r` in bash/zsh, `rehash` in fish, or open a new tab). If a global install hits a
> permissions error, use a Node version manager (nvm/fnm/volta) or a user-writable npm
> prefix (`npm config set prefix ~/.npm-global` and add `~/.npm-global/bin` to your `PATH`).
> On Windows the npm global folder is already on `PATH`.

### From source

```bash
git clone https://github.com/loneshaana/leetcode-cli-tui
cd leetcode-cli-tui
npm install
npm run build
npm link          # makes the `leetcode` command available globally
```

Without `npm link`, run commands as `node dist/index.js <command>`.

### Updating

```bash
leetcode --version   # check your installed version
leetcode update      # upgrade to the latest (alias: upgrade)
leetcode update --check   # only check, don't install
```

The CLI also quietly checks npm at most once a day and prints a one-line note when a newer
version is available. Set `NO_UPDATE_NOTIFIER=1` (or run in CI) to silence it.

## Quick start

```bash
leetcode login          # 1. authenticate (opens your browser, paste two cookies)
leetcode tui two-sum    # 2. open the problem in the split-pane editor
#                          3. write your solution, then Ctrl-R to run, Ctrl-S to submit
```

Prefer your own editor? Use `leetcode show two-sum` to generate a solution file, edit it in
VS Code / vim, then `leetcode run <file>` / `leetcode submit <file>`.

## Logging in

LeetCode has no official public API, so the tool uses your browser session cookies
(`LEETCODE_SESSION` + `csrftoken`).

```bash
leetcode login             # open LeetCode in your default browser, then prompt for cookies
leetcode login --no-open   # don't open a browser, just print the URL
leetcode login --force     # re-login even if a valid session already exists
```

To copy the cookies after signing in:

1. Open DevTools (F12) → **Application** (or **Storage**) → **Cookies** → `https://leetcode.com`.
2. Copy the values of `LEETCODE_SESSION` and `csrftoken`.
3. Paste them at the prompt.

Cookies are stored in `~/.leetcode-cli/config.json`. `login` validates before saving, and on
later runs it keeps you signed in until the session expires. No headless/embedded browser is
used — it just launches your normal default browser.

## Using the TUI

`leetcode tui <problem>` opens a full-screen workspace: a header bar (⚡ LeetCode · problem id
& title · color-coded difficulty · language), a status footer (persisted timer with a `best`
target, editor `Ln/Col`, a saved/unsaved `●` indicator, and a key-hint strip), and four panes:

- **📄 Problem** (left) — the syntax-colored, scrollable problem description.
- **ℹ Info** (bottom left) — difficulty and topic tags.
- **📝 Editor** (top right) — the code editor, pre-filled with the starter code.
- **▶ Output** (bottom right) — run/submit results.

### Keybindings

| Key | Action |
| --- | --- |
| Arrow keys / Home / End / PageUp / PageDown | Move the cursor |
| `Shift` + arrows / Home / End / PageUp / PageDown | Select text (multi-line) |
| `Ctrl-C` | Copy the selection to the OS clipboard (quits if nothing is selected) |
| `Ctrl-X` | Cut the selection (deletes the current line if nothing is selected) |
| `Ctrl-V` | Paste from the OS clipboard at the caret |
| `Ctrl-Z` / `Ctrl-Y` | Undo / redo |
| `Shift-Tab` (or `F6`) | Switch focus between panes |
| `Ctrl-F` | Maximize / restore the focused pane (zoom) |
| Mouse click / wheel | Focus a pane / scroll |
| `Ctrl-R` | Run against the sample tests (or your custom testcase) |
| `Ctrl-S` | Submit |
| `Ctrl-T` | Open/close the custom testcase editor |
| `Ctrl-W` | Save the file |
| `Ctrl-A` | Export the clean solution code to a file |
| `Ctrl-E` | Open the code in your `$EDITOR` (vim/VS Code/…) and come back |
| `Ctrl-P` | Pause/resume the problem timer |
| `F2` | Toggle vim key bindings |
| `F3` | Reveal the next hint |
| `F4` | Reset the editor to the original starter code (undoable) |
| `?` / `F1` | Toggle the keybinding help overlay |
| `Ctrl-Q` | Quit (saves first) |

### Editing

The editor supports syntax highlighting, a colorful line-number gutter (current line in
yellow, `~` past end of file), a movable terminal cursor, auto-closing brackets/quotes, and
language-aware indentation — Enter keeps the current indent and adds a level after `{`, `(`,
`[` or a trailing `:`; Enter between `{` and `}` splits the block; typing `}` de-indents.
`Tab` inserts 4 spaces, or expands a **code snippet** (`for`, `while`, `if`, plus
`def`/`class`/`main` in Python and `main` in C/C++/Java/JS/TS/Go/Rust) when the caret follows
the keyword at the start of a line.

**Selection & clipboard.** Hold `Shift` with any motion to select across lines, then `Ctrl-C`
to copy or `Ctrl-X` to cut — both go to your real OS clipboard (Windows/macOS/Linux). `Ctrl-V`
pastes at the caret; pasted multi-line code lands **verbatim** (no cascading indentation),
with tabs expanded to spaces and CRLF normalized.

**More room to code.** `Ctrl-F` maximizes the focused pane (the editor by default) to fill the
window; press again to restore. Running or submitting restores the split so Output is visible.

### Custom test cases

Press `Ctrl-T` to open a popup and type your own input (one argument per line, in the same
format as the problem's examples). `Ctrl-R` then runs against it. Inside the popup: `Esc`
saves & closes, `Ctrl-X` clears it (empty = fall back to the sample tests).

When a **run or submit fails**, the failing input(s) are automatically added to your custom
test cases (deduplicated). Open the popup with `Ctrl-T` to inspect them; each `Ctrl-R` re-runs
your growing set until they all pass.

From the plain CLI you can pass a custom testcase to `run`:

```bash
leetcode run <file> -t "[2,7,11,15]\n9"
```

### Saving solutions

- `Ctrl-W` (and every run/submit) saves your work back into the workspace solution file,
  keeping the metadata header + problem description.
- `Ctrl-A`, or `leetcode export <file>` / `leetcode save <file>`, writes just the **clean
  solution code** (no metadata/description) — handy for archiving accepted answers. Default
  target: `<workspace>/solutions/<id>-<slug>.<ext>`; override with the popup path field or
  `-o <path>`.

### Vim mode

Press `F2` to toggle vim key bindings (or make it the default with `leetcode config --vim on`):

- **Modes:** normal, insert (`i` `a` `A` `I` `o` `O`), visual (`v`), visual line (`V`); `Esc`
  returns to normal. The current mode shows in the status bar.
- **Motions:** `h` `j` `k` `l`, `w` `b` `e`, `0` `^` `$`, `gg` `G`, `%`, `f` `t` `F` `T` + `;` `,`.
- **Editing:** `x`, `D`, `C`, `r<char>`, `dd` `yy` `cc`, operator + motion (`dw` `cw` `d$` `df,`
  …), `>>` / `<<`, `p` / `P`, `u` to undo, `.` to repeat.
- **Ex commands:** `:w`, `:q`, `:wq`.

### Delightful touches

- A welcome banner with a random tip when the TUI opens.
- A confetti celebration on **Accepted** (in the TUI and plain `submit` output), plus your
  solve time and a ⚡ flag on a new personal best.
- A persisted per-problem timer with a `best` target (pause with `Ctrl-P`).
- Achievement badges for solves, streaks and fast finishes — shown on the accepted banner and
  in `leetcode stats`.
- Colored, labeled per-test-case results so you see exactly which case broke, in any theme.

## Commands

Cheat-sheet, then a detailed reference below.

```bash
leetcode list                       # browse problems
leetcode show <problem>             # fetch + generate a solution file
leetcode tui <problem>              # open the split-pane editor
leetcode today                      # today's daily challenge
leetcode run <file>                 # run against the sample tests
leetcode submit <file>              # submit
leetcode export <file>              # save clean solution code
leetcode config                     # view or change settings
leetcode stats                      # solved count, streaks, breakdown
leetcode random                     # pick a random problem
leetcode review                     # spaced-repetition review
leetcode update                     # upgrade to the latest version
```

A `<problem>` can be a slug (`two-sum`), a frontend id (`1`), a full problem URL, or `daily`.

### `leetcode login`

Authenticate by saving your browser session cookies.

- `--no-open` — don't open the browser; just print the URL.
- `-f, --force` — re-login even if a valid session already exists.

### `leetcode list` (alias `ls`)

Browse and filter problems.

- `-l, --limit <n>` — number of problems to show (default `50`).
- `-s, --skip <n>` — pagination offset (default `0`).
- `-d, --difficulty <level>` — filter by `easy` | `medium` | `hard`.
- `-q, --search <text>` — filter by keyword.
- `--todo` — only unsolved problems.
- `--solved` — only solved problems.

```bash
leetcode list -d medium -q graph
leetcode list --todo -l 20
```

### `leetcode show <problem>` (alias `pick`)

Fetch a problem and generate a solution file in the workspace.

- `-L, --lang <lang>` — language (defaults to your configured language).
- `-o, --open` — also print the description to stdout.
- `--no-gen` — don't generate a solution file.
- `--overwrite` — overwrite an existing solution file (resets your edits).

```bash
leetcode show two-sum
leetcode show 1 -L python3
leetcode show daily -o
```

### `leetcode tui <problem>` (alias `edit`)

Open the split-pane TUI (creates the solution file if missing, preserving existing edits).

- `-L, --lang <lang>` — language (defaults to your configured language).

### `leetcode today` (alias `daily`)

Fetch today's daily challenge. Mirrors `show daily`, with an extra flag:

- `-L, --lang <lang>`, `-o, --open`, `--no-gen`, `--overwrite` — as in `show`.
- `--tui` — open the split-pane TUI instead of just generating a file.

### `leetcode run <file>`

Run a solution file against the sample test cases.

- `-t, --testcase <input>` — custom input (use `\n` for newlines).

### `leetcode submit <file>`

Submit a solution file to LeetCode and show the verdict.

### `leetcode export <file>` (alias `save`)

Write just the clean solution code (no metadata/description).

- `-o, --out <path>` — output path (default `<dir>/solutions/<id>-<slug>.<ext>`).

### `leetcode config`

View settings, or change them with any of:

- `-L, --lang <lang>` — default language.
- `-w, --workspace <dir>` — workspace directory.
- `--vim <on|off>` — vim key bindings in the editor.
- `--bell <on|off>` — ring the terminal bell on Accepted.
- `--tags <on|off>` — show/hide topic tags **and** difficulty (hide to avoid spoilers).
- `--theme <name>` — syntax theme: `default`, `dracula`, `monokai`, `solarized`, `neon`, `mono`.

```bash
leetcode config
leetcode config -L cpp -w D:\lc
leetcode config --theme dracula --tags off
```

### `leetcode stats`

Show your solved counts, daily streak (🔥) and best streak, today's count, an Easy/Medium/Hard
breakdown, fastest/average solve times, earned badges, and a last-30-days activity heatmap.

### `leetcode random` (alias `rand`)

Pick a random problem and generate a solution file.

- `-L, --lang <lang>`, `--no-gen`, `--overwrite` — as in `show`.
- `-d, --difficulty <level>` — restrict to `easy` | `medium` | `hard`.
- `--todo` — only pick from unsolved problems.

### `leetcode review`

Spaced-repetition schedule: which solved problems are due for another look.

- `-a, --all` — show the full schedule, not just what's due.
- `-l, --limit <n>` — maximum problems to list (default `15`).

### `leetcode update` (alias `upgrade`)

Check npm for a newer version and upgrade in place.

- `--check` — only report whether an update is available; don't install.

## Configuration

Settings live in `~/.leetcode-cli/config.json` and are managed with `leetcode config`.

| Setting | Flag | Default | Meaning |
| --- | --- | --- | --- |
| Language | `-L, --lang` | `java` | Default solution language. |
| Workspace | `-w, --workspace` | `~/leetcode-workspace` | Where solution files are written. |
| Vim mode | `--vim` | `off` | Vim key bindings in the editor. |
| Bell | `--bell` | `on` | Ring the terminal bell on Accepted. |
| Tags | `--tags` | `on` | Show topic tags + difficulty (hide to avoid spoilers). |
| Theme | `--theme` | `default` | Editor syntax theme. |

Solution files are written as `<workspace>/<id>-<slug>.<ext>`, e.g. `1-two-sum.java`.

## Language support (SQL / Pandas)

You can use any language LeetCode offers via `-L` (e.g. `python3`, `cpp`, `golang`, `rust`,
`typescript`). Aliases like `py`, `js`, `go`, `sql`, `pandas`, `postgres` are accepted.

Some problems — database problems and Pandas problems such as **#2889 "Reshape Data: Pivot"**
— have **no** Java/C++/etc. starter code. The CLI detects this and automatically generates the
file in a language the problem actually supports (MySQL/PostgreSQL/MS SQL/Oracle for database
problems, Pandas for data problems), telling you when it does. You can also request one
directly:

```bash
leetcode show <slug> -L sql          # MySQL
leetcode show <slug> -L postgresql
leetcode show <slug> -L pandas
```

## Solution file format

Each generated file has a metadata header, the problem description as a comment, and the
editable code between markers. **Only the code between the markers** is sent to LeetCode:

```java
// LEETCODE-META slug=two-sum; questionId=1; frontendId=1; lang=java
// 1. Two Sum  [Easy]
/* ...description... */
// LEETCODE-CODE-START
class Solution { ... }   // <-- your code
// LEETCODE-CODE-END
```

## Troubleshooting

- **`403` on a request** — your session expired; run `leetcode login` again.
- **Premium problems** — paid-only problems need an active subscription; content may be
  unavailable.
- **`leetcode` not found after install** — open a new terminal, or reload your shell
  (`hash -r` / `rehash`). See [Install](#install) for permission/prefix tips.

## Reporting issues

Found a bug or have a feature request? Please
[open an issue](https://github.com/loneshaana/leetcode-cli-tui/issues). Helpful details:

- what you ran (the exact command) and what you expected,
- what happened instead (copy any error output),
- your OS, terminal, Node version (`node --version`), and CLI version (`leetcode --version`).

Please don't paste your `LEETCODE_SESSION` / `csrftoken` cookies into an issue.

## Contributing

Contributions are welcome! To work on the CLI locally:

```bash
git clone https://github.com/loneshaana/leetcode-cli-tui
cd leetcode-cli-tui
npm install
npm run build     # compile TypeScript to dist/
npm link          # try your build as the global `leetcode`
```

### Releasing (maintainers)

The package is published to npm by **GitHub Actions** (`.github/workflows/publish.yml`) using
npm **Trusted Publishing (OIDC)** — no npm token is stored anywhere. Publishing is triggered by
creating a GitHub release:

```bash
npm version patch   # or minor / major — bumps package.json and tags
git push --follow-tags
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

The workflow runs `npm ci` → `npm run build` → `npm publish` and records build provenance. It
can also be run manually from **Actions → Publish to npm → Run workflow**.

## Roadmap

See [docs/ROADMAP.md](docs/ROADMAP.md) for planned and shipped features.

## License

[MIT](LICENSE) © loneshaana
