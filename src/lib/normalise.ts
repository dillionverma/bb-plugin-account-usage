import type {
  AccountRow,
  Cell,
  Column,
  Group,
  Snapshot,
  Tone,
  WeeklyBar,
} from "../contract.ts";
import { STALE_AFTER_MS } from "../contract.ts";
import {
  BB_PROVIDER_ID,
  CLAUDE_FAMILIES,
  POOL_PROVIDERS,
  type AccountSummary,
  type PoolProvider,
  type PoolStatus,
} from "./pool-contracts.ts";

export const DEFAULT_SWITCH_THRESHOLD = 0.98;
/** account-pool itself warns one tenth below the switch threshold. */
const WARN_OFFSET = 0.1;

const CLAUDE_FIVE_HOUR_MINUTES = 300;
const CLAUDE_SEVEN_DAY_MINUTES = 10_080;
/** Both providers call their long window a week; only Claude guarantees the number. */
const WEEKLY_WINDOW_MINUTES = CLAUDE_SEVEN_DAY_MINUTES;

/** Keep expanded accounts compact: gating limits first, then family limits. */
const MAX_COLUMNS = 3;

const FAMILY_LABEL: Record<string, string> = {
  fable: "FABLE",
  opus: "OPUS",
  sonnet: "SONNET",
  haiku: "HAIKU",
  other: "OTHER",
};

interface NormalisedWindow {
  key: string;
  label: string;
  usedFraction: number | null;
  resetAt: number | null;
  tone: Tone;
  blocking: boolean;
  /** Family windows do NOT gate the account — account-pool's own status ignores them. */
  gatesAccount: boolean;
}

/** Duration label for every windowMinutes account-pool can emit (300, 1440, 10080, 43200). */
export function windowLabel(minutes: number | null, slot?: string | null): string {
  if (minutes === null) return slot === "secondary" ? "Other limit" : "Limit";
  if (minutes === CLAUDE_SEVEN_DAY_MINUTES) return "7D";
  if (minutes % 1440 === 0) return `${minutes / 1440}D`;
  if (minutes % 60 === 0) return `${minutes / 60}H`;
  return `${minutes}M`;
}

/**
 * Verbatim port of account-pool's quota.ts `activeWindow`. The pool routes on
 * this exact predicate, so the panel must not "improve" it — if we disagree with
 * the pool the card tells the user something the router will not honour.
 */
function isBlocking(
  utilization: number | null,
  status: string | null,
  resetAt: number | null,
  threshold: number,
  now: number,
): boolean {
  if (resetAt !== null && resetAt <= now) return false;
  return (
    status?.toLowerCase() === "rejected" ||
    (utilization !== null && utilization >= threshold)
  );
}

function clamp01(value: number | null): number | null {
  if (value === null) return null;
  return Math.min(1, Math.max(0, value));
}

function toneFor(
  utilization: number | null,
  status: string | null,
  resetAt: number | null,
  threshold: number,
  now: number,
): Tone {
  // An elapsed window still carries its old number until the next poll. Showing
  // that number as current is the single easiest way for this panel to lie.
  if (resetAt !== null && resetAt <= now) return "elapsed";
  if (isBlocking(utilization, status, resetAt, threshold, now)) return "blocked";
  if (utilization === null) return "unknown";
  return utilization >= threshold - WARN_OFFSET ? "warn" : "ok";
}

