# Security policy

This mod keeps a signing key on your machine, signs requests to dev-null.sh with it, and runs local commands, so a security bug here can matter. Please report one privately.

## Reporting a vulnerability

Use GitHub's private reporting: on this repository's **Security** tab, click **Report a vulnerability**. Don't open a public issue for it.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply on the report, and a fix goes out as a new version with credit to you unless you'd rather not be named.

## What the mod protects, and what it doesn't

- **The device key** (`~/.devnull-claude/id_ed25519`) has no passphrase, so it can sign without asking you. The folder is kept at `700` and the key at `600`, checked on every sign-in, but anything running as your macOS user can read it. To revoke it, remove the device on dev-null.sh and run `/devnull logout`.
- **Nothing is posted or sent without a click.** Drafts from Claude's tools, `/devnull post` and the after-commit drafts all wait above the prompt for Post (or Push, for Remotes).
- **Text from dev-null.sh is data.** Posts, profiles and messages handed to Claude are wrapped in `<untrusted source="dev-null.sh">` with a note not to follow instructions inside them. That lowers the risk of prompt injection; it doesn't remove it.
- **Images** are fetched over https only, from public hosts (no localhost or bare IP addresses), at most 5 MB, with redirects held to https.
- **The `devnull://` handler** writes only `devnull://auth/callback` links, and a callback whose `state` doesn't match the sign-in under way is ignored.

## In scope

- The device key in `~/.devnull-claude/` leaking, or being used to sign something the person didn't ask for
- The sign-in flow: the `devnull://` handler, the callback file, the PKCE and state checks
- Commands the mod runs (`ssh-keygen`, `curl`, `sips`, `osacompile`, `codesign`, `lsregister`) being steered by data from dev-null.sh or a commit
- Content from dev-null.sh being able to run code or reach the network through the pane

Bugs in dev-null.sh itself go to [/dev/null](https://github.com/nunomaduro/dev-null.sh); bugs in Claude Code go to [Anthropic](https://github.com/anthropics/claude-code).

## Supported versions

Only the latest release on `main` gets fixes.
