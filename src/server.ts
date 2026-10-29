import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract, USAGE_CHANGED_CHANNEL, type Snapshot } from "./contract.ts";
import {
  poolConfigSchema,
  poolStatusSchema,
  type AccountSummary,
} from "./lib/pool-contracts.ts";
import { buildSnapshot, DEFAULT_SWITCH_THRESHOLD } from "./lib/normalise.ts";

const ACCOUNT_POOL_PLUGIN_ID = "account-pool";

const emptySnapshot = (error: string | null, poolUnavailable: boolean): Snapshot => ({
  fetchedAt: Date.now(),
  error,
  poolUnavailable,
  groups: [],
});

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function accountUsagePlugin(bb: BbPluginApi): void {
  /**
   * account-pool's own realtime channel is scoped to account-pool, so we cannot
   * subscribe to it. We read its RPC instead and re-publish on OUR channel, which
   * is what an open panel listens to.
   */
  const readStatus = async (): Promise<Snapshot> => {
    let status;
    try {
      status = await bb.sdk.plugins.callRpc({
        pluginId: ACCOUNT_POOL_PLUGIN_ID,
        method: "status.get",
        input: null,
        outputSchema: poolStatusSchema,
      });
    } catch (error) {
      const message = messageOf(error);
      // Distinguish "the pooler isn't there" from "the pooler broke" — the first
      // is a setup state with an obvious fix, the second is a defect to surface.
      const missing =
        /not found|not installed|disabled|unknown plugin/i.test(message);
      bb.log.warn(`account-pool status.get failed: ${message}`);
      return emptySnapshot(missing ? null : message, missing);
    }

    let threshold = DEFAULT_SWITCH_THRESHOLD;
    try {
      const config = await bb.sdk.plugins.callRpc({
        pluginId: ACCOUNT_POOL_PLUGIN_ID,
        method: "config.get",
        input: null,
        outputSchema: poolConfigSchema,
      });
      if (typeof config.switchThreshold === "number") {
        threshold = config.switchThreshold;
      }
    } catch (error) {
      // Not fatal: the default matches account-pool's own default, and every
      // number we render still comes from the pool itself.
      bb.log.debug(`account-pool config.get failed: ${messageOf(error)}`);
    }

    return buildSnapshot(status, threshold, Date.now());
  };

  /**
   * Force account-pool to re-read usage from Anthropic / OpenAI. There is no bulk
   * refresh RPC, so this is one upstream round-trip per enabled account — which is
   * exactly why nothing calls it automatically.
   */
  const refreshAll = async (): Promise<Snapshot> => {
    let accounts: AccountSummary[] = [];
    try {
      const status = await bb.sdk.plugins.callRpc({
        pluginId: ACCOUNT_POOL_PLUGIN_ID,
        method: "status.get",
        input: null,
        outputSchema: poolStatusSchema,
      });
      accounts = status.accounts;
    } catch (error) {
      return emptySnapshot(messageOf(error), false);
    }

    await Promise.allSettled(
      accounts
        .filter((account) => account.enabled && account.kind === "oauth")
        .map((account) =>
          bb.sdk.plugins.callRpc({
            pluginId: ACCOUNT_POOL_PLUGIN_ID,
            method: "account.refreshUsage",
            input: { accountId: account.id },
            outputSchema: z.unknown(),
          }),
        ),
    );

    const snapshot = await readStatus();
    bb.realtime.publish(USAGE_CHANGED_CHANNEL, { fetchedAt: snapshot.fetchedAt });
    return snapshot;
  };

  bb.rpc.register(rpcContract, {
    snapshot: readStatus,
    refresh: refreshAll,
  });

  // A thread finishing is the moment usage has just moved, so nudge any open
  // panel to re-read rather than waiting out its poll interval.
  const nudge = (): void => {
    bb.realtime.publish(USAGE_CHANGED_CHANNEL, { fetchedAt: Date.now() });
  };
  bb.events.on("thread.idle", nudge);
  bb.events.on("thread.failed", nudge);
}
