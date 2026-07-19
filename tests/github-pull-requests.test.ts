import { describe, expect, it } from "vitest";

import type { PersistedPullRequest, PullRequestStore } from "../src/db/pull-request-store.js";
import type { TrackedActor } from "../src/db/target-store.js";
import {
  type GitHubPullRequest,
  type GitHubPullRequestApi,
  synchronizePullRequests,
} from "../src/github/pull-requests.js";
import { GitHubApiError, type TargetRepository } from "../src/github/targets.js";

const repository: TargetRepository = {
  defaultBranch: "main",
  githubRepositoryId: 101,
  isArchived: false,
  isFork: false,
  name: "private-project",
  ownerGithubUserId: 1,
  ownerLogin: "mytysoldier",
  visibility: "private",
};

const trackedActors: TrackedActor[] = [
  { actorType: "user", githubLogin: "mytysoldier", githubUserId: 1 },
  { actorType: "bot", githubLogin: "output-pulse-bot", githubUserId: 2 },
];

const trackedOpenPullRequest: GitHubPullRequest = {
  authorGithubUserId: 1,
  createdAt: new Date("2026-07-01T00:00:00Z"),
  githubNodeId: "PR_node_1",
  mergedAt: null,
  number: 10,
  state: "open",
};

function createStore(): PullRequestStore & { pullRequests: Map<string, PersistedPullRequest> } {
  return {
    pullRequests: new Map(),
    async upsertPullRequests(pullRequests) {
      for (const pullRequest of pullRequests) {
        const existing = this.pullRequests.get(pullRequest.githubNodeId);
        this.pullRequests.set(pullRequest.githubNodeId, {
          ...pullRequest,
          firstSeenAt: existing?.firstSeenAt ?? pullRequest.firstSeenAt,
        });
      }
    },
  };
}

describe("synchronizePullRequests", () => {
  it("paginates and saves only pull requests authored by tracked actors", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        ...trackedOpenPullRequest,
        githubNodeId: `PR_node_${index}`,
        number: index + 1,
      })),
      [
        { ...trackedOpenPullRequest, githubNodeId: "PR_node_bot", authorGithubUserId: 2 },
        { ...trackedOpenPullRequest, githubNodeId: "PR_node_other", authorGithubUserId: 3 },
      ],
    ];
    const requestedPages: number[] = [];
    const api: GitHubPullRequestApi = {
      async listPullRequestsPage({ page }) {
        requestedPages.push(page);
        return { pullRequests: pages[page - 1] ?? [], rateLimit: { remaining: 4980 } };
      },
    };
    const store = createStore();

    const result = await synchronizePullRequests({
      api,
      repository,
      store,
      synchronizedAt: new Date("2026-07-02T00:00:00Z"),
      trackedActors,
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(result).toEqual({ fetchedCount: 102, rateLimit: { remaining: 4980 }, savedCount: 101 });
    expect(store.pullRequests).toHaveLength(101);
    expect(store.pullRequests.get("PR_node_other")).toBeUndefined();
    expect(store.pullRequests.get("PR_node_1")).toEqual({
      authorGithubUserId: 1,
      createdAt: new Date("2026-07-01T00:00:00Z"),
      firstSeenAt: new Date("2026-07-02T00:00:00Z"),
      githubNodeId: "PR_node_1",
      lastSeenAt: new Date("2026-07-02T00:00:00Z"),
      mergedAt: null,
      number: 2,
      repositoryId: 101,
      state: "open",
    });
  });

  it("updates an existing pull request when it is merged without duplicating it", async () => {
    const store = createStore();
    const api: GitHubPullRequestApi = {
      async listPullRequestsPage() {
        return { pullRequests: [trackedOpenPullRequest], rateLimit: {} };
      },
    };

    await synchronizePullRequests({
      api,
      repository,
      store,
      synchronizedAt: new Date("2026-07-02T00:00:00Z"),
      trackedActors,
    });

    const mergedApi: GitHubPullRequestApi = {
      async listPullRequestsPage() {
        return {
          pullRequests: [
            {
              ...trackedOpenPullRequest,
              mergedAt: new Date("2026-07-03T00:00:00Z"),
              state: "closed",
            },
          ],
          rateLimit: {},
        };
      },
    };

    await synchronizePullRequests({
      api: mergedApi,
      repository,
      store,
      synchronizedAt: new Date("2026-07-04T00:00:00Z"),
      trackedActors,
    });

    expect(store.pullRequests).toHaveLength(1);
    expect(store.pullRequests.get("PR_node_1")).toMatchObject({
      firstSeenAt: new Date("2026-07-02T00:00:00Z"),
      lastSeenAt: new Date("2026-07-04T00:00:00Z"),
      mergedAt: new Date("2026-07-03T00:00:00Z"),
      state: "merged",
    });
  });

  it("returns a sanitized typed error when GitHub rejects a request", async () => {
    const api: GitHubPullRequestApi = {
      async listPullRequestsPage() {
        throw { status: 401, message: "token for mytysoldier/private-project" };
      },
    };
    const store = createStore();

    await expect(
      synchronizePullRequests({ api, repository, store, trackedActors }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "GitHub API request failed (status: 401)",
        name: "GitHubApiError",
        status: 401,
      }),
    );
    await expect(
      synchronizePullRequests({ api, repository, store, trackedActors }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});
