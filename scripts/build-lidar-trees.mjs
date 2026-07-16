import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const execFileAsync = promisify(execFile);

const EARTH_RADIUS = 6_378_137;
const CITY_BOUNDS = [-84.1650988, 40.687659, -84.0708798, 40.7956561];
const LIDAR_SOURCES = [
  {
    id: "OH_Statewide_Phase1_2_2019",
    url: "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/OH_Statewide_Phase1_2_2019/ept.json",
  },
  {
    id: "OH_Statewide_Phase1_5_2019",
    url: "https://s3-us-west-2.amazonaws.com/usgs-lidar-public/OH_Statewide_Phase1_5_2019/ept.json",
  },
];
const OUTPUT_DIRECTORY = path.resolve(process.argv.find((argument) => !argument.startsWith("--") && argument !== process.argv[1] && argument !== process.argv[0]) || "public/data");
const SAMPLE_MODE = process.argv.includes("--sample");
const BUILDING_SOURCE = path.resolve("data/source/lima-buildings.geojsonseq");
const INDEX_CELL_DEGREES = 0.002;
const MINIMUM_TREE_HEIGHT = 4.2;
const TREE_SPACING = 6.2;
const PROCESSING_TILE_SIZE = 1_800;
const TILE_OVERLAP = 24;

function project([longitude, latitude]) {
  return [
    (longitude * Math.PI * EARTH_RADIUS) / 180,
    EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (latitude * Math.PI) / 360)),
  ];
}

