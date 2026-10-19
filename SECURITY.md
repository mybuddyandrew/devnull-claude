# Security policy

This mod keeps a signing key on your machine, signs requests to dev-null.sh with it, and runs local commands, so a security bug here can matter. Please report one privately.

## Reporting a vulnerability

Use GitHub's private reporting: on this repository's **Security** tab, click **Report a vulnerability**. Don't open a public issue for it.

Include what you found, how to reproduce it, and what an attacker could do with it. You'll get a reply on the report, and a fix goes out as a new version with credit to you unless you'd rather not be named.

## In scope

- The device key in `~/.devnull-claude/` leaking, or being used to sign something the person didn't ask for
- The sign-in flow: the `devnull://` handler, the callback file, the PKCE and state checks
- Commands the mod runs (`ssh-keygen`, `curl`, `sips`, `osacompile`, `codesign`, `lsregister`) being steered by data from dev-null.sh or a commit
- Content from dev-null.sh being able to run code or reach the network through the pane

Bugs in dev-null.sh itself go to [/dev/null](https://github.com/nunomaduro/dev-null.sh); bugs in Claude Code go to [Anthropic](https://github.com/anthropics/claude-code).

## Supported versions

Only the latest release on `main` gets fixes.
