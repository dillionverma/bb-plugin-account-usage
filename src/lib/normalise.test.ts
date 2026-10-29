import { describe, expect, it } from "vitest";
import { buildGroups, DEFAULT_SWITCH_THRESHOLD, windowLabel } from "./normalise.ts";
import type { AccountSummary, PoolStatus } from "./pool-contracts.ts";

const NOW = 1_789_665_000_000;

describe("window labels", () => {
  it("describes unknown limits without assuming their duration", () => {
    expect(windowLabel(null, "primary")).toBe("Limit");
    expect(windowLabel(null, "secondary")).toBe("Other limit");
    expect(windowLabel(10_080, "primary")).toBe("7D");
    expect(windowLabel(300, "secondary")).toBe("5H");
  });
});

function account(over: Partial<AccountSummary>): AccountSummary {
  return {
    id: "id-1",
    provider: "claude",
    kind: "oauth",
    label: "Alex",
    email: "a@example.com",
    subscriptionType: "max",
    enabled: true,
    priority: 1,
    lastUsedAt: null,
    fiveHourUtilization: null,
    fiveHourResetAt: null,
    fiveHourStatus: null,
    sevenDayUtilization: null,
    sevenDayResetAt: null,
    sevenDayStatus: null,
    familyWeekly: {},
    limitWindows: [],
    observedAt: NOW,
    heldUntil: null,
    error: null,
    inFlight: 0,
    status: "ready",
    ...over,
  };
}

function status(accounts: AccountSummary[]): PoolStatus {
  return {
    accepting: true,
    inFlight: 0,
    enabledAccountCount: accounts.length,
    routing: { claude: true, codex: true },
    accounts,
  };
}

const groupsOf = (accounts: AccountSummary[]) =>
  buildGroups(status(accounts), DEFAULT_SWITCH_THRESHOLD, NOW);

describe("headline reset", () => {
  it("reports the account as full even when its 5h window reads 0%", () => {
    // The real trap: an account sits at 0% on the five-hour window while the
    // seven-day window is rejected. Showing 0% would invite a doomed request.
    const [group] = groupsOf([
      account({
        status: "exhausted",
        fiveHourUtilization: 0,
        fiveHourResetAt: null,
        fiveHourStatus: "allowed",
        sevenDayUtilization: 1,
        sevenDayResetAt: NOW + 80_000_000,
        sevenDayStatus: "rejected",
      }),
    ]);
    const row = group!.accounts[0]!;
    expect(row.status).toBe("exhausted");
    expect(row.resetAt).toBe(NOW + 80_000_000);
    const blocked = row.cells.filter((c) => c?.tone === "blocked");
    expect(blocked).toHaveLength(1);
    expect(blocked[0]!.percent).toBe(100);
  });

  it("waits for the LAST blocking window, not the first", () => {
    const [group] = groupsOf([
      account({
        status: "exhausted",
        fiveHourUtilization: 1,
        fiveHourResetAt: NOW + 1_000,
        fiveHourStatus: "rejected",
        sevenDayUtilization: 1,
        sevenDayResetAt: NOW + 900_000,
        sevenDayStatus: "rejected",
      }),
    ]);
    // Both must clear before the account serves again.
    expect(group!.accounts[0]!.resetAt).toBe(NOW + 900_000);
  });

  it("uses the SOONEST upcoming refill for a ready account", () => {
    const [group] = groupsOf([
      account({
        status: "ready",
        fiveHourUtilization: 0.4,
        fiveHourResetAt: NOW + 5_000,
        fiveHourStatus: "allowed",
        sevenDayUtilization: 0.1,
        sevenDayResetAt: NOW + 900_000,
        sevenDayStatus: "allowed",
      }),
    ]);
    expect(group!.accounts[0]!.resetAt).toBe(NOW + 5_000);
  });
});

