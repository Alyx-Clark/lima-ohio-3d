const CENTER = [-84.105006, 40.7399785];
const EARTH_METERS_PER_DEGREE = 111_320;
const CHUNK_METERS = 650;

export function localMeters(longitude, latitude, center = CENTER) {
  return [
    (longitude - center[0]) * EARTH_METERS_PER_DEGREE * Math.cos((center[1] * Math.PI) / 180),
    (latitude - center[1]) * EARTH_METERS_PER_DEGREE,
  ];
}

export function chunkTreeInventory(trees, chunkMeters = CHUNK_METERS) {
  const chunks = new Map();
  for (const tree of trees) {
    const [longitude, latitude] = tree;
    const [x, y] = localMeters(longitude, latitude);
    const key = `${Math.floor(x / chunkMeters)}:${Math.floor(y / chunkMeters)}`;
    if (!chunks.has(key)) {
      chunks.set(key, { key, bounds: [longitude, latitude, longitude, latitude], trees: [] });
    }
    const chunk = chunks.get(key);
    chunk.bounds[0] = Math.min(chunk.bounds[0], longitude);
    chunk.bounds[1] = Math.min(chunk.bounds[1], latitude);
    chunk.bounds[2] = Math.max(chunk.bounds[2], longitude);
    chunk.bounds[3] = Math.max(chunk.bounds[3], latitude);
    chunk.trees.push({ raw: tree, x, y });
  }
  return [...chunks.values()];
}

function deterministicNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function ring(longitude, latitude, radius, sides, angleOffset, shape = {}) {
  const longitudeScale = 1 / (EARTH_METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const latitudeScale = 1 / EARTH_METERS_PER_DEGREE;
  const coordinates = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = angleOffset + (side / sides) * Math.PI * 2;
    const radialVariation = 1 + (deterministicNoise((shape.seed || 0) + side * 17.17) - 0.5) * (shape.roughness || 0);
    const shapedRadius = radius * radialVariation;
    coordinates.push([
      Number((longitude + Math.cos(angle) * shapedRadius * (shape.aspect || 1) * longitudeScale).toFixed(7)),
      Number((latitude + Math.sin(angle) * shapedRadius * (2 - (shape.aspect || 1)) * latitudeScale).toFixed(7)),
    ]);
  }
  coordinates.push(coordinates[0]);
  return coordinates;
}

function partFeature(tree, part, radius, base, height, sides, angleOffset, shape) {
  const [longitude, latitude, , , variant] = tree;
  return {
    type: "Feature",
    properties: { part, variant, base: Number(base.toFixed(2)), height: Number(height.toFixed(2)) },
    geometry: { type: "Polygon", coordinates: [ring(longitude, latitude, radius, sides, angleOffset, shape)] },
  };
}

export function treePartFeatures(tree, index = 0) {
  const [, , height, crownRadius, variant] = tree;
  const trunkHeight = Math.max(1.8, height * 0.44);
  const trunkRadius = Math.max(0.16, Math.min(0.48, height * 0.026));
  const angle = ((variant * 71 + index * 29) % 360) * (Math.PI / 180);
  const aspect = 0.86 + deterministicNoise(variant * 101 + index * 7.3) * 0.28;
  const crownSeed = variant * 1_009 + index * 31;
  return [
    partFeature(tree, "trunk", trunkRadius, 0, trunkHeight, 5, angle),
    partFeature(tree, "lower", crownRadius * 0.88, height * 0.48, height * 0.73, 10, angle, {
      aspect,
      roughness: 0.22,
      seed: crownSeed,
    }),
    partFeature(tree, "middle", crownRadius, height * 0.57, height * 0.86, 11, angle + 0.11, {
      aspect: 0.94 + (aspect - 1) * 0.5,
      roughness: 0.25,
      seed: crownSeed + 251,
    }),
    partFeature(tree, "upper", crownRadius * 0.56, height * 0.7, height, 8, angle + 0.23, {
      aspect: 2 - aspect,
      roughness: 0.3,
      seed: crownSeed + 503,
    }),
  ];
}
