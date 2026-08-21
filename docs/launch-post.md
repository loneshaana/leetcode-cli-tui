# 🚀 I built a LeetCode TUI so you can grind entirely from your terminal — no browser, no context-switching

Fellow grinders — if you live in the terminal like I do, this one's for you. ❤️

I got tired of the ritual: open browser → find the tab → wait for the editor to load →
lose my flow every time I alt-tabbed back to my notes. So I built **leetcode-cli-tui** — a
full LeetCode workspace that runs *inside your terminal*.

Open a problem and you get a clean, colorful split-screen: the **problem statement** on the
left (syntax-colored, with difficulty + tags), a **real code editor** on the right, and a
**run/submit output** pane below it. Solve, run the samples, submit — without ever leaving
your keyboard.

## Why coding from the terminal is just… better

- **Flow state is sacred.** No browser tabs, no notifications, no "recommended for you"
  rabbit holes. Just you and the problem.
- **Your tools, your rules.** Real editor with syntax highlighting, a line-number gutter,
  language-aware auto-indent, auto-closing brackets, snippets — and full **vim keybindings**
  if that's your thing.
- **The keyboard is faster than the mouse.** `Ctrl-R` to run, `Ctrl-S` to submit,
  `F3` for a hint, `F4` to reset to the starter code. Muscle memory > clicking around.
- **It's lightweight.** Starts instantly, sips memory, works over SSH on that tiny cloud box.
- **It meets you where you already are.** If your editor, your git, and your shell all live
  in the terminal, your practice should too.

## Features I'm proud of

- 📄 Syntax-colored problem view with difficulty & topic tags
- 📝 Real multi-line editor: highlighting, gutter, smart indent, snippets, **vim mode**,
  mouse-wheel scrolling, and jump-to-`$EDITOR` for heavy edits
- ▶ Run against samples or **your own custom test cases** (`Ctrl-T`)
- 🧪 **Failing test cases are auto-captured** into your custom tests — so you keep
  re-running against exactly what broke until it passes
- 💡 On-demand hints, spaced-repetition **review**, and a **random** problem roller
- 💾 Save clean solutions to files, track streaks & best times
- 🎨 Multiple color themes, a branded header, and a genuinely fun vibe

## The whole loop, keyboard-only

```
leetcode tui two-sum      # opens the split-screen workspace
# ...write your solution...
# Ctrl-R run · Ctrl-S submit · F3 hint · Ctrl-T custom tests · F4 reset
```

## Try it

```bash
npm install -g leetcode-cli-tui
leetcode login
leetcode tui <problem-slug-or-id>
```

- 📦 npm: https://www.npmjs.com/package/leetcode-cli-tui
- 💻 GitHub: https://github.com/loneshaana/leetcode-cli-tui

It's open source (MIT) and I'd love your feedback, issues, and stars ⭐. If it saves you even
one context-switch, it did its job. Now go close that tab and solve something. 💪

#leetcode #cli #terminal #opensource #productivity
