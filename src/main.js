import "./style.css";

import { FetchSource, PMTiles, Protocol } from "pmtiles";

import {
  flightSpeedForZoom,
  formatCoordinates,
  moveCenter,
  normalizeBearing,
} from "./lib/flight.js";
import {
  createGoogleRealityController,
  loadGoogleMapsConfig,
} from "./lib/google-reality.js";

const { maplibregl } = window;

const LIMA_CENTER = [-84.105006, 40.7399785];
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const DATA_BASE = `${import.meta.env.BASE_URL}data/`;
const BUILDINGS_PM_TILES = new URL(`${DATA_BASE}lima-buildings.pmtiles`, window.location.href).href;
const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const FACADE_TYPES = ["residential", "urban", "industrial"];
const MATERIAL_VARIANTS = [0, 1, 2, 3, 4, 5, 6, 7];
const HIGH_PITCH_CULLED_LABELS = new Set([
  "highway-shield-non-us",
  "highway-shield-us-interstate",
  "road_shield_us",
  "label_state",
  "label_country_1",
  "label_country_2",
  "label_country_3",
]);

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
  oldcity: {
    center: [-84.10486, 40.73852],
    zoom: 18.35,
    pitch: 76,
    bearing: -86,
    duration: 2_300,
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
    center: [-84.10166, 40.74057],
    zoom: 18.55,
    pitch: 81,
    bearing: 180,
    duration: 2_600,
  },
};

const CINEMATIC_SHOTS = [
  { center: [-84.1069, 40.7408], zoom: 16.1, pitch: 72, bearing: -42, duration: 6_600 },
  { center: [-84.1036, 40.7396], zoom: 17.35, pitch: 79, bearing: 22, duration: 7_200 },
  { center: [-84.1141, 40.7407], zoom: 17.1, pitch: 73, bearing: 67, duration: 6_400 },
  { center: [-84.0964, 40.7491], zoom: 16.45, pitch: 67, bearing: 151, duration: 7_000 },
  { center: [-84.1565, 40.7613], zoom: 16.15, pitch: 70, bearing: -58, duration: 7_200 },
];

