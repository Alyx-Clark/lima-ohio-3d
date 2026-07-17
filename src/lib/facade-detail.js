import * as THREE from "three";

import { localMeters } from "./tree-geometry.js";

const MAX_WINDOWS = 5_400;
const MAX_DOORS = 420;
const MAX_BANDS = 1_800;
const MAX_AWNINGS = 520;
const MAX_VERTICALS = 2_200;
const MAX_LIGHTS = 420;
const MAX_SIGNS = 14;
const CHUNK_SIZE = 0.006;
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const PART_POSITION = new THREE.Vector3();
const PART_SCALE = new THREE.Vector3();
const PART_ROTATION = new THREE.Quaternion();
const PART_LOCAL_MATRIX = new THREE.Matrix4();
const PART_WORLD_MATRIX = new THREE.Matrix4();
const INSTANCE_COLOR = new THREE.Color();

const DETAIL_PALETTES = {
  day: {
    glass: [0x294653, 0x3b5d69, 0x55717a, 0x203a46, 0x6c8186],
    lit: [0x9eb3b3, 0xb7c7c0, 0x8ca9ad],
    frame: [0xe1ddd2, 0xbeb8ab, 0x594d42, 0xd1c7b5, 0x25373c],
    door: [0x5a3028, 0x203f4a, 0x425943, 0x6e6559, 0x763b32],
    accent: [0x8d2f2b, 0x294f63, 0x3e654f, 0xb68a45, 0x342f2c, 0xd2c4a7],
    metal: [0x4a5557, 0x6a7373, 0x2f3b3f, 0x8a8d86],
    lamp: 0xffd99a,
  },
  golden: {
    glass: [0x344c53, 0x4c6062, 0x695f55, 0x293f45, 0x7d7365],
    lit: [0xd5a75e, 0xe1bd78, 0xb9894b],
    frame: [0xdfc7a5, 0xbca58a, 0x61453a, 0xd0b28b, 0x334044],
    door: [0x663329, 0x29444c, 0x4d5b40, 0x77604c, 0x7a3a2d],
    accent: [0x98372b, 0x355b69, 0x4d684b, 0xc08a3f, 0x42342f, 0xd7b986],
    metal: [0x555958, 0x77766f, 0x3d4546, 0x969086],
    lamp: 0xffc875,
  },
  night: {
    glass: [0x091a22, 0x10252c, 0x172d32, 0x07151b, 0x20363a],
    lit: [0xd99b43, 0xf0c66c, 0xc88235, 0xe9b65d],
    frame: [0x4d5552, 0x343d3c, 0x171d1e, 0x62615a, 0x202b2d],
    door: [0x291b19, 0x13252b, 0x213025, 0x302c28, 0x341c1a],
    accent: [0x59201e, 0x173645, 0x25442f, 0x684c25, 0x1e1d1d, 0x5c5547],
    metal: [0x242c2e, 0x343d3e, 0x161d20, 0x444846],
    lamp: 0xffb94f,
  },
};

function hash(seed, salt = 0) {
  let value = (Number(seed) + salt * 2_654_435_761) >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 2_246_822_519);
  value ^= value >>> 13;
  value = Math.imul(value, 3_266_489_917);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

function pick(values, seed, salt) {
  return values[Math.floor(hash(seed, salt) * values.length) % values.length];
}

function intersects(bounds, view) {
  return bounds[0] <= view[2] && bounds[2] >= view[0] && bounds[1] <= view[3] && bounds[3] >= view[1];
}

function paddedViewBounds(map) {
  const bounds = map.getBounds();
  const longitudePadding = (bounds.getEast() - bounds.getWest()) * 0.28;
  const latitudePadding = (bounds.getNorth() - bounds.getSouth()) * 0.28;
  return [
    bounds.getWest() - longitudePadding,
    bounds.getSouth() - latitudePadding,
    bounds.getEast() + longitudePadding,
    bounds.getNorth() + latitudePadding,
  ];
}

export function facadeBudget(zoom, reduced = false, pitch = 0) {
  if (zoom < 16.05) return 0;
  if (reduced) return zoom < 17.25 ? 52 : 82;
  if (zoom < 16.75) return 72;
  if (zoom < 17.4) return 128;
  if (pitch >= 79) return 190;
  return 220;
}

