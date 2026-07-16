import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const config = await readFile(new URL("../../vite.config.js", import.meta.url), "utf8");

test("production assets target the canonical Nginx subpath", () => {
  assert.match(config, /base:\s*["']\/lima-3d\/["']/);
});
