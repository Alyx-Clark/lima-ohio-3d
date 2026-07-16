import assert from "node:assert/strict";
import test from "node:test";

import { chunkTreeInventory, localMeters } from "./tree-layer.js";

test("localMeters anchors Lima's center at zero", () => {
  const [x, y] = localMeters(-84.105006, 40.7399785);
  assert.ok(Math.abs(x) < 0.001);
  assert.ok(Math.abs(y) < 0.001);
});

test("localMeters preserves east and north orientation", () => {
  const [east] = localMeters(-84.104006, 40.7399785);
  const [, north] = localMeters(-84.105006, 40.7409785);
  assert.ok(east > 80 && east < 90);
  assert.ok(north > 110 && north < 112);
});

test("tree inventory is grouped into bounded spatial chunks", () => {
  const trees = [
    [-84.105, 40.74, 12, 3, 0],
    [-84.10499, 40.74001, 10, 2.5, 1],
    [-84.09, 40.75, 15, 3.6, 2],
  ];
  const chunks = chunkTreeInventory(trees, 500);
  assert.equal(chunks.length, 2);
  assert.equal(chunks.reduce((sum, chunk) => sum + chunk.trees.length, 0), trees.length);
  assert.ok(chunks.every((chunk) => chunk.bounds.length === 4));
});
