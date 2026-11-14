# Herdr Mobile

<!-- Written by Herdr Mobile on every connect. Edits here are overwritten. -->

This folder is **Herdr Mobile's whole interface, as files**. Herdr Mobile is a
phone app for the terminals and coding agents that herdr-core (`hc`) runs on
the person's machines. The phone reads this folder from this machine (its
*definition machine*) and redraws itself from it while it runs: change a
layout or a mod here and the phone follows within a few seconds, if the app is
open. When the person asks for something on their phone ("a tab with my
PRs", "show the branch under each space", "move search to the bottom"), you
do it by editing these files. The shipped screens (Spaces, Agents, a space's
tabs, the menus) are mods made from the same parts you have.

It works like herdr-app desktop's `~/.config/herdr-app`, made for a phone.
Desktop mods don't run here: their GPUI builders are different. The ideas,
names and habits carry over.

## What runs where

- **The phone** runs each mod in its own small JavaScript engine (QuickJS)
  and draws what the mod describes with native views. The person taps; the
  mod's callbacks run on the phone.
- **herdr-core** on each machine runs the terminals and agents. A mod asks
  the phone to act (`run`, `exec`), and the phone does it through the core
  of the machine concerned.
- **You** edit files here. There is no CLI to drive the phone and no window
  to look at: the phone reports back through `.error` files, and
  `check.mjs` checks your work without the phone.

## What you can and can't do

You can: rearrange the app (layouts: bottom tabs, screens, blocks), write
mods that list, filter and act on spaces, tabs, agents and terminals on every
machine, open sheets and dialogs, push screens, post toasts, run programs on
any connected machine (`exec`), read and write files there, fetch URLs, keep
state per mod or shared between mods.

You can't: use HTML, CSS, React, a web view, Node APIs, `setTimeout`, `Intl`
or `structuredClone`; change the terminal screen, Settings or Machines (they
are the app's own, so a broken definition never locks the person out); hide
the app's header (it carries the ⋯ menu that reaches Settings).

## Changing things safely

- **Check every change:** `node ~/.config/herdr-mobile/check.mjs` checks
  settings.json, every layout and every mod: it loads, starts and draws each
  mod once with sample data. `node check.mjs prs spaces` checks only those
  mods. It prints `file:line: message` and exits 1 on problems. It needs
  Node 18 or later (Bun and Deno work too). Never call a change done without
  a passing check.
- **A broken file never breaks the screen:** the phone keeps the last good
  version and writes why to `<path>.error`: `settings.error`,
  `layouts/main.error`, `mods/prs.error` (beside the mod's folder). It
  removes the file when the problem is fixed. Read these after a change:
  they also catch what the check can't (an error with real data, in a tap).
  They're written only while the app is open and connected.
- **Line numbers:** an error you `throw` names its line. An error QuickJS
  raises itself (a missing variable, a property of `null`, calling something
  that isn't a function) names the first line of the function it happened in.
- **Escape hatch:** Settings → Reset layout shows the shipped `main` layout
  again, as shipped (an edited `main.json` is kept as
  `layouts/main.json.old-<time>`; other layouts stay). The ⋯ menu on every
  root screen reaches Settings whatever the layout does.

## The files

| File | What it decides |
|---|---|
| `layouts/<name>.json` | the app: bottom tabs, screens, which mods show where; one file per layout |
| `settings.json` | `{ "layout": "<name>", "theme": { "<color>": "#rrggbb" } }`: which layout shows, color overrides |
| `mods/<name>/` | mods: `main.js`, more `.js` modules, `mod.json`, their own icons |
| `icons/` | program icons and UI glyphs (`icons/ui/*.svg`): written by the app |
| `AGENTS.md`, `herdr.d.ts`, `herdr-ui.d.ts`, `check.mjs` | this guide, the API, the checker: written by the app |
| `installed.json`, `*.error` | the app's bookkeeping and reports |

**Shipped layouts and mods are the app's.** They're replaced whenever the app
ships new versions. If you edit one, the next connect moves your version
aside (`mods/spaces-edited/`, `layouts/main-edited.json`) and puts the
shipped one back. To change a shipped mod, copy it under a new name and
point the layout at your copy:

```sh
cd ~/.config/herdr-mobile
cp -r mods/spaces mods/my-spaces            # then edit mods/my-spaces
cp layouts/main.json layouts/mine.json      # then use "my-spaces" in it
echo '{ "layout": "mine" }' > settings.json
```

Paths inside a copied mod that name its own folder (`mods/spaces/x.svg`)
need the new name too.

## The model: machines, spaces, tabs, terminals, agents

- A **machine** runs herdr-core. The phone connects to each one it was given
  (Machines in Settings). `machines()` lists them with their state.
- A **space** is a place to work on one machine, usually a repo. Each machine
  keeps its spaces and their tabs in its core's `herdr-app` document, which
  herdr-app desktop shares: a space made or renamed on the phone shows in
  desktop, and the reverse. Unnamed spaces are called after where their
  first terminal is.
- A **tab** is a piece of work in a space: one or more terminals.
- A **terminal** runs a program. An **agent** is a terminal that reports a
  status: `working`, `blocked` (needs the person), `done` (finished its turn)
  or `idle`. **Sub-agents** are terminals an agent started: `parent` names it.
- A space's and a tab's `status` is the most urgent of their agents:
  blocked > done > working > idle.

## Layouts: `layouts/<name>.json`

A layout's `root` is a screen, or `tabs` of screens:

```json
{ "root": { "type": "tabs", "id": "main", "children": [
    { "id": "spaces", "title": "Spaces", "icon": "albums-outline",
      "screen": { "type": "block", "id": "spaces-list", "title": "Spaces",
                  "content": { "mod": "spaces" }, "header": { "mod": "spaces", "props": { "header": true } } } },
    { "id": "agents", "title": "Agents", "icon": "sparkles-outline", "badge": "agents.needs",
      "screen": { "type": "block", "id": "agents-list", "title": "Agents", "content": { "mod": "agents" } } } ] } }
```

- **Nodes:** `block` shows a mod: `"content": { "mod": "<name>", "props": {...} }`.
  `row` and `column` arrange `children`, with `gap`. Any node can have
  `size` (`{ "px": 120 }` or `{ "weight": 2 }`; default: an equal share),
  `padding` (`16` or `[vertical, horizontal]`) and `background` (a color or
  a theme color name).
- **Screens:** the root, or each tab's `screen`, is a node with an optional
  `title` and `header` (a mod drawn at the right of the header, before the
  app's ⋯ menu). Only screens have these.
- **Tabs:** `id`, `title`, `icon` (an Ionicons name, or an SVG path here),
  and `badge`: the name of a shared key holding a number to show.
- **More screens:** a mod pushes one with `run("screen.open", { mod, props, title })`;
  the person goes back with the arrow or the back gesture. A mod's
  `mod.json` title is used when none is given.
- One block at the root (`{ "root": { "type": "block", "id": "app", "content": { "mod": "my-app" } } }`)
  lets one mod own the whole app below the header.
- `ids` are unique within a layout. `check.mjs` reports unknown fields and
  mods that don't exist.

## Mods: `mods/<name>/`

```
mods/<name>/
  main.js     the mod (required): an ES module
  mod.json    { "title": "PRs", "icon": "git-pull-request-outline" }: for screens pushed with screen.open
  *.js        more modules: import { x } from "./rows.js"
  *.svg, *.png  its own images: svg("mods/<name>/logo.svg")
```

```js
import { View, div, h_flex, v_flex, svg } from "herdr-ui";
import { spaces, exec, run, theme } from "herdr";

export default class Branches extends View {
  init(_props, cx) {
    this.branch = {};
    cx.timer.every(30000, (cx) => this.refresh(cx));
    this.refresh(cx);
  }

  refresh(cx) {
    cx.spawn(async (cx) => {
      for (const s of spaces()) {
        const r = await exec("git", ["branch", "--show-current"], { cwd: s.folder, on: s.machine });
        this.branch[s.id] = r.stdout.trim();
      }
      cx.notify();
    });
  }

  render() {
    const t = theme();
    return v_flex().size_full().bg(t.background).overflow_y_scroll()
      .on_refresh((_e, cx) => this.refresh(cx))
      .children(spaces().map((s) =>
        h_flex().id(s.id).h(52).px(16).gap(12).items_center()
          .on_click(() => run("screen.open", { mod: "space", props: { space: s.id }, title: s.name }))
          .child(svg("icons/ui/git-branch.svg").size(18).text_color(t.muted))
          .child(div().flex_1().truncate().text_size(16).text_color(t.foreground).child(s.name))
          .child(div().text_size(13).text_color(t.dim).child(this.branch[s.id] ?? ""))));
  }
}
```

Rules:

- `main.js` default-exports a class extending `View`. `init(props, cx)` runs
  once; `render(cx)` returns one element and runs again after `cx.notify()`
  and whenever the app's data changes (spaces, agents, terminals, machines,
  theme, shared state). Don't poll those.
- Give the root element `.size_full()` (or `.flex_1()`) so it fills its
  block; a list that can grow needs `.overflow_y_scroll()`.
- **Never keep a `cx`.** Every callback gets one: `on_click((event, cx) => …)`,
  `cx.spawn(async (cx) => …)`, `cx.timer.every(ms, (cx) => …)`,
  `cx.timer.after(ms, …)`, `cx.timer.cancel(id)`.
- No `setTimeout` or `setInterval` (they throw and name `cx.timer`), no
  top-level `await` (use `cx.spawn` in `init`). Slow work goes through `exec`,
  `readTextFile` or `fetch`, which are promises.
- A save reloads every copy of the mod in place: `init` runs again;
  `localStorage` and shared state stay. A broken save keeps the old build
  running. Keep side effects on `globalThis` out of a module's top level.
- A copy starts when its block shows and stays alive while its layout does
  (a tab not shown keeps running): its timers keep running, so poll gently.
  An optional `close(cx)` runs once when the copy goes.
- Text styles (`text_color`, `text_size`, `font_*`, `truncate`) apply to the
  strings inside an element, and color the `svg()` and `icon()` inside.
- Touch targets want room: rows of 44 px or more.
- A sheet doesn't shrink when the keyboard opens. In a sheet with a text field
  near its bottom, keep it short (about 370 px tall on a phone) or put the field
  at the top.
- Animate with `.spin(ms)` (a spinner icon, `icons/ui/spinner.svg`), never
  with a timer.

### UI: `herdr-ui`

Elements: `div()` (a column), `v_flex()`, `h_flex()` (a row), `svg(path)` (an
SVG drawn in the text color), `image(path)` (an SVG or PNG as it is),
`icon(name)` (Ionicons), `input(id)` (a text field). Builders chain:
`.w() .h() .size() .size_full() .w_full() .flex_1() .flex_none() .min_w()
.max_w() .gap() .p() .px() .py() .pt() .m() .mx() .items_center()
.justify_between() .self_end() .absolute() .top() .bg() .border()
.border_color() .rounded() .rounded_full() .opacity() .text_size()
.text_color() .font_semibold() .font_mono() .truncate() .line_clamp()
.child() .children() .when() .id()`; touch: `.on_click()`,
`.on_long_press()`, `.swipe("right", { label, color, action })`; scrolling:
`.overflow_y_scroll()`, `.on_refresh()`; inputs: `.placeholder()`, `.value()`,
`.autofocus()`, `.multiline()`, `.on_change((e) => e.text)`, `.on_submit()`.
A method that doesn't exist says so by name. The full list is
`herdr-ui.d.ts`; desktop-only ones (hover, mouse buttons, focus, keys) aren't
there.

Icons: `icons/<program>.svg` (from `terminal.program.icon`: draw it with
`svg()` when `program.tint`, else `image()`) and Lucide glyphs in
`icons/ui/` (`plus`, `search`, `x`, `pin`, `server`, `git-branch`,
`git-compare`, `chevron-down`, `spinner`, `check`, `clock`, `layers`, ...).

### Data and actions: `herdr`

- **Live data:** `spaces()`, `agents()`, `terminals()`, `machines()`,
  `theme()`, `settings()`, `safeArea()`, `layout()`, `commands()`,
  `props()`. The fields are in `herdr.d.ts`.
- **Act:** `run(command, args)` (below), `exec(cmd, args, { cwd, on })` (a
  program on a machine; `on` is a machine's name, default: this machine),
  `readTextFile(path, { on })`, `writeTextFile(path, text, { on })`,
  `knownAgents({ on })` (the agents installed there), `fetch(url, init)`.
- **Over the screen:** `openOverlay({ mod, props, kind: "sheet" | "dialog" })`
  returns an id; the mod gets it as `props().overlay` and closes itself with
  `closeOverlay(props().overlay)`. `notify({ title, body, level, action })`
  posts a toast; tapping it runs `action` (`{ name, args }`, a command).
- **State:** `shared(key)` / `setShared(key, value)`: shared by every mod on
  the phone, kept across restarts, and a tab's `badge`. `localStorage`:
  per mod copy.
- `console.log` goes to the app's log, not to you: report problems on
  screen or with `notify`.

## Commands

The one way a mod changes anything: `run(name, args)` returns a promise of
what the command returns. Unknown or missing arguments are errors that list
the valid ones. Terminals are named by their `address`.

- Screens: `screen.open {mod, props?, title?}`, `screen.back`,
  `layout.select {tabs, child}` (show a tab of a tabs node),
  `terminal.show {terminal}` (the terminal screen), `app.settings`,
  `app.machines`.
- Spaces and tabs: `space.new {machine, name?, folder?, tab?, argv?}` (a
  space with one tab: a shell, or `argv` like `["pi"]`, in `folder`, default
  that machine's home; returns `{ space, tab, terminal }`),
  `tab.new {space, name?, folder?, argv?}` (returns `{ tab, terminal }`),
  `space.close {id, confirmed?}` and `tab.close {id, confirmed?}` (end their
  terminals; they ask the person first unless `confirmed`),
  `space.rename {id, name}`, `tab.rename {id, name}` (`""`: unnamed again),
  `space.move {id, index}`, `tab.move {id, index}` (1 is first).
- Terminals: `terminal.send {terminal, text}` (paste and press Enter),
  `terminal.interrupt {terminal}`, `terminal.kill {terminal}`,
  `terminal.close {terminal}` (end it and remove it, with its pane),
  `terminal.copy {terminal}` (its screen and history to the clipboard).
- The definition: `layout.switch {name}`, `layout.clone {name, as?}`,
  `mod.clone {name, as?}`, `layout.reset {name?}`, `definition.reload`.
- Other: `clipboard.copy {text}`.

From a shell, change the definition by editing files; `hc` drives terminals
and agents (`hc --help`).

## The shipped mods, as examples

`spaces` (spaces by machine, git branch, worktrees nested; its header has
search and +), `agents` (priority or grouped, pins, sub-agents, the
`agents.needs` badge), `space` (a space's tabs, opened with screen.open),
`new-menu` (a terminal or an agent, a space, a worktree), `menu` (what you
can do to a space, a tab or an agent), `prompt` and `confirm` (dialogs that
run a command), `picker` (search), `worktree`, `changes` (git changes, a
diff, commit), `toast` (how `notify` looks). Read them before writing
something similar, and copy them to change them.

## Keep in mind

- One mod per idea. Don't edit this guide, the `.d.ts` files, `check.mjs`,
  `installed.json` or `icons/`: the app rewrites them.
- Don't touch shipped mods or layouts in place: copy them.
- The person sees changes only while the app is open; tell them to open it
  (and that the definition machine is this one) if they don't see yours.
- After every change: `node ~/.config/herdr-mobile/check.mjs`, then the
  `.error` files.
