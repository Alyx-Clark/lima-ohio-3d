import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [
  ,
  ,
  buildingPath = "data/source/lima-buildings.geojsonseq",
  trafficPath = "public/data/lima-traffic.json",
  poiPath = "data/source/lima-facade-pois-overpass.json",
  outputDirectory = "public/data",
] = process.argv;

const METERS_PER_DEGREE = 111_320;
const GRID_SIZE = 0.0015;
const PROFILE_NAMES = [
  "clapboard-residential",
  "brick-residential",
  "stucco-residential",
  "main-street-storefront",
  "civic-masonry",
  "industrial-service",
  "institutional-modern",
];

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function round(value, digits) {
  return Number(value.toFixed(digits));
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

function projectedPoint([longitude, latitude], referenceLatitude) {
  return [
    longitude * METERS_PER_DEGREE * Math.cos((referenceLatitude * Math.PI) / 180),
    latitude * METERS_PER_DEGREE,
  ];
}

function ringMetrics(ring) {
  const latitude = ring.reduce((sum, coordinate) => sum + coordinate[1], 0) / ring.length;
  const projected = ring.map((coordinate) => projectedPoint(coordinate, latitude));
  let area = 0;
  for (let index = 0; index < projected.length - 1; index += 1) {
    area += projected[index][0] * projected[index + 1][1] - projected[index + 1][0] * projected[index][1];
  }
  const longitudes = ring.map((coordinate) => coordinate[0]);
  const latitudes = ring.map((coordinate) => coordinate[1]);
  return {
    area: Math.abs(area / 2),
    bounds: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
  };
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

function gridKey(longitude, latitude) {
  return `${Math.floor(longitude / GRID_SIZE)}:${Math.floor(latitude / GRID_SIZE)}`;
}

function addToGrid(grid, key, value) {
  const values = grid.get(key) || [];
  values.push(value);
  grid.set(key, values);
}

function cellsForBounds(bounds, padding = 0) {
  const west = Math.floor((bounds[0] - padding) / GRID_SIZE);
  const south = Math.floor((bounds[1] - padding) / GRID_SIZE);
  const east = Math.floor((bounds[2] + padding) / GRID_SIZE);
  const north = Math.floor((bounds[3] + padding) / GRID_SIZE);
  const cells = [];
  for (let x = west; x <= east; x += 1) {
    for (let y = south; y <= north; y += 1) cells.push(`${x}:${y}`);
  }
  return cells;
}

function closestPointOnRoad(point, segment) {
  const latitude = point[1];
  const origin = projectedPoint(point, latitude);
  const start = projectedPoint(segment[0], latitude);
  const end = projectedPoint(segment[1], latitude);
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;
  const progress = lengthSquared
    ? Math.max(0, Math.min(1, ((origin[0] - start[0]) * dx + (origin[1] - start[1]) * dy) / lengthSquared))
    : 0;
  const closest = [start[0] + dx * progress, start[1] + dy * progress];
  return {
    distance: Math.hypot(origin[0] - closest[0], origin[1] - closest[1]),
    vector: [closest[0] - origin[0], closest[1] - origin[1]],
  };
}

function nearestRoad(point, roadGrid) {
  let nearest = null;
  const x = Math.floor(point[0] / GRID_SIZE);
  const y = Math.floor(point[1] / GRID_SIZE);
  for (let radius = 0; radius <= 3 && !nearest; radius += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
        const segments = roadGrid.get(`${x + offsetX}:${y + offsetY}`) || [];
        for (const segment of segments) {
          const candidate = closestPointOnRoad(point, segment);
          if (!nearest || candidate.distance < nearest.distance) nearest = candidate;
        }
      }
    }
  }
  return nearest;
}

function poiCoordinate(element) {
  if (Number.isFinite(element.lon) && Number.isFinite(element.lat)) return [element.lon, element.lat];
  if (Number.isFinite(element.center?.lon) && Number.isFinite(element.center?.lat)) {
    return [element.center.lon, element.center.lat];
  }
  return null;
}

function materialCode(tags = {}) {
  const material = String(tags["building:material"] || tags.material || "").toLowerCase();
  if (/brick|masonry/.test(material)) return 1;
  if (/wood|timber|siding|clapboard/.test(material)) return 2;
  if (/stucco|plaster|render/.test(material)) return 3;
  if (/metal|steel|sheet/.test(material)) return 4;
  if (/concrete|glass|stone/.test(material)) return 5;
  return 0;
}

function toneCode(tags = {}) {
  const color = String(tags["building:colour"] || tags["building:color"] || "").toLowerCase();
  if (/red|brown|brick|maroon|burgundy/.test(color)) return 1;
  if (/yellow|tan|beige|cream|orange/.test(color)) return 2;
  if (/white|gray|grey|silver|black/.test(color)) return 3;
  if (/blue|navy/.test(color)) return 4;
  if (/green|olive/.test(color)) return 5;
  return 0;
}

