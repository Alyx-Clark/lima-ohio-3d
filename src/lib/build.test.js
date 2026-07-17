import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../../vite.config.js", import.meta.url), "utf8");
const html = await readFile(new URL("../../index.html", import.meta.url), "utf8");
const application = await readFile(new URL("../main.js", import.meta.url), "utf8");
const cinematicRenderer = await readFile(new URL("traffic-layer.js", import.meta.url), "utf8");
const facadeRenderer = await readFile(new URL("facade-detail.js", import.meta.url), "utf8");
const googleRealityRenderer = await readFile(new URL("google-reality.js", import.meta.url), "utf8");
const packageManifest = await readFile(new URL("../../package.json", import.meta.url), "utf8");
const runtimeConfig = await readFile(new URL("../../public/runtime-config.json", import.meta.url), "utf8");
const terms = await readFile(new URL("../../public/terms.html", import.meta.url), "utf8");
const privacy = await readFile(new URL("../../public/privacy.html", import.meta.url), "utf8");

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

test("cinematic traffic uses a pinned instanced renderer", () => {
  assert.match(packageManifest, /"three":\s*"\^0\.185\.1"/);
  assert.match(application, /createCinematicLayer/);
  assert.match(cinematicRenderer, /InstancedMesh/);
  assert.match(cinematicRenderer, /IcosahedronGeometry/);
  assert.match(cinematicRenderer, /RoundedBoxGeometry/);
  assert.match(cinematicRenderer, /createFacadeSystem/);
  assert.match(facadeRenderer, /CanvasTexture/);
  assert.match(facadeRenderer, /InstancedMesh/);
});

test("close-range realism stays bounded and data-driven", () => {
  assert.match(application, /facadePatternExpression/);
  assert.match(application, /roofPatternExpression/);
  assert.match(application, /map\.setSky/);
  assert.match(application, /HIGH_PITCH_CULLED_LABELS/);
  assert.match(cinematicRenderer, /treeCandidates/);
  assert.match(cinematicRenderer, /setReduced/);
  assert.match(application, /button\.querySelector\("small"\)\.textContent/);
  assert.match(application, /loadFacadeData/);
  assert.doesNotMatch(application, /const windows = \[/);
});

test("Google reality is licensed, deferred, and credential-safe", () => {
  assert.match(packageManifest, /"@googlemaps\/js-api-loader":\s*"2\.1\.1"/);
  assert.match(googleRealityRenderer, /importLibrary\("maps3d"\)/);
  assert.match(googleRealityRenderer, /StreetViewPanorama/);
  assert.match(googleRealityRenderer, /OLD_CITY_PRIME_STREET_VIEW/);
  assert.doesNotMatch(runtimeConfig, /AIza[0-9A-Za-z_-]{30,}/);
  assert.match(terms, /Google Maps\/Google Earth Additional Terms/);
  assert.match(privacy, /Google Privacy Policy/);
  assert.match(application, /cancelledTileRequest/);
  assert.match(application, /Failed to fetch \\\(0\\\)/);
});
