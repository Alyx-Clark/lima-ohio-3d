import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [, , inputPath = "data/source/lima-buildings.geojsonseq", outputDirectory = "public/data"] = process.argv;
const METERS_PER_DEGREE = 111_320;

function seededRandom(value) {
  let state = value >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function signedArea(ring) {
  let area = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    area += ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
  }
  return area / 2;
}

function exteriorRing(geometry) {
  if (geometry?.type === "Polygon") return geometry.coordinates[0];
  if (geometry?.type !== "MultiPolygon") return null;
  return geometry.coordinates
    .map((polygon) => polygon[0])
    .sort((left, right) => Math.abs(signedArea(right)) - Math.abs(signedArea(left)))[0];
}

function polygonCentroid(ring) {
  const area = signedArea(ring);
  if (Math.abs(area) < 1e-12) return ring[0];
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const cross = ring[index][0] * ring[index + 1][1] - ring[index + 1][0] * ring[index][1];
    x += (ring[index][0] + ring[index + 1][0]) * cross;
    y += (ring[index][1] + ring[index + 1][1]) * cross;
  }
  return [x / (6 * area), y / (6 * area)];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function longestEdgeAngle(ring, latitude) {
  const longitudeScale = Math.cos((latitude * Math.PI) / 180);
  let longest = 0;
  let angle = 0;
  for (let index = 1; index < ring.length; index += 1) {
    const dx = (ring[index][0] - ring[index - 1][0]) * longitudeScale;
    const dy = ring[index][1] - ring[index - 1][1];
    const length = Math.hypot(dx, dy);
    if (length > longest) {
      longest = length;
      angle = Math.atan2(dy, dx);
    }
  }
  return angle;
}

function rectangle(center, widthMeters, lengthMeters, angle) {
  const latitudeScale = 1 / METERS_PER_DEGREE;
  const longitudeScale = 1 / (METERS_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180));
  const forward = [Math.cos(angle), Math.sin(angle)];
  const side = [-forward[1], forward[0]];
  const corners = [
    [-widthMeters / 2, -lengthMeters / 2],
    [widthMeters / 2, -lengthMeters / 2],
    [widthMeters / 2, lengthMeters / 2],
    [-widthMeters / 2, lengthMeters / 2],
  ].map(([across, along]) => [
    Number((center[0] + (side[0] * across + forward[0] * along) * longitudeScale).toFixed(7)),
    Number((center[1] + (side[1] * across + forward[1] * along) * latitudeScale).toFixed(7)),
  ]);
  corners.push(corners[0]);
  return corners;
}

function offsetPoint(center, angle, acrossMeters, alongMeters) {
  const forward = [Math.cos(angle), Math.sin(angle)];
  const side = [-forward[1], forward[0]];
  return [
    center[0] + (side[0] * acrossMeters + forward[0] * alongMeters) / (METERS_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180)),
    center[1] + (side[1] * acrossMeters + forward[1] * alongMeters) / METERS_PER_DEGREE,
  ];
}

const lines = (await readFile(inputPath, "utf8")).trim().split(/\r?\n/);
const features = [];
const counts = { hvac: 0, vent: 0, chimney: 0, skylight: 0, solar: 0 };

