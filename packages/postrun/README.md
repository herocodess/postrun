# postrun

The flight recorder for coding agents. Postrun records every prompt, command, edit and file your Claude Code and Cline sessions touch, on your own machine, and gives you a review app to go through any session afterwards.

```bash
npm install -g postrun
postrun setup
```

`setup` adds Postrun's hooks to Claude Code (your settings are backed up first and everything else is kept), starts recording in the background, and opens the review app at `http://127.0.0.1:1234/`. Restart any Claude Code session that was already open.

Needs macOS or Linux and Node 22.13 or newer.

## Everyday

```bash
postrun status             # is it recording, and where is the review app
postrun open               # open the review app
postrun sessions           # list recorded sessions
postrun export <id>        # one session as a redacted HTML report, to share on purpose
postrun delete <id>        # delete one session for good
postrun doctor             # check everything, with a fix for each problem
```

## Local by default

- Sessions are stored in `~/.postrun`, readable only by you. Nothing is sent anywhere, and Postrun has no telemetry of its own.
- The review app and the telemetry receiver listen on `127.0.0.1` only.
- Exports mask secrets and list every value they masked before you send them.

## Removing it

```bash
postrun uninstall          # takes Postrun out of Claude Code, stops it, asks about your data
npm uninstall -g postrun
```

Docs: https://docs.postrun.app