export function normaliseWindows(
  account: AccountSummary,
  threshold: number,
  now: number,
): NormalisedWindow[] {
  const out: NormalisedWindow[] = [];

  const push = (
    key: string,
    label: string,
    utilization: number | null,
    resetAt: number | null,
    status: string | null,
    gatesAccount: boolean,
  ): void => {
    if (utilization === null && resetAt === null && status === null) return;
    out.push({
      key,
      label,
      usedFraction: clamp01(utilization),
      resetAt,
      tone: toneFor(utilization, status, resetAt, threshold, now),
      blocking: isBlocking(utilization, status, resetAt, threshold, now),
      gatesAccount,
    });
  };

  if (account.provider === "codex") {
    // Sort by duration so 5H always precedes 7D regardless of the slot names,
    // which are a limit-family label upstream and not a duration.
    const windows = [...account.limitWindows].sort(
      (l, r) =>
        (l.windowMinutes ?? Number.MAX_SAFE_INTEGER) -
        (r.windowMinutes ?? Number.MAX_SAFE_INTEGER),
    );
    for (const w of windows) {
      push(
        `w:${w.windowMinutes ?? w.slot ?? "?"}`,
        windowLabel(w.windowMinutes, w.slot),
        w.utilization,
        w.resetAt,
        w.status,
        true,
      );
    }
    return out;
  }

  push(
    `w:${CLAUDE_FIVE_HOUR_MINUTES}`,
    "5H",
    account.fiveHourUtilization,
    account.fiveHourResetAt,
    account.fiveHourStatus,
    true,
  );
  push(
    `w:${CLAUDE_SEVEN_DAY_MINUTES}`,
    "7D",
    account.sevenDayUtilization,
    account.sevenDayResetAt,
    account.sevenDayStatus,
    true,
  );
  for (const family of CLAUDE_FAMILIES) {
    const quota = account.familyWeekly[family];
    if (quota === null || quota === undefined) continue;
    push(
      `fam:${family}`,
      FAMILY_LABEL[family] ?? family.toUpperCase(),
      quota.utilization,
      quota.resetAt,
      quota.status,
      false,
    );
  }
  return out;
}

/**
 * When can this account serve again? Every blocking window has to clear, so the
 * answer is the LATEST of them — not the soonest.
 */
function blockingResetAt(
  windows: NormalisedWindow[],
): { at: number | null; unknown: boolean } {
  let latest: number | null = null;
  let unknown = false;
  for (const w of windows) {
    if (!w.blocking) continue;
    if (w.resetAt === null) unknown = true;
    else latest = Math.max(latest ?? w.resetAt, w.resetAt);
  }
  return { at: latest, unknown };
}

function statusLabel(account: AccountSummary): string {
  switch (account.status) {
    case "disabled":
      return "Disabled";
    case "error":
      return "Error";
    case "held":
      return "Rate limited";
    case "exhausted":
      return "Exhausted";
    case "ready":
      return "Ready";
  }
}

/** Ordered column set for a group: gating windows first, then families. */
function columnsFor(perAccount: NormalisedWindow[][]): Column[] {
  const seen = new Map<string, Column>();
  const rank = new Map<string, number>();
  for (const windows of perAccount) {
    for (const w of windows) {
      if ((w.label === "Other limit" || w.label === "Limit") && w.tone === "elapsed") continue;
      if (!seen.has(w.key)) seen.set(w.key, { key: w.key, label: w.label });
      // Gating windows always outrank families, and a family column only earns
      // a slot when at least one account has actually burned some of it.
      const used = (w.usedFraction ?? 0) > 0 ? 0 : 1;
      const weight = (w.gatesAccount ? 0 : 100) + used;
      rank.set(w.key, Math.min(rank.get(w.key) ?? weight, weight));
    }
  }
  return [...seen.values()]
    .sort((l, r) => (rank.get(l.key) ?? 0) - (rank.get(r.key) ?? 0))
    .slice(0, MAX_COLUMNS);
}

function servingState(
  account: AccountSummary,
  peers: AccountSummary[],
): AccountRow["serving"] {
  if (account.inFlight > 0) return "serving";
  if (account.status !== "ready") return "idle";
  const ready = peers.filter((p) => p.status === "ready");
  if (ready.length === 0) return "idle";
  // Best in-contract proxy for the pool's anchor. It can lag by the pool's 60s
  // usage-record throttle, so the UI labels this "next", never "active".
  const mru = ready.reduce((best, p) =>
    (p.lastUsedAt ?? -1) > (best.lastUsedAt ?? -1) ? p : best,
  );
  return mru.id === account.id ? "next" : "idle";
}

