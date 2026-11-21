import { beforeAll, describe, expect, test } from "vitest";
import { TERMINAL_HTML } from "../src/terminal/terminal-html.generated";

type Terminal = {
  write(data: string, callback: () => void): void;
  onData(listener: (data: string) => void): void;
  loadAddon(addon: unknown): void;
};
type ImageAddon = { getImageAtBufferCell(x: number, y: number): unknown };

let TerminalCtor: new (opts: object) => Terminal;
let ImageAddonCtor: new () => ImageAddon;

const ID = 4256973960;
const PNG = Buffer.from("not decoded in these tests").toString("base64");
const kitty = (control: string, payload = "") => `\x1b_G${control}${payload ? `;${payload}` : ""}\x1b\\`;

function loadPageScript(code: string) {
  const module = { exports: {} as Record<string, unknown> };
  new Function("module", "exports", code)(module, module.exports);
  return module.exports;
}

function stubBrowserGlobals() {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
  g.self ??= globalThis;
  g.ImageData ??= class {
    constructor(
      public data: Uint8ClampedArray,
      public width: number,
      public height: number,
    ) {}
  };
  const bitmap = (width: number, height: number) => ({ width, height, close() {} });
  g.createImageBitmap = async (_src: unknown, ...args: unknown[]) => {
    if (args.length === 4) return bitmap(args[2] as number, args[3] as number);
    const resize = args[0] as { resizeWidth?: number; resizeHeight?: number } | undefined;
    if (resize?.resizeWidth) return bitmap(resize.resizeWidth, resize.resizeHeight ?? 40);
    return bitmap(40, 40);
  };
}

beforeAll(() => {
  stubBrowserGlobals();
  const scripts = TERMINAL_HTML.split("<script>")
    .slice(1)
    .map((s) => s.split("</script>")[0]);
  TerminalCtor = loadPageScript(scripts[0]).Terminal as typeof TerminalCtor;
  ImageAddonCtor = loadPageScript(scripts[2]).ImageAddon as typeof ImageAddonCtor;
});

function setup() {
  const term = new TerminalCtor({ cols: 20, rows: 10, allowProposedApi: true });
  const addon = new ImageAddonCtor();
  term.loadAddon(addon);
  const replies: string[] = [];
  term.onData((d) => replies.push(d));
  const write = (data: string) => new Promise<void>((resolve) => term.write(data, resolve));
  const shown = () => addon.getImageAtBufferCell(0, 0) !== undefined;
  return { write, shown, replies };
}

async function uploaded() {
  const t = setup();
  await t.write(kitty(`a=T,f=100,q=2,C=1,c=4,r=2,i=${ID}`, PNG));
  expect(t.shown()).toBe(true);
  return t;
}

describe("Kitty image deletes", () => {
  test("pi's redraw places the image again after deleting all placements", async () => {
    const t = await uploaded();
    await t.write(kitty("a=d,d=a,q=2"));
    expect(t.shown()).toBe(false);
    await t.write(`\x1b[H${kitty(`a=p,q=2,C=1,c=4,i=${ID},y=10,h=20,r=1`)}`);
    expect(t.shown()).toBe(true);
  });

  test("deleting one image's placements keeps its data", async () => {
    const t = await uploaded();
    await t.write(kitty(`a=d,d=i,i=${ID},q=2`));
    expect(t.shown()).toBe(false);
    await t.write(`\x1b[H${kitty(`a=p,C=1,c=4,r=2,i=${ID}`)}`);
    expect(t.shown()).toBe(true);
    expect(t.replies.join("")).toContain(`i=${ID};OK`);
  });

  test.each([["d=A"], [`d=I,i=${ID}`]])("uppercase %s frees the image data", async (selector) => {
    const t = await uploaded();
    await t.write(kitty(`a=d,${selector},q=2`));
    expect(t.shown()).toBe(false);
    await t.write(`\x1b[H${kitty(`a=p,C=1,c=4,r=2,i=${ID}`)}`);
    expect(t.shown()).toBe(false);
    expect(t.replies.join("")).toContain("ENOENT:image not found");
  });
});
