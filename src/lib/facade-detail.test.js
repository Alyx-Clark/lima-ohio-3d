import test from "node:test";
import assert from "node:assert/strict";

import { facadeBudget, prepareFacadeInventory } from "./facade-detail.js";

test("facade detail is close-range and adaptively bounded", () => {
  assert.equal(facadeBudget(15.9), 0);
  assert.equal(facadeBudget(16.2), 72);
  assert.equal(facadeBudget(17), 128);
  assert.equal(facadeBudget(18, false, 81), 190);
  assert.equal(facadeBudget(18), 220);
  assert.equal(facadeBudget(18, true), 82);
});

test("facade inventory preserves source layout fields and local orientation", () => {
  const inventory = prepareFacadeInventory({
    walls: [[-84.105006, 40.7399785, 1.2, 14.5, 9.2, 0, 3, 42, 3, 8.4, 0, 1, 2]],
  });
  assert.equal(inventory.length, 1);
  assert.equal(inventory[0].x, 0);
  assert.equal(inventory[0].y, 0);
  assert.equal(inventory[0].profile, 3);
  assert.equal(inventory[0].nameIndex, 0);
  assert.equal(inventory[0].length, 14.5);
});
