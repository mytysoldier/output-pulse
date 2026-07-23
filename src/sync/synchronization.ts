import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createCommitStore, type CommitStore } from "../db/commit-store.js";
import {
  createCompletedIssueStore,
  type CompletedIssueStore,
} from "../db/completed-issue-store.js";
import { createPullRequestStore, type PullRequestStore } from "../db/pull-request-store.js";
import { repositories } from "../db/schema/index.js";
import type {
  SyncMode,
  SyncRunStatus,
  SyncRunStore,
  SyncTriggerType,
} from "../db/sync-run-store.js";
import { synchronizeRepositoryCommits, type GitHubCommitApi } from "../github/commits.js";
import {
  synchronizeCompletedIssues,
  type GitHubCompletedIssueApi,
} from "../github/completed-issues.js";
import { synchronizePullRequests, type GitHubPullRequestApi } from "../github/pull-requests.js";
import type {
  GitHubRateLimit,
  SynchronizationTargets,
  TargetRepository,
} from "../github/targets.js";
import { eq } from "drizzle-orm";

const INITIAL_SYNC_DAYS = 30;
const INCREMENTAL_SYNC_OVERLAP_HOURS = 48;

export interface SynchronizationRequest {
  from?: Date;
  mode: SyncMode;
  to?: Date;
  triggerType: SyncTriggerType;
}

export interface SynchronizationPeriod {
  from?: Date;
  to?: Date;
}

export interface RepositorySynchronizationStores {
  commitStore: CommitStore;
  completedIssueStore: CompletedIssueStore;
  markRepositorySynchronized(repositoryId: number, synchronizedAt: Date): Promise<void>;
  pullRequestStore: PullRequestStore;
}

export interface RepositoryTransactionRunner {
  transaction<T>(operation: (stores: RepositorySynchronizationStores) => Promise<T>): Promise<T>;
}

export interface SynchronizationResult {
  fetchedCount: number;
  insertedCount: number;
  period: SynchronizationPeriod;
  rateLimitRemaining?: number;
  repositoryFailed: number;
  repositorySucceeded: number;
  repositoryTotal: number;
  status: Exclude<SyncRunStatus, "running">;
  syncRunId: number;
  updatedCount: number;
}

export interface SynchronizationDependencies {
  commitApi: GitHubCommitApi;
  completedIssueApi: GitHubCompletedIssueApi;
  loadTargets(): Promise<SynchronizationTargets>;
  now?(): Date;
  pullRequestApi: GitHubPullRequestApi;
  repositoryTransactions: RepositoryTransactionRunner;
  syncRunStore: SyncRunStore;
}

/**
 * 同期モードを検証し、対象リポジトリを個別トランザクションで同期する。
 * リポジトリ識別子やGitHubの応答本文はsync_runsへ記録しない。
 */
