import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

import { createFacadeSystem } from "./facade-detail.js";
import { chunkTreeInventory, localMeters } from "./tree-geometry.js";

const CENTER = [-84.105006, 40.7399785];
const MAX_VEHICLES = 180;
const MAX_TREES = 2_100;
const TREE_LOBES = 4;
const ROAD_DENSITY_METERS = [105, 120, 135, 155, 175, 235, 260, 250, 340];
const BODY_COLORS = [
  0xe9ece8,
  0x252c31,
  0x7d8589,
  0xa6322d,
  0x2b5278,
  0x315c45,
  0xd1b082,
  0x6d2d3f,
  0xb9bdba,
  0x433d36,
  0x173d5c,
  0xd7d0c1,
];
const VEHICLE_TYPES = [
  { scale: [1, 1, 1], cabinY: -0.05, cabinScale: [1, 1, 1] },
  { scale: [1.04, 1.07, 1.16], cabinY: -0.04, cabinScale: [1.03, 1.06, 1.12] },
  { scale: [1.04, 1.12, 1.05], cabinY: -0.48, cabinScale: [0.98, 0.78, 0.96] },
];
const TREE_PALETTES = {
  day: {
    trunk: 0x6b4b33,
    crowns: [0x357744, 0x43864c, 0x529257, 0x62884f],
  },
  golden: {
    trunk: 0x704a2f,
    crowns: [0x426f3f, 0x4f7d45, 0x5d894c, 0x6c8150],
  },
  night: {
    trunk: 0x322720,
    crowns: [0x183b28, 0x21482f, 0x2a5537, 0x34523a],
  },
};
const PART_POSITION = new THREE.Vector3();
const PART_SCALE = new THREE.Vector3();
const PART_ROTATION = new THREE.Quaternion();
const TREE_ROTATION = new THREE.Quaternion();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PART_LOCAL_MATRIX = new THREE.Matrix4();
const PART_WORLD_MATRIX = new THREE.Matrix4();

