import "./style.css";

import { FetchSource, PMTiles, Protocol } from "pmtiles";

import {
  flightSpeedForZoom,
  formatCoordinates,
  moveCenter,
  normalizeBearing,
} from "./lib/flight.js";

const { maplibregl } = window;

const LIMA_CENTER = [-84.105006, 40.7399785];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DATA_BASE = `${import.meta.env.BASE_URL}data/`;
const BUILDINGS_PM_TILES = new URL(`${DATA_BASE}lima-buildings.pmtiles`, window.location.href).href;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const PRESETS = {
  overview: {
    center: LIMA_CENTER,
    zoom: 12.65,
    pitch: 49,
    bearing: -18,
    duration: 2_600,
  },
  downtown: {
    center: [-84.1052, 40.7404],
    zoom: 16.25,
    pitch: 68,
    bearing: -31,
    duration: 2_400,
  },
  museum: {
    center: [-84.1138168, 40.7406108],
    zoom: 17.45,
    pitch: 72,
    bearing: 55,
    duration: 2_250,
  },
  schoonover: {
    center: [-84.096361, 40.7490924],
    zoom: 16.55,
    pitch: 66,
    bearing: 28,
    duration: 2_300,
  },
  unoh: {
    center: [-84.1567, 40.7615],
    zoom: 15.45,
    pitch: 61,
    bearing: -48,
    duration: 2_450,
  },
  street: {
    center: [-84.10472, 40.73952],
    zoom: 18.35,
    pitch: 81,
    bearing: 3,
    duration: 2_600,
  },
};

const LIGHT_MODES = {
  day: {
    background: "#e7e1d7",
    buildingLow: "#d6d1c7",
    buildingHigh: "#b9b3aa",
    water: "#8fb8c2",
    light: { anchor: "map", color: "#fff0da", intensity: 0.5, position: [1.15, 205, 38] },
  },
  golden: {
    background: "#dcc8ad",
    buildingLow: "#d6b38f",
    buildingHigh: "#a66f53",
    water: "#6f9da7",
    light: { anchor: "map", color: "#ffc278", intensity: 0.72, position: [1.35, 245, 22] },
  },
  night: {
    background: "#16211f",
    buildingLow: "#3b4b4e",
    buildingHigh: "#63747a",
    water: "#1f4b57",
    light: { anchor: "map", color: "#b8d4df", intensity: 0.27, position: [1.4, 210, 55] },
  },
};

const GROUP_LAYERS = {
  buildings: [
    "building",
    "building-3d",
    "lima-buildings-residential",
    "lima-buildings-urban",
    "lima-buildings-industrial",
    "lima-building-roofs",
  ],
  trees: ["lima-tree-trunks", "lima-tree-crowns-mapped", "lima-tree-crowns-inferred"],
  pedestrian: ["lima-green-space", "lima-path-casing", "lima-pedestrian", "lima-steps", "lima-hedges"],
  furniture: ["lima-furniture-3d", "lima-furniture-halo", "lima-furniture", "lima-furniture-labels"],
  aerial: ["lima-aerial"],
};

const elements = {
  loading: document.querySelector("#loading"),
  renderStatus: document.querySelector("#render-status"),
  fps: document.querySelector("#fps-readout"),
  coordinates: document.querySelector("#camera-coordinates"),
  attitude: document.querySelector("#camera-attitude"),
  panel: document.querySelector("#explorer-controls"),
  panelToggle: document.querySelector("#panel-toggle"),
  closePanel: document.querySelector("#close-panel"),
  presetIndex: document.querySelector("#preset-index"),
  sourceSummary: document.querySelector("#source-summary"),
  toast: document.querySelector("#toast"),
};

let labelLayerIds = [];
let loaded = false;
let toastTimer;
let inferredTreesAutoHidden = false;
let lidarTreeLayer;
let activeLightMode = "day";

const pmtilesProtocol = maplibregl ? new Protocol() : null;
if (pmtilesProtocol) maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

function showToast(message, duration = 3_200) {
  window.clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => elements.toast.classList.remove("is-visible"), duration);
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function loadCompressedJson(name) {
  if (!("DecompressionStream" in window)) return fetchJson(`${DATA_BASE}${name}.json`);

  try {
    const response = await fetch(`${DATA_BASE}${name}.json.gz`);
    if (!response.ok || !response.body) throw new Error(`compressed detail returned ${response.status}`);
    const stream = response.headers.get("content-encoding")
      ? response.body
      : response.body.pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).json();
  } catch (error) {
    console.debug("Compressed detail unavailable; using JSON fallback", error);
    return fetchJson(`${DATA_BASE}${name}.json`);
  }
}

