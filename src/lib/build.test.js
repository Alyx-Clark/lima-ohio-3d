import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../../vite.config.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");

test("production assets target the canonical Nginx subpath", () => {
  assert.match(config, /base:\s*["']\/lima-3d\/["']/);
});

test("the renderer CDN is pinned and integrity checked", () => {
  assert.match(html, /maplibre-gl@5\.24\.0/);
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
});
