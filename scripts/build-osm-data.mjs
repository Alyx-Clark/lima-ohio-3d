import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { gzipSync } from "node:zlib";

const [, , inputPath, outputDirectory = "public/data"] = process.argv;

if (!inputPath) {
  throw new Error("Usage: node scripts/build-osm-data.mjs <overpass.json> [output-directory]");
}

const CITY = {
  name: "Lima, Ohio",
  relationId: 182725,
  bounds: [-84.1650988, 40.687659, -84.0708798, 40.7956561],
};

const PEDESTRIAN_HIGHWAYS = new Set(["footway", "path", "pedestrian", "steps"]);
const FURNITURE_TAGS = new Set([
  "bench",
  "bicycle_parking",
  "waste_basket",
  "street_lamp",
  "traffic_signals",
  "crossing",
  "bus_stop",
  "fire_hydrant",
]);
const INFERRED_TREE_AREAS = new Set(["park", "garden", "forest"]);

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function metersToDegrees(latitude, meters) {
  return {
    lat: meters / 111_320,
    lng: meters / (111_320 * Math.cos((latitude * Math.PI) / 180)),
  };
}

function ringAround([lng, lat], radiusMeters, sides = 8) {
  const delta = metersToDegrees(lat, radiusMeters);
  const coordinates = Array.from({ length: sides }, (_, index) => {
    const angle = (index / sides) * Math.PI * 2;
    return [lng + Math.cos(angle) * delta.lng, lat + Math.sin(angle) * delta.lat];
  });
  coordinates.push(coordinates[0]);
  return coordinates;
}

function createTreeFeatures(coordinate, id, origin, random) {
  const totalHeight = 7 + random() * 8;
  const trunkHeight = totalHeight * (0.35 + random() * 0.12);
  const crownRadius = 2.2 + random() * 2.4;
  const colorVariant = Math.floor(random() * 3);
  const shared = { category: "tree", origin, treeId: id, colorVariant };

  return [
    {
      type: "Feature",
      id: `${id}-trunk`,
      properties: {
        ...shared,
        part: "trunk",
        height: Number(trunkHeight.toFixed(2)),
        base: 0,
      },
      geometry: {
        type: "Polygon",
        coordinates: [ringAround(coordinate, 0.42 + random() * 0.2, 6)],
      },
    },
    {
      type: "Feature",
      id: `${id}-crown`,
      properties: {
        ...shared,
        part: "crown",
        height: Number(totalHeight.toFixed(2)),
        base: Number((trunkHeight * 0.65).toFixed(2)),
      },
      geometry: {
        type: "Polygon",
        coordinates: [ringAround(coordinate, crownRadius, 9)],
      },
    },
  ];
}

function isClosed(coordinates) {
  if (coordinates.length < 4) return false;
  const first = coordinates[0];
  const last = coordinates.at(-1);
  return first[0] === last[0] && first[1] === last[1];
}

function pointInRing([x, y], ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function inferTreesForArea(feature, seed) {
  const ring = feature.geometry.coordinates[0];
  const lats = ring.map((coordinate) => coordinate[1]);
  const lngs = ring.map((coordinate) => coordinate[0]);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const kind = feature.properties.kind;
  const spacingMeters = kind === "forest" ? 21 : kind === "garden" ? 25 : 34;
  const spacing = metersToDegrees(centerLat, spacingMeters);
  const random = seededRandom(seed);
  const output = [];
  let sequence = 0;

  for (let lat = minLat + spacing.lat / 2; lat < maxLat; lat += spacing.lat) {
    for (let lng = minLng + spacing.lng / 2; lng < maxLng; lng += spacing.lng) {
      if (sequence >= 220) return output;
      const coordinate = [
        lng + (random() - 0.5) * spacing.lng * 0.72,
        lat + (random() - 0.5) * spacing.lat * 0.72,
      ];
      if (!pointInRing(coordinate, ring) || random() < 0.14) continue;
      output.push(...createTreeFeatures(coordinate, `inferred-${seed}-${sequence}`, "inferred", random));
      sequence += 1;
    }
  }

  return output;
}

function pointCategory(tags = {}) {
  const value = tags.amenity || tags.highway || tags.emergency;
  return FURNITURE_TAGS.has(value) ? value : null;
}

function createFurnitureExtrusion(coordinate, id, kind) {
  const dimensions = {
    bench: [0.55, 0.65],
    bicycle_parking: [0.34, 1.05],
    waste_basket: [0.3, 0.95],
    street_lamp: [0.18, 5.4],
    traffic_signals: [0.24, 4.5],
    crossing: [0.12, 0.18],
    bus_stop: [0.24, 3.1],
    fire_hydrant: [0.29, 0.9],
  };
  const [radius, height] = dimensions[kind] || [0.25, 1.2];
  return {
    type: "Feature",
    id: `${id}-structure`,
    properties: { category: "furniture-3d", kind, height },
    geometry: { type: "Polygon", coordinates: [ringAround(coordinate, radius, 7)] },
  };
}

function wayCoordinates(element) {
  return (element.geometry || [])
    .filter((point) => Number.isFinite(point.lon) && Number.isFinite(point.lat))
    .map((point) => [point.lon, point.lat]);
}

function sanitizeProperties(tags = {}) {
  const keep = ["name", "surface", "access", "lit", "wheelchair", "sidewalk", "footway"];
  return Object.fromEntries(keep.filter((key) => tags[key] !== undefined).map((key) => [key, tags[key]]));
}

async function fetchBoundary() {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("city", "Lima");
  url.searchParams.set("state", "Ohio");
  url.searchParams.set("country", "USA");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("polygon_geojson", "1");
  url.searchParams.set("limit", "1");
  const response = await fetch(url, { headers: { "User-Agent": "Lima3D/1.0 (github.com/Alyx-Clark)" } });
  if (!response.ok) throw new Error(`Nominatim boundary request failed: ${response.status}`);
  const [result] = await response.json();
  if (!result?.geojson) throw new Error("Lima boundary was not returned by Nominatim");
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: `relation-${CITY.relationId}`,
        properties: { name: CITY.name, osmRelationId: CITY.relationId },
        geometry: result.geojson,
      },
    ],
  };
}