function unproject([x, y]) {
  return [
    (x / EARTH_RADIUS) * (180 / Math.PI),
    (2 * Math.atan(Math.exp(y / EARTH_RADIUS)) - Math.PI / 2) * (180 / Math.PI),
  ];
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

function pointInGeometry(point, geometry) {
  const polygons = geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
  return polygons.some((polygon) => pointInRing(point, polygon[0]) && !polygon.slice(1).some((ring) => pointInRing(point, ring)));
}

function geometryBounds(geometry) {
  const coordinates = [];
  const collect = (value) => {
    if (typeof value[0] === "number") coordinates.push(value);
    else value.forEach(collect);
  };
  collect(geometry.coordinates);
  return [
    Math.min(...coordinates.map(([longitude]) => longitude)),
    Math.min(...coordinates.map(([, latitude]) => latitude)),
    Math.max(...coordinates.map(([longitude]) => longitude)),
    Math.max(...coordinates.map(([, latitude]) => latitude)),
  ];
}

function indexKey(longitude, latitude) {
  return `${Math.floor(longitude / INDEX_CELL_DEGREES)}:${Math.floor(latitude / INDEX_CELL_DEGREES)}`;
}

async function loadBuildingIndex() {
  let source;
  try {
    source = await readFile(BUILDING_SOURCE, "utf8");
  } catch {
    throw new Error("data/source/lima-buildings.geojsonseq is required to mask roof returns. Run npm run data:buildings first.");
  }
  const index = new Map();
  for (const line of source.trim().split(/\r?\n/)) {
    const geometry = JSON.parse(line).geometry;
    const [west, south, east, north] = geometryBounds(geometry);
    for (let longitude = Math.floor(west / INDEX_CELL_DEGREES); longitude <= Math.floor(east / INDEX_CELL_DEGREES); longitude += 1) {
      for (let latitude = Math.floor(south / INDEX_CELL_DEGREES); latitude <= Math.floor(north / INDEX_CELL_DEGREES); latitude += 1) {
        const key = `${longitude}:${latitude}`;
        if (!index.has(key)) index.set(key, []);
        index.get(key).push(geometry);
      }
    }
  }
  return index;
}

function insideBuilding(point, index) {
  return (index.get(indexKey(point[0], point[1])) || []).some((geometry) => pointInGeometry(point, geometry));
}

function stableVariant(x, y) {
  const value = Math.imul(Math.round(x), 73_856_093) ^ Math.imul(Math.round(y), 19_349_663);
  return Math.abs(value) % 4;
}

async function assertPdal() {
  try {
    await execFileAsync("pdal", ["--version"], { timeout: 90_000 });
  } catch {
    throw new Error("PDAL is required. Install it before rebuilding the LiDAR tree inventory.");
  }
}

await assertPdal();
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lima-lidar-"));
const [southwest, northeast] = [project(CITY_BOUNDS.slice(0, 2)), project(CITY_BOUNDS.slice(2, 4))];
const center = project([-84.105006, 40.7399785]);

function boundsString([west, south, east, north], overlap = 0) {
  return `([${west - overlap},${east + overlap}],[${south - overlap},${north + overlap}])`;
}

function processingTiles() {
  if (SAMPLE_MODE) return [[center[0] - 450, center[1] - 450, center[0] + 450, center[1] + 450]];
  const tiles = [];
  for (let west = southwest[0]; west < northeast[0]; west += PROCESSING_TILE_SIZE) {
    for (let south = southwest[1]; south < northeast[1]; south += PROCESSING_TILE_SIZE) {
      tiles.push([
        west,
        south,
        Math.min(west + PROCESSING_TILE_SIZE, northeast[0]),
        Math.min(south + PROCESSING_TILE_SIZE, northeast[1]),
      ]);
    }
  }
  return tiles;
}

function sourcesForTile(tile) {
  const [, south] = unproject(tile.slice(0, 2));
  const [, north] = unproject(tile.slice(2, 4));
  if (north <= 40.7276) return [LIDAR_SOURCES[1]];
  if (south >= 40.74) return [LIDAR_SOURCES[0]];
  return LIDAR_SOURCES;
}

function pipelineFor(tile, candidatesPath, source) {
  return {
    pipeline: [
      {
        type: "readers.ept",
        filename: source.url,
        bounds: boundsString(tile, SAMPLE_MODE ? 0 : TILE_OVERLAP),
        resolution: SAMPLE_MODE ? 2.2 : 2.8,
        requests: 12,
        ignore_unreadable: true,
      },
      { type: "filters.hag_nn", count: 8, max_distance: 24 },
      {
        type: "filters.expression",
        expression: `Classification == 1 && HeightAboveGround >= ${MINIMUM_TREE_HEIGHT} && HeightAboveGround <= 45`,
      },
      { type: "filters.sort", dimension: "HeightAboveGround", order: "DESC" },
      { type: "filters.assign", value: "Z = 0" },
      { type: "filters.sample", radius: TREE_SPACING },
      {
        type: "writers.text",
        filename: candidatesPath,
        format: "csv",
        order: "X:2,Y:2,HeightAboveGround:2,Classification:0",
        keep_unspecified: false,
        quote_header: false,
      },
    ],
  };
}

async function processTile(job, index, total) {
  const pipelinePath = path.join(temporaryDirectory, `tree-pipeline-${index}.json`);
  const candidatesPath = path.join(temporaryDirectory, `tree-candidates-${index}.csv`);
  await writeFile(pipelinePath, JSON.stringify(pipelineFor(job.tile, candidatesPath, job.source)));
  let stderr = "";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      ({ stderr } = await execFileAsync("pdal", ["pipeline", pipelinePath], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: SAMPLE_MODE ? 5 * 60_000 : 12 * 60_000,
      }));
      break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.warn(`Retrying LiDAR tile ${index + 1}/${total} after attempt ${attempt}…`);
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000));
    }
  }
  if (stderr.trim()) console.error(stderr.trim());
  console.log(`LiDAR tile ${index + 1}/${total} complete · ${job.source.id}`);
  return candidatesPath;
}

async function processTiles(jobs) {
  const output = new Array(jobs.length);
  let next = 0;
  const concurrency = SAMPLE_MODE ? 1 : Math.min(6, jobs.length);
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const index = next;
        next += 1;
        output[index] = await processTile(jobs[index], index, jobs.length);
      }
    }),
  );
  return output;
}

function nearbyAccepted(x, y, acceptedIndex) {
  const cellX = Math.floor(x / TREE_SPACING);
  const cellY = Math.floor(y / TREE_SPACING);
  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
      const nearby = acceptedIndex.get(`${cellX + offsetX}:${cellY + offsetY}`) || [];
      if (nearby.some(([otherX, otherY]) => Math.hypot(x - otherX, y - otherY) < TREE_SPACING)) return true;
    }
  }
  return false;
}

