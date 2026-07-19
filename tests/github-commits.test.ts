import { describe, expect, it } from "vitest";

import type { CommitStore } from "../src/db/commit-store.js";
import type { TargetRepository } from "../src/github/targets.js";
import {
  type GitHubCommit,
  type GitHubCommitApi,
  synchronizeRepositoryCommits,
} from "../src/github/commits.js";

const repository: TargetRepository = {
  githubRepositoryId: 101,
  ownerGithubUserId: 1,
  visibility: "private",
  defaultBranch: "main",
  isFork: false,
  isArchived: false,
  name: "private-project",
  ownerLogin: "mytysoldier",
};

const trackedActors = [
  { githubUserId: 1, githubLogin: "mytysoldier", actorType: "user" as const },
  { githubUserId: 2, githubLogin: "output-pulse-bot", actorType: "bot" as const },
];

function createCommit(sha: string, authorGithubUserId: number | undefined): GitHubCommit {
  return {
    sha,
    authorGithubUserId,
    committedAt: new Date("2026-07-18T15:00:00.000Z"),
  };
}

function createStore(): CommitStore & { commits: Map<string, object> } {
  return {
    commits: new Map(),
    async upsertCommits(commits) {
      for (const commit of commits) {
        const key = `${commit.repositoryId}:${commit.sha}`;
        const existing = this.commits.get(key);
        this.commits.set(key, {
          ...commit,
          firstSeenAt:
            existing !== undefined && "firstSeenAt" in existing
              ? existing.firstSeenAt
              : commit.firstSeenAt,
        });
      }
    },
  };
}

describe("synchronizeRepositoryCommits", () => {
  it("stores only tracked authors from the default branch, including merge commits", async () => {
    const requests: Parameters<GitHubCommitApi["listDefaultBranchCommitsPage"]>[0][] = [];
    const api: GitHubCommitApi = {
      async listDefaultBranchCommitsPage(input) {
        requests.push(input);
        return {
          rateLimit: { remaining: 4990 },
          commits: [
            createCommit("author-commit", 1),
            createCommit("merge-commit", 2),
            createCommit("other-user-commit", 3),
            createCommit("unlinked-commit", undefined),
          ],
        };
      },
    };
    const store = createStore();
    const synchronizedAt = new Date("2026-07-19T00:00:00.000Z");

    const result = await synchronizeRepositoryCommits({
      api,
      store,
      repository,
      trackedActors,
      synchronizedAt,
    });

    expect(requests).toEqual([
      expect.objectContaining({
        owner: "mytysoldier",
        repository: "private-project",
        defaultBranch: "main",
        page: 1,
        perPage: 100,
      }),
    ]);
    expect([...store.commits.keys()]).toEqual(["101:author-commit", "101:merge-commit"]);
    expect(store.commits.get("101:author-commit")).toMatchObject({
      authorGithubUserId: 1,
      committedAt: new Date("2026-07-18T15:00:00.000Z"),
      firstSeenAt: synchronizedAt,
      lastSeenAt: synchronizedAt,
    });
    expect(result).toEqual({ fetchedCount: 4, persistedCount: 2, rateLimit: { remaining: 4990 } });
  });

  it("paginates and does not add duplicates when the same period is synchronized again", async () => {
    const api: GitHubCommitApi = {
      async listDefaultBranchCommitsPage({ page }) {
        return {
          rateLimit: { remaining: 4980 },
          commits:
            page === 1
              ? Array.from({ length: 100 }, (_, index) => createCommit(`commit-${index}`, 1))
              : [createCommit("commit-100", 1)],
        };
      },
    };
    const store = createStore();
    const since = new Date("2026-07-01T00:00:00.000Z");
    const until = new Date("2026-07-20T00:00:00.000Z");

    await synchronizeRepositoryCommits({ api, store, repository, trackedActors, since, until });
    const result = await synchronizeRepositoryCommits({
      api,
      store,
      repository,
      trackedActors,
      since,
      until,
    });

    expect(store.commits).toHaveLength(101);
    expect(result).toMatchObject({ fetchedCount: 101, persistedCount: 101 });
  });
});