export function prepareFacadeInventory(data = {}) {
  return (data.walls || []).map((raw, index) => {
    const [longitude, latitude, angle, length, height, base, profile, seed, floors, roadDistance, nameIndex, material, tone] = raw;
    const [x, y] = localMeters(longitude, latitude);
    return {
      raw,
      index,
      longitude,
      latitude,
      x,
      y,
      angle,
      length,
      height,
      base,
      profile,
      seed,
      floors,
      roadDistance,
      nameIndex,
      material,
      tone,
    };
  });
}

function chunkFacades(facades) {
  const chunks = new Map();
  for (const facade of facades) {
    const x = Math.floor(facade.longitude / CHUNK_SIZE);
    const y = Math.floor(facade.latitude / CHUNK_SIZE);
    const key = `${x}:${y}`;
    const chunk = chunks.get(key) || {
      facades: [],
      bounds: [x * CHUNK_SIZE, y * CHUNK_SIZE, (x + 1) * CHUNK_SIZE, (y + 1) * CHUNK_SIZE],
    };
    chunk.facades.push(facade);
    chunks.set(key, chunk);
  }
  return [...chunks.values()];
}

function selectFacades(map, chunks, reduced) {
  const budget = facadeBudget(map.getZoom(), reduced, map.getPitch());
  if (!budget) return [];
  const view = paddedViewBounds(map);
  const [centerX, centerY] = localMeters(map.getCenter().lng, map.getCenter().lat);
  return chunks
    .filter((chunk) => intersects(chunk.bounds, view))
    .flatMap((chunk) => chunk.facades)
    .sort((left, right) => {
      const leftDistance = Math.hypot(left.x - centerX, left.y - centerY) + left.roadDistance * 0.15;
      const rightDistance = Math.hypot(right.x - centerX, right.y - centerY) + right.roadDistance * 0.15;
      return leftDistance - rightDistance;
    })
    .slice(0, budget);
}

function addInstancedMesh(scene, geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  scene.add(mesh);
  return mesh;
}

function createMeshes(scene) {
  const opaque = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.03 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.19, metalness: 0.36 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.48, metalness: 0.42 });
  const lamp = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xffc96f,
    emissiveIntensity: 1.1,
    roughness: 0.3,
  });
  const box = () => new THREE.BoxGeometry(1, 1, 1);
  const meshes = {
    frames: addInstancedMesh(scene, box(), opaque, MAX_WINDOWS),
    windows: addInstancedMesh(scene, box(), glass, MAX_WINDOWS),
    sills: addInstancedMesh(scene, box(), opaque, MAX_WINDOWS),
    doors: addInstancedMesh(scene, box(), opaque, MAX_DOORS),
    bands: addInstancedMesh(scene, box(), opaque, MAX_BANDS),
    awnings: addInstancedMesh(scene, box(), opaque, MAX_AWNINGS),
    verticals: addInstancedMesh(scene, box(), metal, MAX_VERTICALS),
    lamps: addInstancedMesh(scene, new THREE.SphereGeometry(0.5, 10, 6), lamp, MAX_LIGHTS),
  };
  return { ...meshes, materials: { opaque, glass, metal, lamp } };
}

function rootMatrix(facade) {
  PART_POSITION.set(facade.x, facade.y, facade.base);
  PART_ROTATION.setFromAxisAngle(Z_AXIS, facade.angle);
  PART_SCALE.set(1, 1, 1);
  return new THREE.Matrix4().compose(PART_POSITION, PART_ROTATION, PART_SCALE);
}

function addPart(state, meshName, root, x, outward, z, width, depth, height, color) {
  const mesh = state.meshes[meshName];
  const index = state.counts[meshName];
  if (!mesh || index >= mesh.instanceMatrix.count) return false;
  PART_POSITION.set(x, outward, z);
  PART_ROTATION.identity();
  PART_SCALE.set(Math.max(0.02, width), Math.max(0.02, depth), Math.max(0.02, height));
  PART_LOCAL_MATRIX.compose(PART_POSITION, PART_ROTATION, PART_SCALE);
  PART_WORLD_MATRIX.multiplyMatrices(root, PART_LOCAL_MATRIX);
  mesh.setMatrixAt(index, PART_WORLD_MATRIX);
  INSTANCE_COLOR.setHex(color);
  mesh.setColorAt(index, INSTANCE_COLOR);
  state.counts[meshName] += 1;
  return true;
}

