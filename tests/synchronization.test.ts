import { describe, expect, it } from "vitest";

import type { PersistedCommit, CommitStore } from "../src/db/commit-store.js";
import type {
  CompletedIssueStore,
  PersistedCompletedIssue,
} from "../src/db/completed-issue-store.js";
import type { PersistedPullRequest, PullRequestStore } from "../src/db/pull-request-store.js";
import type {
  FinishSyncRunInput,
  StartSyncRunInput,
  SyncRunStore,
} from "../src/db/sync-run-store.js";
import type { GitHubCommitApi } from "../src/github/commits.js";
import type { GitHubCompletedIssueApi } from "../src/github/completed-issues.js";
import type { GitHubPullRequestApi } from "../src/github/pull-requests.js";
import type { SynchronizationTargets, TargetRepository } from "../src/github/targets.js";
import {
  synchronize,
  type RepositorySynchronizationStores,
  type RepositoryTransactionRunner,
} from "../src/sync/synchronization.js";

const now = new Date("2026-07-20T00:00:00.000Z");
const repository: TargetRepository = {
  defaultBranch: "main",
  githubRepositoryId: 101,
  isArchived: false,
  isFork: false,
  name: "first-repository",
  ownerGithubUserId: 1,
  ownerLogin: "mytysoldier",
  visibility: "private",
};

function createTargets(repositories: TargetRepository[] = [repository]): SynchronizationTargets {
  return {
    rateLimit: { remaining: 5000 },
    repositories,
    trackedActors: [{ actorType: "user", githubLogin: "mytysoldier", githubUserId: 1 }],
  };
}

function createSyncRunStore(lastSuccess?: Date): SyncRunStore & {
  finishes: Array<{ id: number; input: FinishSyncRunInput }>;
  starts: StartSyncRunInput[];
} {
  return {
    finishes: [],
    starts: [],
    async findLastIncrementalOrFullSuccessFinishedAt() {
      return lastSuccess;
    },
    async finishSyncRun(id, input) {
      this.finishes.push({ id, input });
    },
    async startSyncRun(input) {
      this.starts.push(input);
      return 42;
    },
  };
}

function createStores(): RepositorySynchronizationStores & { persisted: string[] } {
  const persisted: string[] = [];
  const commitStore: CommitStore = {
    async upsertCommits(commits: PersistedCommit[]) {
      persisted.push(...commits.map((commit) => `commit:${commit.sha}`));
    },
  };
  const pullRequestStore: PullRequestStore = {
    async upsertPullRequests(pullRequests: PersistedPullRequest[]) {
      persisted.push(...pullRequests.map((pullRequest) => `pr:${pullRequest.githubNodeId}`));
    },
  };
  const completedIssueStore: CompletedIssueStore = {
    async upsertCompletedIssues(issues: PersistedCompletedIssue[]) {
      persisted.push(...issues.map((issue) => `issue:${issue.githubNodeId}`));
    },
  };

  return {
    commitStore,
    completedIssueStore,
    async markRepositorySynchronized() {},
    persisted,
    pullRequestStore,
  };
}

function createTransactionRunner(
  stores: RepositorySynchronizationStores & { persisted: string[] },
  failRepositoryId?: number,
): RepositoryTransactionRunner {
  let calls = 0;
  return {
    async transaction(operation) {
      const before = [...stores.persisted];
      const result = await operation(stores);
      calls += 1;
      if (calls === failRepositoryId) {
        stores.persisted.splice(0, stores.persisted.length, ...before);
        throw new Error("database rollback");
      }
      return result;
    },
  };
}

function createCommitApi(): GitHubCommitApi {
  return {
    async listDefaultBranchCommitsPage() {
      return {
        commits: [
          {
            authorGithubUserId: 1,
            committedAt: new Date("2026-07-19T00:00:00.000Z"),
            sha: "commit-1",
          },
        ],
        rateLimit: { remaining: 4999 },
      };
    },
  };
}

