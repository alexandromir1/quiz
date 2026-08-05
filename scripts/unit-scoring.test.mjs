import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAnswer } from "../src/lib/scoring.ts";

describe("scoreAnswer", () => {
  it("returns 0 for wrong answers", () => {
    assert.equal(scoreAnswer(false, 0, 20000), 0);
    assert.equal(scoreAnswer(false, 5000, 20000), 0);
  });

  it("gives max points for instant correct answer", () => {
    assert.equal(scoreAnswer(true, 0, 20000), 1000);
  });

  it("gives min correct points at time limit", () => {
    assert.equal(scoreAnswer(true, 20000, 20000), 500);
  });

  it("rewards faster answers with more points", () => {
    const fast = scoreAnswer(true, 1000, 20000);
    const slow = scoreAnswer(true, 10000, 20000);
    assert.ok(fast > slow);
    assert.ok(fast >= 500 && fast <= 1000);
    assert.ok(slow >= 500 && slow <= 1000);
  });
});
