import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "usage-panel.css"), "utf8");

describe("usage panel styles", () => {
  // A closed phone drawer stays in the page, so an endless animation there
  // repaints every frame for a panel nobody can see.
  it("stops every endless animation inside a closed sidebar", () => {
    const animated = [...css.matchAll(/\.([\w-]+)\s*\{[^}]*animation:[^;}]*infinite/g)].map((match) => match[1]);
    const stopped = [...css.matchAll(/\[data-state="closed"\][^{]*\{\s*animation:\s*none;?\s*\}/g)].map((match) => match[0]);
    expect(animated.length).toBeGreaterThan(0);
    for (const name of animated) expect(stopped.some((rule) => rule.includes(`.${name}`))).toBe(true);
  });
});