function addWindow(state, root, x, z, width, height, seed, salt, palette, options = {}) {
  const frameColor = options.frameColor || pick(palette.frame, seed, salt + 1);
  const lit = state.theme === "night" && hash(seed, salt + 2) > 0.47;
  const glassColor = lit ? pick(palette.lit, seed, salt + 3) : pick(palette.glass, seed, salt + 4);
  addPart(state, "frames", root, x, 0.11, z, width + 0.2, 0.11, height + 0.2, frameColor);
  addPart(state, "windows", root, x, 0.19, z, width, 0.08, height, glassColor);
  if (!options.noSill) addPart(state, "sills", root, x, 0.23, z - height / 2 - 0.08, width + 0.28, 0.18, 0.12, frameColor);
  if (options.mullion && width > 1.15) {
    addPart(state, "verticals", root, x, 0.245, z, 0.055, 0.08, height, frameColor);
  }
}

function columnPositions(length, count, margin = 0.75) {
  if (count <= 1) return [0];
  const span = Math.max(0, length - margin * 2);
  const spacing = span / count;
  return Array.from({ length: count }, (_, index) => -span / 2 + spacing * (index + 0.5));
}

function residentialFacade(state, facade, root, palette) {
  const wallHeight = facade.height - facade.base;
  const floors = Math.max(1, Math.min(3, facade.floors));
  const columns = Math.max(2, Math.min(7, Math.floor(facade.length / (2.65 + hash(facade.seed, 10) * 0.9))));
  const positions = columnPositions(facade.length, columns);
  const floorHeight = wallHeight / Math.max(facade.floors, 1);
  const doorColumn = Math.floor(hash(facade.seed, 11) * columns);
  const frameColor = facade.profile === 1 ? 0xc5ad8c : pick(palette.frame, facade.seed, 12);
  addPart(state, "bands", root, 0, 0.08, 0.24, Math.max(1.5, facade.length - 0.15), 0.13, 0.48, pick(palette.metal, facade.seed, 13));

  for (let floor = 0; floor < floors; floor += 1) {
    const centerZ = Math.min(wallHeight - 0.65, floorHeight * floor + Math.min(1.62, floorHeight * 0.55));
    for (let column = 0; column < columns; column += 1) {
      if (floor === 0 && column === doorColumn) continue;
      const jitter = (hash(facade.seed, 30 + floor * 11 + column) - 0.5) * 0.12;
      const width = Math.min(1.38, Math.max(0.72, facade.length / columns * (0.42 + hash(facade.seed, 50 + column) * 0.12)));
      const height = Math.min(1.58, Math.max(1.02, floorHeight * 0.45 + jitter));
      addWindow(state, root, positions[column], centerZ, width, height, facade.seed, floor * 41 + column, palette, {
        frameColor,
        mullion: facade.profile !== 2 && hash(facade.seed, 70 + column) > 0.46,
      });
      if (facade.profile === 0 && hash(facade.seed, 90 + column) > 0.63) {
        addPart(state, "verticals", root, positions[column] - width / 2 - 0.12, 0.23, centerZ, 0.11, 0.1, height + 0.15, pick(palette.accent, facade.seed, column));
        addPart(state, "verticals", root, positions[column] + width / 2 + 0.12, 0.23, centerZ, 0.11, 0.1, height + 0.15, pick(palette.accent, facade.seed, column));
      }
    }
  }

  const doorX = positions[doorColumn] + (hash(facade.seed, 14) - 0.5) * 0.18;
  const doorHeight = Math.min(2.25, wallHeight - 0.25);
  addPart(state, "doors", root, doorX, 0.2, doorHeight / 2, 0.96, 0.15, doorHeight, pick(palette.door, facade.seed, 15));
  addWindow(state, root, doorX, doorHeight * 0.68, 0.32, 0.42, facade.seed, 16, palette, { noSill: true });
  if (hash(facade.seed, 17) > 0.36) {
    addPart(state, "awnings", root, doorX, 0.52, Math.min(wallHeight - 0.25, doorHeight + 0.18), 2.1, 0.95, 0.13, pick(palette.accent, facade.seed, 18));
  }
  for (const side of [-1, 1]) {
    addPart(state, "verticals", root, side * (facade.length / 2 - 0.18), 0.17, wallHeight * 0.48, 0.11, 0.11, wallHeight * 0.9, pick(palette.metal, facade.seed, 19 + side));
  }
}