const raw = JSON.parse(await readFile(inputPath, "utf8"));
const features = [];
const greenAreas = [];
const counts = {
  pedestrianWays: 0,
  sidewalkTaggedRoads: 0,
  greenAreas: 0,
  hedges: 0,
  furniture: 0,
  mappedTrees: 0,
  inferredTrees: 0,
};

for (const element of raw.elements || []) {
  const tags = element.tags || {};
  const featureId = `${element.type}-${element.id}`;

  if (element.type === "node") {
    if (tags.natural === "tree") {
      const random = seededRandom(element.id);
      features.push(...createTreeFeatures([element.lon, element.lat], featureId, "mapped", random));
      counts.mappedTrees += 1;
      continue;
    }

    const category = pointCategory(tags);
    if (!category) continue;
    const coordinate = [element.lon, element.lat];
    features.push(createFurnitureExtrusion(coordinate, featureId, category));
    features.push({
      type: "Feature",
      id: featureId,
      properties: { category: "furniture", kind: category, ...sanitizeProperties(tags) },
      geometry: { type: "Point", coordinates: coordinate },
    });
    counts.furniture += 1;
    continue;
  }

  if (element.type !== "way") continue;
  const coordinates = wayCoordinates(element);
  if (coordinates.length < 2) continue;

  if (PEDESTRIAN_HIGHWAYS.has(tags.highway)) {
    features.push({
      type: "Feature",
      id: featureId,
      properties: {
        category: "pedestrian",
        kind: tags.highway,
        width: Number.parseFloat(tags.width) || (tags.highway === "pedestrian" ? 4 : 2.1),
        ...sanitizeProperties(tags),
      },
      geometry: { type: "LineString", coordinates },
    });
    counts.pedestrianWays += 1;
    continue;
  }

  if (tags.sidewalk || tags.footway) {
    counts.sidewalkTaggedRoads += 1;
    continue;
  }

  if (tags.barrier === "hedge") {
    features.push({
      type: "Feature",
      id: featureId,
      properties: { category: "hedge", kind: "hedge", ...sanitizeProperties(tags) },
      geometry: { type: "LineString", coordinates },
    });
    counts.hedges += 1;
    continue;
  }

  const kind = tags.leisure || tags.landuse;
  if (!kind || !isClosed(coordinates)) continue;
  const greenFeature = {
    type: "Feature",
    id: featureId,
    properties: { category: "green-space", kind, ...sanitizeProperties(tags) },
    geometry: { type: "Polygon", coordinates: [coordinates] },
  };
  features.push(greenFeature);
  greenAreas.push(greenFeature);
  counts.greenAreas += 1;
}

for (const area of greenAreas) {
  if (!INFERRED_TREE_AREAS.has(area.properties.kind)) continue;
  const seed = Number(String(area.id).split("-").at(-1)) || 1;
  const trees = inferTreesForArea(area, seed);
  features.push(...trees);
  counts.inferredTrees += trees.length / 2;
}

const boundary = await fetchBoundary();
const detail = {
  type: "FeatureCollection",
  name: "Lima, Ohio local detail",
  features,
};
const metadata = {
  city: CITY,
  generatedAt: new Date().toISOString(),
  osmTimestamp: raw.osm3s?.timestamp_osm_base || null,
  source: "OpenStreetMap via Overpass API and Nominatim",
  license: "ODbL 1.0",
  counts,
  note: "Inferred trees are deterministic visual proxies inside mapped parks, gardens, and forests; they are not surveyed tree locations.",
};
const detailJson = JSON.stringify(detail);

await mkdir(outputDirectory, { recursive: true });
await Promise.all([
  writeFile(path.join(outputDirectory, "lima-detail.json"), detailJson),
  writeFile(path.join(outputDirectory, "lima-detail.json.gz"), gzipSync(detailJson, { level: 9 })),
  writeFile(path.join(outputDirectory, "lima-boundary.json"), JSON.stringify(boundary)),
  writeFile(path.join(outputDirectory, "lima-metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`),
]);

console.log(JSON.stringify({ outputDirectory, features: features.length, counts }, null, 2));
