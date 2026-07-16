const CENTER = [-84.105006, 40.7399785];
const EARTH_METERS_PER_DEGREE = 111_320;
const CHUNK_METERS = 650;
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

const PALETTES = {
  day: {
    trunk: "#79583d",
    lower: ["#397d45", "#478d50", "#55985b", "#66884f"],
    upper: ["#4c9859", "#5aa663", "#69b16e", "#799b60"],
  },
  golden: {
    trunk: "#805c3b",
    lower: ["#50713b", "#5d7d40", "#6c8746", "#7b8248"],
    upper: ["#66844a", "#738f50", "#839956", "#918f54"],
  },
  night: {
    trunk: "#3c3028",
    lower: ["#1c402b", "#254b32", "#2d563a", "#36513a"],
    upper: ["#28543a", "#326044", "#3b6a4b", "#49634a"],
  },
};

const TREE_LAYER_IDS = ["lima-lidar-tree-trunks", "lima-lidar-tree-lower", "lima-lidar-tree-upper"];

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
      chunks.set(key, {
        key,
        bounds: [longitude, latitude, longitude, latitude],
        trees: [],
      });
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

function intersects(bounds, view) {
  return bounds[0] <= view[2] && bounds[2] >= view[0] && bounds[1] <= view[3] && bounds[3] >= view[1];
}

function paddedViewBounds(map) {
  const bounds = map.getBounds();
  const west = bounds.getWest();
  const south = bounds.getSouth();
  const east = bounds.getEast();
  const north = bounds.getNorth();
  const longitudePadding = (east - west) * 0.3;
  const latitudePadding = (north - south) * 0.3;
  return [west - longitudePadding, south - latitudePadding, east + longitudePadding, north + latitudePadding];
}

function deterministicNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function ring(longitude, latitude, radius, sides, angleOffset, shape = {}) {
  const longitudeScale = 1 / (EARTH_METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const latitudeScale = 1 / EARTH_METERS_PER_DEGREE;
  const roughness = shape.roughness || 0;
  const aspect = shape.aspect || 1;
  const seed = shape.seed || 0;
  const coordinates = [];
  for (let side = 0; side < sides; side += 1) {
    const angle = angleOffset + (side / sides) * Math.PI * 2;
    const radialVariation = 1 + (deterministicNoise(seed + side * 17.17) - 0.5) * roughness;
    const shapedRadius = radius * radialVariation;
    coordinates.push([
      longitude + Math.cos(angle) * shapedRadius * aspect * longitudeScale,
      latitude + Math.sin(angle) * shapedRadius * (2 - aspect) * latitudeScale,
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
    geometry: {
      type: "Polygon",
      coordinates: [ring(longitude, latitude, radius, sides, angleOffset, shape)],
    },
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
    partFeature(tree, "trunk", trunkRadius, 0, trunkHeight, 7, angle),
    partFeature(tree, "lower", crownRadius, trunkHeight * 0.62, height * 0.81, 11, angle, {
      aspect,
      roughness: 0.22,
      seed: crownSeed,
    }),
    partFeature(tree, "upper", crownRadius * 0.7, height * 0.54, height, 10, angle + 0.19, {
      aspect: 2 - aspect,
      roughness: 0.28,
      seed: crownSeed + 503,
    }),
  ];
}

function colorExpression(colors) {
  return ["match", ["get", "variant"], 0, colors[0], 1, colors[1], 2, colors[2], colors[3]];
}

function cameraBatchLimit(zoom, reduced) {
  if (reduced) return 2_800;
  if (zoom < 15.35) return 4_500;
  if (zoom < 16.3) return 8_500;
  return 13_000;
}

function selectVisibleTrees(map, chunks, reduced) {
  const view = paddedViewBounds(map);
  const center = map.getCenter();
  const limit = cameraBatchLimit(map.getZoom(), reduced);
  const visibleChunks = chunks
    .filter((chunk) => intersects(chunk.bounds, view))
    .sort((left, right) => {
      const leftDistance = Math.hypot(
        (left.bounds[0] + left.bounds[2]) / 2 - center.lng,
        (left.bounds[1] + left.bounds[3]) / 2 - center.lat,
      );
      const rightDistance = Math.hypot(
        (right.bounds[0] + right.bounds[2]) / 2 - center.lng,
        (right.bounds[1] + right.bounds[3]) / 2 - center.lat,
      );
      return leftDistance - rightDistance;
    });

  const trees = [];
  for (const chunk of visibleChunks) {
    const remaining = limit - trees.length;
    if (remaining <= 0) break;
    trees.push(...chunk.trees.slice(0, remaining).map((entry) => entry.raw));
  }
  return trees;
}

function addLayers(map, beforeId) {
  map.addLayer(
    {
      id: "lima-lidar-tree-trunks",
      type: "fill-extrusion",
      source: "lima-lidar-trees",
      minzoom: 15.7,
      filter: ["==", ["get", "part"], "trunk"],
      paint: {
        "fill-extrusion-color": PALETTES.day.trunk,
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeId,
  );
  for (const part of ["lower", "upper"]) {
    map.addLayer(
      {
        id: `lima-lidar-tree-${part}`,
        type: "fill-extrusion",
        source: "lima-lidar-trees",
        minzoom: part === "upper" ? 15.05 : 14.7,
        filter: ["==", ["get", "part"], part],
        paint: {
          "fill-extrusion-color": colorExpression(PALETTES.day[part]),
          "fill-extrusion-base": ["get", "base"],
          "fill-extrusion-height": ["get", "height"],
          "fill-extrusion-opacity": 0.99,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      beforeId,
    );
  }
}

export function createTreeLayer(trees, options = {}) {
  const chunks = chunkTreeInventory(trees, options.chunkMeters || CHUNK_METERS);
  let map;
  let updateTimer;
  let moveEndHandler;
  let lastCameraKey = "";
  let theme = "day";

  const manager = {
    id: "lima-lidar-trees",
    enabled: true,
    reduced: false,
    totalTrees: trees.length,
    visibleTrees: 0,

    addTo(nextMap, beforeId) {
      map = nextMap;
      map.addSource("lima-lidar-trees", { type: "geojson", data: EMPTY_COLLECTION });
      addLayers(map, beforeId);
      this.setTheme(theme);
      map.on("move", this.scheduleUpdate);
      moveEndHandler = () => manager.update();
      map.on("moveend", moveEndHandler);
      this.update(true);
    },

    scheduleUpdate: () => {
      if (updateTimer) return;
      updateTimer = window.setTimeout(() => {
        updateTimer = undefined;
        manager.update();
      }, 280);
    },

    update(force = false) {
      if (!map?.getSource("lima-lidar-trees")) return;
      const zoom = map.getZoom();
      const minimumZoom = this.reduced ? 16.1 : 14.7;
      const center = map.getCenter();
      const cameraKey = [
        Math.round(center.lng / 0.0018),
        Math.round(center.lat / 0.0018),
        Math.round(map.getBearing() / 18),
        Math.floor(zoom * 2),
        this.enabled,
        this.reduced,
      ].join(":");
      if (!force && cameraKey === lastCameraKey) return;
      lastCameraKey = cameraKey;
      if (!this.enabled || zoom < minimumZoom) {
        this.visibleTrees = 0;
        map.getSource("lima-lidar-trees").setData(EMPTY_COLLECTION);
        return;
      }
      const visible = selectVisibleTrees(map, chunks, this.reduced);
      this.visibleTrees = visible.length;
      const features = visible.flatMap((tree, index) => treePartFeatures(tree, index));
      map.getSource("lima-lidar-trees").setData({ type: "FeatureCollection", features });
    },

    setTheme(nextTheme) {
      theme = PALETTES[nextTheme] ? nextTheme : "day";
      if (!map) return;
      const palette = PALETTES[theme];
      if (map.getLayer("lima-lidar-tree-trunks")) {
        map.setPaintProperty("lima-lidar-tree-trunks", "fill-extrusion-color", palette.trunk);
      }
      for (const part of ["lower", "upper"]) {
        if (map.getLayer(`lima-lidar-tree-${part}`)) {
          map.setPaintProperty(
            `lima-lidar-tree-${part}`,
            "fill-extrusion-color",
            colorExpression(palette[part]),
          );
        }
      }
    },

    setVisible(nextVisible) {
      this.enabled = nextVisible;
      if (map) {
        for (const id of TREE_LAYER_IDS) {
          if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", nextVisible ? "visible" : "none");
        }
      }
      this.update(true);
    },

    setReduced(nextReduced) {
      this.reduced = nextReduced;
      this.update(true);
    },

    remove() {
      if (!map) return;
      window.clearTimeout(updateTimer);
      map.off("move", this.scheduleUpdate);
      map.off("moveend", moveEndHandler);
    },
  };

  return manager;
}
