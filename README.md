# /dev/null for Claude Code

A Claude Code mod that puts [/dev/null](https://dev-null.sh), the social network for developers drawn as a git log, in a pane beside your session. Read Following, Latest, Trending and your notifications, and commit, reply, quote, star and save without leaving Claude Code.

It talks to the same signed `/api/v1` the [/dev/null mobile app](https://github.com/nativephp/dev-null-app) uses, and its API client is a TypeScript port of that app's.

This is an unofficial community project, not affiliated with /dev/null, NativePHP or Anthropic.

## Written by AI

This mod was written by Claude, Anthropic's AI model, working in Claude Code. Andrew Hodson directed the work, chose the design and tested it against the live site. Claude wrote the code, the tests and these docs.

Read it before you install it, as you would any code you didn't write. It runs commands on your Mac (`ssh-keygen`, `curl`, `sips`, `osacompile`, `codesign`, `lsregister`), keeps a signing key in `~/.devnull-claude/`, and registers a handler for `devnull://` links. [How signing in works](#how-signing-in-works) covers each of these.

## Install

At the prompt of a terminal session:

```
/plugin install devnull --marketplace mybuddyandrew/devnull-claude
```

From a shell:

```sh
claude plugin install devnull --marketplace mybuddyandrew/devnull-claude
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `mybuddyandrew/devnull-claude`, then Add plugin.

## Use

- `/devnull` opens the pane.
- `/devnull login` signs this machine in. Approve the device on dev-null.sh in your browser and the pane signs in by itself.
- `/devnull logout` signs this machine out here. Remove the device on dev-null.sh to revoke its key.
- `/devnull show <link or id>` draws a commit and its replies as a card in the conversation, and Claude reads it too.

The pane draws best in the Claude desktop app; the terminal gets a plainer version without avatars.

## What it does

**The pane.** Following, Latest, Trending and Notifications, drawn like the web: avatars ringed in each author's lane colour with a lane fading out beneath, replies threaded underneath. Commit, reply, quote, star and save from it. A header shows your streak, rank, XP and a heatmap of your commits. When new commits land, an "↑ N new commits" button appears, and the Notifications tab counts what's unread.

**Ship it to /dev/null.** When a `git commit` or `gh pr create` succeeds in your session, Claude drafts a post about what you just shipped, from what the session actually did. It waits in a band above the prompt with Post, Edit in pane and Dismiss. Nothing is posted until you press Post. Turn it off with the "Suggest posts when you ship" setting.

**Claude can use /dev/null.** Ask "what's happening on /dev/null?", "catch me up on my notifications" or "draft a reply to that thread". Claude gets five tools:

| Tool | What it does |
| --- | --- |
| `devnull_feed` | Reads a page of Following, Latest or Trending |
| `devnull_thread` | Reads a commit with what it replies to and its replies |
| `devnull_profile` | Reads a profile: bio, streak, rank, XP, badges, recent commits |
| `devnull_notifications` | Reads your notifications (dev-null.sh marks them read) |
| `devnull_draft` | Puts a draft in the pane's composer. It never posts; you press Commit |

**In the conversation.** Paste a dev-null.sh commit link into a prompt and Claude gets the thread as context. Type `@` and people you follow, or have seen in a log, are offered as completions.

**Streaks.** The status line keeps your streak, unread count and new commits in view. Once a day, if your streak is alive and you haven't posted, a toast reminds you before it ends at midnight UTC.

## How signing in works

There are no passwords or tokens. `/devnull login` makes an ed25519 key in `~/.devnull-claude/` (no passphrase, readable only by you) and every request is signed with it, exactly as the mobile app signs with its Keychain key.

dev-null.sh only sends its approval back to a `devnull://` link, so the first login builds a tiny AppleScript app, `~/.devnull-claude/Devnull Callback.app`, and registers it with macOS for `devnull://` links. It writes the link to a file the mod reads, and does nothing else. If you install the /dev/null mobile app on the same Mac, both will claim those links.

To remove everything: unregister and delete the folder.

```sh
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u ~/.devnull-claude/Devnull\ Callback.app && rm -rf ~/.devnull-claude
```

## Requirements

macOS: sign-in uses `osacompile` and LaunchServices, avatars are resized with `sips`, and the ship chime plays with `afplay`. `ssh-keygen`, `curl` and `git` must be on your PATH.

Drafting a post uses your Claude Code model: one tool-less question over the current session (`$.model.fork`), falling back to Haiku on just the commit subject.

## Notes

- Opening the Notifications tab marks them read on dev-null.sh, as the web does.
- Avatars are embedded in the pane at about 2.5 KB each, and one draw carries at most 50 KB of them. The desktop app drops a pane that sends much more, so rows past that show initials.

## License

MIT, see [LICENSE](LICENSE). The API client is ported from [nativephp/dev-null-app](https://github.com/nativephp/dev-null-app), also MIT; its notice is in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Contributing and security

Issues and pull requests are welcome, see [CONTRIBUTING.md](CONTRIBUTING.md). Report a security problem privately, as [SECURITY.md](SECURITY.md) describes, not in a public issue.
