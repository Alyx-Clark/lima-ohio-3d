import * as THREE from "three";

const CENTER = [-84.105006, 40.7399785];
const EARTH_METERS_PER_DEGREE = 111_320;
const CHUNK_METERS = 650;

const PALETTES = {
  day: ["#3f8d4c", "#4f9e59", "#61aa67", "#71955a"],
  golden: ["#527d3f", "#648c45", "#78984c", "#899354"],
  night: ["#254b33", "#2f5a3b", "#396846", "#496044"],
};

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
  const longitudePadding = (east - west) * 0.22;
  const latitudePadding = (north - south) * 0.22;
  return [west - longitudePadding, south - latitudePadding, east + longitudePadding, north + latitudePadding];
}

function createMeshes(chunk, geometries, materials) {
  const count = chunk.trees.length;
  const trunk = new THREE.InstancedMesh(geometries.trunk, materials.trunk, count);
  const crownLow = new THREE.InstancedMesh(geometries.crownLow, materials.crown, count);
  const crownHigh = new THREE.InstancedMesh(geometries.crownHigh, materials.crown, count);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const rotation = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);

  for (let index = 0; index < count; index += 1) {
    const { raw, x, y } = chunk.trees[index];
    const [, , height, crownRadius, variant] = raw;
    const trunkHeight = Math.max(1.8, height * 0.42);
    const trunkRadius = Math.max(0.16, Math.min(0.48, height * 0.026));
    const crownHeight = Math.max(2.2, height - trunkHeight * 0.68);
    const angle = ((variant * 71 + index * 29) % 360) * (Math.PI / 180);
    rotation.setFromAxisAngle(zAxis, angle);

    position.set(x, y, trunkHeight / 2);
    scale.set(trunkRadius, trunkRadius, trunkHeight);
    matrix.compose(position, rotation, scale);
    trunk.setMatrixAt(index, matrix);

    position.set(x, y, trunkHeight * 0.72 + crownHeight * 0.43);
    scale.set(crownRadius * 0.94, crownRadius * (0.78 + variant * 0.035), crownHeight * 0.56);
    matrix.compose(position, rotation, scale);
    crownLow.setMatrixAt(index, matrix);
    crownHigh.setMatrixAt(index, matrix);
  }

  for (const mesh of [trunk, crownLow, crownHigh]) {
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
  }
  crownHigh.visible = false;
  return { trunk, crownLow, crownHigh };
}

function applyCrownColors(chunkMeshes, palette) {
  const color = new THREE.Color();
  for (let index = 0; index < chunkMeshes.data.trees.length; index += 1) {
    const variant = chunkMeshes.data.trees[index].raw[4] % palette.length;
    color.set(palette[variant]);
    chunkMeshes.meshes.crownLow.setColorAt(index, color);
    chunkMeshes.meshes.crownHigh.setColorAt(index, color);
  }
  chunkMeshes.meshes.crownLow.instanceColor.needsUpdate = true;
  chunkMeshes.meshes.crownHigh.instanceColor.needsUpdate = true;
}

export function createTreeLayer(maplibregl, trees, options = {}) {
  const center = options.center || CENTER;
  const treeChunks = chunkTreeInventory(trees, options.chunkMeters || CHUNK_METERS);
  const origin = maplibregl.MercatorCoordinate.fromLngLat(center, 0);
  const scale = origin.meterInMercatorCoordinateUnits();
  let theme = "day";

  return {
    id: "lima-lidar-trees",
    type: "custom",
    renderingMode: "3d",
    enabled: true,
    reduced: false,
    totalTrees: trees.length,
    visibleTrees: 0,

    onAdd(map, gl) {
      this.map = map;
      this.camera = new THREE.Camera();
      this.scene = new THREE.Scene();
      this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
      this.scene.add(new THREE.HemisphereLight(0xf2fff2, 0x6d765f, 2.05));
      const sun = new THREE.DirectionalLight(0xfff0d2, 2.35);
      sun.position.set(-0.45, -0.8, 1.4).normalize();
      this.scene.add(sun);

      const trunkGeometry = new THREE.CylinderGeometry(1, 1.12, 1, 7, 1, false);
      trunkGeometry.rotateX(Math.PI / 2);
      const geometries = {
        trunk: trunkGeometry,
        crownLow: new THREE.IcosahedronGeometry(1, 0),
        crownHigh: new THREE.DodecahedronGeometry(1, 1),
      };
      const materials = {
        trunk: new THREE.MeshLambertMaterial({ color: 0x79583d, emissive: 0x1f130c, emissiveIntensity: 0.18 }),
        crown: new THREE.MeshLambertMaterial({
          color: 0xffffff,
          emissive: 0x17351f,
          emissiveIntensity: 0.22,
          vertexColors: true,
        }),
      };

      this.resources = { geometries, materials };
      this.chunks = treeChunks.map((data) => {
        const meshes = createMeshes(data, geometries, materials);
        const group = new THREE.Group();
        group.add(meshes.trunk, meshes.crownLow, meshes.crownHigh);
        group.visible = false;
        this.scene.add(group);
        const chunk = { data, meshes, group };
        applyCrownColors(chunk, PALETTES[theme]);
        return chunk;
      });

      this.renderer = new THREE.WebGLRenderer({
        canvas: map.getCanvas(),
        context: gl,
        antialias: true,
      });
      this.renderer.autoClear = false;
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
    },

    render(gl, args) {
      const zoom = this.map.getZoom();
      const minimumZoom = this.reduced ? 16.1 : 14.7;
      const visible = this.enabled && zoom >= minimumZoom;
      const view = visible ? paddedViewBounds(this.map) : null;
      const highDetail = !this.reduced && zoom >= 16.55;
      const showTrunks = zoom >= 15.8;
      let visibleTrees = 0;

      for (const chunk of this.chunks) {
        const chunkVisible = visible && intersects(chunk.data.bounds, view);
        chunk.group.visible = chunkVisible;
        if (!chunkVisible) continue;
        visibleTrees += chunk.data.trees.length;
        chunk.meshes.trunk.visible = showTrunks;
        chunk.meshes.crownLow.visible = !highDetail;
        chunk.meshes.crownHigh.visible = highDetail;
      }
      this.visibleTrees = visibleTrees;
      if (!visibleTrees) return;

      const projection = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
      const model = new THREE.Matrix4()
        .makeTranslation(origin.x, origin.y, origin.z)
        .scale(new THREE.Vector3(scale, -scale, scale));
      this.camera.projectionMatrix = projection.multiply(model);
      this.renderer.resetState();
      this.renderer.render(this.scene, this.camera);
    },

    setTheme(nextTheme) {
      theme = PALETTES[nextTheme] ? nextTheme : "day";
      if (this.chunks) this.chunks.forEach((chunk) => applyCrownColors(chunk, PALETTES[theme]));
      this.map?.triggerRepaint();
    },

    setVisible(nextVisible) {
      this.enabled = nextVisible;
      this.map?.triggerRepaint();
    },

    setReduced(nextReduced) {
      this.reduced = nextReduced;
      this.map?.triggerRepaint();
    },

    onRemove() {
      if (this.resources) {
        Object.values(this.resources.geometries).forEach((geometry) => geometry.dispose());
        Object.values(this.resources.materials).forEach((material) => material.dispose());
      }
      this.renderer?.dispose();
    },
  };
}
