import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  experimental_ProviderIcon as ProviderIcon,
  experimental_useProviders,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  AccountRow,
  Cell,
  Group,
  Snapshot,
  Tone,
  rpcContract,
} from "../contract.ts";
import { PANEL_POLL_MS, USAGE_CHANGED_CHANNEL } from "../contract.ts";
import { formatAbsolute, formatAgo, formatReset } from "../lib/format.ts";
import { WeeklyBars } from "./weekly-strip.tsx";
import "./usage-panel.css";

const TONE_TEXT: Record<Tone, string> = {
  ok: "text-sidebar-foreground",
  warn: "text-warning-text",
  blocked: "text-destructive-text",
  elapsed: "text-subtle-foreground",
  unknown: "text-subtle-foreground",
};

const TONE_BAR: Record<Tone, string> = {
  ok: "bg-success",
  warn: "bg-warning",
  blocked: "bg-destructive",
  elapsed: "bg-subtle-foreground/30",
  unknown: "bg-subtle-foreground/30",
};

const STATUS_DOT: Record<AccountRow["status"], string> = {
  ready: "bg-success",
  exhausted: "bg-destructive",
  held: "bg-warning",
  error: "bg-destructive",
  disabled: "bg-subtle-foreground",
};

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function CellValue({ cell, serving }: { cell: Cell | null; serving: boolean }): React.ReactElement {
  if (cell === null) {
    return <span className="w-8 shrink-0 text-right text-2xs text-subtle-foreground/50">—</span>;
  }
  if (cell.percent === null) {
    return (
      <span className="w-8 shrink-0 text-right text-2xs tabular-nums text-subtle-foreground">
        ?
      </span>
    );
  }
  return (
    <span
      className={`flex w-8 shrink-0 flex-col gap-0.5 text-right text-[10px] leading-3 font-medium tabular-nums ${TONE_TEXT[cell.tone]}`}
      role="meter"
      aria-label={cell.tone === "elapsed" ? "Previous window usage" : "Quota used"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={cell.percent}
      aria-valuetext={cell.tone === "elapsed" ? `${cell.percent}% before reset; awaiting updated usage` : `${cell.percent}% used`}
      title={
        cell.tone === "elapsed"
          ? "This window has already reset; the number is from before the reset."
          : (formatAbsolute(cell.resetAt) ?? undefined)
      }
    >
      {cell.percent}%
      <span aria-hidden="true" className="h-0.5 overflow-hidden rounded-full bg-sidebar-border/60">
        <span className={`block h-full rounded-full ${TONE_BAR[cell.tone]} ${serving && cell.tone !== "elapsed" ? "bb-account-usage-bar-serving" : ""}`} style={{ width: `${cell.percent}%` }} />
      </span>
    </span>
  );
}

function AccountRowView({
  row,
  now,
  provider,
}: {
  row: AccountRow;
  now: number;
  provider: { id: string; displayName?: string } & Record<string, unknown>;
}): React.ReactElement {
  const reset = formatReset(row.resetAt, now);

  // One honest line under the name: what the pool thinks of this account, when it
  // frees up, and — only when it matters — that we stopped hearing from it.
  const detail: string[] = [];
  if (row.plan !== null) detail.push(row.plan);
  detail.push(row.status === "error" ? "Account unavailable" : row.statusLabel);
  if (reset !== null) detail.push(reset);

  return (
    <li className="grid list-none grid-cols-[12px_minmax(0,1fr)_auto] items-center gap-x-1.5 gap-y-0.5 px-2.5 py-1 hover:bg-state-hover">
      <ProviderIcon
        providerKind="agent"
        provider={provider}
        fallback="Bot"
        className="size-3 shrink-0"
        aria-hidden={true}
      />
      <span className="flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[11px] leading-4 ${
            row.enabled ? "text-sidebar-foreground" : "text-subtle-foreground line-through"
          } ${row.serving === "serving" ? "bb-account-usage-serving" : ""}`}
          title={row.name}
        >
          {row.name}
        </span>
      </span>
      <span
        aria-hidden="true"
        className={`col-start-1 row-start-2 justify-self-center size-1.5 shrink-0 rounded-full ${STATUS_DOT[row.status]} ${
          row.serving === "serving" ? "ring-2 ring-success/30" : ""
        }`}
      />
      <span className="col-start-2 row-start-2 flex min-w-0 items-center gap-2">
        <span
          className={`min-w-0 flex-1 truncate text-[10px] leading-3 ${
            row.stale ? "text-warning-text" : "text-subtle-foreground"
          }`}
          title={
            row.status === "error" && row.error !== null
              ? row.error
              : row.stale
              ? `Usage last observed ${formatAgo(row.observedAt, now)} — account-pool may have stopped refreshing this account.`
              : (formatAbsolute(row.resetAt) ?? undefined)
          }
        >
          {row.stale ? "stale · " : ""}
          {detail.join(" · ")}
        </span>
      </span>
      <span className="col-start-3 row-start-1 row-span-2 flex shrink-0 items-center gap-1 self-center">
        {row.cells.map((cell, index) => (
          <CellValue key={cell?.key ?? `empty-${index}`} cell={cell} serving={row.serving === "serving"} />
        ))}
      </span>
    </li>
  );
}

function GroupView({
  group,
  now,
  provider,
}: {
  group: Group;
  now: number;
  /** The real bb provider record — it carries logoUrl and the brand tint. */
  provider: { id: string; displayName?: string } & Record<string, unknown>;
}): React.ReactElement {
  const displayName = provider.displayName ?? group.providerId;

  return (
    <section aria-label={`${displayName} usage`}>
      <header className="flex items-center justify-end gap-1.5 px-2.5 pt-1">
        {!group.routingEnabled ? <span className="mr-auto text-2xs text-subtle-foreground">routing off</span> : null}
        <span className="flex shrink-0 items-center gap-1">
          {group.columns.map((column) => (
            <span
              key={column.key}
              title={column.label === "Other limit" || column.label === "Limit" ? "Additional usage limit; the provider did not report its duration." : undefined}
              className="w-8 shrink-0 text-right text-2xs tracking-wide text-subtle-foreground"
            >
              {column.label === "Other limit" ? "Other" : column.label}
            </span>
          ))}
        </span>
      </header>
      {/* The host root is `display: contents`, so the browser's default list
          indent is not reset for us — zero it or every row loses 40px. */}
      <ul className="m-0 list-none p-0">
        {group.accounts.map((row) => (
          <AccountRowView key={row.id} row={row} now={now} provider={provider} />
        ))}
      </ul>
    </section>
  );
}

export function UsagePanel(): React.ReactElement {
  const sectionId = useId();
  const storageKey = "account-usage:expanded";
  const [expanded, setExpanded] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === "true";
    } catch {
      return false;
    }
  });
  const toggleExpanded = () => {
    const next = !expanded;
    setExpanded(next);
    try {
      localStorage.setItem(storageKey, String(next));
    } catch {
      // Disclosure still works when browser storage is unavailable.
    }
  };
  const rpc = useRpc<typeof rpcContract>();
  const { providers } = experimental_useProviders();
  const now = useNow(30_000);

  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const next = await rpc.call("snapshot");
      if (!mounted.current) return;
      setSnapshot(next);
      setFailure(null);
    } catch (error) {
      if (!mounted.current) return;
      // Surface it. A panel that silently keeps showing yesterday's numbers is
      // worse than one that admits it lost contact.
      setFailure(error instanceof Error ? error.message : String(error));
    }
  }, [rpc]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const timer = setInterval(() => void load(), PANEL_POLL_MS);
    return () => clearInterval(timer);
  }, [load]);

  useRealtime(USAGE_CHANGED_CHANNEL, () => {
    void load();
  });

  // Realtime signals are ephemeral and never replayed, so reconcile on reconnect.
  const connection = useRealtimeConnectionState();
  const wasConnected = useRef(connection === "connected");
  useEffect(() => {
    if (connection === "connected" && !wasConnected.current) void load();
    wasConnected.current = connection === "connected";
  }, [connection, load]);

  const providerFor = useCallback(
    (providerId: string) =>
      providers.find((provider) => provider.id === providerId) ?? {
        id: providerId,
      },
    [providers],
  );

  const totalReady =
    snapshot?.groups.reduce((sum, group) => sum + group.readyCount, 0) ?? 0;
  const totalAccounts =
    snapshot?.groups.reduce((sum, group) => sum + group.totalCount, 0) ?? 0;

  const stripAccounts =
    snapshot?.groups.reduce((sum, group) => sum + group.weeklyBars.length, 0) ?? 0;

  return (
    <section className="border-t border-sidebar-border px-1 pt-1" aria-label="Account usage" data-account-usage-panel="">
      <div className="relative">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-expanded={expanded}
          aria-controls={sectionId}
          aria-label={expanded ? "Collapse account usage" : "Expand account usage"}
          className="group/header block w-full min-w-0 cursor-pointer rounded text-left hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <span className="flex min-h-7 items-center gap-1.5 py-1 px-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"
              className={`size-3 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "rotate-90" : ""}`}>
              <path d="m9 6 6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground">
              <path d="M5 19V9m7 10V5m7 14v-6" strokeLinecap="round" />
            </svg>
            <span className="truncate text-[11px] font-semibold uppercase tracking-wider text-muted-foreground group-hover/header:text-foreground">Usage</span>
            <span className="text-[11px] leading-4 tabular-nums text-muted-foreground" title={`${totalReady} of ${totalAccounts} accounts ready`}>
              {snapshot === null ? "…" : `${totalReady}/${totalAccounts}`}
            </span>
          </span>
          {stripAccounts > 0 ? (
            <span className="block py-1">
              {snapshot?.groups.map((group) => (
                <WeeklyBars key={group.providerId} group={group} now={now} provider={providerFor(group.providerId)} />
              ))}
            </span>
          ) : null}
        </button>
      </div>
      <div id={sectionId} hidden={!expanded} className="ml-1 max-h-[min(16rem,28vh)] overflow-y-auto overscroll-contain border-l border-sidebar-border pb-1">
        {snapshot === null ? <p className="px-3 py-2 text-xs text-muted-foreground">Loading usage…</p> : null}
        {failure !== null ? <p className="px-3 py-2 text-xs text-destructive-text">{failure}</p> : null}
        {snapshot?.poolUnavailable ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">The Account Pooler plugin is not enabled.</p>
        ) : null}
        {snapshot?.error ? (
          <p className="px-3 py-2 text-xs text-destructive-text">Could not read the account pool: {snapshot.error}</p>
        ) : null}
        {snapshot !== null && !snapshot.poolUnavailable && snapshot.error === null && snapshot.groups.length === 0 ? (
          <p className="px-3 py-2 text-xs text-muted-foreground">No accounts pooled yet. Add one in the Account Pooler settings.</p>
        ) : null}
        {snapshot?.groups.map((group) => (
          <GroupView key={group.providerId} group={group} now={now} provider={providerFor(group.providerId)} />
        ))}
      </div>
    </section>
  );
}
