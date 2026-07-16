import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , outputPath = "data/source/lima-overpass.json"] = process.argv;
const bbox = "(40.6876590,-84.1650988,40.7956561,-84.0708798)";
const query = `[out:json][timeout:180];
(
node["natural"="tree"]${bbox};
node["amenity"~"bench|bicycle_parking|waste_basket"]${bbox};
node["highway"~"street_lamp|traffic_signals|crossing|bus_stop"]${bbox};
node["emergency"="fire_hydrant"]${bbox};
way["barrier"="hedge"]${bbox};
way["highway"~"footway|path|pedestrian|steps"]${bbox};
way["footway"]${bbox};
way["sidewalk"]${bbox};
way["leisure"~"park|playground|pitch|garden"]${bbox};
way["landuse"~"forest|grass|meadow|recreation_ground|cemetery"]${bbox};
);
out tags geom;`;

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function request(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 210_000);
  try {
    const body = new URLSearchParams({ data: query });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Lima3D/1.0 (github.com/Alyx-Clark)",
      },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

let payload;
let lastError;
for (const endpoint of endpoints) {
  try {
    payload = await request(endpoint);
    JSON.parse(payload);
    break;
  } catch (error) {
    lastError = error;
    console.warn(error.message);
  }
}

if (!payload) throw lastError || new Error("All Overpass endpoints failed");
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, payload);
console.log(`Saved ${Buffer.byteLength(payload).toLocaleString()} bytes to ${outputPath}`);
