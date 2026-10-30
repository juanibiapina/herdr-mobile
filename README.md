# Herdr Mobile

An Android client for [herdr-core](https://github.com/herdrdev/herdr-core) (`hc`).

- **Agents:** every session on your machines, grouped the way Herdr's Agents
  panel groups them: what needs you, what is idle waiting for your next
  message, what is working, and plain terminals.
- **Switching:** inside a session, a strip of every session across the top,
  a "waiting" button that jumps to the next agent waiting on you, and the full
  list from the title.
- **Terminal:** live, in color, at phone size or your desktop's size. Tap it
  and type: keys go straight to the terminal, exactly as pressed (no
  autocorrect, unless you pick the standard keyboard in Settings). The key bar
  sends esc, tab, arrows, ctrl combinations and the clipboard instantly.
  Message mode is for prose to agents: hc pastes it and presses Enter.
- **Start sessions:** pick a machine (also one reached through another), browse
  to a folder, and start a shell, an installed agent (Claude Code, pi, Codex, …),
  a template, or any command, with an optional first task.
- **Manage:** interrupt, kill, keep alive, remove finished sessions.
- **Notifications:** when an agent needs you, finishes a turn, or exits, also
  with the app closed (a quiet foreground notification keeps it connected).

## How it connects

The phone reaches each machine the way hc reaches a machine it adds: SSH, then
`herdr-core connect`, which speaks the hc API over stdin/stdout. Nothing new
runs on your machines. The phone makes its own Ed25519 key; add its public key
(Machines screen → Copy) to `~/.ssh/authorized_keys` on each machine. The first
host key a machine presents is trusted and pinned.

The phone connects to every machine you add and merges their lists. A machine
that another one added with `hc machine add` shows up through it too, as hc's
`ls` would show it; when the phone also reaches that machine directly, each
terminal is listed once and the direct line is used.


## Develop

```sh
pnpm install          # also builds the terminal page (xterm.js inlined)
pnpm test             # protocol and multi-machine tests against real scratch hc cores
pnpm typecheck
```

The tests need `hc` on `PATH`. They run their cores in scratch sessions with
scratch state directories, so they never see your terminals.

Layout:

- `src/hc/`: the hc protocol client (`connection.ts`) and the merged view of all machines (`fleet.ts`). No React Native imports, so the tests run in Node.
- `modules/hc-ssh/`: the native SSH module (Kotlin, JSch + BouncyCastle).
- `src/terminal/`: xterm.js in a WebView, fed by hc's attach stream.
- `app/`: screens (Expo Router).

## Build

```sh
./scripts/build-apk.sh    # standalone arm64 release APK → herdr-mobile.apk
adb install -r herdr-mobile.apk
```

The script expects a NixOS box with the Android dev shell from
`juanibiapina/dotfiles` (`nix develop ~/workspace/juanibiapina/dotfiles#android`).
It limits Gradle to one worker and one JVM for low-memory machines, and reuses
`android/` between builds; run it with `PREBUILD=1` after changing `app.json`
or a native dependency. The release build is signed with the debug key.
