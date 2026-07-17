import assert from "node:assert/strict";
import test from "node:test";

import { pointAlongRoute, prepareTrafficRoutes, trafficBudget } from "./traffic-layer.js";

const [route] = prepareTrafficRoutes([
  [5, 10, 0, 2, [[-84.105006, 40.7399785], [-84.104006, 40.7399785], [-84.104006, 40.7409785]]],
]);

test("traffic routes preserve measured distance and direction", () => {
  assert.ok(route.length > 190 && route.length < 210);
  const eastbound = pointAlongRoute(route, 40, 1, 0);
  const westbound = pointAlongRoute(route, 40, -1, 0);
  assert.ok(eastbound.x > 35 && eastbound.x < 45);
  assert.ok(Math.abs(eastbound.y) < 0.01);
  assert.ok(Math.abs(eastbound.heading - Math.PI / 2) < 0.01);
  assert.ok(westbound.y > 40);
  assert.ok(westbound.heading < -3 || westbound.heading > 3);
});

test("traffic detail is zoom bounded and adaptive", () => {
  assert.equal(trafficBudget(14.5), 0);
  assert.equal(trafficBudget(15), 16);
  assert.equal(trafficBudget(17.5), 68);
  assert.equal(trafficBudget(17.5, true), 30);
});
