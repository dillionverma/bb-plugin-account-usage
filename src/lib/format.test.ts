import { describe, expect, it } from "vitest";
import { formatReset, timeMarkerPercent } from "./format.ts";

const NOW = 1_789_665_000_000;
const WEEK_MINUTES = 10_080;
const WEEK_MS = WEEK_MINUTES * 60_000;

describe("reset countdown", () => {
  it("has no countdown without a reset and treats elapsed resets as now", () => {
    expect(formatReset(null, NOW)).toBeNull();
    expect(formatReset(NOW - 60_000, NOW)).toBe("resets now");
    expect(formatReset(NOW + 60_000, NOW)).toBe("resets now");
  });

  it.each([
    [12 * 60_000, "resets in 12m"],
    [90 * 60_000, "resets in 1h 30m"],
    [2 * 3_600_000, "resets in 2h"],
    [6 * 86_400_000 + 3 * 3_600_000, "resets in 6d 3h"],
    [7 * 86_400_000, "resets in 7d"],
    [59 * 60_000 + 40_000, "resets in 1h"],
    [119 * 60_000 + 40_000, "resets in 2h"],
    [86_400_000 - 20_000, "resets in 1d"],
    [2 * 86_400_000 - 10 * 60_000, "resets in 2d"],
  ])("formats %i milliseconds as %s", (delta, expected) => {
    expect(formatReset(NOW + delta, NOW)).toBe(expected);
  });
});

describe("time marker", () => {
  it("sits at the midpoint halfway through the window", () => {
    expect(timeMarkerPercent(NOW + WEEK_MS / 2, WEEK_MINUTES, NOW)).toBe(50);
  });

  it("is on the same remaining axis as the fill, not the elapsed one", () => {
    // A quarter of the week gone leaves three quarters ahead: a bar still 80%
    // full is ahead of the marker, which is what 'ahead of budget' has to look
    // like. An elapsed-time marker would have sat at 25% and inverted that.
    expect(timeMarkerPercent(NOW + (WEEK_MS * 3) / 4, WEEK_MINUTES, NOW)).toBe(75);
  });

  it("clamps a window that is longer or shorter than the reported one", () => {
    expect(timeMarkerPercent(NOW + WEEK_MS * 2, WEEK_MINUTES, NOW)).toBe(100);
    expect(timeMarkerPercent(NOW - 1, WEEK_MINUTES, NOW)).toBe(0);
  });

  it("has no position without a reset time or a window length", () => {
    expect(timeMarkerPercent(null, WEEK_MINUTES, NOW)).toBeNull();
    expect(timeMarkerPercent(NOW + WEEK_MS, null, NOW)).toBeNull();
    expect(timeMarkerPercent(NOW + WEEK_MS, 0, NOW)).toBeNull();
  });
});
