# Herdr Mobile

Herdr Mobile is a phone app for the terminals and coding agents that [herdr-core](https://github.com/herdrdev/herdr-core) runs on your machines. See which agents need you, open their terminals, and start new work from anywhere.

## Install

**Android:** there is no public download yet. To make one, see [Build an APK](docs/releasing.md#build-an-apk).

**iOS:** build it on a Mac with Xcode:

```sh
pnpm install
npx expo prebuild --platform ios
npx expo run:ios --device --configuration Release
```

Xcode asks you to sign the app. A free signature lasts 7 days; run the last command again to renew it.
iOS can't run mods yet, so only Settings, Machines and terminals work there.

## Connect your machines

Each machine needs herdr-core and an SSH server:

```sh
curl -fsSL https://releases.herdr.dev/core/install.sh | sh
```

Copy the app's key from Settings → Machines and add it to `~/.ssh/authorized_keys` on each machine.
Then add each machine in Settings → Machines.

## Find your work

**Spaces** shows your spaces on every machine. **Agents** shows every agent, the ones that need you first.
Tap an agent to open its terminal.

## Make it yours

The app draws its screens with mods: small JavaScript programs in `~/.config/herdr-mobile` on one of your machines.
Ask an agent there to change them. Copy the agent prompt from Settings → Definition to start.
Your phone shows the change within a few seconds.
If something goes wrong, Settings → Definition → Reset layout brings back the shipped screens.

## Updates

On Android the app updates itself. Choose Restart to update in the ⋯ menu.
On iOS, build it again.

## Build from source

See [docs/development.md](docs/development.md).
