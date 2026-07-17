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
