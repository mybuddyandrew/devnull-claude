# Contributing

Thanks for helping. Issues and pull requests are both welcome.

## Before you start

For anything bigger than a small fix, open an issue first so we can agree on the approach.

This project is written with AI: most of its code came from Claude in Claude Code (see the README). AI-assisted pull requests are welcome on the same terms as any other: you understand every line you submit, you've run it, and you say in the pull request which tools you used.

## Develop

You need Claude Code 2.1.299 or later on macOS.

1. Fork and clone the repository.
2. Load your working copy into a session: `claude --plugin-dir /path/to/devnull-claude`. In the desktop app, set `CLAUDE_CODE_PLUGIN_DIRS` to that path in the `env` block of `~/.claude/settings.json`. Saving a file reloads the mod.
3. Run `/devnull` and `/devnull login` to try it.

The engine writes this build's API types to `.claude-plugin/types/` when it loads the mod (git ignores that folder), and `tsconfig.json` extends them, so `npx tsc -p .` type-checks the mod after one load.

## Check your change

Run these before opening a pull request. CI runs the first two on every pull request.

```sh
claude plugin validate .
claude plugin test .
npx tsc -p .
```

For a change to the pane, include before and after screenshots from the desktop app. The desktop drops a pane whose tree is too large without any error, so check that it still draws with a full feed.

## Pull requests

- One change per pull request, with a description of what changed and why.
- Add or update a test in `hooks/devnull.test.ts` for behaviour you change.
- Test data must be made up. Don't commit real /dev/null users' posts or profiles.
- Pull requests are squash-merged into `main`.

By contributing you agree your work is released under the [MIT License](LICENSE) and that you'll follow the [code of conduct](CODE_OF_CONDUCT.md).