function hash(index, salt = 0) {
  const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

function intersects(bounds, view) {
  return bounds[0] <= view[2] && bounds[2] >= view[0] && bounds[1] <= view[3] && bounds[3] >= view[1];
}

function paddedViewBounds(map) {
  const bounds = map.getBounds();
  const longitudePadding = (bounds.getEast() - bounds.getWest()) * 0.38;
  const latitudePadding = (bounds.getNorth() - bounds.getSouth()) * 0.38;
  return [
    bounds.getWest() - longitudePadding,
    bounds.getSouth() - latitudePadding,
    bounds.getEast() + longitudePadding,
    bounds.getNorth() + latitudePadding,
  ];
}

function routeMetric(raw, index) {
  const [classIndex, speed, oneway, lanes, coordinates] = raw;
  const local = coordinates.map(([longitude, latitude]) => localMeters(longitude, latitude));
  const cumulative = [0];
  for (let point = 1; point < local.length; point += 1) {
    cumulative.push(cumulative.at(-1) + Math.hypot(local[point][0] - local[point - 1][0], local[point][1] - local[point - 1][1]));
  }
  const longitudes = coordinates.map((coordinate) => coordinate[0]);
  const latitudes = coordinates.map((coordinate) => coordinate[1]);
  return {
    index,
    classIndex,
    speed,
    oneway: Boolean(oneway),
    lanes,
    coordinates,
    local,
    cumulative,
    length: cumulative.at(-1),
    bounds: [Math.min(...longitudes), Math.min(...latitudes), Math.max(...longitudes), Math.max(...latitudes)],
    center: [
      (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
      (Math.min(...latitudes) + Math.max(...latitudes)) / 2,
    ],
  };
}

export function prepareTrafficRoutes(rawRoutes) {
  return rawRoutes.map(routeMetric).filter((route) => route.length >= 28);
}

export function pointAlongRoute(route, distance, direction = 1, laneOffset = 0) {
  const wrapped = ((distance % route.length) + route.length) % route.length;
  const target = direction > 0 ? wrapped : route.length - wrapped;
  let low = 1;
  let high = route.cumulative.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (route.cumulative[middle] < target) low = middle + 1;
    else high = middle;
  }
  const segment = Math.max(1, low);
  const start = route.local[segment - 1];
  const end = route.local[segment];
  const segmentLength = Math.max(0.001, route.cumulative[segment] - route.cumulative[segment - 1]);
  const progress = Math.max(0, Math.min(1, (target - route.cumulative[segment - 1]) / segmentLength));
  let dx = end[0] - start[0];
  let dy = end[1] - start[1];
  if (direction < 0) {
    dx *= -1;
    dy *= -1;
  }
  const heading = Math.atan2(dx, dy);
  const x = start[0] + (end[0] - start[0]) * progress + Math.cos(heading) * laneOffset;
  const y = start[1] + (end[1] - start[1]) * progress - Math.sin(heading) * laneOffset;
  return { x, y, heading };
}

export function trafficBudget(zoom, reduced = false) {
  if (zoom < 14.65) return 0;
  if (reduced) return zoom < 16 ? 14 : 30;
  if (zoom < 15.2) return 16;
  if (zoom < 16) return 28;
  if (zoom < 17) return 44;
  return 68;
}

function vehicleCandidates(map, routes, reduced) {
  const budget = trafficBudget(map.getZoom(), reduced);
  if (!budget) return [];
  const view = paddedViewBounds(map);
  const center = map.getCenter();
  const visibleRoutes = routes
    .filter((route) => intersects(route.bounds, view))
    .filter((route) => route.classIndex !== 8 || hash(route.index, 91) > 0.78)
    .sort((left, right) => {
      const leftPriority = left.classIndex * 0.25 + Math.hypot(left.center[0] - center.lng, left.center[1] - center.lat) * 100;
      const rightPriority = right.classIndex * 0.25 + Math.hypot(right.center[0] - center.lng, right.center[1] - center.lat) * 100;
      return leftPriority - rightPriority;
    });

  const vehicles = [];
  for (let pass = 0; vehicles.length < budget && pass < 5; pass += 1) {
    for (const route of visibleRoutes) {
      if (vehicles.length >= budget) break;
      const slots = Math.max(1, Math.min(5, Math.floor(route.length / ROAD_DENSITY_METERS[route.classIndex])));
      if (pass >= slots) continue;
      const seed = route.index * 7 + pass * 131;
      const direction = route.oneway || hash(seed, 2) > 0.5 ? 1 : -1;
      const laneCount = Math.max(1, Math.min(3, route.lanes));
      const laneIndex = Math.floor(hash(seed, 3) * laneCount);
      const laneCenter = (laneIndex - (laneCount - 1) / 2) * 2.55;
      const roadSide = route.oneway ? laneCenter : direction * (1.45 + Math.abs(laneCenter) * 0.7);
      vehicles.push({
        route,
        phase: hash(seed, 4) * route.length,
        speed: route.speed * (0.72 + hash(seed, 5) * 0.24),
        direction,
        laneOffset: roadSide,
        color: BODY_COLORS[Math.floor(hash(seed, 6) * BODY_COLORS.length)],
        type: Math.min(2, Math.floor(hash(seed, 7) * 3.25)),
      });
    }
  }
  return vehicles;
}

function treeBudget(map, reduced) {
  const zoom = map.getZoom();
  if (zoom < 14.7) return 0;
  if (reduced) return 850;
  if (map.getPitch() >= 74) return 1_250;
  if (zoom < 15.35) return 1_050;
  if (zoom < 16.3) return 1_550;
  return MAX_TREES;
}

function treeCandidates(map, chunks, reduced) {
  const budget = treeBudget(map, reduced);
  if (!budget) return [];
  const view = paddedViewBounds(map);
  const center = map.getCenter();
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
  const selected = [];
  for (const chunk of visibleChunks) {
    const remaining = budget - selected.length;
    if (remaining <= 0) break;
    selected.push(...chunk.trees.slice(0, remaining).map((tree) => tree.raw));
  }
  return selected;
}

function roundedGeometry(width, height, length, radius = 0.12) {
  const geometry = new RoundedBoxGeometry(width, height, length, 2, radius);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function addInstancedMesh(scene, geometry, material, count) {
  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

function createVehicleMeshes(scene) {
  const bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.28 });
  const roofMaterial = new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.25 });
  const glassMaterial = new THREE.MeshStandardMaterial({ color: 0x162a31, roughness: 0.18, metalness: 0.35 });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x111313, roughness: 0.92, metalness: 0.02 });
  const headlightMaterial = new THREE.MeshStandardMaterial({ color: 0xfff0c0, emissive: 0xffd88a, emissiveIntensity: 1.25 });
  const tailLightMaterial = new THREE.MeshStandardMaterial({ color: 0xa9221d, emissive: 0x8b0904, emissiveIntensity: 0.72 });
  const shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x060a09, transparent: true, opacity: 0.22, depthWrite: false });

  const body = addInstancedMesh(scene, roundedGeometry(1.84, 0.52, 4.32, 0.13), bodyMaterial, MAX_VEHICLES);
  const glass = addInstancedMesh(scene, roundedGeometry(1.58, 0.68, 2.26, 0.12), glassMaterial, MAX_VEHICLES);
  const roof = addInstancedMesh(scene, roundedGeometry(1.27, 0.1, 1.48, 0.04), roofMaterial, MAX_VEHICLES);
  const wheels = addInstancedMesh(scene, new THREE.CylinderGeometry(0.32, 0.32, 0.24, 12).rotateZ(Math.PI / 2), tireMaterial, MAX_VEHICLES * 4);
  const headlights = addInstancedMesh(scene, new THREE.BoxGeometry(0.38, 0.11, 0.18), headlightMaterial, MAX_VEHICLES * 2);
  const tailLights = addInstancedMesh(scene, new THREE.BoxGeometry(0.36, 0.1, 0.17), tailLightMaterial, MAX_VEHICLES * 2);
  const shadows = addInstancedMesh(scene, new THREE.CircleGeometry(1, 18), shadowMaterial, MAX_VEHICLES);

  return {
    body,
    glass,
    roof,
    wheels,
    headlights,
    tailLights,
    shadows,
    materials: { bodyMaterial, roofMaterial, glassMaterial, headlightMaterial, tailLightMaterial },
  };
}