function facadeProfile(building, enrichment, seed) {
  const properties = building.properties;
  const amenity = String(enrichment.tags.amenity || "").toLowerCase();
  const category = String(
    properties.class ||
      enrichment.tags.shop ||
      enrichment.tags.office ||
      enrichment.tags.amenity ||
      enrichment.tags.tourism ||
      enrichment.tags.building ||
      "",
  ).toLowerCase();
  const material = materialCode(enrichment.tags);
  if (/industrial|warehouse|garage|service|storage/.test(category) || properties.facade_type === "industrial") return 5;
  if (/school|university|college|hospital|medical|clinic/.test(category)) return 6;
  if (/church|chapel|civic|government|museum|library|courthouse/.test(category)) return 4;
  if (
    enrichment.tags.shop ||
    enrichment.tags.office ||
    enrichment.tags.craft ||
    /retail|commercial|office|restaurant|cafe|fast_food|bank|bar|pub|marketplace|pharmacy|post_office/.test(category) ||
    /restaurant|cafe|fast_food|bank|bar|pub|marketplace|pharmacy|post_office/.test(amenity)
  ) {
    return 3;
  }
  const centerLongitude = (building.bounds[0] + building.bounds[2]) / 2;
  const centerLatitude = (building.bounds[1] + building.bounds[3]) / 2;
  const downtown =
    centerLongitude >= -84.1115 &&
    centerLongitude <= -84.099 &&
    centerLatitude >= 40.735 &&
    centerLatitude <= 40.746;
  if (downtown && building.area >= 75 && building.height >= 4) return seed % 4 === 0 ? 6 : 3;
  if (/apartments|hotel/.test(category) || building.height >= 10 || building.area >= 520) return seed % 2 ? 4 : 6;
  if (material === 1) return 1;
  if (material === 3 || material === 5) return 2;
  if (material === 4) return 5;
  return seed % 3;
}

const [buildingText, traffic, poiPayload] = await Promise.all([
  readFile(buildingPath, "utf8"),
  readFile(trafficPath, "utf8").then(JSON.parse),
  readFile(poiPath, "utf8").then(JSON.parse),
]);

const roadGrid = new Map();
for (const route of traffic.routes || []) {
  const coordinates = route[4] || [];
  for (let index = 1; index < coordinates.length; index += 1) {
    const segment = [coordinates[index - 1], coordinates[index]];
    const bounds = [
      Math.min(segment[0][0], segment[1][0]),
      Math.min(segment[0][1], segment[1][1]),
      Math.max(segment[0][0], segment[1][0]),
      Math.max(segment[0][1], segment[1][1]),
    ];
    for (const cell of cellsForBounds(bounds, 0.00025)) addToGrid(roadGrid, cell, segment);
  }
}

const buildings = buildingText
  .trim()
  .split(/\r?\n/)
  .map((line, index) => {
    const feature = JSON.parse(line);
    const ring = exteriorRing(feature.geometry);
    if (!ring || ring.length < 4) return null;
    const metrics = ringMetrics(ring);
    return {
      index,
      ring,
      area: metrics.area,
      bounds: metrics.bounds,
      properties: feature.properties || {},
      height: Math.max(2.6, Number(feature.properties?.height) || 4.2),
      base: Math.max(0, Number(feature.properties?.min_height) || 0),
    };
  })
  .filter(Boolean);

const buildingGrid = new Map();
for (const building of buildings) {
  for (const cell of cellsForBounds(building.bounds)) addToGrid(buildingGrid, cell, building);
}

const enrichments = new Map();
for (const element of poiPayload.elements || []) {
  const coordinate = poiCoordinate(element);
  if (!coordinate) continue;
  const containing = (buildingGrid.get(gridKey(...coordinate)) || [])
    .filter((building) => pointInRing(coordinate, building.ring))
    .sort((left, right) => left.area - right.area)[0];
  if (!containing) continue;
  const current = enrichments.get(containing.index) || { tags: {}, name: null };
  current.tags = { ...current.tags, ...(element.tags || {}) };
  if (!current.name && element.tags?.name) current.name = element.tags.name;
  enrichments.set(containing.index, current);
}

const names = [];
const nameIndexes = new Map();
function nameIndex(name) {
  if (!name) return -1;
  const normalized = String(name).trim().replace(/\s+/g, " ").slice(0, 72);
  if (!normalized) return -1;
  if (!nameIndexes.has(normalized)) {
    nameIndexes.set(normalized, names.length);
    names.push(normalized);
  }
  return nameIndexes.get(normalized);
}

