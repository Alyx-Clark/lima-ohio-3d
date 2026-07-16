import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../../vite.config.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const application = await readFile(new URL("../main.js", import.meta.url), "utf8");
const treeRenderer = await readFile(new URL("tree-layer.js", import.meta.url), "utf8");
const packageManifest = await readFile(new URL("../../package.json", import.meta.url), "utf8");

test("production assets target the canonical Nginx subpath", () => {
  assert.match(config, /base:\s*["']\/lima-3d\/["']/);
});

test("the renderer CDN is pinned and integrity checked", () => {
  assert.match(html, /maplibre-gl@5\.24\.0/);
  assert.match(html, /integrity="sha384-[A-Za-z0-9+/=]+"/);
});

test("PMTiles ranges bypass partial browser cache entries", () => {
  assert.match(application, /archiveSource\.mustReload\s*=\s*true/);
});

test("LiDAR canopy uses native bounded extrusions without a second WebGL renderer", () => {
  assert.match(treeRenderer, /type:\s*["']fill-extrusion["']/);
  assert.match(treeRenderer, /cameraBatchLimit/);
  assert.match(treeRenderer, /scheduleUpdate/);
  assert.doesNotMatch(packageManifest, /["']three["']/);
});

test("close-range realism stays native and data-driven", () => {
  assert.match(application, /facadePatternExpression/);
  assert.match(application, /roofPatternExpression/);
  assert.match(application, /map\.setSky/);
  assert.match(application, /HIGH_PITCH_CULLED_LABELS/);
  assert.match(treeRenderer, /"middle"/);
  assert.match(treeRenderer, /setReduced/);
});
