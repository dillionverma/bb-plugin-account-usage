// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "usage-panel.css"), "utf8");

/** The shimmer on both serving elements, inside a sidebar panel with this data-state. */
function animations(state: string | null): string[] {
  const attribute = state === null ? "" : ` data-state="${state}"`;
  document.body.innerHTML = `<style>${css}</style>
    <div data-sidebar="panel"${attribute}><div data-account-usage-mount>
      <span class="bb-account-usage-serving"></span><span class="bb-account-usage-bar-serving"></span>
    </div></div>`;
  return [...document.querySelectorAll("span")].map((span) => getComputedStyle(span).getPropertyValue("animation"));
}

describe("usage panel shimmer", () => {
  // On a phone the closed sidebar stays in the page, covered by the thread.
  // A shimmer there repaints every frame for a panel nobody can see.
  it("stops inside a closed sidebar", () => {
    expect(animations("closed")).toEqual(["none", "none"]);
  });

  it("runs in an open phone sidebar and on desktop", () => {
    for (const state of ["open", null]) {
      for (const animation of animations(state)) expect(animation).toContain("bb-account-usage-shimmer");
    }
  });
});