export async function synchronize(
  request: SynchronizationRequest,
  dependencies: SynchronizationDependencies,
): Promise<SynchronizationResult> {
  validateRequest(request);

  const startedAt = dependencies.now?.() ?? new Date();
  const period = await resolvePeriod(request, startedAt, dependencies.syncRunStore);
  const syncRunId = await dependencies.syncRunStore.startSyncRun({
    requestedFrom: period.from,
    requestedTo: period.to,
    startedAt,
    syncMode: request.mode,
    triggerType: request.triggerType,
  });

  let targets: SynchronizationTargets;
  try {
    targets = await dependencies.loadTargets();
  } catch {
    const result: SynchronizationResult = {
      fetchedCount: 0,
      insertedCount: 0,
      period,
      repositoryFailed: 0,
      repositorySucceeded: 0,
      repositoryTotal: 0,
      status: "failure",
      syncRunId,
      updatedCount: 0,
    };
    await dependencies.syncRunStore.finishSyncRun(
      syncRunId,
      toFinishInput(result, dependencies.now?.() ?? new Date(), "同期対象の取得に失敗しました"),
    );
    return result;
  }

  const aggregate = createAggregate(targets.rateLimit, targets.repositories.length);

  for (const repository of targets.repositories) {
    try {
      const repositoryPeriod = resolveRepositoryPeriod(request, startedAt, repository);
      const result = await dependencies.repositoryTransactions.transaction(async (stores) => {
        const synchronized = await synchronizeRepository({
          commitApi: dependencies.commitApi,
          completedIssueApi: dependencies.completedIssueApi,
          period: repositoryPeriod,
          pullRequestApi: dependencies.pullRequestApi,
          repository,
          stores,
          synchronizedAt: startedAt,
          targets,
        });
        if (request.mode !== "range") {
          await stores.markRepositorySynchronized(repository.githubRepositoryId, startedAt);
        }
        return synchronized;
      });
      aggregate.fetchedCount += result.fetchedCount;
      aggregate.insertedCount += result.insertedCount;
      aggregate.updatedCount += result.updatedCount;
      aggregate.rateLimitRemaining = lowestRateLimit(
        aggregate.rateLimitRemaining,
        result.rateLimitRemaining,
      );
      aggregate.repositorySucceeded += 1;
    } catch {
      aggregate.repositoryFailed += 1;
    }
  }

  const status = resolveStatus(aggregate.repositorySucceeded, aggregate.repositoryFailed);
  const result: SynchronizationResult = {
    ...aggregate,
    period,
    status,
    syncRunId,
    updatedCount: aggregate.updatedCount,
  };
  await dependencies.syncRunStore.finishSyncRun(
    syncRunId,
    toFinishInput(result, dependencies.now?.() ?? new Date()),
  );
  return result;
}

/** NodePgDatabaseのトランザクションごとに、リポジトリ同期で使うStoreを生成する。 */
export function createRepositoryTransactionRunner(
  database: NodePgDatabase,
): RepositoryTransactionRunner {
  return {
    transaction(operation) {
      return database.transaction((transaction) =>
        operation({
          commitStore: createCommitStore(transaction),
          completedIssueStore: createCompletedIssueStore(transaction),
          async markRepositorySynchronized(repositoryId, synchronizedAt) {
            await transaction
              .update(repositories)
              .set({ lastSyncedAt: synchronizedAt })
              .where(eq(repositories.githubRepositoryId, repositoryId));
          },
          pullRequestStore: createPullRequestStore(transaction),
        }),
      );
    },
  };
}

async function synchronizeRepository({
  commitApi,
  completedIssueApi,
  period,
  pullRequestApi,
  repository,
  stores,
  synchronizedAt,
  targets,
}: {
  commitApi: GitHubCommitApi;
  completedIssueApi: GitHubCompletedIssueApi;
  period: SynchronizationPeriod;
  pullRequestApi: GitHubPullRequestApi;
  repository: TargetRepository;
  stores: RepositorySynchronizationStores;
  synchronizedAt: Date;
  targets: SynchronizationTargets;
}): Promise<{
  fetchedCount: number;
  insertedCount: number;
  rateLimitRemaining?: number;
  updatedCount: number;
}> {
  const commits = await synchronizeRepositoryCommits({
    api: commitApi,
    repository,
    since: period.from,
    store: stores.commitStore,
    synchronizedAt,
    trackedActors: targets.trackedActors,
    until: period.to,
  });
  const pullRequests = await synchronizePullRequests({
    api: pullRequestApi,
    repository,
    since: period.from,
    store: stores.pullRequestStore,
    synchronizedAt,
    trackedActors: targets.trackedActors,
    until: period.to,
  });
  const completedIssues = await synchronizeCompletedIssues({
    api: completedIssueApi,
    repository,
    since: period.from,
    store: stores.completedIssueStore,
    synchronizedAt,
    trackedActors: targets.trackedActors,
    until: period.to,
  });

  return {
    fetchedCount: commits.fetchedCount + pullRequests.fetchedCount + completedIssues.fetchedCount,
    insertedCount:
      commits.insertedCount + pullRequests.insertedCount + completedIssues.insertedCount,
    rateLimitRemaining: lowestRateLimit(
      lowestRateLimit(commits.rateLimit.remaining, pullRequests.rateLimit.remaining),
      completedIssues.rateLimit.remaining,
    ),
    updatedCount: commits.updatedCount + pullRequests.updatedCount + completedIssues.updatedCount,
  };
}