function displayName(account: AccountSummary): string {
  if (account.email !== null && account.email.length > 0) return account.email;
  if (account.label !== null && account.label.length > 0) return account.label;
  return account.id.slice(0, 8);
}

function planLabel(account: AccountSummary): string | null {
  if (account.subscriptionType !== null && account.subscriptionType.length > 0) {
    return account.subscriptionType;
  }
  if (account.kind === "api_key") return "API key";
  return null;
}

/**
 * The weekly window of one account, as a fraction of headroom left.
 *
 * Claude reports it in `sevenDay*`; Codex reports it as a `limitWindows` entry,
 * labelled by duration because `slot` is an upstream limit-family name. Codex has
 * shipped weeks that are not exactly 10080 minutes (monthly-ish 43200 windows), so
 * the longest window of a day or more counts as "the week" when 10080 is absent —
 * otherwise a provider that renamed its long window would silently drop out of the
 * average and the bar would read fuller than the account actually is.
 */
function weeklyWindowOf(account: AccountSummary): {
  utilization: number | null;
  resetAt: number | null;
  status: string | null;
  windowMinutes: number | null;
} | null {
  if (account.provider !== "codex") {
    if (
      account.sevenDayUtilization === null &&
      account.sevenDayResetAt === null &&
      account.sevenDayStatus === null
    ) {
      return null;
    }
    return {
      utilization: account.sevenDayUtilization,
      resetAt: account.sevenDayResetAt,
      status: account.sevenDayStatus,
      windowMinutes: CLAUDE_SEVEN_DAY_MINUTES,
    };
  }
  const daily = account.limitWindows.filter(
    (w) => w.windowMinutes !== null && w.windowMinutes >= 1440,
  );
  if (daily.length === 0) return null;
  const exact = daily.find((w) => w.windowMinutes === WEEKLY_WINDOW_MINUTES);
  const window =
    exact ??
    daily.reduce((longest, w) =>
      (w.windowMinutes ?? 0) > (longest.windowMinutes ?? 0) ? w : longest,
    );
  return {
    utilization: window.utilization,
    resetAt: window.resetAt,
    status: window.status,
    windowMinutes: window.windowMinutes,
  };
}

/**
 * How much of this account's week is left, 0..1, or null when it has no usable
 * weekly reading.
 *
 * A rejected week is zero regardless of the number beside it — the pool refuses
 * the account on status alone. An elapsed window has already refilled, so it is
 * worth a full week rather than the pre-reset number still sitting in the cache;
 * that is the same rule the per-account cells use when they grey out.
 */
export function weeklyRemaining(
  account: AccountSummary,
  now: number,
): { remaining: number; resetAt: number | null; windowMinutes: number | null } | null {
  const window = weeklyWindowOf(account);
  if (window === null) return null;
  const windowMinutes = window.windowMinutes;
  if (window.resetAt !== null && window.resetAt <= now) {
    return { remaining: 1, resetAt: null, windowMinutes };
  }
  if (window.status?.toLowerCase() === "rejected") {
    return { remaining: 0, resetAt: window.resetAt, windowMinutes };
  }
  if (window.utilization === null) return null;
  return {
    remaining: 1 - (clamp01(window.utilization) as number),
    resetAt: window.resetAt,
    windowMinutes,
  };
}

/**
 * One weekly bar per account the router can actually spend.
 *
 * Disabled accounts are excluded: the router will never reach them, so a bar for
 * their untouched week would advertise capacity that does not exist. An account
 * with no observed weekly window still gets a bar (as an empty, "—" one) rather
 * than vanishing — a missing row reads as "this account is gone", which is a
 * different and wrong claim.
 */