function createTreeMeshes(scene) {
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: TREE_PALETTES.day.trunk, roughness: 0.94, metalness: 0 });
  const crownMaterial = new THREE.MeshStandardMaterial({ roughness: 0.88, metalness: 0, flatShading: false });
  const trunkGeometry = new THREE.CylinderGeometry(1, 1.16, 2, 8, 1).rotateX(Math.PI / 2);
  const crownGeometry = new THREE.IcosahedronGeometry(1, 1);
  const trunks = addInstancedMesh(scene, trunkGeometry, trunkMaterial, MAX_TREES);
  const crowns = addInstancedMesh(scene, crownGeometry, crownMaterial, MAX_TREES * TREE_LOBES);
  return { trunks, crowns, materials: { trunkMaterial, crownMaterial } };
}

function setTreePart(mesh, index, x, y, z, scaleX, scaleY, scaleZ, rotationZ = 0) {
  PART_POSITION.set(x, y, z);
  PART_SCALE.set(scaleX, scaleY, scaleZ);
  TREE_ROTATION.setFromAxisAngle(Z_AXIS, rotationZ);
  PART_WORLD_MATRIX.compose(PART_POSITION, TREE_ROTATION, PART_SCALE);
  mesh.setMatrixAt(index, PART_WORLD_MATRIX);
}

