import * as Tooltip from "@radix-ui/react-tooltip";
import {
  experimental_ProviderIcon as ProviderIcon,
} from "@get-bb/plugin-sdk/app";
import type { Group, WeeklyBar } from "../contract.ts";
import { formatAbsolute, formatReset, timeMarkerPercent, weeklyBarLabel } from "../lib/format.ts";

/**
 * The weekly summary: one line per provider, its accounts sitting
 * side by side on that line as separate segments — each with its own weekly
 * headroom, its own percentage above, and a grey tick at the point the clock
 * has reached in that account's own weekly window.
 *
 * Segments, not one averaged bar: the router spends accounts one at a time, so an
 * average hides the account that is already empty behind the ones that are not.
 * Fill past the tick means that account is ahead of its week; fill behind it means
 * it is burning the week faster than the week is passing.
 */

/** Tint by headroom, matching the thresholds the per-account cells already warn at. */
function barTone(remaining: number | null): string {
  if (remaining === null) return "bg-subtle-foreground/40";
  if (remaining <= 5) return "bg-destructive";
  if (remaining <= 20) return "bg-warning";
  return "bg-success";
}

/**
 * The numbers are a read-out, not the signal — the bars already carry that — so a
 * healthy percentage stays quiet and only a thin or empty week takes any colour.
 * Everything is held below full strength so the strip reads as chrome next to the
 * sidebar's own text.
 */
function textTone(remaining: number | null): string {
  if (remaining === null) return "text-subtle-foreground/50";
  if (remaining <= 5) return "text-destructive-text/75";
  if (remaining <= 20) return "text-warning-text/75";
  return "text-subtle-foreground/70";
}

/** The segments carry no labels, so the tooltip is where the account is named. */
function hint(bar: WeeklyBar, providerName: string, now: number): string {
  const parts = [`${providerName} · ${bar.name}`];
  if (bar.plan !== null) parts.push(bar.plan);
  parts.push(
    bar.remainingPercent === null
      ? "no weekly usage observed yet"
      : `${bar.remainingPercent}% of the week left`,
  );
  const marker = timeMarkerPercent(bar.resetAt, bar.windowMinutes, now);
  if (marker !== null) parts.push(`${Math.round(100 - marker)}% of the week elapsed`);
  const reset = formatReset(bar.resetAt, now);
  if (reset !== null) parts.push(`${formatAbsolute(bar.resetAt)} (${reset})`);
  return parts.join(" · ");
}

function AccountSegment({
  bar,
  providerName,
  now,
}: {
  bar: WeeklyBar;
  providerName: string;
  now: number;
}): React.ReactElement {
  const percent = bar.remainingPercent;
  const marker = timeMarkerPercent(bar.resetAt, bar.windowMinutes, now);
  const label = hint(bar, providerName, now);
  const readout = weeklyBarLabel(percent, bar.resetAt, now);

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <span className="group/segment flex min-w-0 flex-1 flex-col gap-1" aria-label={label}>
          <span
            aria-hidden={true}
            className={`flex h-3 items-center justify-center gap-1 text-[10px] leading-3 tabular-nums ${textTone(percent)}`}
          >
            <span className={bar.serving === "serving" ? "bb-account-usage-serving" : undefined}>{readout}</span>
          </span>
          <span
            className="relative h-1 w-full rounded-full bg-sidebar-border transition-colors group-hover/segment:bg-sidebar-accent motion-reduce:transition-none"
            role="img"
            aria-label={label}
          >
            <span className="block h-full overflow-hidden rounded-full">
              <span
                className={`block h-full rounded-full ${barTone(percent)} ${bar.serving === "serving" ? "bb-account-usage-bar-serving" : ""}`}
                style={{ width: `${percent ?? 0}%` }}
              />
            </span>
            {marker === null ? null : (
              <span
                aria-hidden={true}
                className="absolute -top-px -bottom-px w-px rounded-full bg-sidebar-foreground/30"
                style={{ left: `${marker}%`, marginLeft: "-0.5px" }}
              />
            )}
          </span>
        </span>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          data-bb-portaled-overlay=""
          data-bb-plugin-root=""
          data-bb-plugin="account-usage"
          className="z-50 max-w-[min(18rem,var(--radix-tooltip-content-available-width))] rounded border border-border/60 bg-popover px-2 py-1.5 text-[11px] leading-4 text-popover-foreground shadow-sm"
        >
          <div className="break-all">{bar.name}</div>
          <div className="text-[10px] text-muted-foreground">
            {[bar.plan, percent === null ? "Usage unavailable" : `${percent}% left`, formatReset(bar.resetAt, now)].filter(Boolean).join(" · ")}
          </div>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function WeeklyBars({
  group,
  now,
  provider,
}: {
  group: Group;
  now: number;
  provider: { id: string; displayName?: string } & Record<string, unknown>;
}): React.ReactElement | null {
  const providerName = provider.displayName ?? group.providerId;
  if (group.weeklyBars.length === 0) return null;

  return (
    <Tooltip.Provider delayDuration={200} skipDelayDuration={300}>
      <span className="flex items-center gap-2 px-2.5 py-[3px]">
        <ProviderIcon
          providerKind="agent"
          provider={provider}
          fallback="Bot"
          className="size-3 shrink-0 opacity-80"
          aria-hidden={true}
        />
        <span className="flex min-w-0 flex-1 items-start gap-1.5">
          {group.weeklyBars.map((bar) => (
            <AccountSegment
              key={bar.accountId}
              bar={bar}
              providerName={providerName}
              now={now}
            />
          ))}
        </span>
      </span>
    </Tooltip.Provider>
  );
}