for (const line of lines) {
  const building = JSON.parse(line);
  const ring = exteriorRing(building.geometry);
  if (!ring || ring.length < 4) continue;
  const properties = building.properties || {};
  const center = polygonCentroid(ring);
  if (!pointInRing(center, ring)) continue;
  const longitudes = ring.map((coordinate) => coordinate[0]);
  const latitudes = ring.map((coordinate) => coordinate[1]);
  const widthMeters = (Math.max(...longitudes) - Math.min(...longitudes)) * METERS_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180);
  const lengthMeters = (Math.max(...latitudes) - Math.min(...latitudes)) * METERS_PER_DEGREE;
  const areaEstimate = widthMeters * lengthMeters;
  if (Math.min(widthMeters, lengthMeters) < 6 || areaEstimate < 55) continue;

  const random = seededRandom(hashString(properties.id || building.id));
  const angle = longestEdgeAngle(ring, center[1]);
  const sourceFacadeType = properties.facade_type || "residential";
  const facadeType = areaEstimate >= 780 ? "industrial" : areaEstimate >= 290 ? "urban" : sourceFacadeType;
  const planned = [];
  if (facadeType === "industrial") {
    const count = Math.min(4, 1 + Math.floor(areaEstimate / 1_200));
    for (let index = 0; index < count; index += 1) {
      planned.push({
        kind: index % 3 === 2 ? "vent" : "hvac",
        width: 1.8 + random() * 1.4,
        length: 2.2 + random() * 1.9,
        height: 0.85 + random() * 0.8,
        across: (random() - 0.5) * Math.min(widthMeters, 18) * 0.45,
        along: (random() - 0.5) * Math.min(lengthMeters, 22) * 0.45,
      });
    }
  } else if (facadeType === "urban") {
    const count = Math.min(3, 1 + Math.floor(areaEstimate / 1_000));
    for (let index = 0; index < count; index += 1) {
      planned.push({
        kind: index === 1 && random() > 0.55 ? "skylight" : "hvac",
        width: 1.4 + random() * 1.2,
        length: 1.7 + random() * 1.7,
        height: 0.55 + random() * 0.75,
        across: (random() - 0.5) * Math.min(widthMeters, 14) * 0.38,
        along: (random() - 0.5) * Math.min(lengthMeters, 17) * 0.38,
      });
    }
  } else if (random() < 0.34) {
    planned.push({
      kind: random() < 0.72 ? "chimney" : "skylight",
      width: 0.55 + random() * 0.35,
      length: 0.65 + random() * 0.45,
      height: 0.42 + random() * 0.75,
      across: (random() - 0.5) * Math.min(widthMeters, 8) * 0.3,
      along: (random() - 0.5) * Math.min(lengthMeters, 10) * 0.3,
    });
  }

  if (areaEstimate > 240 && random() < 0.09) {
    planned.push({
      kind: "solar",
      width: 2.6 + random() * 2,
      length: 3.2 + random() * 2.8,
      height: 0.24,
      across: (random() - 0.5) * Math.min(widthMeters, 12) * 0.32,
      along: (random() - 0.5) * Math.min(lengthMeters, 15) * 0.32,
    });
  }

  for (let index = 0; index < planned.length; index += 1) {
    const part = planned[index];
    const partCenter = offsetPoint(center, angle, part.across, part.along);
    const partRing = rectangle(partCenter, part.width, part.length, angle);
    if (!partRing.slice(0, -1).every((coordinate) => pointInRing(coordinate, ring))) continue;
    const base = Number((Number(properties.height) + 0.18).toFixed(2));
    features.push({
      type: "Feature",
      id: `${properties.id || building.id}-roof-${index}`,
      properties: {
        category: "roof-detail",
        kind: part.kind,
        base,
        height: Number((base + part.height).toFixed(2)),
        material_variant: Number(properties.material_variant) || 0,
      },
      geometry: { type: "Polygon", coordinates: [partRing] },
    });
    counts[part.kind] += 1;
  }
}

const collection = { type: "FeatureCollection", name: "Lima procedural rooftop detail", features };
const json = JSON.stringify(collection);
const metadata = {
  city: "Lima, Ohio",
  generatedAt: new Date().toISOString(),
  source: "Derived from Overture building footprints and heights",
  license: "ODbL 1.0; source attributions documented in DATA_LICENSE.md",
  counts: { features: features.length, ...counts },
  note: "Equipment locations are deterministic visual proxies placed within source building footprints; they are not surveyed roof inventories.",
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "lima-rooftops.json"), json),
  writeFile(path.join(outputDirectory, "lima-rooftops.json.gz"), gzipSync(json, { level: 9 })),
  writeFile(path.join(outputDirectory, "lima-rooftops-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
]);
console.log(JSON.stringify({ outputDirectory, ...metadata }, null, 2));