const loadDetailData = () => loadCompressedJson("lima-detail");
const loadTreeData = () => loadCompressedJson("lima-trees");

function safePaint(map, layerId, property, value) {
  if (!map.getLayer(layerId)) return;
  try {
    map.setPaintProperty(layerId, property, value);
  } catch (error) {
    console.debug(`Skipped unsupported paint property ${layerId}.${property}`, error);
  }
}

function safeLayout(map, layerId, property, value) {
  if (!map.getLayer(layerId)) return;
  try {
    map.setLayoutProperty(layerId, property, value);
  } catch (error) {
    console.debug(`Skipped unsupported layout property ${layerId}.${property}`, error);
  }
}

function layerAnchor(map, preferredId) {
  if (preferredId && map.getLayer(preferredId)) return preferredId;
  return map.getStyle().layers.find((layer) => layer.type === "symbol")?.id;
}

function createFacadePattern(facadeType, mode) {
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext("2d", { alpha: false });
  const palette = {
    day: {
      residential: ["#c9c1ae", "#9b927f", "#4f6770", "#d8d0bd"],
      urban: ["#9b7463", "#6f4f44", "#36505d", "#c6aa8c"],
      industrial: ["#a8ada8", "#7f8987", "#4a6068", "#c6c9c1"],
    },
    golden: {
      residential: ["#c7ae8e", "#93765f", "#57646a", "#dbc09c"],
      urban: ["#a36b50", "#704638", "#43555c", "#c9946d"],
      industrial: ["#aaa18f", "#7e7668", "#536066", "#c8bda5"],
    },
    night: {
      residential: ["#34403f", "#202b2c", "#d7b96e", "#52605d"],
      urban: ["#3d3938", "#25292a", "#e1b85d", "#594d46"],
      industrial: ["#354043", "#232d30", "#9fb4b2", "#4c595a"],
    },
  }[mode][facadeType];

  context.fillStyle = palette[0];
  context.fillRect(0, 0, 96, 96);

  if (facadeType === "residential") {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.34;
    context.lineWidth = 2;
    for (let y = 8; y < 96; y += 12) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (facadeType === "urban") {
    context.strokeStyle = palette[3];
    context.globalAlpha = 0.24;
    context.lineWidth = 1;
    for (let y = 0; y <= 96; y += 12) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
    }
    for (let x = 0; x <= 96; x += 24) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.4;
    context.lineWidth = 2;
    for (let x = 0; x <= 96; x += 16) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    context.globalAlpha = 1;
  }

  context.fillStyle = palette[1];
  context.fillRect(9, 17, 30, 30);
  context.fillRect(57, 17, 30, 30);
  context.fillRect(9, 63, 30, 24);
  context.fillRect(57, 63, 30, 24);
  context.fillStyle = palette[2];
  context.fillRect(12, 20, 24, 24);
  context.fillRect(60, 20, 24, 24);
  context.fillRect(12, 66, 24, 18);
  if (mode === "night") context.fillRect(60, 66, 24, 18);
  context.strokeStyle = palette[3];
  context.globalAlpha = 0.48;
  for (const x of [24, 72]) {
    context.beginPath();
    context.moveTo(x, 18);
    context.lineTo(x, 87);
    context.stroke();
  }
  context.globalAlpha = 1;
  return context.getImageData(0, 0, 96, 96);
}

