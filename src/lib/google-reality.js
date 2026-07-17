import { importLibrary, setOptions } from "@googlemaps/js-api-loader";

const GOOGLE_KEY_PATTERN = /^AIza[0-9A-Za-z_-]{30,}$/;

export const GOOGLE_REALITY_PRESETS = Object.freeze({
  overview: {
    center: { lat: 40.7399785, lng: -84.105006, altitude: 650 },
    range: 11_500,
    tilt: 48,
    heading: 342,
  },
  downtown: {
    center: { lat: 40.7404, lng: -84.1052, altitude: 44 },
    range: 1_050,
    tilt: 67,
    heading: 329,
  },
  oldcity: {
    center: { lat: 40.73852, lng: -84.10486, altitude: 18 },
    range: 132,
    tilt: 73,
    heading: 274,
  },
  museum: {
    center: { lat: 40.7406108, lng: -84.1138168, altitude: 25 },
    range: 330,
    tilt: 68,
    heading: 55,
  },
  schoonover: {
    center: { lat: 40.7490924, lng: -84.096361, altitude: 32 },
    range: 1_050,
    tilt: 64,
    heading: 28,
  },
  unoh: {
    center: { lat: 40.7615, lng: -84.1567, altitude: 65 },
    range: 2_300,
    tilt: 59,
    heading: 312,
  },
  street: {
    center: { lat: 40.74057, lng: -84.10166, altitude: 12 },
    range: 105,
    tilt: 78,
    heading: 180,
  },
});

export const OLD_CITY_PRIME_STREET_VIEW = Object.freeze({
  name: "Old City Prime",
  address: "215 S Main St, Lima, Ohio",
  position: { lat: 40.7382575, lng: -84.1050414 },
  pov: { heading: 93.78, pitch: 8 },
  zoom: 1,
});

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeGoogleMapsConfig(value = {}) {
  const googleMapsApiKey = typeof value.googleMapsApiKey === "string" ? value.googleMapsApiKey.trim() : "";
  const googleMapId = typeof value.googleMapId === "string" ? value.googleMapId.trim() : "";
  return {
    googleMapsApiKey,
    googleMapId,
    defaultRealityMode: value.defaultRealityMode === "open" ? "open" : "google",
    isConfigured: GOOGLE_KEY_PATTERN.test(googleMapsApiKey),
  };
}

export async function loadGoogleMapsConfig(baseUrl, fetchImplementation = globalThis.fetch) {
  const buildConfig = normalizeGoogleMapsConfig({
    googleMapsApiKey: import.meta.env?.VITE_GOOGLE_MAPS_API_KEY,
    googleMapId: import.meta.env?.VITE_GOOGLE_MAP_ID,
    defaultRealityMode: import.meta.env?.VITE_DEFAULT_REALITY_MODE,
  });
  if (buildConfig.isConfigured) return buildConfig;
  if (typeof fetchImplementation !== "function") return buildConfig;

  try {
    const response = await fetchImplementation(`${baseUrl}runtime-config.json`, { cache: "no-store" });
    if (!response.ok) return buildConfig;
    return normalizeGoogleMapsConfig(await response.json());
  } catch {
    return buildConfig;
  }
}

export function realityPresetFor(name) {
  return GOOGLE_REALITY_PRESETS[name] || GOOGLE_REALITY_PRESETS.overview;
}

export function moveRealityCamera(camera, movement, deltaSeconds) {
  const range = Math.max(24, finiteNumber(camera.range, 1_000));
  const heading = finiteNumber(camera.heading, 0);
  const tilt = finiteNumber(camera.tilt, 60);
  const center = camera.center || GOOGLE_REALITY_PRESETS.overview.center;
  const boost = movement.boost ? 3.2 : 1;
  const meters = (range * 0.095 + 5) * boost * Math.max(0, deltaSeconds);
  const forward = finiteNumber(movement.forward, 0) * meters;
  const strafe = finiteNumber(movement.strafe, 0) * meters;
  const radians = (heading * Math.PI) / 180;
  const northMeters = Math.cos(radians) * forward - Math.sin(radians) * strafe;
  const eastMeters = Math.sin(radians) * forward + Math.cos(radians) * strafe;
  const latitude = finiteNumber(center.lat, GOOGLE_REALITY_PRESETS.overview.center.lat);
  const longitude = finiteNumber(center.lng, GOOGLE_REALITY_PRESETS.overview.center.lng);
  const latScale = 111_320;
  const lngScale = Math.max(1, latScale * Math.cos((latitude * Math.PI) / 180));
  const climb = finiteNumber(movement.climb, 0);

  return {
    center: {
      lat: latitude + northMeters / latScale,
      lng: longitude + eastMeters / lngScale,
      altitude: Math.max(0, finiteNumber(center.altitude, 0)),
    },
    range: Math.max(24, Math.min(30_000, range * Math.exp(-climb * 1.45 * deltaSeconds))),
    heading: ((heading + finiteNumber(movement.yaw, 0) * 50 * deltaSeconds) % 360 + 360) % 360,
    tilt: Math.max(5, Math.min(88, tilt + finiteNumber(movement.tilt, 0) * 32 * deltaSeconds)),
  };
}

