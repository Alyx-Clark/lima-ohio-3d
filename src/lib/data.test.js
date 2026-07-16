import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

const DATA_PATH = new URL("../../public/data/lima-detail.json", import.meta.url);
const BOUNDARY_PATH = new URL("../../public/data/lima-boundary.json", import.meta.url);
const METADATA_PATH = new URL("../../public/data/lima-metadata.json", import.meta.url);

const [detail, boundary, metadata] = await Promise.all(
  [DATA_PATH, BOUNDARY_PATH, METADATA_PATH].map(async (url) => JSON.parse(await readFile(url, "utf8"))),
);

function categoryCount(category) {
  return detail.features.filter((feature) => feature.properties.category === category).length;
}

function everyCoordinateIsFinite(value) {
  if (!Array.isArray(value)) return false;
  if (typeof value[0] === "number") return value.length >= 2 && value.every(Number.isFinite);
  return value.every(everyCoordinateIsFinite);
}

test("derived feature counts match the source metadata", () => {
  assert.equal(categoryCount("pedestrian"), metadata.counts.pedestrianWays);
  assert.equal(categoryCount("green-space"), metadata.counts.greenAreas);
  assert.equal(categoryCount("furniture"), metadata.counts.furniture);
  assert.equal(categoryCount("furniture-3d"), metadata.counts.furniture);
  assert.equal(
    detail.features.filter(
      (feature) => feature.properties.category === "tree" && feature.properties.origin === "inferred",
    ).length,
    metadata.counts.inferredTrees * 2,
  );
});

test("all committed geometries contain finite coordinates", () => {
  assert.ok(detail.features.length > 4_000);
  assert.ok(detail.features.every((feature) => everyCoordinateIsFinite(feature.geometry.coordinates)));
  assert.ok(boundary.features.every((feature) => everyCoordinateIsFinite(feature.geometry.coordinates)));
});

test("the boundary identifies the canonical Lima relation", () => {
  assert.equal(boundary.features.length, 1);
  assert.equal(boundary.features[0].properties.osmRelationId, 182725);
  assert.match(boundary.features[0].properties.name, /Lima, Ohio/);
});

test("local detail stays within the startup size budget", async () => {
  const file = await stat(DATA_PATH);
  assert.ok(file.size < 2_500_000, `detail payload is ${file.size.toLocaleString()} bytes`);
});
