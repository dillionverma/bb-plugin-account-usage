const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Compact weekly-bar readout for accounts with less than 3% remaining. */
export function weeklyBarLabel(percent: number | null, resetAt: number | null, now: number): string {
  if (percent === null) return "—";
  if (percent >= 3 || resetAt === null || !Number.isFinite(resetAt)) return `${percent}%`;
  const delta = resetAt - now;
  if (delta <= 0) return "now";
  if (delta < HOUR) return "<1h";
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h`;
  return `${Math.floor(delta / DAY)}d`;
}

/** Keep reset countdowns relative, carrying rounded minutes into hours and days. */
export function formatReset(resetAt: number | null, now: number): string | null {
  if (resetAt === null) return null;
  const delta = resetAt - now;
  if (delta <= MINUTE) return "resets now";
  const totalMinutes = Math.round(delta / MINUTE);
  if (totalMinutes < 60) return `resets in ${totalMinutes}m`;
  if (totalMinutes < 1440) {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return minutes === 0
      ? `resets in ${hours}h`
      : `resets in ${hours}h ${minutes}m`;
  }
  const totalHours = Math.round(delta / HOUR);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  return hours === 0 ? `resets in ${days}d` : `resets in ${days}d ${hours}h`;
}

/** Full timestamp for the row's title attribute, where there is no width limit. */
export function formatAbsolute(at: number | null): string | null {
  if (at === null) return null;
  return new Date(at).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function formatAgo(at: number | null, now: number): string | null {
  if (at === null) return null;
  const delta = now - at;
  if (delta < MINUTE) return "just now";
  if (delta < HOUR) return `${Math.round(delta / MINUTE)}m ago`;
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`;
  return `${Math.floor(delta / DAY)}d ago`;
}

/**
 * Where the time marker sits on a usage bar, 0..100, or null when the window's
 * shape is unknown.
 *
 * The bar is drawn on a *remaining* axis — a full bar is a full week — so the
 * marker has to be on that same axis to be comparable: it is the share of the
 * window still ahead of us, `(resetAt - now) / window`. Halfway through the week
 * that is the midpoint, which is what makes "70% left, marker at 50%" read as
 * "ahead of budget" at a glance. Putting elapsed time there instead would place
 * the marker on the opposite axis from the fill and invert that comparison.
 */
export function timeMarkerPercent(
  resetAt: number | null,
  windowMinutes: number | null,
  now: number,
): number | null {
  if (resetAt === null || windowMinutes === null || windowMinutes <= 0) return null;
  const remaining = (resetAt - now) / (windowMinutes * MINUTE);
  if (!Number.isFinite(remaining)) return null;
  return Math.min(100, Math.max(0, remaining * 100));
}