function createPullRequestApi(): GitHubPullRequestApi {
  return {
    async listPullRequestsPage() {
      return {
        pullRequests: [
          {
            authorGithubUserId: 1,
            createdAt: new Date("2026-07-19T00:00:00.000Z"),
            githubNodeId: "PR_1",
            mergedAt: null,
            number: 1,
            state: "open",
          },
        ],
        rateLimit: { remaining: 4998 },
      };
    },
  };
}

function createCompletedIssueApi(): GitHubCompletedIssueApi {
  return {
    async listClosedIssuesPage() {
      return {
        endCursor: null,
        hasNextPage: false,
        issues: [
          {
            authorGithubUserId: 1,
            closedEvents: [
              {
                closedAt: new Date("2026-07-19T00:00:00.000Z"),
                closingPullRequestAuthorGithubUserId: null,
              },
            ],
            githubNodeId: "I_1",
            number: 1,
            title: "完了Issue",
          },
        ],
        rateLimit: { remaining: 4997 },
      };
    },
  };
}

function createDependencies({
  lastSuccess,
  repositories,
  transactionRunner,
}: {
  lastSuccess?: Date;
  repositories?: TargetRepository[];
  transactionRunner: RepositoryTransactionRunner;
}) {
  const syncRunStore = createSyncRunStore(lastSuccess);
  return {
    commitApi: createCommitApi(),
    completedIssueApi: createCompletedIssueApi(),
    loadTargets: async () => createTargets(repositories),
    now: () => now,
    pullRequestApi: createPullRequestApi(),
    repositoryTransactions: transactionRunner,
    syncRunStore,
  };
}