function createFallbackMapIcon() {
  const canvas = document.createElement("canvas");
  canvas.width = 24;
  canvas.height = 24;
  const context = canvas.getContext("2d");
  context.fillStyle = "rgba(15, 34, 28, 0.88)";
  context.strokeStyle = "rgba(231, 199, 116, 0.94)";
  context.lineWidth = 2;
  context.beginPath();
  context.arc(12, 12, 6.5, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  return context.getImageData(0, 0, 24, 24);
}

function addFacadePatterns(map) {
  for (const mode of Object.keys(LIGHT_MODES)) {
    for (const facadeType of ["residential", "urban", "industrial"]) {
      const name = `facade-${mode}-${facadeType}`;
      if (!map.hasImage(name)) map.addImage(name, createFacadePattern(facadeType, mode), { pixelRatio: 2 });
    }
  }
}

function addAerialLayer(map) {
  map.addSource("lima-aerial", {
    type: "raster",
    tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    tileSize: 256,
    maxzoom: 19,
    attribution: "Imagery © Esri and source contributors",
  });
  map.addLayer(
    {
      id: "lima-aerial",
      type: "raster",
      source: "lima-aerial",
      minzoom: 11.7,
      paint: {
        "raster-opacity": ["interpolate", ["linear"], ["zoom"], 11.7, 0, 12.25, 0.72, 14, 0.9, 18, 0.97],
        "raster-saturation": -0.08,
        "raster-contrast": 0.08,
        "raster-brightness-min": 0.08,
        "raster-brightness-max": 0.94,
        "raster-fade-duration": 140,
      },
    },
    map.getLayer("road_area_pattern") ? "road_area_pattern" : layerAnchor(map),
  );
}

function addMeasuredBuildings(map, beforeLabels) {
  const archiveSource = new FetchSource(BUILDINGS_PM_TILES);
  archiveSource.mustReload = true;
  const archive = new PMTiles(archiveSource);
  pmtilesProtocol.add(archive);
  map.addSource("lima-buildings", {
    type: "vector",
    url: `pmtiles://${BUILDINGS_PM_TILES}`,
    attribution: "© OpenStreetMap contributors, Overture Maps Foundation",
  });
  addFacadePatterns(map);

  const wallHeight = ["max", ["get", "min_height"], ["-", ["get", "height"], 0.34]];
  for (const facadeType of ["residential", "urban", "industrial"]) {
    map.addLayer(
      {
        id: `lima-buildings-${facadeType}`,
        type: "fill-extrusion",
        source: "lima-buildings",
        "source-layer": "buildings",
        minzoom: 13.2,
        filter: ["==", ["get", "facade_type"], facadeType],
        paint: {
          "fill-extrusion-pattern": `facade-day-${facadeType}`,
          "fill-extrusion-height": wallHeight,
          "fill-extrusion-base": ["get", "min_height"],
          "fill-extrusion-opacity": 0.98,
          "fill-extrusion-vertical-gradient": true,
        },
      },
      beforeLabels,
    );
  }

  map.addLayer(
    {
      id: "lima-building-roofs",
      type: "fill-extrusion",
      source: "lima-buildings",
      "source-layer": "buildings",
      minzoom: 13.2,
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "facade_type"],
          "industrial",
          "#b8b9b2",
          "urban",
          "#89766b",
          "#9a8976",
        ],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": wallHeight,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  if (map.getLayer("building-3d")) map.setLayerZoomRange("building-3d", 0, 13.25);
  if (map.getLayer("building")) map.setLayerZoomRange("building", 0, 13.25);
}

function styleMeasuredBuildings(map, mode) {
  for (const facadeType of ["residential", "urban", "industrial"]) {
    safePaint(map, `lima-buildings-${facadeType}`, "fill-extrusion-pattern", `facade-${mode}-${facadeType}`);
  }
  const roofColors = {
    day: ["#b8b9b2", "#89766b", "#9a8976"],
    golden: ["#b4a78f", "#8f6652", "#9c7b61"],
    night: ["#485150", "#454443", "#4c4b46"],
  }[mode];
  safePaint(map, "lima-building-roofs", "fill-extrusion-color", [
    "match",
    ["get", "facade_type"],
    "industrial",
    roofColors[0],
    "urban",
    roofColors[1],
    roofColors[2],
  ]);
}

function addLimaLayers(map, detailData) {
  const beforeBuildings = layerAnchor(map, "building-3d");
  const beforeLabels = layerAnchor(map);

  addAerialLayer(map);
  addMeasuredBuildings(map, beforeLabels);

  map.addSource("lima-boundary", {
    type: "geojson",
    data: `${DATA_BASE}lima-boundary.json`,
  });
  map.addSource("lima-detail", {
    type: "geojson",
    data: detailData,
    generateId: false,
  });

  map.addLayer(
    {
      id: "lima-green-space",
      type: "fill",
      source: "lima-detail",
      minzoom: 12,
      filter: ["==", ["get", "category"], "green-space"],
      paint: {
        "fill-color": [
          "match",
          ["get", "kind"],
          "forest",
          "#315f42",
          "park",
          "#6f9668",
          "garden",
          "#7f9e68",
          "cemetery",
          "#789374",
          "#88a879",
        ],
        "fill-opacity": ["interpolate", ["linear"], ["zoom"], 12, 0.12, 16, 0.28],
      },
    },
    beforeBuildings,
  );

  map.addLayer(
    {
      id: "lima-path-casing",
      type: "line",
      source: "lima-detail",
      minzoom: 14,
      filter: ["==", ["get", "category"], "pedestrian"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "rgba(46, 54, 49, 0.34)",
        "line-width": [
          "interpolate",
          ["exponential", 1.55],
          ["zoom"],
          14,
          0.6,
          17,
          ["+", ["get", "width"], 1.2],
          20,
          ["*", ["get", "width"], 3.5],
        ],
      },
    },
    beforeBuildings,
  );

  map.addLayer(
    {
      id: "lima-pedestrian",
      type: "line",
      source: "lima-detail",
      minzoom: 14,
      filter: [
        "all",
        ["==", ["get", "category"], "pedestrian"],
        ["!=", ["get", "kind"], "steps"],
      ],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": [
          "match",
          ["get", "surface"],
          ["asphalt", "paved", "concrete"],
          "#e3ded1",
          ["gravel", "fine_gravel"],
          "#c9bda7",
          "#d9d2c0",
        ],
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 14, 0.35, 16, 0.9],
        "line-width": [
          "interpolate",
          ["exponential", 1.5],
          ["zoom"],
          14,
          0.35,
          17,
          ["get", "width"],
          20,
          ["*", ["get", "width"], 3],
        ],
      },
    },
    beforeBuildings,
  );

  map.addLayer(
    {
      id: "lima-steps",
      type: "line",
      source: "lima-detail",
      minzoom: 16,
      filter: [
        "all",
        ["==", ["get", "category"], "pedestrian"],
        ["==", ["get", "kind"], "steps"],
      ],
      paint: {
        "line-color": "#b7a38a",
        "line-dasharray": [0.45, 0.45],
        "line-width": ["interpolate", ["linear"], ["zoom"], 16, 1, 20, 7],
      },
    },
    beforeBuildings,
  );

  map.addLayer(
    {
      id: "lima-hedges",
      type: "line",
      source: "lima-detail",
      minzoom: 16,
      filter: ["==", ["get", "category"], "hedge"],
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#315f3d",
        "line-opacity": 0.9,
        "line-width": ["interpolate", ["exponential", 1.6], ["zoom"], 16, 0.7, 20, 7],
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-tree-trunks",
      type: "fill-extrusion",
      source: "lima-detail",
      minzoom: 15.2,
      filter: [
        "all",
        ["==", ["get", "category"], "tree"],
        ["==", ["get", "part"], "trunk"],
      ],
      paint: {
        "fill-extrusion-color": "#66503b",
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-opacity": 0.94,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-tree-crowns-mapped",
      type: "fill-extrusion",
      source: "lima-detail",
      minzoom: 14.5,
      filter: [
        "all",
        ["==", ["get", "category"], "tree"],
        ["==", ["get", "part"], "crown"],
        ["==", ["get", "origin"], "mapped"],
      ],
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "colorVariant"],
          0,
          "#2f7045",
          1,
          "#3f7c4c",
          "#4e8954",
        ],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-opacity": 0.96,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-tree-crowns-inferred",
      type: "fill-extrusion",
      source: "lima-detail",
      minzoom: 15.6,
      filter: [
        "all",
        ["==", ["get", "category"], "tree"],
        ["==", ["get", "part"], "crown"],
        ["==", ["get", "origin"], "inferred"],
      ],
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "colorVariant"],
          0,
          "#376f46",
          1,
          "#447d4e",
          "#568b58",
        ],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-opacity": 0.82,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-furniture-3d",
      type: "fill-extrusion",
      source: "lima-detail",
      minzoom: 16.4,
      filter: ["==", ["get", "category"], "furniture-3d"],
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "kind"],
          "fire_hydrant",
          "#c34f3f",
          "traffic_signals",
          "#343d39",
          "street_lamp",
          "#3f4d50",
          "bus_stop",
          "#376b8f",
          "#77654f",
        ],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": 0,
        "fill-extrusion-opacity": 0.94,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-furniture-halo",
      type: "circle",
      source: "lima-detail",
      minzoom: 16.5,
      filter: ["==", ["get", "category"], "furniture"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 16.5, 3, 20, 10],
        "circle-color": "rgba(255,255,255,0.5)",
        "circle-blur": 0.8,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-furniture",
      type: "circle",
      source: "lima-detail",
      minzoom: 16.5,
      filter: ["==", ["get", "category"], "furniture"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 16.5, 1.4, 20, 4.6],
        "circle-color": [
          "match",
          ["get", "kind"],
          "fire_hydrant",
          "#c34f3f",
          "traffic_signals",
          "#d59b35",
          "street_lamp",
          "#4f6268",
          "bus_stop",
          "#376b8f",
          "#77654f",
        ],
        "circle-stroke-color": "rgba(22,31,29,0.65)",
        "circle-stroke-width": 0.8,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-furniture-labels",
      type: "symbol",
      source: "lima-detail",
      minzoom: 18.4,
      filter: ["==", ["get", "category"], "furniture"],
      layout: {
        "text-field": ["coalesce", ["get", "name"], ["get", "kind"]],
        "text-font": ["Noto Sans Regular"],
        "text-size": 10,
        "text-offset": [0, 1.1],
        "text-anchor": "top",
        "text-optional": true,
      },
      paint: {
        "text-color": "#3c4947",
        "text-halo-color": "rgba(255,255,255,0.88)",
        "text-halo-width": 1,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-boundary-glow",
      type: "line",
      source: "lima-boundary",
      minzoom: 10,
      paint: {
        "line-color": "#d9b86c",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.38, 15, 0.08],
        "line-blur": 7,
        "line-width": ["interpolate", ["linear"], ["zoom"], 10, 5, 15, 2],
      },
    },
    beforeLabels,
  );
  map.addLayer(
    {
      id: "lima-boundary",
      type: "line",
      source: "lima-boundary",
      minzoom: 10,
      paint: {
        "line-color": "#c6a65b",
        "line-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.75, 15, 0.15],
        "line-dasharray": [2, 1.5],
        "line-width": 1.2,
      },
    },
    beforeLabels,
  );
}

