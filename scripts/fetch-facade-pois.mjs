import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [, , outputPath = "data/source/lima-facade-pois-overpass.json"] = process.argv;
const bbox = "(40.6876590,-84.1650988,40.7956561,-84.0708798)";
const query = `[out:json][timeout:240];
(
nwr["name"]["amenity"]${bbox};
nwr["name"]["shop"]${bbox};
nwr["name"]["tourism"]${bbox};
nwr["name"]["office"]${bbox};
nwr["name"]["craft"]${bbox};
nwr["name"]["leisure"]${bbox};
nwr["name"]["healthcare"]${bbox};
nwr["name"]["building"]${bbox};
nwr["building:material"]${bbox};
nwr["building:colour"]${bbox};
);
out center tags;`;

const endpoints = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

async function request(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 270_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "User-Agent": "Lima3D/1.0 (github.com/Alyx-Clark)",
      },
      body: new URLSearchParams({ data: query }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${endpoint} returned ${response.status}`);
    const payload = await response.text();
    JSON.parse(payload);
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

let payload;
let lastError;
for (const endpoint of endpoints) {
  try {
    payload = await request(endpoint);
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