const LIGHT_MODES = {
  day: {
    background: "#e7e1d7",
    buildingLow: "#d6d1c7",
    buildingHigh: "#b9b3aa",
    water: "#8fb8c2",
    sky: { sky: "#78b3df", horizon: "#eef2f2", fog: "#d9e0e2" },
    light: { anchor: "map", color: "#fff0da", intensity: 0.5, position: [1.15, 205, 38] },
  },
  golden: {
    background: "#dcc8ad",
    buildingLow: "#d6b38f",
    buildingHigh: "#a66f53",
    water: "#6f9da7",
    sky: { sky: "#83aecd", horizon: "#f3c795", fog: "#d9baa0" },
    light: { anchor: "map", color: "#ffe0b0", intensity: 0.58, position: [1.3, 245, 34] },
  },
  night: {
    background: "#16211f",
    buildingLow: "#3b4b4e",
    buildingHigh: "#63747a",
    water: "#1f4b57",
    sky: { sky: "#07111e", horizon: "#28383f", fog: "#18282d" },
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
    "lima-building-cornices",
    "lima-rooftop-detail",
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
  map: document.querySelector("#map"),
  googleReality: document.querySelector("#google-reality"),
  googleMode: document.querySelector('[data-reality-mode="google"]'),
  openMode: document.querySelector('[data-reality-mode="open"]'),
  googleModeStatus: document.querySelector("#google-mode-status"),
  streetViewShell: document.querySelector("#street-view-shell"),
  streetViewMap: document.querySelector("#street-view-map"),
  streetViewStatus: document.querySelector("#street-view-status"),
  openStreetView: document.querySelector("#open-street-view"),
  closeStreetView: document.querySelector("#close-street-view"),
  openAttribution: document.querySelector("#open-attribution"),
};

let labelLayerIds = [];
let loaded = false;
let toastTimer;
let inferredTreesAutoHidden = false;
let lidarTreeLayer;
let activeLightMode = "day";
let labelsVisible = true;
let highPitchLabelsCulled = false;
let trafficLayer;
let buildingsVisible = true;
let facadesVisible = true;
let cinematicTourActive = false;
let cinematicTourTimer;
let activeRealityMode = "open";
let googleRealityController;
let googleRealityConfig;
let googleRealityInitialization;

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
const loadTrafficData = () => loadCompressedJson("lima-traffic");
const loadRooftopData = () => loadCompressedJson("lima-rooftops");
const loadFacadeData = () => loadCompressedJson("lima-facades");
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

function createFacadePattern(facadeType, mode, variant) {
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

  const materialTints = {
    day: [
      "rgba(255,255,255,0)",
      "rgba(116,70,45,0.16)",
      "rgba(247,231,198,0.2)",
      "rgba(76,101,104,0.15)",
      "rgba(96,70,57,0.12)",
      "rgba(228,215,187,0.18)",
      "rgba(72,88,92,0.16)",
      "rgba(143,91,67,0.15)",
    ],
    golden: [
      "rgba(255,255,255,0)",
      "rgba(130,67,38,0.18)",
      "rgba(246,215,167,0.17)",
      "rgba(77,91,94,0.14)",
      "rgba(112,67,45,0.14)",
      "rgba(226,193,143,0.16)",
      "rgba(70,78,82,0.15)",
      "rgba(148,75,48,0.17)",
    ],
    night: [
      "rgba(255,255,255,0)",
      "rgba(31,20,18,0.24)",
      "rgba(90,86,70,0.16)",
      "rgba(27,49,53,0.22)",
      "rgba(53,34,29,0.18)",
      "rgba(77,68,49,0.18)",
      "rgba(17,31,35,0.22)",
      "rgba(60,27,21,0.2)",
    ],
  };
  context.fillStyle = materialTints[mode][variant];
  context.fillRect(0, 0, 96, 96);

  const family = variant % 4;
  if (facadeType === "residential" && family === 0) {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.34;
    context.lineWidth = 2;
    const sidingSpacing = [12, 10, 14, 8, 11, 9, 13, 7][variant];
    for (let y = 8; y < 96; y += sidingSpacing) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (facadeType === "residential" && family === 1) {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.3;
    context.lineWidth = 1;
    for (let y = 0; y <= 96; y += 8) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
      for (let x = (y / 8) % 2 ? 0 : -12; x <= 96; x += 24) {
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(x, Math.min(96, y + 8));
        context.stroke();
      }
    }
    context.globalAlpha = 1;
  } else if (facadeType === "residential" && family === 2) {
    context.fillStyle = mode === "night" ? "rgba(138,146,139,0.08)" : "rgba(255,255,255,0.18)";
    for (let index = 0; index < 70; index += 1) {
      context.fillRect((index * 37 + variant * 11) % 96, (index * 53 + variant * 7) % 96, 1, 1);
    }
  } else if (facadeType === "residential") {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.27;
    context.lineWidth = 2;
    for (let x = 0; x <= 96; x += variant === 3 ? 12 : 9) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (facadeType === "urban" && (family === 0 || family === 1)) {
    context.strokeStyle = palette[3];
    context.globalAlpha = family === 0 ? 0.26 : 0.19;
    context.lineWidth = 1;
    const course = family === 0 ? 10 : 16;
    for (let y = 0; y <= 96; y += course) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
    }
    for (let x = variant % 2 ? course : 0; x <= 96; x += course * 2) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (facadeType === "urban") {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.23;
    context.lineWidth = 2;
    for (let x = 0; x <= 96; x += family === 2 ? 24 : 14) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    for (let y = 0; y <= 96; y += family === 2 ? 24 : 18) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(96, y);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else if (family === 0 || family === 2) {
    context.strokeStyle = palette[1];
    context.globalAlpha = 0.4;
    context.lineWidth = 2;
    const panelSpacing = [16, 12, 20, 24, 14, 18, 22, 10][variant];
    for (let x = 0; x <= 96; x += panelSpacing) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 96);
      context.stroke();
    }
    context.globalAlpha = 1;
  } else {
    context.strokeStyle = palette[3];
    context.globalAlpha = 0.24;
    context.lineWidth = 1;
    for (let x = 0; x <= 96; x += 24) {
      for (let y = 0; y <= 96; y += 16) context.strokeRect(x, y, 24, 16);
    }
    context.globalAlpha = 1;
  }

  context.fillStyle = mode === "night" ? "rgba(3,10,11,0.12)" : "rgba(42,35,30,0.1)";
  for (let index = 0; index < 34; index += 1) {
    const x = (index * 31 + variant * 17) % 96;
    const y = (index * 47 + variant * 13) % 96;
    context.fillRect(x, y, index % 6 === 0 ? 3 : 1, index % 5 === 0 ? 2 : 1);
  }
  context.globalAlpha = 1;
  return context.getImageData(0, 0, 96, 96);
}

function createRoofPattern(mode, variant) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d", { alpha: false });
  const bases = {
    day: ["#999083", "#756b62", "#a8aaa5", "#79685b", "#8e8170", "#686f70", "#a3957d", "#605954"],
    golden: ["#9b8068", "#77594b", "#a59c89", "#805e49", "#927158", "#6c6b64", "#a38a67", "#665247"],
    night: ["#414746", "#343838", "#4b5351", "#3c3938", "#45413e", "#303a3c", "#4a463e", "#302f2e"],
  };
  const seams = {
    day: "rgba(52,48,43,0.24)",
    golden: "rgba(62,43,32,0.25)",
    night: "rgba(12,18,18,0.34)",
  };
  context.fillStyle = bases[mode][variant];
  context.fillRect(0, 0, 64, 64);
  context.strokeStyle = seams[mode];
  context.lineWidth = 1;

  if (variant % 4 === 2) {
    for (let x = 0; x <= 64; x += 8) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, 64);
      context.stroke();
    }
  } else {
    for (let y = 0; y <= 64; y += variant % 4 === 1 ? 8 : 12) {
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(64, y);
      context.stroke();
    }
    if (variant % 4 === 0) {
      for (let y = 0; y < 64; y += 12) {
        for (let x = (y / 12) % 2 ? -8 : 0; x < 64; x += 16) {
          context.beginPath();
          context.moveTo(x, y);
          context.lineTo(x, Math.min(64, y + 12));
          context.stroke();
        }
      }
    }
  }

  context.fillStyle = mode === "night" ? "rgba(155,172,169,0.1)" : "rgba(241,235,219,0.15)";
  for (let index = 0; index < 42; index += 1) {
    const x = (index * 37 + variant * 13) % 64;
    const y = (index * 23 + variant * 19) % 64;
    const size = index % 5 === 0 ? 2 : 1;
    context.fillRect(x, y, size, size);
  }
  context.fillStyle = mode === "night" ? "rgba(3,10,11,0.14)" : "rgba(49,45,40,0.11)";
  for (let index = 0; index < 16; index += 1) {
    context.fillRect((index * 29 + variant * 7) % 64, (index * 17 + variant * 5) % 64, 2, 1);
  }

  if (variant % 4 === 3) {
    context.fillStyle = mode === "night" ? "#1d292b" : "#51636a";
    context.fillRect(10, 12, 15, 10);
    context.fillRect(39, 36, 11, 9);
    context.strokeStyle = mode === "night" ? "#718183" : "#d3d9d6";
    context.strokeRect(10.5, 12.5, 14, 9);
    context.strokeRect(39.5, 36.5, 10, 8);
  }
  return context.getImageData(0, 0, 64, 64);
}