function styleBaseMap(map, mode = "day") {
  const palette = LIGHT_MODES[mode];
  const buildingColor = [
    "interpolate",
    ["linear"],
    ["coalesce", ["get", "render_height"], 7],
    0,
    palette.buildingLow,
    12,
    palette.buildingLow,
    38,
    palette.buildingHigh,
    120,
    palette.buildingHigh,
  ];

  safePaint(map, "background", "background-color", palette.background);
  safePaint(map, "building", "fill-color", palette.buildingLow);
  safePaint(map, "building-3d", "fill-extrusion-color", buildingColor);
  safePaint(map, "building-3d", "fill-extrusion-opacity", 0.91);
  safePaint(map, "building-3d", "fill-extrusion-vertical-gradient", true);
  styleMeasuredBuildings(map, mode);

  const aerialLight = {
    day: { min: 0.08, max: 0.94, saturation: -0.08, contrast: 0.08 },
    golden: { min: 0.08, max: 0.82, saturation: -0.02, contrast: 0.12 },
    night: { min: 0.015, max: 0.34, saturation: -0.42, contrast: 0.18 },
  }[mode];
  safePaint(map, "lima-aerial", "raster-brightness-min", aerialLight.min);
  safePaint(map, "lima-aerial", "raster-brightness-max", aerialLight.max);
  safePaint(map, "lima-aerial", "raster-saturation", aerialLight.saturation);
  safePaint(map, "lima-aerial", "raster-contrast", aerialLight.contrast);

  for (const layer of map.getStyle().layers) {
    if (layer.type === "fill" && /water/.test(layer.id)) {
      safePaint(map, layer.id, "fill-color", palette.water);
    }
  }

  try {
    map.setLight(palette.light);
  } catch (error) {
    console.debug("This renderer does not expose map light controls", error);
  }
}