function storefrontFacade(state, facade, root, palette) {
  const wallHeight = facade.height - facade.base;
  const groundHeight = Math.min(3.05, wallHeight * 0.72);
  const bays = Math.max(2, Math.min(10, Math.floor(facade.length / 2.7)));
  const positions = columnPositions(facade.length, bays, 0.4);
  const spacing = Math.max(1.5, (facade.length - 0.8) / bays);
  const doorBay = Math.floor(hash(facade.seed, 101) * bays);
  positions.forEach((position, index) => {
    if (index === doorBay) {
      addPart(state, "doors", root, position, 0.2, groundHeight * 0.47, Math.min(1.12, spacing * 0.48), 0.14, groundHeight * 0.88, pick(palette.door, facade.seed, index));
      addWindow(state, root, position, groundHeight * 0.62, Math.min(0.64, spacing * 0.28), groundHeight * 0.42, facade.seed, 110 + index, palette, { noSill: true });
    } else {
      addWindow(state, root, position, groundHeight * 0.49, Math.min(2.35, spacing * 0.8), groundHeight * 0.76, facade.seed, 120 + index, palette, { noSill: true, mullion: true });
    }
    if (hash(facade.seed, 130 + index) > 0.28) {
      addPart(state, "awnings", root, position, 0.57, Math.min(wallHeight - 0.2, groundHeight + 0.12), Math.min(2.45, spacing * 0.88), 1.05, 0.14, pick(palette.accent, facade.seed, 140 + index));
    }
  });
  addPart(state, "bands", root, 0, 0.14, Math.min(wallHeight - 0.45, groundHeight + 0.62), Math.max(2, facade.length - 0.35), 0.16, 0.78, pick(palette.accent, facade.seed, 151));

  const upperFloors = Math.max(0, Math.min(4, facade.floors - 1));
  for (let floor = 0; floor < upperFloors; floor += 1) {
    const z = groundHeight + 1.3 + floor * Math.max(2.35, (wallHeight - groundHeight) / Math.max(1, upperFloors));
    if (z >= wallHeight - 0.35) continue;
    positions.slice(0, Math.min(8, positions.length)).forEach((position, index) => {
      addWindow(state, root, position, z, Math.min(1.42, spacing * 0.54), 1.48, facade.seed, 170 + floor * 17 + index, palette, { mullion: true });
    });
  }
}

function civicFacade(state, facade, root, palette) {
  const wallHeight = facade.height - facade.base;
  const columns = Math.max(2, Math.min(9, Math.floor(facade.length / 3.5)));
  const positions = columnPositions(facade.length, columns, 0.7);
  const floorHeight = wallHeight / Math.max(1, facade.floors);
  const visibleFloors = Math.min(4, facade.floors);
  for (let floor = 0; floor < visibleFloors; floor += 1) {
    const z = Math.min(wallHeight - 0.55, floorHeight * floor + Math.min(1.75, floorHeight * 0.56));
    positions.forEach((position, index) => {
      if (floor === 0 && (index === Math.floor(columns / 2) || index === Math.floor((columns - 1) / 2))) return;
      addWindow(state, root, position, z, Math.min(1.5, facade.length / columns * 0.47), Math.min(2.05, floorHeight * 0.58), facade.seed, 210 + floor * 13 + index, palette, { mullion: true });
    });
  }
  for (let index = 0; index <= columns; index += 1) {
    const x = -facade.length / 2 + (facade.length / columns) * index;
    addPart(state, "verticals", root, x, 0.16, wallHeight * 0.48, 0.18, 0.14, wallHeight * 0.92, pick(palette.frame, facade.seed, 240 + index));
  }
  addPart(state, "bands", root, 0, 0.16, wallHeight - 0.4, facade.length, 0.2, 0.48, pick(palette.frame, facade.seed, 250));
  const doorHeight = Math.min(2.65, wallHeight - 0.25);
  addPart(state, "doors", root, 0, 0.21, doorHeight / 2, Math.min(2.2, facade.length * 0.2), 0.16, doorHeight, pick(palette.door, facade.seed, 251));
  addPart(state, "awnings", root, 0, 0.8, Math.min(wallHeight - 0.22, doorHeight + 0.22), Math.min(4.2, facade.length * 0.35), 1.5, 0.18, pick(palette.metal, facade.seed, 252));
}

