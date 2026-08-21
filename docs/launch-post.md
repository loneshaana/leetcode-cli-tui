# leetcode-cli-tui — solve LeetCode problems from your terminal

I built a small command-line tool for working through LeetCode problems without leaving the
terminal, and I'm sharing it in case it's useful to others with a similar workflow.

Opening a problem gives you a split view: the problem statement on the left (with difficulty
and topic tags), a code editor on the right, and a run/submit output pane below. You can read
the problem, write your solution, run the sample tests, and submit — all without switching to
a browser.

## Why a terminal workflow

- Fewer context switches: no separate browser tab to manage alongside your editor and shell.
- A real editor: syntax highlighting, line numbers, auto-indent, auto-closing brackets,
  snippets, and optional vim keybindings. You can also open the file in `$EDITOR` for heavier
  edits.
- Keyboard-driven: run, submit, hints, and reset are all shortcuts.
- Lightweight, and works over SSH.

If the website already suits you, that's fine — this is aimed at people who prefer staying in
the terminal.

## Features

- Syntax-colored problem view with difficulty and tags
- Multi-line editor with highlighting, a line-number gutter, smart indentation, snippets,
  vim mode, and mouse-wheel scrolling
- Run against the sample tests or your own custom test cases (`Ctrl-T`)
- Failing test cases are added to your custom tests automatically, so you can keep
  re-running against them
- Hints, a spaced-repetition review command, and a random-problem command
- Save solutions to files; basic streak and best-time tracking
- Several color themes

## Getting started

```bash
npm install -g leetcode-cli-tui
leetcode login
leetcode tui <problem-slug-or-id>
```

Inside the TUI: `Ctrl-R` run · `Ctrl-S` submit · `Ctrl-T` custom tests · `F3` hint · `F4`
reset to starter code.

## Links

- npm: https://www.npmjs.com/package/leetcode-cli-tui
- GitHub: https://github.com/loneshaana/leetcode-cli-tui

The project is open source (MIT) and still early, so bug reports and suggestions are welcome.