function setLighting(map, mode) {
  activeLightMode = mode;
  document.documentElement.dataset.theme = mode;
  document.querySelectorAll("[data-light]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.light === mode);
  });
  if (loaded) styleBaseMap(map, mode);
  lidarTreeLayer?.setTheme(mode);
}

function setLayerGroup(map, group, visible) {
  if (group === "terrain") {
    if (visible) {
      if (!map.getSource("terrain-dem")) {
        map.addSource("terrain-dem", {
          type: "raster-dem",
          tiles: ["https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"],
          encoding: "terrarium",
          tileSize: 256,
          maxzoom: 15,
        });
      }
      map.setTerrain({ source: "terrain-dem", exaggeration: 1.35 });
      showToast("Terrain enabled · 1.35× relief");
    } else {
      map.setTerrain(null);
    }
    return;
  }

  if (group === "trees") lidarTreeLayer?.setVisible(visible);

  const ids = group === "labels" ? labelLayerIds : group === "trees" && lidarTreeLayer ? [] : GROUP_LAYERS[group] || [];
  ids.forEach((id) => safeLayout(map, id, "visibility", visible ? "visible" : "none"));

  if (group === "trees" && visible && inferredTreesAutoHidden) {
    safeLayout(map, "lima-tree-crowns-inferred", "visibility", "none");
  }
}

