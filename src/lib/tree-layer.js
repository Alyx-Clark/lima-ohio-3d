import { chunkTreeInventory, treePartFeatures } from "./tree-geometry.js";

const CHUNK_METERS = 650;
const EMPTY_COLLECTION = { type: "FeatureCollection", features: [] };

const PALETTES = {
  day: {
    trunk: "#79583d",
    lower: ["#397d45", "#478d50", "#55985b", "#66884f"],
    middle: ["#438b4f", "#519858", "#60a461", "#709059"],
    upper: ["#5aa663", "#69b16e", "#78bb79", "#86a76b"],
  },
  golden: {
    trunk: "#805c3b",
    lower: ["#3f7340", "#4c8047", "#598b4d", "#68804d"],
    middle: ["#4b8349", "#589050", "#659b56", "#74915a"],
    upper: ["#5d9554", "#6aa15c", "#78ac63", "#86a06a"],
  },
  night: {
    trunk: "#3c3028",
    lower: ["#1c402b", "#254b32", "#2d563a", "#36513a"],
    middle: ["#234b33", "#2c573b", "#346243", "#3e5c42"],
    upper: ["#326044", "#3b6a4b", "#457652", "#526e51"],
  },
};

const TREE_PARTS = ["lower", "middle", "upper"];
const TREE_LAYER_IDS = ["lima-lidar-tree-trunks", ...TREE_PARTS.map((part) => `lima-lidar-tree-${part}`)];

function intersects(bounds, view) {
  return bounds[0] <= view[2] && bounds[2] >= view[0] && bounds[1] <= view[3] && bounds[3] >= view[1];
}

function paddedViewBounds(map) {
  const bounds = map.getBounds();
  const longitudePadding = (bounds.getEast() - bounds.getWest()) * 0.3;
  const latitudePadding = (bounds.getNorth() - bounds.getSouth()) * 0.3;
  return [
    bounds.getWest() - longitudePadding,
    bounds.getSouth() - latitudePadding,
    bounds.getEast() + longitudePadding,
    bounds.getNorth() + latitudePadding,
  ];
}

function colorExpression(colors) {
  return ["match", ["get", "variant"], 0, colors[0], 1, colors[1], 2, colors[2], colors[3]];
}

function cameraBatchLimit(zoom, pitch, reduced) {
  if (reduced) return 2_800;
  if (zoom < 15.35) return 3_600;
  if (pitch >= 72) return 6_000;
  if (zoom < 16.3) return 6_800;
  return 8_500;
}

function selectVisibleTrees(map, chunks, reduced) {
  const view = paddedViewBounds(map);
  const center = map.getCenter();
  const limit = cameraBatchLimit(map.getZoom(), map.getPitch(), reduced);
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
  const minimumZoom = { lower: 14.7, middle: 15.05, upper: 15.45 };
  for (const part of TREE_PARTS) {
    map.addLayer(
      {
        id: `lima-lidar-tree-${part}`,
        type: "fill-extrusion",
        source: "lima-lidar-trees",
        minzoom: minimumZoom[part],
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
  let moveHandler;
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
      moveHandler = () => this.scheduleUpdate(380);
      moveEndHandler = () => this.scheduleUpdate(80);
      map.on("move", moveHandler);
      map.on("moveend", moveEndHandler);
      this.update(true);
    },

    scheduleUpdate(delay = 180) {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => {
        updateTimer = undefined;
        this.update();
      }, delay);
    },

    update(force = false) {
      const source = map?.getSource("lima-lidar-trees");
      if (!source) return;
      const zoom = map.getZoom();
      const center = map.getCenter();
      const cameraKey = [
        Math.round(center.lng / 0.0018),
        Math.round(center.lat / 0.0018),
        Math.round(map.getBearing() / 18),
        Math.floor(zoom * 2),
        Math.floor(map.getPitch() / 12),
        this.enabled,
        this.reduced,
      ].join(":");
      if (!force && cameraKey === lastCameraKey) return;
      lastCameraKey = cameraKey;
      if (!this.enabled || zoom < (this.reduced ? 16.1 : 14.7)) {
        this.visibleTrees = 0;
        source.setData(EMPTY_COLLECTION);
        return;
      }
      const visible = selectVisibleTrees(map, chunks, this.reduced);
      this.visibleTrees = visible.length;
      source.setData({
        type: "FeatureCollection",
        features: visible.flatMap((tree, index) => treePartFeatures(tree, index)),
      });
    },

    setTheme(nextTheme) {
      theme = PALETTES[nextTheme] ? nextTheme : "day";
      if (!map) return;
      const palette = PALETTES[theme];
      if (map.getLayer("lima-lidar-tree-trunks")) {
        map.setPaintProperty("lima-lidar-tree-trunks", "fill-extrusion-color", palette.trunk);
      }
      for (const part of TREE_PARTS) {
        if (map.getLayer(`lima-lidar-tree-${part}`)) {
          map.setPaintProperty(`lima-lidar-tree-${part}`, "fill-extrusion-color", colorExpression(palette[part]));
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
      window.clearTimeout(updateTimer);
      map?.off("move", moveHandler);
      map?.off("moveend", moveEndHandler);
    },
  };

  return manager;
}
