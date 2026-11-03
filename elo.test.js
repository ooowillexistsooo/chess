import test from "node:test";
import assert from "node:assert/strict";
import {calculateEloRatings} from "./elo.js";

test("equal-rated players exchange 16 points after a decisive game", () => {
    assert.deepEqual(calculateEloRatings(1200, 1200, 1), {
        white: 1216,
        black: 1184
    });
});

test("draws preserve equal ratings", () => {
    assert.deepEqual(calculateEloRatings(1200, 1200, 0.5), {
        white: 1200,
        black: 1200
    });
});

test("an upset transfers more rating than a predicted win", () => {
    const upset = calculateEloRatings(1000, 1400, 1);
    const expectedWin = calculateEloRatings(1400, 1000, 1);

    assert.ok(upset.white - 1000 > 1400 - expectedWin.white);
    assert.equal(upset.white + upset.black, 2400);
});

test("invalid ratings and scores are rejected", () => {
    assert.throws(() => calculateEloRatings(Number.NaN, 1200, 1), TypeError);
    assert.throws(() => calculateEloRatings(1200, 1200, 0.3), TypeError);
});
