import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { syncRuns } from "./schema/index.js";

export type SyncRunStatus = "failure" | "partial_failure" | "running" | "success";
export type SyncMode = "full" | "incremental" | "range";
export type SyncTriggerType = "manual" | "scheduled";

export interface StartSyncRunInput {
  requestedFrom?: Date;
  requestedTo?: Date;
  startedAt: Date;
  syncMode: SyncMode;
  triggerType: SyncTriggerType;
}

export interface FinishSyncRunInput {
  errorSummary?: string;
  fetchedCount: number;
  finishedAt: Date;
  githubRateLimitRemaining?: number;
  insertedCount: number;
  repositoryFailed: number;
  repositorySucceeded: number;
  repositoryTotal: number;
  status: Exclude<SyncRunStatus, "running">;
  updatedCount: number;
}

export interface SyncRunStore {
  findLastSuccessfulFinishedAt(): Promise<Date | undefined>;
  finishSyncRun(id: number, input: FinishSyncRunInput): Promise<void>;
  startSyncRun(input: StartSyncRunInput): Promise<number>;
}

/** 同期の開始・結果だけを記録し、リポジトリ名やAPIエラー詳細は保存しないStoreを作成する。 */
export function createSyncRunStore(database: NodePgDatabase): SyncRunStore {
  return {
    async findLastSuccessfulFinishedAt() {
      const [lastSuccess] = await database
        .select({ finishedAt: syncRuns.finishedAt })
        .from(syncRuns)
        .where(and(eq(syncRuns.status, "success"), isNotNull(syncRuns.finishedAt)))
        .orderBy(desc(syncRuns.finishedAt))
        .limit(1);

      return lastSuccess?.finishedAt ?? undefined;
    },

    async finishSyncRun(id, input) {
      await database
        .update(syncRuns)
        .set({
          errorSummary: input.errorSummary,
          fetchedCount: input.fetchedCount,
          finishedAt: input.finishedAt,
          githubRateLimitRemaining: input.githubRateLimitRemaining,
          insertedCount: input.insertedCount,
          repositoryFailed: input.repositoryFailed,
          repositorySucceeded: input.repositorySucceeded,
          repositoryTotal: input.repositoryTotal,
          status: input.status,
          updatedCount: input.updatedCount,
        })
        .where(eq(syncRuns.id, id));
    },

    async startSyncRun(input) {
      const [syncRun] = await database
        .insert(syncRuns)
        .values({
          requestedFrom: input.requestedFrom,
          requestedTo: input.requestedTo,
          startedAt: input.startedAt,
          status: "running",
          syncMode: input.syncMode,
          triggerType: input.triggerType,
        })
        .returning({ id: syncRuns.id });

      if (syncRun === undefined) {
        throw new Error("Failed to create sync run");
      }

      return syncRun.id;
    },
  };
}