function createAggregate(rateLimit: GitHubRateLimit, repositoryTotal: number) {
  return {
    fetchedCount: 0,
    insertedCount: 0,
    rateLimitRemaining: rateLimit.remaining,
    repositoryFailed: 0,
    repositorySucceeded: 0,
    repositoryTotal,
    updatedCount: 0,
  };
}

function resolveStatus(
  repositorySucceeded: number,
  repositoryFailed: number,
): Exclude<SyncRunStatus, "running"> {
  if (repositoryFailed === 0) {
    return "success";
  }

  return repositorySucceeded === 0 ? "failure" : "partial_failure";
}

async function resolvePeriod(
  request: SynchronizationRequest,
  startedAt: Date,
  syncRunStore: SyncRunStore,
): Promise<SynchronizationPeriod> {
  if (request.mode === "range") {
    return { from: request.from, to: request.to };
  }

  if (request.mode === "full") {
    return {};
  }

  const lastSuccessfulFinishedAt = await syncRunStore.findLastIncrementalOrFullSuccessFinishedAt();
  return {
    from:
      lastSuccessfulFinishedAt === undefined
        ? subtractDays(startedAt, INITIAL_SYNC_DAYS)
        : subtractHours(lastSuccessfulFinishedAt, INCREMENTAL_SYNC_OVERLAP_HOURS),
    to: startedAt,
  };
}

function resolveRepositoryPeriod(
  request: SynchronizationRequest,
  startedAt: Date,
  repository: TargetRepository,
): SynchronizationPeriod {
  if (request.mode === "range") {
    return { from: request.from, to: request.to };
  }
  if (request.mode === "full") {
    return {};
  }

  return {
    from:
      repository.lastSyncedAt === undefined
        ? subtractDays(startedAt, INITIAL_SYNC_DAYS)
        : subtractHours(repository.lastSyncedAt, INCREMENTAL_SYNC_OVERLAP_HOURS),
    to: startedAt,
  };
}

function validateRequest(request: SynchronizationRequest): void {
  if (request.mode === "range") {
    if (!isValidDate(request.from) || !isValidDate(request.to) || request.from > request.to) {
      throw new Error("期間指定同期には有効な開始日時と終了日時が必要です");
    }
    return;
  }

  if (request.from !== undefined || request.to !== undefined) {
    throw new Error("期間は期間指定同期でのみ指定できます");
  }
}

function isValidDate(value: Date | undefined): value is Date {
  return value !== undefined && !Number.isNaN(value.getTime());
}

function subtractDays(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

function subtractHours(date: Date, hours: number): Date {
  return new Date(date.getTime() - hours * 60 * 60 * 1000);
}

function lowestRateLimit(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) {
    return right;
  }
  if (right === undefined) {
    return left;
  }
  return Math.min(left, right);
}

function toFinishInput(result: SynchronizationResult, finishedAt: Date, errorSummary?: string) {
  return {
    ...(errorSummary === undefined ? {} : { errorSummary }),
    fetchedCount: result.fetchedCount,
    finishedAt,
    githubRateLimitRemaining: result.rateLimitRemaining,
    insertedCount: result.insertedCount,
    repositoryFailed: result.repositoryFailed,
    repositorySucceeded: result.repositorySucceeded,
    repositoryTotal: result.repositoryTotal,
    status: result.status,
    updatedCount: result.updatedCount,
  };
}