function industrialFacade(state, facade, root, palette) {
  const wallHeight = facade.height - facade.base;
  const bays = Math.max(1, Math.min(10, Math.floor(facade.length / 5.4)));
  const positions = columnPositions(facade.length, bays, 0.7);
  const spacing = (facade.length - 1.4) / bays;
  positions.forEach((position, index) => {
    const bayHeight = Math.min(3.75, wallHeight * 0.7);
    addPart(state, "doors", root, position, 0.18, bayHeight / 2, Math.min(4.1, spacing * 0.76), 0.13, bayHeight, pick(palette.metal, facade.seed, 300 + index));
    const slats = Math.max(2, Math.min(5, Math.floor(bayHeight / 0.72)));
    for (let slat = 1; slat < slats; slat += 1) {
      addPart(state, "bands", root, position, 0.27, (bayHeight / slats) * slat, Math.min(4.1, spacing * 0.76), 0.07, 0.055, pick(palette.frame, facade.seed, 310 + index));
    }
    if (wallHeight > 4.2) {
      addWindow(state, root, position, Math.min(wallHeight - 0.65, bayHeight + 0.82), Math.min(2.5, spacing * 0.64), 0.72, facade.seed, 330 + index, palette, { noSill: true, mullion: true });
    }
  });
  for (let index = 0; index <= bays; index += 1) {
    const x = -facade.length / 2 + (facade.length / bays) * index;
    addPart(state, "verticals", root, x, 0.15, wallHeight * 0.5, 0.1, 0.1, wallHeight, pick(palette.metal, facade.seed, 350 + index));
  }
}

function institutionalFacade(state, facade, root, palette) {
  const wallHeight = facade.height - facade.base;
  const floors = Math.max(1, Math.min(5, facade.floors));
  const floorHeight = wallHeight / Math.max(1, facade.floors);
  const columns = Math.max(2, Math.min(10, Math.floor(facade.length / 3.15)));
  const positions = columnPositions(facade.length, columns, 0.55);
  const spacing = (facade.length - 1.1) / columns;
  for (let floor = 0; floor < floors; floor += 1) {
    const z = Math.min(wallHeight - 0.48, floorHeight * floor + floorHeight * 0.56);
    positions.forEach((position, index) => {
      const isEntrance = floor === 0 && Math.abs(index - (columns - 1) / 2) < 0.75;
      if (isEntrance) return;
      addWindow(state, root, position, z, Math.min(2.35, spacing * 0.78), Math.min(1.42, floorHeight * 0.48), facade.seed, 400 + floor * 17 + index, palette, { noSill: true, mullion: true });
    });
    addPart(state, "bands", root, 0, 0.12, Math.min(wallHeight - 0.15, floorHeight * (floor + 1) - 0.16), facade.length - 0.2, 0.12, 0.16, pick(palette.metal, facade.seed, 430 + floor));
  }
  const doorHeight = Math.min(2.55, wallHeight - 0.25);
  addPart(state, "doors", root, 0, 0.2, doorHeight / 2, Math.min(2.4, facade.length * 0.18), 0.15, doorHeight, pick(palette.door, facade.seed, 450));
  addPart(state, "awnings", root, 0, 1.05, Math.min(wallHeight - 0.2, doorHeight + 0.17), Math.min(5.2, facade.length * 0.36), 2.05, 0.16, pick(palette.accent, facade.seed, 451));
}

function addWallLamp(state, facade, root, palette) {
  if (hash(facade.seed, 510) < 0.48 || facade.length < 5) return;
  const wallHeight = facade.height - facade.base;
  const x = (hash(facade.seed, 511) - 0.5) * Math.min(facade.length * 0.72, 10);
  addPart(state, "verticals", root, x, 0.32, Math.min(wallHeight - 0.3, 2.45), 0.08, 0.42, 0.24, pick(palette.metal, facade.seed, 512));
  addPart(state, "lamps", root, x, 0.57, Math.min(wallHeight - 0.28, 2.38), 0.18, 0.18, 0.18, palette.lamp);
}

function clearSigns(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose();
    child.material?.map?.dispose();
    child.material?.dispose();
  }
}

function fitSignText(context, text, maxWidth) {
  let size = 58;
  do {
    context.font = `700 ${size}px system-ui, sans-serif`;
    if (context.measureText(text).width <= maxWidth) return;
    size -= 2;
  } while (size > 22);
}