export function weeklyBars(accounts: AccountSummary[], now: number): WeeklyBar[] {
  const usable = accounts.filter((a) => a.enabled);
  return usable.map((account) => {
    const reading = weeklyRemaining(account, now);
    return {
      accountId: account.id,
      name: displayName(account),
      plan: planLabel(account),
      remainingPercent:
        reading === null ? null : Math.round(reading.remaining * 100),
      resetAt: reading?.resetAt ?? null,
      windowMinutes: reading?.windowMinutes ?? null,
      status: account.status,
      serving: servingState(account, accounts),
    };
  });
}

export function buildAccountRow(
  account: AccountSummary,
  peers: AccountSummary[],
  columns: Column[],
  threshold: number,
  now: number,
): AccountRow {
  const windows = normaliseWindows(account, threshold, now);
  const byKey = new Map(windows.map((w) => [w.key, w]));

  const cells: (Cell | null)[] = columns.map((column) => {
    const w = byKey.get(column.key);
    if (w === undefined) return null;
    return {
      key: w.key,
      percent: w.usedFraction === null ? null : Math.round(w.usedFraction * 100),
      tone: w.tone,
      resetAt: w.resetAt,
      gating: w.gatesAccount,
    };
  });

  const blocked = blockingResetAt(windows);
  let resetAt: number | null = null;
  if (account.status === "held") {
    resetAt = account.heldUntil;
  } else if (account.status === "exhausted") {
    resetAt = blocked.unknown ? null : blocked.at;
  } else if (account.status === "ready") {
    // For a usable account the interesting moment is the next refill, so the
    // soonest upcoming reset across the windows that can gate it.
    const upcoming = windows
      .filter((w) => w.gatesAccount && w.resetAt !== null && w.resetAt > now)
      .map((w) => w.resetAt as number);
    resetAt = upcoming.length === 0 ? null : Math.min(...upcoming);
  }

  return {
    id: account.id,
    name: displayName(account),
    plan: planLabel(account),
    enabled: account.enabled,
    status: account.status,
    statusLabel: statusLabel(account),
    serving: servingState(account, peers),
    resetAt,
    lastUsedAt: account.lastUsedAt,
    observedAt: account.observedAt,
    // account-pool swallows usage-refresh failures without setting `error`, so a
    // frozen observedAt is the only signal that the numbers stopped moving.
    stale:
      account.observedAt !== null && now - account.observedAt > STALE_AFTER_MS,
    error: account.error,
    cells,
  };
}

export function buildGroups(
  status: PoolStatus,
  threshold: number,
  now: number,
): Group[] {
  const groups: Group[] = [];
  for (const provider of POOL_PROVIDERS) {
    const accounts = status.accounts
      .filter((a) => a.provider === provider)
      // Codex accounts all share priority 100, so fall back to the visible name
      // rather than the opaque uuid — otherwise the rows look shuffled.
      .sort(
        (l, r) =>
          l.priority - r.priority ||
          displayName(l).localeCompare(displayName(r), undefined, {
            numeric: true,
          }),
      );
    if (accounts.length === 0) continue;

    const columns = columnsFor(
      accounts.map((a) => normaliseWindows(a, threshold, now)),
    );
    const rows = accounts.map((a) =>
      buildAccountRow(a, accounts, columns, threshold, now),
    );

    const readyCount = rows.filter((r) => r.status === "ready").length;
    const comingBack = rows
      .filter((r) => r.status !== "ready" && r.resetAt !== null && r.resetAt > now)
      .map((r) => r.resetAt as number);

    groups.push({
      providerId: BB_PROVIDER_ID[provider as PoolProvider],
      poolProvider: provider,
      routingEnabled: status.routing[provider],
      readyCount,
      totalCount: rows.length,
      nextCapacityAt:
        readyCount > 0 || comingBack.length === 0 ? null : Math.min(...comingBack),
      weeklyBars: weeklyBars(accounts, now),
      columns,
      accounts: rows,
    });
  }
  return groups;
}

export function buildSnapshot(
  status: PoolStatus,
  threshold: number,
  now: number,
): Snapshot {
  return {
    fetchedAt: now,
    error: null,
    poolUnavailable: false,
    groups: buildGroups(status, threshold, now),
  };
}