function updateTreeMeshes(treeMeshes, trees, theme) {
  const palette = TREE_PALETTES[theme] || TREE_PALETTES.day;
  const color = new THREE.Color();
  let crownIndex = 0;
  trees.forEach((tree, index) => {
    const [longitude, latitude, height, crownRadius, variant] = tree;
    const [x, y] = localMeters(longitude, latitude);
    const seed = Math.abs(Math.floor(longitude * 100_000) ^ Math.floor(latitude * 100_000));
    const angle = hash(seed, 21) * Math.PI * 2;
    const aspect = 0.88 + hash(seed, 22) * 0.24;
    const leanX = (hash(seed, 23) - 0.5) * crownRadius * 0.34;
    const leanY = (hash(seed, 24) - 0.5) * crownRadius * 0.34;
    const trunkHeight = Math.max(2.2, height * 0.46);
    const trunkRadius = Math.max(0.16, Math.min(0.46, height * 0.025));
    setTreePart(treeMeshes.trunks, index, x, y, trunkHeight / 2, trunkRadius, trunkRadius, trunkHeight / 2, angle);

    const lobes = [
      { x: -0.28, y: 0.03, z: 0.5, sx: 0.76, sy: 0.7, sz: 0.18 },
      { x: 0.29, y: -0.04, z: 0.53, sx: 0.8, sy: 0.72, sz: 0.19 },
      { x: 0, y: 0, z: 0.68, sx: 1, sy: 0.91, sz: 0.23 },
      { x: 0.06, y: 0.03, z: 0.86, sx: 0.67, sy: 0.62, sz: 0.15 },
    ];
    lobes.forEach((lobe, lobeIndex) => {
      const lobeJitter = 0.9 + hash(seed, 30 + lobeIndex) * 0.18;
      setTreePart(
        treeMeshes.crowns,
        crownIndex,
        x + lobe.x * crownRadius + leanX * (0.35 + lobeIndex * 0.2),
        y + lobe.y * crownRadius + leanY * (0.35 + lobeIndex * 0.2),
        height * lobe.z,
        crownRadius * lobe.sx * aspect * lobeJitter,
        crownRadius * lobe.sy * (2 - aspect) * lobeJitter,
        height * lobe.sz,
        angle + lobeIndex * 0.37,
      );
      color.setHex(palette.crowns[(variant + lobeIndex) % palette.crowns.length]);
      treeMeshes.crowns.setColorAt(crownIndex, color);
      crownIndex += 1;
    });
  });

  treeMeshes.trunks.count = trees.length;
  treeMeshes.crowns.count = crownIndex;
  treeMeshes.trunks.instanceMatrix.needsUpdate = true;
  treeMeshes.crowns.instanceMatrix.needsUpdate = true;
  if (treeMeshes.crowns.instanceColor) treeMeshes.crowns.instanceColor.needsUpdate = true;
  treeMeshes.materials.trunkMaterial.color.setHex(palette.trunk);
}

function setPart(mesh, index, root, x, y, z, scaleX = 1, scaleY = 1, scaleZ = 1) {
  PART_POSITION.set(x, y, z);
  PART_SCALE.set(scaleX, scaleY, scaleZ);
  PART_LOCAL_MATRIX.compose(PART_POSITION, PART_ROTATION, PART_SCALE);
  PART_WORLD_MATRIX.multiplyMatrices(root, PART_LOCAL_MATRIX);
  mesh.setMatrixAt(index, PART_WORLD_MATRIX);
}