function copyCamera(camera) {
  return {
    center: { ...camera.center },
    range: camera.range,
    tilt: camera.tilt,
    heading: camera.heading,
  };
}

export function createGoogleRealityController({
  mapContainer,
  streetContainer,
  onStatus = () => {},
  onCamera = () => {},
  onStreetStatus = () => {},
}) {
  let map3d;
  let panorama;
  let panoramaPromise;
  let camera = copyCamera(GOOGLE_REALITY_PRESETS.overview);
  let initialized = false;
  let streetVisible = false;

  function publishCamera() {
    onCamera(copyCamera(camera));
  }

  async function ensureStreetView() {
    if (panorama) return panorama;
    if (!panoramaPromise) {
      panoramaPromise = importLibrary("streetView")
        .then(({ StreetViewPanorama }) => {
          const nextPanorama = new StreetViewPanorama(streetContainer, {
            position: OLD_CITY_PRIME_STREET_VIEW.position,
            pov: OLD_CITY_PRIME_STREET_VIEW.pov,
            zoom: OLD_CITY_PRIME_STREET_VIEW.zoom,
            visible: false,
            addressControl: true,
            clickToGo: true,
            fullscreenControl: true,
            imageDateControl: true,
            linksControl: true,
            motionTracking: false,
            motionTrackingControl: false,
            panControl: true,
            zoomControl: true,
          });
          nextPanorama.addListener("status_changed", () =>
            onStreetStatus(nextPanorama.getStatus?.() || "UNKNOWN"),
          );
          nextPanorama.addListener("position_changed", () => {
            const position = nextPanorama.getPosition?.();
            if (!position) return;
            onStreetStatus("LIVE", { lat: position.lat(), lng: position.lng() });
          });
          panorama = nextPanorama;
          return nextPanorama;
        })
        .catch((error) => {
          panoramaPromise = undefined;
          throw error;
        });
    }
    return panoramaPromise;
  }

  return {
    get initialized() {
      return initialized;
    },
    get streetVisible() {
      return streetVisible;
    },
    get camera() {
      return copyCamera(camera);
    },
    async initialize(config) {
      if (initialized) return;
      if (!config?.isConfigured) throw new Error("A valid Google Maps Platform API key is required.");
      onStatus("CONNECTING GOOGLE 3D");
      setOptions({
        key: config.googleMapsApiKey,
        v: "beta",
        authReferrerPolicy: "origin",
      });
      const { Map3DElement } = await importLibrary("maps3d");

      const options = {
        ...copyCamera(camera),
        mode: "HYBRID",
        gestureHandling: "GREEDY",
        bounds: { south: 40.64, west: -84.23, north: 40.84, east: -83.97 },
        minAltitude: 0,
        maxAltitude: 18_000,
        minTilt: 0,
        maxTilt: 88,
        description: "Google photorealistic 3D view of Lima, Ohio",
      };
      if (config.googleMapId) options.mapId = config.googleMapId;
      map3d = new Map3DElement(options);
      map3d.id = "google-map-3d";
      map3d.setAttribute("aria-label", "Google photorealistic three-dimensional map of Lima, Ohio");
      mapContainer.replaceChildren(map3d);

      initialized = true;
      onStatus("GOOGLE REALITY READY");
      publishCamera();
    },
    async flyTo(name, durationMillis = 2_400) {
      if (!map3d) return false;
      camera = copyCamera(realityPresetFor(name));
      map3d.stopCameraAnimation();
      await map3d.flyCameraTo({ endCamera: copyCamera(camera), durationMillis });
      publishCamera();
      return true;
    },
    async startOrbit() {
      if (!map3d) return false;
      const target = copyCamera(GOOGLE_REALITY_PRESETS.downtown);
      camera = target;
      map3d.stopCameraAnimation();
      await map3d.flyCameraAround({ camera: target, durationMillis: 26_000, repeatCount: Number.POSITIVE_INFINITY });
      publishCamera();
      return true;
    },
    stopAnimation() {
      map3d?.stopCameraAnimation();
    },
    move(movement, deltaSeconds) {
      if (!map3d) return false;
      map3d.stopCameraAnimation();
      camera = moveRealityCamera(camera, movement, deltaSeconds);
      map3d.center = camera.center;
      map3d.range = camera.range;
      map3d.heading = camera.heading;
      map3d.tilt = camera.tilt;
      publishCamera();
      return true;
    },
    async showOldCityPrimeStreetView() {
      if (!initialized) return false;
      streetVisible = true;
      onStreetStatus("LOADING");
      const nextPanorama = await ensureStreetView();
      if (!streetVisible) {
        nextPanorama.setVisible(false);
        return false;
      }
      nextPanorama.setPosition(OLD_CITY_PRIME_STREET_VIEW.position);
      nextPanorama.setPov(OLD_CITY_PRIME_STREET_VIEW.pov);
      nextPanorama.setZoom(OLD_CITY_PRIME_STREET_VIEW.zoom);
      nextPanorama.setVisible(true);
      return true;
    },
    hideStreetView() {
      panorama?.setVisible(false);
      streetVisible = false;
      onStreetStatus("CLOSED");
    },
  };
}