function addNamedSigns(state, facades, names) {
  clearSigns(state.signs);
  let count = 0;
  for (const facade of facades) {
    if (count >= MAX_SIGNS || facade.nameIndex < 0) continue;
    const name = names[facade.nameIndex];
    if (!name) continue;
    const wallHeight = facade.height - facade.base;
    const width = Math.min(facade.length * 0.7, Math.max(2.8, Math.min(8.4, name.length * 0.29)));
    const height = facade.profile === 3 ? 0.72 : 0.62;
    const z = Math.min(wallHeight - height / 2 - 0.22, facade.profile === 3 ? 3.55 : 2.75);
    if (z < 1.15) continue;

    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 96;
    const context = canvas.getContext("2d", { alpha: false });
    const dark = state.theme === "night";
    context.fillStyle = dark ? "#171d1d" : facade.profile === 3 ? "#eee4cf" : "#293634";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = dark ? "#c89a50" : facade.profile === 3 ? "#5c3029" : "#d2b66f";
    context.lineWidth = 6;
    context.strokeRect(3, 3, canvas.width - 6, canvas.height - 6);
    context.fillStyle = dark ? "#f0bd65" : facade.profile === 3 ? "#432a27" : "#f0dfb0";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const label = name.toLocaleUpperCase();
    fitSignText(context, label, 468);
    context.fillText(label, 256, 51);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: false, side: THREE.DoubleSide });
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, material);
    const root = rootMatrix(facade);
    PART_POSITION.set(0, 0.31, z);
    PART_ROTATION.identity();
    PART_SCALE.set(width, 1, height);
    PART_LOCAL_MATRIX.compose(PART_POSITION, PART_ROTATION, PART_SCALE);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.multiplyMatrices(root, PART_LOCAL_MATRIX);
    mesh.renderOrder = 4;
    state.signs.add(mesh);
    count += 1;
  }
}

function updateMeshes(state, facades, names, theme) {
  state.theme = theme;
  const palette = DETAIL_PALETTES[theme] || DETAIL_PALETTES.day;
  state.counts = Object.fromEntries(
    Object.entries(state.meshes)
      .filter(([, value]) => value?.isInstancedMesh)
      .map(([key]) => [key, 0]),
  );

  for (const facade of facades) {
    const root = rootMatrix(facade);
    if (facade.profile <= 2) residentialFacade(state, facade, root, palette);
    else if (facade.profile === 3) storefrontFacade(state, facade, root, palette);
    else if (facade.profile === 4) civicFacade(state, facade, root, palette);
    else if (facade.profile === 5) industrialFacade(state, facade, root, palette);
    else institutionalFacade(state, facade, root, palette);
    addWallLamp(state, facade, root, palette);
  }

  for (const [key, mesh] of Object.entries(state.meshes)) {
    if (!mesh?.isInstancedMesh) continue;
    mesh.count = state.counts[key] || 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  state.meshes.materials.glass.emissive.setHex(theme === "night" ? 0x2d2112 : 0x000000);
  state.meshes.materials.glass.emissiveIntensity = theme === "night" ? 0.55 : 0;
  state.meshes.materials.lamp.emissive.setHex(palette.lamp);
  state.meshes.materials.lamp.emissiveIntensity = theme === "night" ? 4.2 : 0.75;
  addNamedSigns(state, facades, names);
}

export function createFacadeSystem(scene, data = {}) {
  const facades = prepareFacadeInventory(data);
  const chunks = chunkFacades(facades);
  const meshes = createMeshes(scene);
  const signs = new THREE.Group();
  signs.name = "facade-signs";
  scene.add(signs);
  const state = { meshes, signs, counts: {}, theme: "day" };
  let visible = [];
  let enabled = true;
  let reduced = false;

  return {
    total: facades.length,
    get visibleCount() {
      return visible.length;
    },
    update(map, nextReduced = reduced) {
      reduced = nextReduced;
      visible = enabled ? selectFacades(map, chunks, reduced) : [];
      updateMeshes(state, visible, data.names || [], state.theme);
    },
    setTheme(theme, map) {
      state.theme = DETAIL_PALETTES[theme] ? theme : "day";
      if (map) this.update(map, reduced);
    },
    setVisible(nextEnabled, map) {
      enabled = nextEnabled;
      if (map) this.update(map, reduced);
    },
    dispose() {
      clearSigns(signs);
      scene.remove(signs);
      const disposedMaterials = new Set();
      for (const mesh of Object.values(meshes)) {
        if (!mesh?.isInstancedMesh) continue;
        mesh.geometry.dispose();
        if (!disposedMaterials.has(mesh.material)) {
          mesh.material.dispose();
          disposedMaterials.add(mesh.material);
        }
      }
    },
  };
}
