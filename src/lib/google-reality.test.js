import assert from "node:assert/strict";
import test from "node:test";

import {
  GOOGLE_REALITY_PRESETS,
  OLD_CITY_PRIME_STREET_VIEW,
  loadGoogleMapsConfig,
  moveRealityCamera,
  normalizeGoogleMapsConfig,
  realityPresetFor,
} from "./google-reality.js";

test("runtime configuration accepts only plausible Google browser keys", () => {
  assert.equal(normalizeGoogleMapsConfig({ googleMapsApiKey: "" }).isConfigured, false);
  assert.equal(normalizeGoogleMapsConfig({ googleMapsApiKey: "not-a-key" }).isConfigured, false);
  assert.equal(
    normalizeGoogleMapsConfig({ googleMapsApiKey: `AIza${"a".repeat(35)}`, googleMapId: " demo " }).isConfigured,
    true,
  );
});

test("runtime configuration loads without exposing a key in source", async () => {
  const config = await loadGoogleMapsConfig("/lima-3d/", async (url, options) => {
    assert.equal(url, "/lima-3d/runtime-config.json");
    assert.deepEqual(options, { cache: "no-store" });
    return {
      ok: true,
      async json() {
        return { googleMapsApiKey: `AIza${"b".repeat(35)}`, defaultRealityMode: "google" };
      },
    };
  });
  assert.equal(config.isConfigured, true);
  assert.equal(config.defaultRealityMode, "google");
});

test("Old City Prime has dedicated 3D and Street View camera targets", () => {
  assert.deepEqual(realityPresetFor("oldcity"), GOOGLE_REALITY_PRESETS.oldcity);
  assert.equal(OLD_CITY_PRIME_STREET_VIEW.name, "Old City Prime");
  assert.equal(OLD_CITY_PRIME_STREET_VIEW.address, "215 S Main St, Lima, Ohio");
  assert.ok(Math.abs(OLD_CITY_PRIME_STREET_VIEW.position.lat - 40.7382575) < 0.000001);
  assert.ok(Math.abs(OLD_CITY_PRIME_STREET_VIEW.position.lng + 84.1050414) < 0.000001);
});

test("Google reality flight math stays finite and inside camera limits", () => {
  const moved = moveRealityCamera(
    GOOGLE_REALITY_PRESETS.oldcity,
    { forward: 1, strafe: -1, yaw: 1, climb: 1, tilt: -1, boost: true },
    0.25,
  );
  assert.ok(Number.isFinite(moved.center.lat));
  assert.ok(Number.isFinite(moved.center.lng));
  assert.ok(moved.range >= 24 && moved.range < GOOGLE_REALITY_PRESETS.oldcity.range);
  assert.ok(moved.heading >= 0 && moved.heading < 360);
  assert.ok(moved.tilt >= 5 && moved.tilt <= 88);
});
