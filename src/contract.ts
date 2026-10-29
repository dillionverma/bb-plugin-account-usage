import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

/**
 * Shared between server.ts and the frontend. The frontend imports the TYPES from
 * here and `rpcContract` only as a type, so none of the server lands in the app
 * bundle. The realtime channel name is a plain string constant both sides use.
 */

export const USAGE_CHANGED_CHANNEL = "usage-changed";

/** How often the open panel re-reads the server snapshot (cheap, cache-only). */
export const PANEL_POLL_MS = 30_000;

/** account-pool polls upstream every 5 min; two missed cycles means something broke. */
export const STALE_AFTER_MS = 11 * 60 * 1000;

export const toneSchema = z.enum(["ok", "warn", "blocked", "elapsed", "unknown"]);
export type Tone = z.infer<typeof toneSchema>;

/** One usage window rendered as a column cell, e.g. 5H / 7D / FABLE. */
export const cellSchema = z.object({
  key: z.string(),
  /** 0..100, already rounded. Null when the window has no observed number. */
  percent: z.number().nullable(),
  tone: toneSchema,
  resetAt: z.number().nullable(),
  /** True when this window can make the whole account unusable. */
  gating: z.boolean(),
});
export type Cell = z.infer<typeof cellSchema>;

export const columnSchema = z.object({
  key: z.string(),
  label: z.string(),
});
export type Column = z.infer<typeof columnSchema>;

export const accountRowSchema = z.object({
  id: z.string(),
  /** Best human identity: email, else label, else a short id. */
  name: z.string(),
  /** Plan chip, e.g. "max" / "Pro" / "OAuth". Null hides the chip. */
  plan: z.string().nullable(),
  enabled: z.boolean(),
  status: z.enum(["disabled", "ready", "held", "exhausted", "error"]),
  statusLabel: z.string(),
  /** "serving" is exact (inFlight > 0); "next" is the most-recently-used ready peer. */
  serving: z.enum(["serving", "next", "idle"]),
  /** Headline reset: max of blocking windows when blocked, else soonest refill. */
  resetAt: z.number().nullable(),
  lastUsedAt: z.number().nullable(),
  observedAt: z.number().nullable(),
  stale: z.boolean(),
  error: z.string().nullable(),
  /** Aligned 1:1 with the group's columns; a missing window is a null cell. */
  cells: z.array(cellSchema.nullable()),
});
export type AccountRow = z.infer<typeof accountRowSchema>;

/**
 * One bar in the collapsed strip: a single account's weekly headroom.
 *
 * The strip is one bar per enabled account rather than one averaged bar per
 * provider, because the router spends accounts individually — an average hides
 * the one account that is already empty behind the three that are not.
 *
 * `windowMinutes` is what lets the bar carry a time marker: the pool reports when
 * the window resets, not when it started, so the start is `resetAt - window`.
 */
export const weeklyBarSchema = z.object({
  accountId: z.string(),
  /** Full identity for the tooltip: email, else label, else a short id. */
  name: z.string(),
  plan: z.string().nullable(),
  /** 0..100 of this account's weekly pool still available. Null when unobserved. */
  remainingPercent: z.number().nullable(),
  /** End of the current weekly window. Null when unknown or already elapsed. */
  resetAt: z.number().nullable(),
  /** Length of that window in minutes, for the elapsed-time marker. */
  windowMinutes: z.number().nullable(),
  status: z.enum(["disabled", "ready", "held", "exhausted", "error"]),
  /** Same meaning as the row's: "serving" is exact, "next" is a best guess. */
  serving: z.enum(["serving", "next", "idle"]),
});
export type WeeklyBar = z.infer<typeof weeklyBarSchema>;

export const groupSchema = z.object({
  /** bb provider id, for logo + display name lookup: "claude-code" | "codex". */
  providerId: z.string(),
  poolProvider: z.enum(["claude", "codex"]),
  routingEnabled: z.boolean(),
  readyCount: z.number(),
  totalCount: z.number(),
  /** When nothing is ready: the soonest moment any account comes back. */
  nextCapacityAt: z.number().nullable(),
  /** One strip bar per enabled account, in the same order as `accounts`. */
  weeklyBars: z.array(weeklyBarSchema),
  columns: z.array(columnSchema),
  accounts: z.array(accountRowSchema),
});
export type Group = z.infer<typeof groupSchema>;

export const snapshotSchema = z.object({
  fetchedAt: z.number(),
  /** Set when account-pool could not be reached at all. Groups will be empty. */
  error: z.string().nullable(),
  /** True when the account-pool plugin is not installed or not enabled. */
  poolUnavailable: z.boolean(),
  groups: z.array(groupSchema),
});
export type Snapshot = z.infer<typeof snapshotSchema>;

export const rpcContract = defineRpcContract({
  /** Cache-only read of account-pool state. Safe to poll. */
  snapshot: { input: z.null(), output: snapshotSchema },
  /**
   * Forces account-pool to re-fetch usage from Anthropic/OpenAI for every enabled
   * account, then returns the fresh snapshot. One real upstream round-trip per
   * account, so nothing calls it automatically; run it by hand through bb's
   * plugin RPC.
   */
  refresh: { input: z.null(), output: snapshotSchema },
});
