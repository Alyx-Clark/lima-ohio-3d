import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [, , inputPath = "data/source/lima-traffic-overpass.json", outputDirectory = "public/data"] = process.argv;
const CLASSES = [
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "residential",
  "living_street",
  "unclassified",
  "service",
];
const DEFAULT_SPEED_MPS = {
  motorway: 26,
  trunk: 22,
  primary: 17,
  secondary: 15,
  tertiary: 13,
  residential: 9.5,
  living_street: 6,
  unclassified: 9,
  service: 5.5,
};

function distanceMeters(left, right) {
  const latitude = ((left[1] + right[1]) / 2) * (Math.PI / 180);
  const x = (right[0] - left[0]) * 111_320 * Math.cos(latitude);
  const y = (right[1] - left[1]) * 111_320;
  return Math.hypot(x, y);
}

function routeLength(coordinates) {
  let length = 0;
  for (let index = 1; index < coordinates.length; index += 1) length += distanceMeters(coordinates[index - 1], coordinates[index]);
  return length;
}

function compactCoordinates(geometry = []) {
  const valid = geometry
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    .map((point) => [Number(point.lon.toFixed(7)), Number(point.lat.toFixed(7))]);
  if (valid.length < 3) return valid;
  const compact = [valid[0]];
  for (let index = 1; index < valid.length - 1; index += 1) {
    if (distanceMeters(compact.at(-1), valid[index]) >= 4) compact.push(valid[index]);
  }
  compact.push(valid.at(-1));
  return compact;
}

function parseSpeed(tags, highway) {
  const value = String(tags.maxspeed || "").toLowerCase();
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SPEED_MPS[highway];
  const metersPerSecond = value.includes("mph") ? numeric * 0.44704 : numeric / 3.6;
  return Math.max(4, Math.min(31, metersPerSecond));
}

const raw = JSON.parse(await readFile(inputPath, "utf8"));
const routes = [];
const countsByClass = Object.fromEntries(CLASSES.map((name) => [name, 0]));
let totalLengthMeters = 0;

for (const element of raw.elements || []) {
  if (element.type !== "way") continue;
  const tags = element.tags || {};
  const classIndex = CLASSES.indexOf(tags.highway);
  if (classIndex < 0) continue;
  const coordinates = compactCoordinates(element.geometry);
  const length = routeLength(coordinates);
  if (coordinates.length < 2 || length < 28) continue;
  const lanes = Math.max(1, Math.min(6, Number.parseInt(tags.lanes, 10) || (classIndex <= 4 ? 2 : 1)));
  const oneway = ["yes", "1", "true"].includes(String(tags.oneway).toLowerCase()) || tags.highway === "motorway";
  routes.push([
    classIndex,
    Number(parseSpeed(tags, tags.highway).toFixed(1)),
    oneway ? 1 : 0,
    lanes,
    coordinates,
  ]);
  countsByClass[tags.highway] += 1;
  totalLengthMeters += length;
}

routes.sort((left, right) => left[0] - right[0] || right[4].length - left[4].length);
const output = { classes: CLASSES, routes };
const json = JSON.stringify(output);
const metadata = {
  city: "Lima, Ohio",
  generatedAt: new Date().toISOString(),
  osmTimestamp: raw.osm3s?.timestamp_osm_base || null,
  source: "OpenStreetMap drivable ways via Overpass API",
  license: "ODbL 1.0",
  counts: {
    routes: routes.length,
    routeKilometers: Number((totalLengthMeters / 1_000).toFixed(1)),
    byClass: countsByClass,
  },
  note: "Routes drive a deterministic cinematic traffic simulation; vehicle locations are visualizations, not live observations.",
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "lima-traffic.json"), json),
  writeFile(path.join(outputDirectory, "lima-traffic.json.gz"), gzipSync(json, { level: 9 })),
  writeFile(path.join(outputDirectory, "lima-traffic-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
]);

console.log(JSON.stringify({ outputDirectory, ...metadata }, null, 2));
