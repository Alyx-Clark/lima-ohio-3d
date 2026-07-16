const EARTH_METERS_PER_DEGREE = 111_320;

export function normalizeBearing(value) {
  return ((value % 360) + 360) % 360;
}

export function moveCenter(center, bearing, forwardMeters, strafeMeters) {
  const angle = (bearing * Math.PI) / 180;
  const east = Math.sin(angle) * forwardMeters + Math.cos(angle) * strafeMeters;
  const north = Math.cos(angle) * forwardMeters - Math.sin(angle) * strafeMeters;
  const latitudeRadians = (center.lat * Math.PI) / 180;
  const longitudeScale = EARTH_METERS_PER_DEGREE * Math.cos(latitudeRadians);

  return {
    lng: center.lng + east / longitudeScale,
    lat: center.lat + north / EARTH_METERS_PER_DEGREE,
  };
}

export function flightSpeedForZoom(zoom, boost = false) {
  const base = 95 * 2 ** (14.5 - zoom);
  return Math.min(3_000, Math.max(8, base)) * (boost ? 3.5 : 1);
}

export function formatCoordinates({ lng, lat }) {
  const northSouth = lat >= 0 ? "N" : "S";
  const eastWest = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${northSouth} · ${Math.abs(lng).toFixed(4)}° ${eastWest}`;
}