function updateCameraReadout(map) {
  const center = map.getCenter();
  elements.coordinates.textContent = formatCoordinates(center);
  elements.attitude.textContent = `Z ${map.getZoom().toFixed(1)} · P ${Math.round(map.getPitch())}° · B ${Math.round(
    normalizeBearing(map.getBearing()),
  )}°`;
}

function openPanel(open) {
  document.body.classList.toggle("panel-closed", !open);
  elements.panelToggle.setAttribute("aria-expanded", String(open));
  elements.panel.setAttribute("aria-hidden", String(!open));
  elements.panel.inert = !open;
}

function flyToPreset(map, name, announce = true) {
  const preset = PRESETS[name];
  if (!preset) return;
  map.flyTo({
    ...preset,
    duration: prefersReducedMotion.matches ? 0 : preset.duration,
    essential: false,
    curve: 1.35,
    speed: 0.72,
  });

  const buttons = [...document.querySelectorAll("[data-preset]")];
  buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.preset === name));
  const activeIndex = buttons.findIndex((button) => button.dataset.preset === name);
  elements.presetIndex.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(
    buttons.length,
  ).padStart(2, "0")}`;
  if (announce) showToast(`Flying to ${buttons[activeIndex]?.querySelector("strong")?.textContent || name}`);
}

function attachFlightControls(map) {
  const held = new Set();
  const controlKeys = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "KeyQ",
    "KeyE",
    "KeyR",
    "KeyF",
    "KeyT",
    "KeyG",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ShiftLeft",
    "ShiftRight",
  ]);

  window.addEventListener("keydown", (event) => {
    const tagName = event.target?.tagName;
    if (tagName === "INPUT" || tagName === "BUTTON" || tagName === "A") return;
    if (!controlKeys.has(event.code)) return;
    event.preventDefault();
    held.add(event.code);
    elements.renderStatus.textContent = "MANUAL FLIGHT";
  });
  window.addEventListener("keyup", (event) => held.delete(event.code));
  window.addEventListener("blur", () => held.clear());

  let previous = performance.now();
  function frame(now) {
    const deltaSeconds = Math.min((now - previous) / 1_000, 0.05);
    previous = now;
    if (held.size > 0 && loaded) {
      const forward = Number(held.has("KeyW") || held.has("ArrowUp")) - Number(held.has("KeyS") || held.has("ArrowDown"));
      const strafe = Number(held.has("KeyD")) - Number(held.has("KeyA"));
      const yaw = Number(held.has("KeyE") || held.has("ArrowRight")) - Number(held.has("KeyQ") || held.has("ArrowLeft"));
      const climb = Number(held.has("KeyR")) - Number(held.has("KeyF"));
      const tilt = Number(held.has("KeyT")) - Number(held.has("KeyG"));
      const boost = held.has("ShiftLeft") || held.has("ShiftRight");
      const speed = flightSpeedForZoom(map.getZoom(), boost);
      const center = moveCenter(map.getCenter(), map.getBearing(), forward * speed * deltaSeconds, strafe * speed * deltaSeconds);

      map.jumpTo({
        center,
        bearing: map.getBearing() + yaw * 48 * deltaSeconds,
        zoom: Math.max(10.5, Math.min(19.5, map.getZoom() + climb * 1.25 * deltaSeconds)),
        pitch: Math.max(0, Math.min(82, map.getPitch() + tilt * 34 * deltaSeconds)),
      });
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);
}

function attachPopupInteractions(map) {
  const interactiveLayers = [
    "lima-building-roofs",
    "lima-buildings-residential",
    "lima-buildings-urban",
    "lima-buildings-industrial",
    "building-3d",
    "lima-green-space",
    "lima-pedestrian",
    "lima-furniture",
  ];

  map.on("mousemove", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers.filter((id) => map.getLayer(id)) });
    map.getCanvas().style.cursor = features.length ? "pointer" : "";
  });

  map.on("click", (event) => {
    const features = map.queryRenderedFeatures(event.point, { layers: interactiveLayers.filter((id) => map.getLayer(id)) });
    const feature = features[0];
    if (!feature) return;

    const properties = feature.properties || {};
    const popup = document.createElement("div");
    popup.className = "feature-card";
    const eyebrow = document.createElement("span");
    eyebrow.textContent = properties.category || feature.layer.id.replaceAll("-", " ");
    const title = document.createElement("strong");
    title.textContent = properties.name || properties.kind?.replaceAll("_", " ") || "Mapped feature";
    const detail = document.createElement("small");
    const height = properties.render_height || properties.height;
    const heightLabel = {
      measured: "Source",
      normalized: "Normalized",
      inferred: "Estimated",
    }[properties.height_source] || "Estimated";
    detail.textContent = height ? `${heightLabel} ${Number(height).toFixed(1)} m high` : "Mapped feature";
    popup.append(eyebrow, title, detail);

    new maplibregl.Popup({ offset: 14, closeButton: true, maxWidth: "240px" })
      .setLngLat(event.lngLat)
      .setDOMContent(popup)
      .addTo(map);
  });
}

function attachUi(map) {
  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => flyToPreset(map, button.dataset.preset));
  });

  document.querySelectorAll("[data-layer-toggle]").forEach((input) => {
    input.addEventListener("change", () => setLayerGroup(map, input.dataset.layerToggle, input.checked));
  });

  document.querySelectorAll("[data-light]").forEach((button) => {
    button.addEventListener("click", () => setLighting(map, button.dataset.light));
  });

  document.querySelector("#reset-scene").addEventListener("click", () => {
    inferredTreesAutoHidden = false;
    lidarTreeLayer?.setReduced(false);
    document.querySelectorAll("[data-layer-toggle]").forEach((input) => {
      input.checked = input.dataset.layerToggle !== "terrain";
      setLayerGroup(map, input.dataset.layerToggle, input.checked);
    });
    setLighting(map, "day");
    flyToPreset(map, "overview", false);
    showToast("Scene reset");
  });

  elements.panelToggle.addEventListener("click", () => openPanel(document.body.classList.contains("panel-closed")));
  elements.closePanel.addEventListener("click", () => openPanel(false));
}

function attachPerformanceReadout(map) {
  let frames = 0;
  let frameWindow = performance.now();
  let lowFpsWindows = 0;
  let measuredFps = 60;

  function measureFrame(now) {
    if (document.visibilityState !== "visible" || !document.hasFocus()) {
      frames = 0;
      frameWindow = now;
      window.requestAnimationFrame(measureFrame);
      return;
    }
    frames += 1;
    const elapsed = now - frameWindow;
    if (elapsed >= 1_000) {
      measuredFps = Math.round((frames * 1_000) / elapsed);
      elements.fps.textContent = `${measuredFps} FPS`;
      frames = 0;
      frameWindow = now;

      if (map.isMoving() && map.getZoom() >= 15.5 && measuredFps < 38) lowFpsWindows += 1;
      else lowFpsWindows = Math.max(0, lowFpsWindows - 1);

      if (lowFpsWindows >= 3 && !inferredTreesAutoHidden) {
        inferredTreesAutoHidden = true;
        safeLayout(map, "lima-tree-crowns-inferred", "visibility", "none");
        lidarTreeLayer?.setReduced(true);
        elements.renderStatus.textContent = "ADAPTIVE";
        showToast("Adaptive detail reduced distant tree geometry to keep flight smooth", 4_800);
      }
    }
    window.requestAnimationFrame(measureFrame);
  }

  window.requestAnimationFrame(measureFrame);
  return () => measuredFps;
}

function initializeMap() {
  if (!maplibregl) {
    elements.loading.innerHTML = "<p>Map renderer unavailable</p><small>Check your connection and reload.</small>";
    return null;
  }
  if (!("WebGL2RenderingContext" in window)) {
    elements.loading.innerHTML = "<p>WebGL is unavailable</p><small>Open this page in a modern hardware-accelerated browser.</small>";
    return null;
  }

  const map = new maplibregl.Map({
    container: "map",
    style: MAP_STYLE,
    center: PRESETS.overview.center,
    zoom: PRESETS.overview.zoom,
    pitch: PRESETS.overview.pitch,
    bearing: PRESETS.overview.bearing,
    minZoom: 10.5,
    maxZoom: 19.5,
    maxPitch: 82,
    maxBounds: [
      [-84.23, 40.64],
      [-83.97, 40.84],
    ],
    fadeDuration: 180,
    attributionControl: false,
    keyboard: false,
    pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
    canvasContextAttributes: { antialias: true, powerPreference: "high-performance" },
  });

  map.on("styleimagemissing", ({ id }) => {
    if (!map.hasImage(id)) map.addImage(id, createFallbackMapIcon(), { pixelRatio: 2 });
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: true }), "bottom-right");
  map.addControl(new maplibregl.FullscreenControl(), "bottom-right");
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: "imperial" }), "bottom-left");

  let loadingDismissed = false;
  function dismissLoading() {
    if (loadingDismissed || !document.body.contains(elements.loading)) return;
    loadingDismissed = true;
    elements.loading.classList.add("is-hidden");
    window.setTimeout(() => elements.loading.remove(), 700);
  }

  map.on("load", async () => {
    labelLayerIds = map
      .getStyle()
      .layers.filter((layer) => layer.type === "symbol")
      .map((layer) => layer.id);
    styleBaseMap(map, "day");
    try {
      const treeLoad = Promise.all([loadTreeData(), import("./lib/tree-layer.js")]).catch((error) => {
        console.warn("Measured tree inventory unavailable; retaining fallback canopy", error);
        return null;
      });
      const detailData = await loadDetailData();
      addLimaLayers(map, detailData);
      const treeResources = await treeLoad;
      if (treeResources) {
        const [treeData, { createTreeLayer }] = treeResources;
        lidarTreeLayer = createTreeLayer(treeData.trees);
        lidarTreeLayer.setTheme(activeLightMode);
        lidarTreeLayer.addTo(map, layerAnchor(map));
        for (const id of ["lima-tree-trunks", "lima-tree-crowns-mapped", "lima-tree-crowns-inferred"]) {
          safeLayout(map, id, "visibility", "none");
        }
      }
      loaded = true;
      elements.renderStatus.textContent = "READY";
      updateCameraReadout(map);
      attachPopupInteractions(map);
      map.once("idle", dismissLoading);
    } catch (error) {
      console.error("Lima detail failed to load", error);
      elements.loading.querySelector("p").textContent = "City detail unavailable";
      elements.loading.querySelector("small").textContent = "Check your connection and reload";
      elements.renderStatus.textContent = "OFFLINE";
    }
  });

  map.on("movestart", () => {
    if (loaded) elements.renderStatus.textContent = inferredTreesAutoHidden ? "ADAPTIVE" : "FLYING";
  });
  map.on("move", () => updateCameraReadout(map));
  map.on("moveend", () => {
    if (loaded) elements.renderStatus.textContent = inferredTreesAutoHidden ? "ADAPTIVE" : "READY";
  });
  map.on("error", (event) => {
    console.warn("Map resource error", event.error || event);
    if (!loaded) elements.renderStatus.textContent = "RETRYING";
  });

  window.setTimeout(() => {
    if (loaded || loadingDismissed || !document.body.contains(elements.loading)) return;
    elements.loading.querySelector("p").textContent = "Map connection unavailable";
    elements.loading.querySelector("small").textContent = "Check your connection and reload";
    elements.renderStatus.textContent = "OFFLINE";
  }, 15_000);

  attachUi(map);
  attachFlightControls(map);
  attachPerformanceReadout(map);
  return map;
}

const map = initializeMap();

Promise.all([
  fetchJson(`${DATA_BASE}lima-metadata.json`),
  fetchJson(`${DATA_BASE}lima-buildings-metadata.json`),
  fetchJson(`${DATA_BASE}lima-trees-metadata.json`),
])
  .then(([detailMetadata, buildingMetadata, treeMetadata]) => {
    const detailCounts = detailMetadata.counts;
    const buildingCounts = buildingMetadata.counts;
    const treeCounts = treeMetadata.counts;
    const strong = document.createElement("strong");
    strong.textContent = treeCounts.lidarTreeCrowns.toLocaleString();
    elements.sourceSummary.replaceChildren(strong, " LiDAR canopy objects");
    elements.renderStatus.title = [
      `${buildingCounts.source_heights.toLocaleString()} source building heights`,
      `${treeCounts.lidarTreeCrowns.toLocaleString()} LiDAR canopy objects`,
      `${detailCounts.pedestrianWays.toLocaleString()} pedestrian ways`,
    ].join(" · ");
  })
  .catch((error) => console.debug(error));

if (window.innerWidth < 760) openPanel(false);

window.__LIMA_3D__ = { map, presets: PRESETS };