function updateVehicleMeshes(meshes, vehicles, elapsedSeconds) {
  let wheelIndex = 0;
  let headlightIndex = 0;
  let tailLightIndex = 0;
  const root = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const bodyColor = new THREE.Color();

  vehicles.forEach((vehicle, index) => {
    const location = pointAlongRoute(vehicle.route, vehicle.phase + elapsedSeconds * vehicle.speed, vehicle.direction, vehicle.laneOffset);
    const type = VEHICLE_TYPES[vehicle.type];
    position.set(location.x, location.y, 0.06);
    rotation.setFromAxisAngle(zAxis, -location.heading);
    scale.set(...type.scale);
    root.compose(position, rotation, scale);

    setPart(meshes.body, index, root, 0, 0, 0.58);
    setPart(meshes.glass, index, root, 0, type.cabinY, 1.08, ...type.cabinScale);
    setPart(meshes.roof, index, root, 0, type.cabinY - 0.05, 1.45, type.cabinScale[0], type.cabinScale[1], 1);
    setPart(meshes.shadows, index, root, 0, 0, 0.025, 1.14, 2.36, 1);

    for (const x of [-0.9, 0.9]) {
      for (const y of [-1.38, 1.38]) {
        setPart(meshes.wheels, wheelIndex, root, x, y, 0.36);
        wheelIndex += 1;
      }
    }
    for (const x of [-0.52, 0.52]) {
      setPart(meshes.headlights, headlightIndex, root, x, 2.13, 0.59);
      setPart(meshes.tailLights, tailLightIndex, root, x, -2.13, 0.59);
      headlightIndex += 1;
      tailLightIndex += 1;
    }

    bodyColor.setHex(vehicle.color);
    meshes.body.setColorAt(index, bodyColor);
    meshes.roof.setColorAt(index, bodyColor);
  });

  meshes.body.count = vehicles.length;
  meshes.glass.count = vehicles.length;
  meshes.roof.count = vehicles.length;
  meshes.shadows.count = vehicles.length;
  meshes.wheels.count = wheelIndex;
  meshes.headlights.count = headlightIndex;
  meshes.tailLights.count = tailLightIndex;
  for (const mesh of [meshes.body, meshes.glass, meshes.roof, meshes.shadows, meshes.wheels, meshes.headlights, meshes.tailLights]) {
    mesh.instanceMatrix.needsUpdate = true;
  }
  if (meshes.body.instanceColor) meshes.body.instanceColor.needsUpdate = true;
  if (meshes.roof.instanceColor) meshes.roof.instanceColor.needsUpdate = true;
}