describe("synchronize", () => {
  it("uses the initial 30-day period and records a successful run without repository names", async () => {
    const stores = createStores();
    const dependencies = createDependencies({ transactionRunner: createTransactionRunner(stores) });

    const result = await synchronize(
      { mode: "incremental", triggerType: "scheduled" },
      dependencies,
    );

    expect(result).toMatchObject({
      fetchedCount: 3,
      insertedCount: 3,
      period: { from: new Date("2026-06-20T00:00:00.000Z"), to: now },
      rateLimitRemaining: 4997,
      repositorySucceeded: 1,
      repositoryTotal: 1,
      status: "success",
      syncRunId: 42,
    });
    expect(stores.persisted).toEqual(["commit:commit-1", "pr:PR_1", "issue:I_1"]);
    expect(dependencies.syncRunStore.starts).toEqual([
      expect.objectContaining({
        requestedFrom: new Date("2026-06-20T00:00:00.000Z"),
        requestedTo: now,
      }),
    ]);
    expect(dependencies.syncRunStore.finishes[0]?.input).toMatchObject({
      repositoryFailed: 0,
      repositorySucceeded: 1,
      status: "success",
    });
    expect(JSON.stringify(dependencies.syncRunStore.finishes)).not.toContain(repository.name);
  });

  it("overlaps the last complete success by 48 hours", async () => {
    const stores = createStores();
    const dependencies = createDependencies({
      lastSuccess: new Date("2026-07-19T12:00:00.000Z"),
      transactionRunner: createTransactionRunner(stores),
    });

    const result = await synchronize({ mode: "incremental", triggerType: "manual" }, dependencies);

    expect(result.period).toEqual({
      from: new Date("2026-07-17T12:00:00.000Z"),
      to: new Date("2026-07-20T00:00:00.000Z"),
    });
  });

  it("uses each repository's last success time and records only successful repositories", async () => {
    const stores = createStores();
    const secondRepository = {
      ...repository,
      githubRepositoryId: 102,
      lastSyncedAt: new Date("2026-07-19T12:00:00.000Z"),
      name: "second-repository",
    };
    const dependencies = createDependencies({
      repositories: [repository, secondRepository],
      transactionRunner: createTransactionRunner(stores),
    });
    const requestedSince: Array<Date | undefined> = [];
    const synchronizedRepositories: number[] = [];
    stores.markRepositorySynchronized = async (repositoryId) => {
      synchronizedRepositories.push(repositoryId);
    };
    dependencies.commitApi = {
      async listDefaultBranchCommitsPage(input) {
        requestedSince.push(input.since);
        return { commits: [], rateLimit: {} };
      },
    };

    await synchronize({ mode: "incremental", triggerType: "manual" }, dependencies);

    expect(requestedSince).toEqual([
      new Date("2026-06-20T00:00:00.000Z"),
      new Date("2026-07-17T12:00:00.000Z"),
    ]);
    expect(synchronizedRepositories).toEqual([101, 102]);
  });

  it("does not advance a repository cursor for a range sync", async () => {
    const stores = createStores();
    const synchronizedRepositories: number[] = [];
    stores.markRepositorySynchronized = async (repositoryId) => {
      synchronizedRepositories.push(repositoryId);
    };
    const dependencies = createDependencies({ transactionRunner: createTransactionRunner(stores) });

    await synchronize(
      {
        from: new Date("2026-07-01T00:00:00.000Z"),
        mode: "range",
        to: new Date("2026-07-10T00:00:00.000Z"),
        triggerType: "manual",
      },
      dependencies,
    );

    expect(synchronizedRepositories).toEqual([]);
  });

  it("accepts range and full modes, while rejecting invalid mode-specific dates", async () => {
    const stores = createStores();
    const dependencies = createDependencies({ transactionRunner: createTransactionRunner(stores) });
    const from = new Date("2026-07-01T00:00:00.000Z");
    const to = new Date("2026-07-10T00:00:00.000Z");

    await expect(
      synchronize({ from, mode: "range", to, triggerType: "manual" }, dependencies),
    ).resolves.toMatchObject({ insertedCount: 0, period: { from, to } });
    await expect(
      synchronize({ mode: "full", triggerType: "manual" }, dependencies),
    ).resolves.toMatchObject({ period: {} });
    await expect(
      synchronize({ mode: "range", triggerType: "manual" }, dependencies),
    ).rejects.toThrow("期間指定同期");
    await expect(
      synchronize({ from, mode: "full", triggerType: "manual" }, dependencies),
    ).rejects.toThrow("期間は期間指定同期");
    await expect(
      synchronize({ mode: "ful" as never, triggerType: "manual" }, dependencies),
    ).rejects.toThrow("同期モードはincremental、range、fullのいずれか");
  });

  it("rolls back only a failed repository and continues later repositories", async () => {
    const stores = createStores();
    const secondRepository = { ...repository, githubRepositoryId: 102, name: "second-repository" };
    const dependencies = createDependencies({
      repositories: [repository, secondRepository],
      transactionRunner: createTransactionRunner(stores, 1),
    });

    const result = await synchronize({ mode: "full", triggerType: "manual" }, dependencies);

    expect(result).toMatchObject({
      repositoryFailed: 1,
      repositorySucceeded: 1,
      repositoryTotal: 2,
      status: "partial_failure",
    });
    expect(stores.persisted).toEqual(["commit:commit-1", "pr:PR_1", "issue:I_1"]);
    expect(dependencies.syncRunStore.finishes[0]?.input.errorSummary).toBeUndefined();
  });

  it("records failure without API details when targets cannot be loaded", async () => {
    const stores = createStores();
    const dependencies = createDependencies({ transactionRunner: createTransactionRunner(stores) });
    dependencies.loadTargets = async () => {
      throw new Error("token for first-repository was rejected");
    };

    const result = await synchronize({ mode: "full", triggerType: "manual" }, dependencies);

    expect(result).toMatchObject({ repositoryTotal: 0, status: "failure" });
    expect(dependencies.syncRunStore.finishes[0]?.input).toMatchObject({
      errorSummary: "同期対象の取得に失敗しました",
      status: "failure",
    });
  });

  it("surfaces a final sync-run write failure without replacing the committed result", async () => {
    const stores = createStores();
    const dependencies = createDependencies({ transactionRunner: createTransactionRunner(stores) });
    dependencies.syncRunStore.finishSyncRun = async () => {
      throw new Error("sync run write failed");
    };

    await expect(
      synchronize({ mode: "full", triggerType: "manual" }, dependencies),
    ).rejects.toThrow("sync run write failed");
    expect(stores.persisted).toEqual(["commit:commit-1", "pr:PR_1", "issue:I_1"]);
  });
});
