import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const RELEASE = "2026-06-17.0";
const DATASET = `s3://overturemaps-us-west-2/release/${RELEASE}/theme=buildings/type=building/*`;
const BOUNDS = [-84.1650988, 40.687659, -84.0708798, 40.7956561];
const OUTPUT_DIRECTORY = path.resolve(process.argv[2] || "public/data");
const OUTPUT_PM_TILES = path.join(OUTPUT_DIRECTORY, "lima-buildings.pmtiles");
const OUTPUT_METADATA = path.join(OUTPUT_DIRECTORY, "lima-buildings-metadata.json");
const CACHED_SOURCE = path.resolve("data/source/lima-buildings.geojsonseq");
const FROM_CACHE = process.argv.includes("--from-cache");
const MINIMUM_PLAUSIBLE_HEIGHT = 2.2;

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sourceQuery() {
  const [west, south, east, north] = BOUNDS;
  return `
    SELECT
      id,
      names.primary AS name,
      class,
      subtype,
      ROUND(COALESCE(
        height,
        CASE
          WHEN class IN ('church', 'cathedral') THEN 12.0
          WHEN class IN ('hospital', 'office', 'commercial') THEN 8.5
          WHEN subtype IN ('industrial', 'civic') THEN 7.0
          ELSE 4.2
        END
      ), 2) AS height,
      ROUND(COALESCE(min_height, 0), 2) AS min_height,
      CASE WHEN height IS NULL THEN 'inferred' ELSE 'measured' END AS height_source,
      CASE
        WHEN subtype = 'industrial' OR class IN ('warehouse', 'industrial') THEN 'industrial'
        WHEN subtype IN ('civic', 'medical', 'religious') OR class IN ('church', 'hospital', 'office', 'commercial') THEN 'urban'
        ELSE 'residential'
      END AS facade_type,
      CAST(hash(id) % 8 AS INTEGER) AS material_variant,
      geometry
    FROM read_parquet(${sqlString(DATASET)}, filename=true, hive_partitioning=1)
    WHERE
      is_underground IS NOT TRUE
      AND bbox.xmin < ${east}
      AND bbox.xmax > ${west}
      AND bbox.ymin < ${north}
      AND bbox.ymax > ${south}
  `;
}

async function assertTool(tool) {
  try {
    await execFileAsync(tool, ["--version"], { timeout: 60_000 });
  } catch {
    throw new Error(`${tool} is required. Install it before rebuilding the measured building tiles.`);
  }
}

function fallbackHeight(properties) {
  if (["church", "cathedral"].includes(properties.class)) return 12;
  if (["hospital", "office", "commercial"].includes(properties.class)) return 8.5;
  if (["industrial", "civic"].includes(properties.subtype)) return 7;
  if (["roof", "shed", "garage", "greenhouse"].includes(properties.class)) return 2.8;
  return 4.2;
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function normalizeSequence(filename) {
  const lines = (await readFile(filename, "utf8")).trim().split(/\r?\n/);
  const normalized = lines.map((line) => {
    const feature = JSON.parse(line);
    const properties = feature.properties;
    properties.material_variant = hashString(properties.id || feature.id) % 8;
    const sourceHeight = properties.height_source === "inferred" ? null : properties.raw_height ?? properties.height;
    if (Number.isFinite(sourceHeight)) properties.raw_height = sourceHeight;
    if (sourceHeight === null) {
      properties.height = fallbackHeight(properties);
      properties.height_source = "inferred";
    } else if (sourceHeight < MINIMUM_PLAUSIBLE_HEIGHT) {
      properties.height = fallbackHeight(properties);
      properties.height_source = "normalized";
    } else {
      properties.height = sourceHeight;
      properties.height_source = "measured";
    }
    return JSON.stringify(feature);
  });
  await writeFile(filename, `${normalized.join("\n")}\n`);
}

await Promise.all([assertTool("duckdb"), assertTool("tippecanoe")]);
await mkdir(OUTPUT_DIRECTORY, { recursive: true });

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lima-buildings-"));
const geojsonSequence = path.join(temporaryDirectory, "lima-buildings.geojsonseq");

try {
  const exportSql = `
    INSTALL spatial;
    INSTALL httpfs;
    LOAD spatial;
    LOAD httpfs;
    SET s3_region='us-west-2';
    SET geometry_always_xy=true;
    COPY (${sourceQuery()}) TO ${sqlString(geojsonSequence)}
      WITH (FORMAT GDAL, DRIVER 'GeoJSONSeq');
  `;

  if (FROM_CACHE) {
    console.log(`Reusing cached Overture buildings release ${RELEASE}…`);
    await copyFile(CACHED_SOURCE, geojsonSequence);
  } else {
    console.log(`Fetching Overture buildings release ${RELEASE}…`);
    await execFileAsync("duckdb", ["-c", exportSql], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 15 * 60_000,
    });
  }
  await normalizeSequence(geojsonSequence);
  const sourceDirectory = path.resolve("data/source");
  await mkdir(sourceDirectory, { recursive: true });
  await copyFile(geojsonSequence, path.join(sourceDirectory, "lima-buildings.geojsonseq"));

  console.log("Packaging measured buildings as range-streamed PMTiles…");
  await execFileAsync(
    "tippecanoe",
    [
      "--force",
      "--output",
      OUTPUT_PM_TILES,
      "--layer",
      "buildings",
      "--minimum-zoom",
      "13",
      "--maximum-zoom",
      "18",
      "--drop-densest-as-needed",
      "--extend-zooms-if-still-dropping",
      "--detect-shared-borders",
      "--simplification",
      "2",
      "--exclude",
      "raw_height",
      geojsonSequence,
    ],
    { maxBuffer: 16 * 1024 * 1024, timeout: 15 * 60_000 },
  );

  const features = (await readFile(geojsonSequence, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line).properties);
  const measured = features.filter((properties) => properties.height_source === "measured");
  const normalized = features.filter((properties) => properties.height_source === "normalized");
  const sourceHeights = [...measured, ...normalized];
  const counts = {
    buildings: features.length,
    measured_heights: measured.length,
    source_heights: sourceHeights.length,
    normalized_low_heights: normalized.length,
    inferred_heights: features.length - sourceHeights.length,
    average_measured_height: Number(
      (sourceHeights.reduce((sum, properties) => sum + properties.raw_height, 0) / sourceHeights.length).toFixed(2),
    ),
  };
  const metadata = {
    city: "Lima, Ohio",
    bounds: BOUNDS,
    generatedAt: new Date().toISOString(),
    source: "Overture Maps buildings",
    release: RELEASE,
    license: "ODbL 1.0; source attributions documented in DATA_LICENSE.md",
    counts,
    note: `Source height values below ${MINIMUM_PLAUSIBLE_HEIGHT} m are labeled normalized and use class-aware visualization defaults. Missing heights remain labeled inferred.`,
  };
  await writeFile(OUTPUT_METADATA, `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT_PM_TILES, ...metadata }, null, 2));
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