export function createCinematicLayer(trafficData, treeInventory = [], facadeData = {}) {
  const routes = prepareTrafficRoutes(trafficData.routes || []);
  const treeChunks = chunkTreeInventory(treeInventory);
  let map;
  let renderer;
  let scene;
  let camera;
  let meshes;
  let treeMeshes;
  let facadeSystem;
  let vehicles = [];
  let visibleTrees = [];
  let updateTimer;
  let moveHandler;
  let moveEndHandler;
  let theme = "day";
  let trafficEnabled = true;
  let treesEnabled = true;
  let facadesEnabled = true;
  let reduced = false;

  const origin = window.maplibregl.MercatorCoordinate.fromLngLat(CENTER, 0);
  const anchorMatrix = new THREE.Matrix4()
    .makeTranslation(origin.x, origin.y, origin.z)
    .scale(new THREE.Vector3(origin.meterInMercatorCoordinateUnits(), -origin.meterInMercatorCoordinateUnits(), origin.meterInMercatorCoordinateUnits()));

  const customLayer = {
    id: "lima-cinematic-traffic",
    type: "custom",
    renderingMode: "3d",
    onAdd(nextMap, gl) {
      map = nextMap;
      camera = new THREE.Camera();
      scene = new THREE.Scene();
      const ambient = new THREE.HemisphereLight(0xdce9ee, 0x25342d, 1.55);
      ambient.name = "traffic-ambient";
      scene.add(ambient);
      const sun = new THREE.DirectionalLight(0xffead1, 2.35);
      sun.name = "traffic-sun";
      sun.position.set(-80, -120, 180).normalize();
      scene.add(sun);
      meshes = createVehicleMeshes(scene);
      treeMeshes = createTreeMeshes(scene);
      facadeSystem = createFacadeSystem(scene, facadeData);
      renderer = new THREE.WebGLRenderer({ canvas: map.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
    },
    render(gl, args) {
      const hasVehicles = trafficEnabled && vehicles.length > 0;
      const hasTrees = treesEnabled && visibleTrees.length > 0;
      const hasFacades = facadesEnabled && (facadeSystem?.visibleCount || 0) > 0;
      if (!renderer || (!hasVehicles && !hasTrees && !hasFacades)) return;
      if (hasVehicles) updateVehicleMeshes(meshes, vehicles, performance.now() / 1_000);
      const mapMatrix = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      camera.projectionMatrix = mapMatrix.multiply(anchorMatrix);
      renderer.resetState();
      renderer.render(scene, camera);
    },
    onRemove() {
      for (const mesh of [...Object.values(meshes || {}), ...Object.values(treeMeshes || {})]) {
        if (mesh?.isMesh) {
          mesh.geometry.dispose();
          mesh.material.dispose();
        }
      }
      facadeSystem?.dispose();
      renderer?.dispose();
    },
  };

  const manager = {
    id: customLayer.id,
    totalRoutes: routes.length,
    totalTrees: treeInventory.length,
    get visibleVehicles() {
      return vehicles.length;
    },
    get visibleTreeCount() {
      return visibleTrees.length;
    },
    get visibleFacadeCount() {
      return facadeSystem?.visibleCount || 0;
    },
    addTo(nextMap, beforeId) {
      map = nextMap;
      map.addLayer(customLayer, beforeId);
      moveHandler = () => this.scheduleUpdate(420);
      moveEndHandler = () => this.scheduleUpdate(60);
      map.on("move", moveHandler);
      map.on("moveend", moveEndHandler);
      this.update();
      this.setTheme(theme);
    },
    scheduleUpdate(delay = 160) {
      window.clearTimeout(updateTimer);
      updateTimer = window.setTimeout(() => this.update(), delay);
    },
    update() {
      vehicles = trafficEnabled ? vehicleCandidates(map, routes, reduced) : [];
      visibleTrees = treesEnabled ? treeCandidates(map, treeChunks, reduced) : [];
      if (treeMeshes) updateTreeMeshes(treeMeshes, visibleTrees, theme);
      facadeSystem?.update(map, reduced);
      map?.triggerRepaint();
    },
    setVisible(nextVisible) {
      trafficEnabled = nextVisible;
      this.update();
    },
    setTreeVisible(nextVisible) {
      treesEnabled = nextVisible;
      this.update();
    },
    setFacadeVisible(nextVisible) {
      facadesEnabled = nextVisible;
      facadeSystem?.setVisible(nextVisible, map);
      map?.triggerRepaint();
    },
    setReduced(nextReduced) {
      reduced = nextReduced;
      this.update();
    },
    setTheme(nextTheme) {
      theme = ["day", "golden", "night"].includes(nextTheme) ? nextTheme : "day";
      if (!scene || !meshes) return;
      const ambient = scene.getObjectByName("traffic-ambient");
      const sun = scene.getObjectByName("traffic-sun");
      const settings = {
        day: { ambient: 1.55, sun: 2.35, glass: 0x162a31, head: 0.65, tail: 0.45 },
        golden: { ambient: 1.28, sun: 2.7, glass: 0x202b2e, head: 1.35, tail: 0.75 },
        night: { ambient: 0.52, sun: 0.7, glass: 0x071116, head: 4.8, tail: 2.6 },
      }[theme];
      ambient.intensity = settings.ambient;
      sun.intensity = settings.sun;
      meshes.materials.glassMaterial.color.setHex(settings.glass);
      meshes.materials.headlightMaterial.emissiveIntensity = settings.head;
      meshes.materials.tailLightMaterial.emissiveIntensity = settings.tail;
      if (treeMeshes) updateTreeMeshes(treeMeshes, visibleTrees, theme);
      facadeSystem?.setTheme(theme, map);
    },
    remove() {
      window.clearTimeout(updateTimer);
      map?.off("move", moveHandler);
      map?.off("moveend", moveEndHandler);
      if (map?.getLayer(customLayer.id)) map.removeLayer(customLayer.id);
    },
  };

  return manager;
}