try {
  const tiles = processingTiles();
  const jobs = SAMPLE_MODE
    ? [{ source: LIDAR_SOURCES[0], tile: tiles[0] }]
    : tiles.flatMap((tile) => sourcesForTile(tile).map((source) => ({ source, tile })));
  console.log(`${SAMPLE_MODE ? "Sampling" : `Processing ${jobs.length} work-unit tiles of`} classified Ohio QL1 LiDAR canopy…`);
  const candidatePaths = await processTiles(jobs);

  const boundary = JSON.parse(await readFile(path.join(OUTPUT_DIRECTORY, "lima-boundary.json"), "utf8"));
  const geometry = boundary.features[0].geometry;
  const buildingIndex = await loadBuildingIndex();
  const candidates = [];
  for (const candidatePath of candidatePaths) {
    const lines = (await readFile(candidatePath, "utf8")).trim().split(/\r?\n/);
    for (const line of lines.slice(1)) {
      const [x, y, rawHeight] = line.split(",").map(Number);
      if ([x, y, rawHeight].every(Number.isFinite)) candidates.push([x, y, rawHeight]);
    }
  }
  candidates.sort((a, b) => b[2] - a[2]);

  const trees = [];
  const acceptedIndex = new Map();
  let rejectedBuildingReturns = 0;
  let rejectedDuplicateReturns = 0;

  for (const [x, y, rawHeight] of candidates) {
    const [longitude, latitude] = unproject([x, y]);
    if (!SAMPLE_MODE && !pointInGeometry([longitude, latitude], geometry)) continue;
    if (insideBuilding([longitude, latitude], buildingIndex)) {
      rejectedBuildingReturns += 1;
      continue;
    }
    if (nearbyAccepted(x, y, acceptedIndex)) {
      rejectedDuplicateReturns += 1;
      continue;
    }
    const cellKey = `${Math.floor(x / TREE_SPACING)}:${Math.floor(y / TREE_SPACING)}`;
    if (!acceptedIndex.has(cellKey)) acceptedIndex.set(cellKey, []);
    acceptedIndex.get(cellKey).push([x, y]);

    const height = Math.min(38, Math.max(MINIMUM_TREE_HEIGHT, rawHeight));
    const crownRadius = Math.min(6.2, Math.max(1.7, height * 0.205));
    trees.push([
      Number(longitude.toFixed(7)),
      Number(latitude.toFixed(7)),
      Number(height.toFixed(1)),
      Number(crownRadius.toFixed(1)),
      stableVariant(x, y),
    ]);
  }

  trees.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (SAMPLE_MODE) {
    console.log(JSON.stringify({ sampleBounds: boundsString(tiles[0]), trees: trees.length, rejectedBuildingReturns, rejectedDuplicateReturns, firstTrees: trees.slice(0, 5) }, null, 2));
  } else {
    const source = {
      name: "USGS 3DEP / Ohio Statewide Phase 1 QL1 LiDAR",
      datasets: LIDAR_SOURCES.map(({ id }) => id),
      acquisition: "2019-11-04 to 2020-04-27",
      lidarQuality: "QL1",
      license: "U.S. Government public domain",
      method: "PDAL height-above-ground normalization followed by height-sorted Poisson canopy-apex selection; building-footprint masking removes roof returns",
    };
    const data = { schemaVersion: 1, generatedAt: new Date().toISOString(), source, trees };
    const json = JSON.stringify(data);
    await Promise.all([
      writeFile(path.join(OUTPUT_DIRECTORY, "lima-trees.json"), json),
      writeFile(path.join(OUTPUT_DIRECTORY, "lima-trees.json.gz"), gzipSync(json, { level: 9 })),
      writeFile(
        path.join(OUTPUT_DIRECTORY, "lima-trees-metadata.json"),
        `${JSON.stringify({ city: "Lima, Ohio", bounds: CITY_BOUNDS, generatedAt: data.generatedAt, source, counts: { lidarTreeCrowns: trees.length, rejectedBuildingReturns, rejectedDuplicateReturns } }, null, 2)}\n`,
      ),
    ]);
    console.log(JSON.stringify({ outputDirectory: OUTPUT_DIRECTORY, lidarTreeCrowns: trees.length, rejectedBuildingReturns, rejectedDuplicateReturns, source }, null, 2));
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