describe("stale numbers", () => {
  it("marks an already-elapsed window rather than showing its old number as current", () => {
    const [group] = groupsOf([
      account({
        status: "ready",
        fiveHourUtilization: 1,
        fiveHourResetAt: NOW - 1_000,
        fiveHourStatus: "rejected",
      }),
    ]);
    const cell = group!.accounts[0]!.cells.find((c) => c !== null)!;
    expect(cell.tone).toBe("elapsed");
  });

  it("flags an account account-pool has stopped refreshing", () => {
    const [group] = groupsOf([
      account({ observedAt: NOW - 30 * 60_000, fiveHourUtilization: 0.2 }),
    ]);
    expect(group!.accounts[0]!.stale).toBe(true);
  });
});

describe("family windows", () => {
  it("never lets a maxed family window drive the account headline", () => {
    // account-pool's own status ignores familyWeekly, so a full Fable bucket must
    // not make a usable account look dead.
    const [group] = groupsOf([
      account({
        status: "ready",
        fiveHourUtilization: 0.1,
        fiveHourStatus: "allowed",
        fiveHourResetAt: NOW + 60_000,
        familyWeekly: {
          fable: {
            utilization: 1,
            resetAt: NOW + 900_000,
            status: "rejected",
            observedAt: NOW,
          },
        },
      }),
    ]);
    const row = group!.accounts[0]!;
    expect(row.status).toBe("ready");
    const family = row.cells.find((c) => c?.key === "fam:fable")!;
    expect(family.gating).toBe(false);
  });
});

describe("codex", () => {
  it("reads limitWindows and labels them by duration, not slot", () => {
    const [group] = groupsOf([
      account({
        id: "c1",
        provider: "codex",
        subscriptionType: null,
        status: "exhausted",
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 10_080,
            utilization: 1,
            resetAt: NOW + 200_000,
            status: "rejected",
            observedAt: NOW,
          },
          {
            slot: "secondary",
            windowMinutes: 300,
            utilization: 0.5,
            resetAt: NOW + 10_000,
            status: "allowed",
            observedAt: NOW,
          },
        ],
      }),
    ]);
    // Sorted by duration so the 5h column always precedes the weekly one.
    expect(group!.columns.map((c) => c.label)).toEqual(["5H", "7D"]);
    expect(group!.accounts[0]!.resetAt).toBe(NOW + 200_000);
  });
});

describe("group summary", () => {
  it("says when the next capacity arrives if nothing is ready", () => {
    const [group] = groupsOf([
      account({
        id: "a",
        status: "exhausted",
        sevenDayUtilization: 1,
        sevenDayStatus: "rejected",
        sevenDayResetAt: NOW + 500_000,
      }),
      account({
        id: "b",
        status: "exhausted",
        sevenDayUtilization: 1,
        sevenDayStatus: "rejected",
        sevenDayResetAt: NOW + 100_000,
      }),
    ]);
    expect(group!.readyCount).toBe(0);
    expect(group!.nextCapacityAt).toBe(NOW + 100_000);
  });

  it("marks the in-flight account as serving", () => {
    const [group] = groupsOf([
      account({ id: "a", status: "ready", inFlight: 2 }),
      account({ id: "b", status: "ready", lastUsedAt: NOW }),
    ]);
    expect(group!.accounts.find((r) => r.id === "a")!.serving).toBe("serving");
  });
});

