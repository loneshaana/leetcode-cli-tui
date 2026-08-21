# Roadmap

Ideas to make solving problems in the terminal faster, friendlier, and more fun.

Effort key: 🟢 small · 🟡 medium · 🔴 large. Items already shipped are marked ✅.

## Onboarding & setup

- 🟢 `leetcode doctor` — check login/session, `$EDITOR`, default language, and network,
  and print how to fix anything that's off.
- 🟢 First-run wizard — on the very first command, prompt for default language, theme, and
  vim on/off, then save to config.
- 🟢 Shell completions (`leetcode completion bash|zsh|fish|powershell`).
- 🟡 `leetcode config --interactive` — a small TUI form for all settings.
- ✅ Persist credentials on first login and re-validate them on subsequent runs.

## Discovery & workflow

- 🟢 `leetcode today` — the daily challenge, ready to open in the TUI.
- ✅ `leetcode random [-d easy|medium|hard]` — roll a random problem.
- 🟡 `leetcode list` filters — by difficulty, tag, paid/free, solved/unsolved, acceptance.
- 🟡 `leetcode search <text>` — fuzzy search across titles and tags.
- 🟡 Problem sets / study plans — curated lists (e.g. Top 150, Blind 75) with progress.
- 🟡 `leetcode next` — pick the next unsolved problem from the current list or plan.

## In-editor experience

- ✅ Language-aware auto-indent, auto-closing brackets, snippets, and motions.
- ✅ Vim key bindings (`F2` / `config --vim on`).
- ✅ Syntax themes (`config --theme <name>`).
- ✅ Colorful line-number gutter + branded header/footer.
- 🟡 LSP integration — real completions, diagnostics, and go-to-definition per language.
- 🟡 Multiple cursors / block editing.
- 🟡 Format-on-save via the language's formatter (prettier, gofmt, rustfmt, black…).
- 🟢 Inline diff against your last accepted solution.

## Feedback & learning

- ✅ Custom testcases (`Ctrl-T`).
- ✅ Hints on demand (`F3`).
- ✅ Reset editor to original starter code (`F4`, undoable).
- ✅ Spaced-repetition review (`leetcode review`).
- 🟡 Rich run/submit results — per-testcase pass/fail table, runtime/memory percentile bars.
- 🟡 After a solve, show the editorial / top community solutions in a pane.
- 🟢 Complexity notes prompt — jot the time/space complexity when you solve; store it.
- 🟡 Local test runner — run your solution against saved testcases without hitting LeetCode.

## Productivity & sharing

- ✅ Save solutions to files (`Ctrl-A`).
- 🟡 Auto-archive every accepted solution into a git-friendly folder structure
  (`solutions/<difficulty>/<id>-<slug>.<ext>`) with a short front-matter note.
- 🟡 `leetcode stats` — streaks, solved-by-difficulty, and best times (partly shipped).
- 🟢 Export a solved problem + solution as Markdown for a blog or notes.
- 🟡 Sync progress/notes to a personal GitHub repo.

## TUI polish (ongoing)

- ✅ Branded header bar, accent-bordered panes, segmented footer, colored spinner.
- 🟢 Theming for the whole TUI (not just editor syntax).
- 🟢 Configurable pane layout (swap editor/output, resize splits).
- 🟢 A compact help overlay (`?`) listing every keybinding.