function facadePatternExpression(mode, facadeType) {
  return [
    "match",
    ["get", "material_variant"],
    ...MATERIAL_VARIANTS.flatMap((variant) => [variant, `facade-${mode}-${facadeType}-${variant}`]),
    `facade-${mode}-${facadeType}-0`,
  ];
}

function roofPatternExpression(mode) {
  return [
    "match",
    ["get", "material_variant"],
    ...MATERIAL_VARIANTS.flatMap((variant) => [variant, `roof-${mode}-${variant}`]),
    `roof-${mode}-0`,
  ];
}

function rooftopColorExpression(mode) {
  const palette = {
    day: ["#9ca5a3", "#c2c9c6", "#7d5545", "#294856", "#1f3a52", "#8f9794"],
    golden: ["#9d9990", "#c7beb0", "#80523d", "#344851", "#29435b", "#908a80"],
    night: ["#3b4748", "#536063", "#3e2d28", "#13262f", "#10243a", "#384345"],
  }[mode];
  return [
    "match",
    ["get", "kind"],
    "hvac",
    palette[0],
    "vent",
    palette[1],
    "chimney",
    palette[2],
    "skylight",
    palette[3],
    "solar",
    palette[4],
    palette[5],
  ];
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
    for (const facadeType of FACADE_TYPES) {
      for (const variant of MATERIAL_VARIANTS) {
        const name = `facade-${mode}-${facadeType}-${variant}`;
        if (!map.hasImage(name)) map.addImage(name, createFacadePattern(facadeType, mode, variant), { pixelRatio: 2 });
      }
    }
    for (const variant of MATERIAL_VARIANTS) {
      const name = `roof-${mode}-${variant}`;
      if (!map.hasImage(name)) map.addImage(name, createRoofPattern(mode, variant), { pixelRatio: 2 });
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
  for (const facadeType of FACADE_TYPES) {
    map.addLayer(
      {
        id: `lima-buildings-${facadeType}`,
        type: "fill-extrusion",
        source: "lima-buildings",
        "source-layer": "buildings",
        minzoom: 13.2,
        filter: ["==", ["get", "facade_type"], facadeType],
        paint: {
          "fill-extrusion-pattern": facadePatternExpression("day", facadeType),
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
        "fill-extrusion-pattern": roofPatternExpression("day"),
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-base": wallHeight,
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  map.addLayer(
    {
      id: "lima-building-cornices",
      type: "fill-extrusion",
      source: "lima-buildings",
      "source-layer": "buildings",
      minzoom: 15.35,
      paint: {
        "fill-extrusion-color": [
          "match",
          ["get", "facade_type"],
          "urban",
          "#b99b80",
          "industrial",
          "#aeb3ae",
          "#d4c9b4",
        ],
        "fill-extrusion-base": ["get", "height"],
        "fill-extrusion-height": ["+", ["get", "height"], 0.22],
        "fill-extrusion-opacity": 0.96,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

  if (map.getLayer("building-3d")) map.setLayerZoomRange("building-3d", 0, 13.25);
  if (map.getLayer("building")) map.setLayerZoomRange("building", 0, 13.25);
}

function styleMeasuredBuildings(map, mode) {
  for (const facadeType of FACADE_TYPES) {
    safePaint(map, `lima-buildings-${facadeType}`, "fill-extrusion-pattern", facadePatternExpression(mode, facadeType));
  }
  safePaint(map, "lima-building-roofs", "fill-extrusion-pattern", roofPatternExpression(mode));
}

function addLimaLayers(map, detailData, rooftopData) {
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
  map.addSource("lima-rooftops", {
    type: "geojson",
    data: rooftopData,
    generateId: false,
  });

  map.addLayer(
    {
      id: "lima-rooftop-detail",
      type: "fill-extrusion",
      source: "lima-rooftops",
      minzoom: 15.45,
      paint: {
        "fill-extrusion-color": rooftopColorExpression("day"),
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "height"],
        "fill-extrusion-opacity": 0.98,
        "fill-extrusion-vertical-gradient": true,
      },
    },
    beforeLabels,
  );

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
  safePaint(map, "lima-rooftop-detail", "fill-extrusion-color", rooftopColorExpression(mode));
  safePaint(
    map,
    "lima-building-cornices",
    "fill-extrusion-color",
    mode === "night"
      ? "#454a47"
      : mode === "golden"
        ? "#b79272"
        : "#c9c2b5",
  );

  const aerialLight = {
    day: { min: 0.08, max: 0.94, saturation: -0.08, contrast: 0.08 },
    golden: { min: 0.07, max: 0.88, saturation: -0.01, contrast: 0.09 },
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
  try {
    map.setSky({
      "sky-color": palette.sky.sky,
      "sky-horizon-blend": mode === "night" ? 0.36 : 0.55,
      "horizon-color": palette.sky.horizon,
      "horizon-fog-blend": mode === "night" ? 0.32 : 0.5,
      "fog-color": palette.sky.fog,
      "fog-ground-blend": 0.12,
      "atmosphere-blend": 0,
    });
  } catch (error) {
    console.debug("This renderer does not expose sky controls", error);
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
  trafficLayer?.setTheme(mode);
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
  if (group === "buildings") {
    buildingsVisible = visible;
    trafficLayer?.setFacadeVisible(buildingsVisible && facadesVisible);
  }
  if (group === "facades") {
    facadesVisible = visible;
    trafficLayer?.setFacadeVisible(buildingsVisible && facadesVisible);
    return;
  }
  if (group === "traffic") {
    trafficLayer?.setVisible(visible);
    return;
  }

  if (group === "labels") {
    labelsVisible = visible;
    syncLabelVisibility(map, true);
    return;
  }

  const ids = group === "trees" && lidarTreeLayer ? [] : GROUP_LAYERS[group] || [];
  ids.forEach((id) => safeLayout(map, id, "visibility", visible ? "visible" : "none"));

  if (group === "trees" && visible && inferredTreesAutoHidden) {
    safeLayout(map, "lima-tree-crowns-inferred", "visibility", "none");
  }
}

function syncLabelVisibility(map, force = false) {
  const cullForPitch = map.getPitch() >= 76;
  if (!force && cullForPitch === highPitchLabelsCulled) return;
  highPitchLabelsCulled = cullForPitch;
  for (const id of labelLayerIds) {
    const pitchCulled = cullForPitch && HIGH_PITCH_CULLED_LABELS.has(id);
    safeLayout(map, id, "visibility", labelsVisible && !pitchCulled ? "visible" : "none");
  }
}

function updateCameraReadout(map) {
  const center = map.getCenter();
  elements.coordinates.textContent = formatCoordinates(center);
  elements.attitude.textContent = `Z ${map.getZoom().toFixed(1)} · P ${Math.round(map.getPitch())}° · B ${Math.round(
    normalizeBearing(map.getBearing()),
  )}°`;
}

function updateGoogleCameraReadout(camera) {
  const latitude = camera.center.lat;
  const longitude = camera.center.lng;
  elements.coordinates.textContent = `${Math.abs(latitude).toFixed(4)}° ${latitude >= 0 ? "N" : "S"} · ${Math.abs(
    longitude,
  ).toFixed(4)}° ${longitude >= 0 ? "E" : "W"}`;
  elements.attitude.textContent = `R ${Math.round(camera.range)} m · P ${Math.round(camera.tilt)}° · B ${Math.round(
    normalizeBearing(camera.heading),
  )}°`;
}

function updateRealityButtons(mode) {
  document.querySelectorAll("[data-reality-mode]").forEach((button) => {
    const active = button.dataset.realityMode === mode;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function configureGoogleRealityController() {
  if (googleRealityController) return googleRealityController;
  googleRealityController = createGoogleRealityController({
    mapContainer: elements.googleReality,
    streetContainer: elements.streetViewMap,
    onStatus(status) {
      if (activeRealityMode === "google") elements.renderStatus.textContent = status;
    },
    onCamera: updateGoogleCameraReadout,
    onStreetStatus(status) {
      elements.streetViewStatus.textContent = status === "OK" ? "LIVE" : status;
    },
  });
  return googleRealityController;
}

async function ensureGoogleReality() {
  if (!googleRealityConfig?.isConfigured) return false;
  const controller = configureGoogleRealityController();
  if (controller.initialized) return true;
  if (!googleRealityInitialization) {
    googleRealityInitialization = controller.initialize(googleRealityConfig).catch((error) => {
      googleRealityInitialization = null;
      throw error;
    });
  }
  await googleRealityInitialization;
  return true;
}

async function setRealityMode(map, mode, announce = true) {
  if (mode === "google") {
    if (!googleRealityConfig?.isConfigured) {
      showToast("Google Reality is installed · add the domain-restricted Maps key to runtime-config.json to activate it", 6_000);
      return false;
    }
    try {
      elements.renderStatus.textContent = "CONNECTING GOOGLE 3D";
      await ensureGoogleReality();
    } catch (error) {
      console.error("Google Reality failed to initialize", error);
      elements.renderStatus.textContent = "OPEN DATA READY";
      elements.googleModeStatus.textContent = "RETRY";
      showToast("Google Reality could not connect · the open-data city remains available", 5_000);
      return false;
    }
  }

  activeRealityMode = mode;
  document.body.dataset.realityMode = mode;
  elements.googleReality.hidden = mode !== "google";
  elements.map.setAttribute("aria-hidden", String(mode === "google"));
  elements.openAttribution.hidden = mode === "google";
  updateRealityButtons(mode);

  if (mode === "google") {
    map.stop();
    elements.renderStatus.textContent = "GOOGLE REALITY";
    const activePreset = document.querySelector("[data-preset].is-active")?.dataset.preset || "overview";
    await googleRealityController.flyTo(activePreset, prefersReducedMotion.matches ? 0 : 1_600);
    if (announce) showToast("Google Photorealistic 3D · live licensed imagery");
  } else {
    googleRealityController?.stopAnimation();
    googleRealityController?.hideStreetView();
    elements.streetViewShell.hidden = true;
    map.resize();
    updateCameraReadout(map);
    elements.renderStatus.textContent = loaded ? "OPEN DATA READY" : "STREAMING";
    if (announce) showToast("Open-data reconstruction · optimized fallback");
  }
  return true;
}

async function initializeRealityMode(map) {
  googleRealityConfig = await loadGoogleMapsConfig(import.meta.env.BASE_URL);
  window.__LIMA_3D__.googleConfigured = googleRealityConfig.isConfigured;
  if (!googleRealityConfig.isConfigured) {
    elements.googleMode.classList.add("is-unavailable");
    elements.googleModeStatus.textContent = "KEY NEEDED";
    elements.openStreetView.classList.add("is-unavailable");
    elements.openStreetView.setAttribute("aria-disabled", "true");
    return;
  }

  elements.googleMode.classList.remove("is-unavailable");
  elements.googleModeStatus.textContent = "LIVE";
  elements.openStreetView.classList.remove("is-unavailable");
  elements.openStreetView.removeAttribute("aria-disabled");
  if (googleRealityConfig.defaultRealityMode === "google") await setRealityMode(map, "google", false);
}

function openPanel(open) {
  document.body.classList.toggle("panel-closed", !open);
  elements.panelToggle.setAttribute("aria-expanded", String(open));
  elements.panel.setAttribute("aria-hidden", String(!open));
  elements.panel.inert = !open;
}

async function flyToPreset(map, name, announce = true) {
  const preset = PRESETS[name];
  if (!preset) return;
  if (activeRealityMode === "google" && googleRealityController?.initialized) {
    await googleRealityController.flyTo(name, prefersReducedMotion.matches ? 0 : preset.duration);
  } else {
    map.flyTo({
      ...preset,
      duration: prefersReducedMotion.matches ? 0 : preset.duration,
      essential: false,
      curve: 1.35,
      speed: 0.72,
    });
  }

  const buttons = [...document.querySelectorAll("[data-preset]")];
  buttons.forEach((button) => button.classList.toggle("is-active", button.dataset.preset === name));
  const activeIndex = buttons.findIndex((button) => button.dataset.preset === name);
  elements.presetIndex.textContent = `${String(activeIndex + 1).padStart(2, "0")} / ${String(
    buttons.length,
  ).padStart(2, "0")}`;
  if (announce) showToast(`Flying to ${buttons[activeIndex]?.querySelector("strong")?.textContent || name}`);
}

function updateCinematicButton() {
  const button = document.querySelector("#cinematic-tour");
  if (!button) return;
  button.classList.toggle("is-active", cinematicTourActive);
  button.setAttribute("aria-pressed", String(cinematicTourActive));
  button.querySelector("strong").textContent = cinematicTourActive ? "END TOUR" : "CINEMATIC TOUR";
  button.querySelector("small").textContent = cinematicTourActive ? "RETURN TO MANUAL FLIGHT" : "DIRECTOR-CURATED FLYTHROUGH";
}

function stopCinematicTour(map, announce = false) {
  if (!cinematicTourActive) return;
  cinematicTourActive = false;
  window.clearTimeout(cinematicTourTimer);
  if (activeRealityMode === "google") googleRealityController?.stopAnimation();
  else map.stop();
  document.body.classList.remove("cinematic-active");
  updateCinematicButton();
  if (announce) showToast("Cinematic tour ended");
}

async function startCinematicTour(map) {
  if (prefersReducedMotion.matches) {
    showToast("Cinematic motion is disabled by your reduced-motion preference", 4_500);
    return;
  }
  cinematicTourActive = true;
  document.body.classList.add("cinematic-active");
  updateCinematicButton();
  if (activeRealityMode === "google") {
    elements.renderStatus.textContent = "GOOGLE CINEMATIC";
    showToast("Google cinematic orbit · move or press a flight key to take control", 5_000);
    await googleRealityController?.startOrbit();
    return;
  }
  setLighting(map, "golden");
  let shotIndex = 0;
  const playShot = () => {
    if (!cinematicTourActive) return;
    const shot = CINEMATIC_SHOTS[shotIndex % CINEMATIC_SHOTS.length];
    map.flyTo({ ...shot, curve: 1.08, speed: 0.34, essential: false });
    elements.renderStatus.textContent = "CINEMATIC";
    cinematicTourTimer = window.setTimeout(() => {
      shotIndex += 1;
      playShot();
    }, shot.duration + 900);
  };
  showToast("Cinematic tour · move or press a flight key to take control", 5_000);
  playShot();
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
    stopCinematicTour(map);
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
      if (activeRealityMode === "google" && googleRealityController?.initialized) {
        googleRealityController.move({ forward, strafe, yaw, climb, tilt, boost }, deltaSeconds);
        window.requestAnimationFrame(frame);
        return;
      }
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
  document.querySelectorAll("[data-reality-mode]").forEach((button) => {
    button.addEventListener("click", () => setRealityMode(map, button.dataset.realityMode));
  });

  document.querySelectorAll("[data-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      stopCinematicTour(map);
      flyToPreset(map, button.dataset.preset);
    });
  });

  document.querySelector("#cinematic-tour").addEventListener("click", () => {
    if (cinematicTourActive) stopCinematicTour(map, true);
    else startCinematicTour(map);
  });
  map.getCanvas().addEventListener("pointerdown", () => stopCinematicTour(map));
  elements.googleReality.addEventListener("pointerdown", () => stopCinematicTour(map));

  elements.openStreetView.addEventListener("click", async () => {
    const ready = await setRealityMode(map, "google", false);
    if (!ready) return;
    stopCinematicTour(map);
    await flyToPreset(map, "oldcity", false);
    elements.streetViewShell.hidden = false;
    document.body.classList.add("street-view-open");
    googleRealityController.showOldCityPrimeStreetView();
    showToast("Official Google Street View · Old City Prime · 215 S Main St", 5_000);
  });
  elements.closeStreetView.addEventListener("click", () => {
    googleRealityController?.hideStreetView();
    elements.streetViewShell.hidden = true;
    document.body.classList.remove("street-view-open");
  });

  document.querySelectorAll("[data-layer-toggle]").forEach((input) => {
    input.addEventListener("change", () => setLayerGroup(map, input.dataset.layerToggle, input.checked));
  });

  document.querySelectorAll("[data-light]").forEach((button) => {
    button.addEventListener("click", () => setLighting(map, button.dataset.light));
  });

  document.querySelector("#reset-scene").addEventListener("click", () => {
    stopCinematicTour(map);
    inferredTreesAutoHidden = false;
    lidarTreeLayer?.setReduced(false);
    trafficLayer?.setReduced(false);
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
        trafficLayer?.setReduced(true);
        elements.renderStatus.textContent = "ADAPTIVE";
        showToast("Adaptive detail reduced distant canopy and traffic to keep flight smooth", 4_800);
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
      const cinematicLoad = Promise.all([
        loadTreeData(),
        loadTrafficData(),
        loadFacadeData(),
        import("./lib/traffic-layer.js"),
      ]).catch((error) => {
        console.warn("Cinematic traffic, canopy, and facade detail unavailable; retaining native fallback", error);
        return null;
      });
      const [detailData, rooftopData] = await Promise.all([loadDetailData(), loadRooftopData()]);
      addLimaLayers(map, detailData, rooftopData);
      const cinematicResources = await cinematicLoad;
      if (cinematicResources) {
        const [treeData, trafficData, facadeData, { createCinematicLayer }] = cinematicResources;
        trafficLayer = createCinematicLayer(trafficData, treeData.trees, facadeData);
        trafficLayer.addTo(map, layerAnchor(map));
        trafficLayer.setTheme(activeLightMode);
        lidarTreeLayer = {
          setTheme() {},
          setVisible(visible) {
            trafficLayer.setTreeVisible(visible);
          },
          setReduced(reduced) {
            trafficLayer.setReduced(reduced);
          },
        };
        for (const id of ["lima-tree-trunks", "lima-tree-crowns-mapped", "lima-tree-crowns-inferred"]) {
          safeLayout(map, id, "visibility", "none");
        }
      }
      loaded = true;
      if (activeRealityMode === "open") {
        elements.renderStatus.textContent = "OPEN DATA READY";
        updateCameraReadout(map);
      }
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
    if (loaded && activeRealityMode === "open") elements.renderStatus.textContent = inferredTreesAutoHidden ? "ADAPTIVE" : "FLYING";
  });
  map.on("move", () => {
    if (activeRealityMode === "open") updateCameraReadout(map);
    syncLabelVisibility(map);
  });
  map.on("moveend", () => {
    if (loaded && activeRealityMode === "open") {
      elements.renderStatus.textContent = inferredTreesAutoHidden ? "ADAPTIVE" : "OPEN DATA READY";
    }
  });
  map.on("error", (event) => {
    const resourceError = event.error || event;
    const resourceDetail = resourceError?.message || resourceError?.url || resourceError?.status || "unknown resource failure";
    console.warn(`Map resource error: ${resourceDetail}`);
    if (!loaded && activeRealityMode === "open") elements.renderStatus.textContent = "RETRYING";
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

window.__LIMA_3D__ = { map, presets: PRESETS, googleConfigured: false };
if (map) {
  initializeRealityMode(map).catch((error) => {
    console.error("Reality mode bootstrap failed", error);
    elements.googleModeStatus.textContent = "RETRY";
  });
}

Promise.all([
  fetchJson(`${DATA_BASE}lima-metadata.json`),
  fetchJson(`${DATA_BASE}lima-buildings-metadata.json`),
  fetchJson(`${DATA_BASE}lima-trees-metadata.json`),
  fetchJson(`${DATA_BASE}lima-traffic-metadata.json`),
  fetchJson(`${DATA_BASE}lima-rooftops-metadata.json`),
  fetchJson(`${DATA_BASE}lima-facades-metadata.json`),
])
  .then(([detailMetadata, buildingMetadata, treeMetadata, trafficMetadata, rooftopMetadata, facadeMetadata]) => {
    const detailCounts = detailMetadata.counts;
    const buildingCounts = buildingMetadata.counts;
    const treeCounts = treeMetadata.counts;
    const strong = document.createElement("strong");
    strong.textContent = treeCounts.lidarTreeCrowns.toLocaleString();
    elements.sourceSummary.replaceChildren(strong, " LiDAR canopy objects");
    const trafficSummary = document.querySelector("#traffic-summary");
    trafficSummary.replaceChildren(
      Object.assign(document.createElement("strong"), {
        textContent: trafficMetadata.counts.routes.toLocaleString(),
      }),
      " drivable route segments",
    );
    const facadeSummary = document.querySelector("#facade-summary");
    facadeSummary.replaceChildren(
      Object.assign(document.createElement("strong"), {
        textContent: facadeMetadata.counts.streetFacingWalls.toLocaleString(),
      }),
      " individualized street facades",
    );
    elements.renderStatus.title = [
      `${buildingCounts.source_heights.toLocaleString()} source building heights`,
      `${treeCounts.lidarTreeCrowns.toLocaleString()} LiDAR canopy objects`,
      `${detailCounts.pedestrianWays.toLocaleString()} pedestrian ways`,
      `${trafficMetadata.counts.routes.toLocaleString()} traffic routes`,
      `${rooftopMetadata.counts.features.toLocaleString()} rooftop details`,
      `${facadeMetadata.counts.streetFacingWalls.toLocaleString()} street-facing facade layouts`,
    ].join(" · ");
  })
  .catch((error) => console.debug(error));

if (window.innerWidth < 760) openPanel(false);