describe("per-account weekly bars", () => {
  const barsOf = (accounts: AccountSummary[]) => groupsOf(accounts)[0]!.weeklyBars;

  it("gives every enabled account its own bar, in row order", () => {
    const bars = barsOf([
      account({ id: "a", email: "one@example.com", sevenDayUtilization: 0.2, sevenDayResetAt: NOW + 3_600_000 }),
      account({ id: "b", email: "two@example.com", priority: 2, sevenDayUtilization: 0.8, sevenDayResetAt: NOW + 7_200_000 }),
    ]);
    expect(bars.map((b) => b.accountId)).toEqual(["a", "b"]);
    // Each bar is its own week, not the group average.
    expect(bars.map((b) => b.remainingPercent)).toEqual([80, 20]);
    expect(bars.map((b) => b.resetAt)).toEqual([NOW + 3_600_000, NOW + 7_200_000]);
  });

  it("carries the window length so the bar can place a time marker", () => {
    const [bar] = barsOf([
      account({ sevenDayUtilization: 0.5, sevenDayResetAt: NOW + 3_600_000 }),
    ]);
    expect(bar!.windowMinutes).toBe(10_080);
  });

  it("counts a rejected week as empty whatever number came with it", () => {
    const [bar] = barsOf([
      account({
        id: "a",
        status: "exhausted",
        sevenDayUtilization: 0.4,
        sevenDayStatus: "rejected",
        sevenDayResetAt: NOW + 80_000_000,
      }),
    ]);
    expect(bar!.remainingPercent).toBe(0);
  });

  it("treats an elapsed week as refilled rather than trusting the stale number", () => {
    const [bar] = barsOf([
      account({
        id: "a",
        sevenDayUtilization: 1,
        sevenDayStatus: "rejected",
        sevenDayResetAt: NOW - 1,
      }),
    ]);
    expect(bar!.remainingPercent).toBe(100);
    // No reset time means no marker: we would be drawing the previous window.
    expect(bar!.resetAt).toBeNull();
  });

  it("excludes disabled accounts so the strip cannot advertise unroutable capacity", () => {
    const bars = barsOf([
      account({ id: "a", sevenDayUtilization: 1, sevenDayResetAt: NOW + 3_600_000 }),
      account({
        id: "b",
        enabled: false,
        status: "disabled",
        sevenDayUtilization: 0,
        sevenDayResetAt: NOW + 3_600_000,
      }),
    ]);
    expect(bars.map((b) => b.accountId)).toEqual(["a"]);
  });

  it("keeps a bar for an account with no observed week, reading null rather than full", () => {
    const [bar] = barsOf([account({ id: "a", fiveHourUtilization: 0.5 })]);
    expect(bar!.remainingPercent).toBeNull();
    expect(bar!.windowMinutes).toBeNull();
  });

  it("reads the codex week from limitWindows, ignoring its 5h window", () => {
    const [bar] = barsOf([
      account({
        id: "c",
        provider: "codex",
        subscriptionType: null,
        sevenDayUtilization: null,
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 300,
            utilization: 0.9,
            resetAt: NOW + 3_600_000,
            status: "allowed",
          },
          {
            slot: "secondary",
            windowMinutes: 10_080,
            utilization: 0.25,
            resetAt: NOW + 200_000_000,
            status: "allowed",
          },
        ],
      }),
    ]);
    expect(bar!.remainingPercent).toBe(75);
    expect(bar!.resetAt).toBe(NOW + 200_000_000);
    expect(bar!.windowMinutes).toBe(10_080);
  });

  it("falls back to codex's longest window when there is no 10080-minute one", () => {
    const [bar] = barsOf([
      account({
        id: "c",
        provider: "codex",
        sevenDayUtilization: null,
        limitWindows: [
          {
            slot: "primary",
            windowMinutes: 300,
            utilization: 0.9,
            resetAt: NOW + 3_600_000,
            status: "allowed",
          },
          {
            slot: "monthly",
            windowMinutes: 43_200,
            utilization: 0.6,
            resetAt: NOW + 400_000_000,
            status: "allowed",
          },
        ],
      }),
    ]);
    expect(bar!.remainingPercent).toBe(40);
    // The marker has to scale to the window the number actually came from.
    expect(bar!.windowMinutes).toBe(43_200);
  });
});

describe("which account is in use", () => {
  it("marks the in-flight account on the strip, exactly", () => {
    const bars = groupsOf([
      account({ id: "a", inFlight: 1, lastUsedAt: NOW - 60_000 }),
      account({ id: "b", priority: 2, lastUsedAt: NOW }),
    ])[0]!.weeklyBars;
    // inFlight is the only exact signal; lastUsedAt is the fallback guess.
    expect(bars.find((b) => b.accountId === "a")!.serving).toBe("serving");
    expect(bars.find((b) => b.accountId === "b")!.serving).toBe("next");
  });

  it("never guesses a non-ready account is next", () => {
    const bars = groupsOf([
      account({
        id: "a",
        status: "exhausted",
        lastUsedAt: NOW,
        sevenDayUtilization: 1,
        sevenDayStatus: "rejected",
        sevenDayResetAt: NOW + 80_000_000,
      }),
    ])[0]!.weeklyBars;
    expect(bars[0]!.serving).toBe("idle");
  });
});