const walls = [];
const profileCounts = Object.fromEntries(PROFILE_NAMES.map((profile) => [profile, 0]));
let enrichedBuildings = 0;
let namedBuildings = 0;

for (const building of buildings) {
  if (building.area < 12 || ["storage_tank", "roof"].includes(building.properties.class)) continue;
  const enrichment = enrichments.get(building.index) || { tags: {}, name: null };
  if (enrichments.has(building.index)) enrichedBuildings += 1;
  const id = building.properties.id || building.index;
  const seed = hashString(id);
  const profile = facadeProfile(building, enrichment, seed);
  const floors = Math.max(1, Math.min(8, Math.round((building.height - building.base) / (profile === 5 ? 4.1 : 3.05))));
  const resolvedName = building.properties.name || enrichment.name;
  const resolvedNameIndex = nameIndex(resolvedName);
  if (resolvedNameIndex >= 0) namedBuildings += 1;
  const material = materialCode(enrichment.tags);
  const tone = toneCode(enrichment.tags);

  const candidates = [];
  for (let edgeIndex = 1; edgeIndex < building.ring.length; edgeIndex += 1) {
    let start = building.ring[edgeIndex - 1];
    let end = building.ring[edgeIndex];
    const latitude = (start[1] + end[1]) / 2;
    let [startX, startY] = projectedPoint(start, latitude);
    let [endX, endY] = projectedPoint(end, latitude);
    let dx = endX - startX;
    let dy = endY - startY;
    const length = Math.hypot(dx, dy);
    if (length < 3 || length > 140) continue;
    const midpoint = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
    const road = nearestRoad(midpoint, roadGrid);
    if (!road || road.distance > 125) continue;
    const leftNormal = [-dy / length, dx / length];
    if (leftNormal[0] * road.vector[0] + leftNormal[1] * road.vector[1] < 0) {
      [start, end] = [end, start];
      [startX, endX] = [endX, startX];
      [startY, endY] = [endY, startY];
      dx = endX - startX;
      dy = endY - startY;
    }
    candidates.push({
      midpoint,
      angle: Math.atan2(dy, dx),
      length,
      distance: road.distance,
    });
  }

  candidates.sort((left, right) => left.distance - right.distance || right.length - left.length);
  const selected = [];
  const facadeCount = building.area >= 560 || profile >= 3 ? 2 : 1;
  for (const candidate of candidates) {
    if (selected.length >= facadeCount) break;
    if (
      selected.some((other) => {
        const angleDifference = Math.abs(Math.sin(candidate.angle - other.angle));
        const separation = Math.hypot(
          (candidate.midpoint[0] - other.midpoint[0]) * METERS_PER_DEGREE * Math.cos((candidate.midpoint[1] * Math.PI) / 180),
          (candidate.midpoint[1] - other.midpoint[1]) * METERS_PER_DEGREE,
        );
        return angleDifference < 0.35 || separation < 4;
      })
    ) {
      continue;
    }
    selected.push(candidate);
  }

  for (const candidate of selected) {
    walls.push([
      round(candidate.midpoint[0], 7),
      round(candidate.midpoint[1], 7),
      round(candidate.angle, 5),
      round(candidate.length, 2),
      round(building.height, 2),
      round(building.base, 2),
      profile,
      seed,
      floors,
      round(candidate.distance, 1),
      resolvedNameIndex,
      material,
      tone,
    ]);
    profileCounts[PROFILE_NAMES[profile]] += 1;
  }
}

const payload = {
  version: 1,
  profiles: PROFILE_NAMES,
  names,
  walls,
};
const json = JSON.stringify(payload);
const metadata = {
  city: "Lima, Ohio",
  generatedAt: new Date().toISOString(),
  sources: [
    "Overture Maps building footprints, classes, names, and heights",
    "OpenStreetMap drivable street geometry",
    "OpenStreetMap named POIs and volunteered building material/color tags",
  ],
  license: "ODbL 1.0; source attributions documented in DATA_LICENSE.md",
  counts: {
    buildings: buildings.length,
    streetFacingWalls: walls.length,
    namedBuildings,
    uniqueNames: names.length,
    osmEnrichedBuildings: enrichedBuildings,
    profiles: profileCounts,
  },
  note: "Wall alignment, opening layouts, trim, awnings, and untagged materials are deterministic visualization proxies. Names and explicit material/color tags are retained where volunteered in source data.",
};

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "lima-facades.json"), json),
  writeFile(path.join(outputDirectory, "lima-facades.json.gz"), gzipSync(json, { level: 9 })),
  writeFile(path.join(outputDirectory, "lima-facades-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
]);
console.log(JSON.stringify({ outputDirectory, ...metadata }, null, 2));
