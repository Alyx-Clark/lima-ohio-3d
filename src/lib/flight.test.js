import test from "node:test";
import assert from "node:assert/strict";

import {
  flightSpeedForZoom,
  formatCoordinates,
  moveCenter,
  normalizeBearing,
} from "./flight.js";

test("normalizes negative and overflowing bearings", () => {
  assert.equal(normalizeBearing(-20), 340);
  assert.equal(normalizeBearing(725), 5);
});

test("moves north when the camera faces north", () => {
  const moved = moveCenter({ lng: -84.105, lat: 40.74 }, 0, 100, 0);
  assert.ok(moved.lat > 40.74);
  assert.ok(Math.abs(moved.lng + 84.105) < 1e-9);
});

test("moves east when strafing right while facing north", () => {
  const moved = moveCenter({ lng: -84.105, lat: 40.74 }, 0, 0, 100);
  assert.ok(moved.lng > -84.105);
  assert.ok(Math.abs(moved.lat - 40.74) < 1e-9);
});

test("camera speed scales with height and boost", () => {
  assert.ok(flightSpeedForZoom(12) > flightSpeedForZoom(17));
  assert.ok(flightSpeedForZoom(16, true) > flightSpeedForZoom(16));
});

test("formats signed geographic coordinates", () => {
  assert.equal(
    formatCoordinates({ lng: -84.105, lat: 40.74 }),
    "40.7400° N · 84.1050° W",
  );
});
