import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

const html = readFileSync(new URL("../../web/index.html", import.meta.url), "utf8");
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)?.[1];
if (!script) throw new Error("Web GUI inline script was not found");

function row() {
  const buttons = new Map<string, EventTarget>();
  return {
    innerHTML: "",
    querySelector(selector: string) {
      const title = selector.match(/^button\[title="([^"]+)"\]$/)?.[1];
      if (!title || !this.innerHTML.includes(`title="${title}"`)) throw new Error(`Missing button: ${selector}`);
      if (!buttons.has(title)) buttons.set(title, new EventTarget());
      return buttons.get(title)!;
    },
  };
}

// Load the shipped script and stub only the DOM operations used by its renderers.
function setup() {
  const rows: ReturnType<typeof row>[] = [];
  const actions = { copy: vi.fn(), download: vi.fn(), qbit: vi.fn(), remove: vi.fn() };
  const document = {
    createElement: row,
    getElementById: () => ({
      classList: { add() {}, remove() {}, toggle() {} },
      appendChild: (child: ReturnType<typeof row>) => rows.push(child),
    }),
  };
  const gui = runInNewContext(`${script}\n
    copyMagnet = actions.copy;
    sendToBuiltin = actions.download;
    sendToQbit = actions.qbit;
    confirmStopDownload = actions.remove;
    ({ renderResults, renderQueue });
  `, { document, window: { location: { origin: "http://torlink.test" } }, actions }) as {
    renderResults: (items: unknown[]) => void;
    renderQueue: (items: unknown[]) => void;
  };
  return { gui, rows, actions };
}

const name = 'Ocean\'s "Eleven" & <extras> [Y\'TS]';

it("passes quoted result values to the correct row's actions", () => {
  const { gui, rows, actions } = setup();
  const items = [name, "Second [EZTV]"].map((title, index) => {
    const id = String(index).repeat(40);
    const magnet = `magnet:?xt=urn:btih:${id}&dn=${encodeURIComponent(title)}`;
    const fields: Record<string, string> = { title, size: "123" };
    const attrs = { infohash: id, magneturl: magnet };
    return {
      title, id, magnet,
      querySelector: (tag: string) => ({ textContent: fields[tag] ?? "" }),
      getElementsByTagName: () => Object.entries(attrs).map(([name, value]) => ({
        getAttribute: (attribute: string) => attribute === "name" ? name : value,
      })),
    };
  });
  gui.renderResults(items);
  expect(rows).toHaveLength(2);
  rows.forEach(buttonRow => {
    for (const title of ["Copy magnet", "Download with Torlink", "Send to qBittorrent"]) {
      buttonRow.querySelector(`button[title="${title}"]`).dispatchEvent(new Event("click"));
    }
  });
  expect(actions.copy.mock.calls).toEqual(items.map(item => [item.magnet]));
  expect(actions.qbit.mock.calls).toEqual(items.map(item => [item.magnet]));
  expect(actions.download.mock.calls).toEqual(items.map((item, index) => [
    item.id, item.title, item.magnet, index === 0 ? "Y'TS" : "EZTV", 123,
  ]));
});

it("passes a quoted queue name intact to the existing remove confirmation", () => {
  const { gui, rows, actions } = setup();
  const id = "a".repeat(40);
  gui.renderQueue([{ id, name, status: "downloading" }]);
  expect(rows).toHaveLength(1);
  rows[0]!.querySelector('button[title="Stop and delete files"]').dispatchEvent(new Event("click"));
  expect(actions.remove).toHaveBeenCalledExactlyOnceWith(id, name);
});
