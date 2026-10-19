# /dev/null for Claude Code

A Claude Code mod that puts [/dev/null](https://dev-null.sh), the social network for developers drawn as a git log, in a pane beside your session. Read Following, Latest, Trending and your notifications, and commit, reply, quote, star and save without leaving Claude Code.

It talks to the same signed `/api/v1` the [/dev/null mobile app](https://github.com/nativephp/dev-null-app) uses, and its API client is a TypeScript port of that app's.

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

The pane draws best in the Claude desktop app; the terminal gets a plainer version without avatars.

## How signing in works

There are no passwords or tokens. `/devnull login` makes an ed25519 key in `~/.devnull-claude/` (no passphrase, readable only by you) and every request is signed with it, exactly as the mobile app signs with its Keychain key.

dev-null.sh only sends its approval back to a `devnull://` link, so the first login builds a tiny AppleScript app, `~/.devnull-claude/Devnull Callback.app`, and registers it with macOS for `devnull://` links. It writes the link to a file the mod reads, and does nothing else. If you install the /dev/null mobile app on the same Mac, both will claim those links.

To remove everything: unregister and delete the folder.

```sh
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u ~/.devnull-claude/Devnull\ Callback.app && rm -rf ~/.devnull-claude
```

## Requirements

macOS: sign-in uses `osacompile` and LaunchServices, and avatars are resized with `sips`. `ssh-keygen` and `curl` must be on your PATH.

## Notes

- Opening the Notifications tab marks them read on dev-null.sh, as the web does.
- Avatars are embedded in the pane at about 2.5 KB each, and one draw carries at most 50 KB of them. The desktop app drops a pane that sends much more, so rows past that show initials.

## License

MIT. The API client is ported from [nativephp/dev-null-app](https://github.com/nativephp/dev-null-app), also MIT.
