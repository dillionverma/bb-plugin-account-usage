import { z } from "zod";

/**
 * The subset of the `account-pool` plugin's `status.get` / `config.get` output we
 * consume. Deliberately NOT a copy of account-pool's own strict schemas: this is
 * a foreign contract, so we parse permissively (zod strips unknown keys) and only
 * pin the fields we actually read. If account-pool adds a field we keep working;
 * if it removes one we read, parsing fails loudly rather than rendering a lie.
 */

export const POOL_PROVIDERS = ["claude", "codex"] as const;
export type PoolProvider = (typeof POOL_PROVIDERS)[number];

/** account-pool's provider key -> bb's provider id (used for logos / display names). */
export const BB_PROVIDER_ID: Record<PoolProvider, string> = {
  claude: "claude-code",
  codex: "codex",
};

export const CLAUDE_FAMILIES = [
  "fable",
  "opus",
  "sonnet",
  "haiku",
  "other",
] as const;
export type ClaudeFamily = (typeof CLAUDE_FAMILIES)[number];

const familyQuotaSchema = z.object({
  utilization: z.number().nullable(),
  resetAt: z.number().nullable(),
  status: z.string().nullable(),
  observedAt: z.number().nullable(),
});

const limitWindowSchema = z.object({
  slot: z.string().nullable().optional(),
  windowMinutes: z.number().nullable(),
  utilization: z.number().nullable(),
  resetAt: z.number().nullable(),
  status: z.string().nullable(),
  observedAt: z.number().nullable().optional(),
});

export const accountSummarySchema = z.object({
  id: z.string(),
  provider: z.enum(POOL_PROVIDERS),
  kind: z.string(),
  label: z.string().nullable(),
  email: z.string().nullable(),
  subscriptionType: z.string().nullable(),
  enabled: z.boolean(),
  priority: z.number(),
  lastUsedAt: z.number().nullable(),

  fiveHourUtilization: z.number().nullable(),
  fiveHourResetAt: z.number().nullable(),
  fiveHourStatus: z.string().nullable(),
  sevenDayUtilization: z.number().nullable(),
  sevenDayResetAt: z.number().nullable(),
  sevenDayStatus: z.string().nullable(),
  familyWeekly: z.record(z.string(), familyQuotaSchema.nullable()),
  limitWindows: z.array(limitWindowSchema),

  observedAt: z.number().nullable(),
  heldUntil: z.number().nullable(),
  error: z.string().nullable(),
  inFlight: z.number(),
  status: z.enum(["disabled", "ready", "held", "exhausted", "error"]),
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;
export type AccountStatus = AccountSummary["status"];

export const poolStatusSchema = z.object({
  accepting: z.boolean(),
  inFlight: z.number(),
  enabledAccountCount: z.number(),
  routing: z.object({ claude: z.boolean(), codex: z.boolean() }),
  accounts: z.array(accountSummarySchema),
});

export type PoolStatus = z.infer<typeof poolStatusSchema>;

export const poolConfigSchema = z.object({
  switchThreshold: z.number().nullable().optional(),
});
