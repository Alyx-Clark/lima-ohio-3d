import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

const DATA_PATH = new URL("../../public/data/lima-detail.json", import.meta.url);
const BOUNDARY_PATH = new URL("../../public/data/lima-boundary.json", import.meta.url);
const METADATA_PATH = new URL("../../public/data/lima-metadata.json", import.meta.url);
const COMPRESSED_PATH = new URL("../../public/data/lima-detail.json.gz", import.meta.url);
const BUILDING_METADATA_PATH = new URL("../../public/data/lima-buildings-metadata.json", import.meta.url);
const BUILDING_TILES_PATH = new URL("../../public/data/lima-buildings.pmtiles", import.meta.url);
const TREE_METADATA_PATH = new URL("../../public/data/lima-trees-metadata.json", import.meta.url);
const TREE_PATH = new URL("../../public/data/lima-trees.json", import.meta.url);
const COMPRESSED_TREE_PATH = new URL("../../public/data/lima-trees.json.gz", import.meta.url);

const [detail, boundary, metadata] = await Promise.all(
  [DATA_PATH, BOUNDARY_PATH, METADATA_PATH].map(async (url) => JSON.parse(await readFile(url, "utf8"))),
);
const compressedDetail = await readFile(COMPRESSED_PATH);
const [buildingMetadata, treeMetadata, treeInventory] = await Promise.all(
  [BUILDING_METADATA_PATH, TREE_METADATA_PATH, TREE_PATH].map(async (url) =>
    JSON.parse(await readFile(url, "utf8")),
  ),
);
const compressedTrees = await readFile(COMPRESSED_TREE_PATH);

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

test("the compressed startup payload stays below 400 KB", async () => {
  const file = await stat(COMPRESSED_PATH);
  assert.ok(file.size < 400_000, `compressed detail is ${file.size.toLocaleString()} bytes`);
  assert.deepEqual(JSON.parse(gunzipSync(compressedDetail)), detail);
});

test("the measured building archive covers Lima without becoming a startup payload", async () => {
  const archive = await stat(BUILDING_TILES_PATH);
  assert.equal(buildingMetadata.release, "2026-06-17.0");
  assert.ok(buildingMetadata.counts.buildings > 24_000);
  assert.ok(buildingMetadata.counts.source_heights / buildingMetadata.counts.buildings > 0.97);
  assert.ok(buildingMetadata.counts.normalized_low_heights > 1_500);
  assert.ok(archive.size < 11_000_000, `building archive is ${archive.size.toLocaleString()} bytes`);
});

test("LiDAR canopy inventory matches metadata and stays compact", async () => {
  const compressed = await stat(COMPRESSED_TREE_PATH);
  assert.equal(treeInventory.trees.length, treeMetadata.counts.lidarTreeCrowns);
  assert.ok(treeInventory.trees.length > 260_000);
  assert.ok(treeInventory.trees.every((tree) => tree.length === 5 && tree.every(Number.isFinite)));
  assert.ok(compressed.size < 2_500_000, `compressed canopy is ${compressed.size.toLocaleString()} bytes`);
  assert.deepEqual(JSON.parse(gunzipSync(compressedTrees)), treeInventory);
});

test("LiDAR canopy spans the southern and northern municipal extents", () => {
  const latitudes = treeInventory.trees.map((tree) => tree[1]);
  const minimumLatitude = latitudes.reduce((minimum, latitude) => Math.min(minimum, latitude), Infinity);
  const maximumLatitude = latitudes.reduce((maximum, latitude) => Math.max(maximum, latitude), -Infinity);
  assert.ok(minimumLatitude < 40.7);
  assert.ok(maximumLatitude > 40.78);
  assert.ok(
    treeInventory.trees.every(
      ([longitude, latitude]) =>
        longitude >= treeMetadata.bounds[0] &&
        longitude <= treeMetadata.bounds[2] &&
        latitude >= treeMetadata.bounds[1] &&
        latitude <= treeMetadata.bounds[3],
    ),
  );
});
