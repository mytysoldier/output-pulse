import { describe, expect, it } from "vitest";

import type {
  CompletedIssueStore,
  PersistedCompletedIssue,
} from "../src/db/completed-issue-store.js";
import type { TrackedActor } from "../src/db/target-store.js";
import {
  createGitHubCompletedIssueApi,
  type GitHubCompletedIssue,
  type GitHubCompletedIssueApi,
  synchronizeCompletedIssues,
} from "../src/github/completed-issues.js";
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

function completedIssue(overrides: Partial<GitHubCompletedIssue> = {}): GitHubCompletedIssue {
  return {
    authorGithubUserId: 3,
    closedAt: new Date("2026-07-01T00:00:00Z"),
    closingPullRequestAuthorGithubUserIds: [],
    githubNodeId: "I_node_1",
    number: 10,
    title: "完了したIssue",
    ...overrides,
  };
}

function createStore(): CompletedIssueStore & { issues: Map<string, PersistedCompletedIssue> } {
  return {
    issues: new Map(),
    async upsertCompletedIssues(issues) {
      for (const issue of issues) {
        const existing = this.issues.get(issue.githubNodeId);
        this.issues.set(issue.githubNodeId, {
          ...issue,
          firstClosedAt: existing?.firstClosedAt ?? issue.firstClosedAt,
          matchedByAuthor: (existing?.matchedByAuthor ?? false) || issue.matchedByAuthor,
          matchedByClosingPr: (existing?.matchedByClosingPr ?? false) || issue.matchedByClosingPr,
        });
      }
    },
  };
}

describe("synchronizeCompletedIssues", () => {
  it("queries actor database IDs through User and Bot inline fragments", async () => {
    const client = {
      async graphql(query: string) {
        expect(query).toContain("... on User { databaseId }");
        expect(query).toContain("... on Bot { databaseId }");
        return {
          rateLimit: { remaining: 4999, resetAt: null },
          repository: {
            issues: {
              nodes: [
                {
                  author: { databaseId: 1 },
                  closedAt: "2026-07-01T00:00:00Z",
                  closedByPullRequestsReferences: { nodes: [{ author: { databaseId: 2 } }] },
                  id: "I_node_1",
                  number: 10,
                  title: "完了したIssue",
                },
              ],
              pageInfo: { endCursor: null, hasNextPage: false },
            },
          },
        };
      },
    };

    const api = createGitHubCompletedIssueApi(client as never);
    const page = await api.listClosedIssuesPage({
      owner: "mytysoldier",
      repository: "private-project",
    });

    expect(page.issues[0]).toMatchObject({
      authorGithubUserId: 1,
      closingPullRequestAuthorGithubUserIds: [2],
    });
  });

  it("saves issues matched by each OR condition exactly once", async () => {
    const pages = [
      [
        completedIssue({ authorGithubUserId: 1, githubNodeId: "I_author" }),
        completedIssue({
          closingPullRequestAuthorGithubUserIds: [2],
          githubNodeId: "I_closing_pr",
        }),
        completedIssue({
          authorGithubUserId: 1,
          closingPullRequestAuthorGithubUserIds: [2],
          githubNodeId: "I_both",
        }),
        completedIssue({ githubNodeId: "I_url_only" }),
      ],
      [completedIssue({ authorGithubUserId: 2, githubNodeId: "I_second_page" })],
    ];
    const cursors: Array<string | undefined> = [];
    const api: GitHubCompletedIssueApi = {
      async listClosedIssuesPage({ cursor }) {
        cursors.push(cursor);
        const page = pages[cursor === undefined ? 0 : 1] ?? [];
        return {
          endCursor: cursor === undefined ? "page-2" : null,
          hasNextPage: cursor === undefined,
          issues: page,
          rateLimit: { remaining: 4980 },
        };
      },
    };
    const store = createStore();

    const result = await synchronizeCompletedIssues({
      api,
      repository,
      store,
      synchronizedAt: new Date("2026-07-02T00:00:00Z"),
      trackedActors,
    });

    expect(cursors).toEqual([undefined, "page-2"]);
    expect(result).toEqual({ fetchedCount: 5, rateLimit: { remaining: 4980 }, savedCount: 4 });
    expect(store.issues.size).toBe(4);
    expect(store.issues.get("I_url_only")).toBeUndefined();
    expect(store.issues.get("I_author")).toMatchObject({
      matchedByAuthor: true,
      matchedByClosingPr: false,
    });
    expect(store.issues.get("I_closing_pr")).toMatchObject({
      matchedByAuthor: false,
      matchedByClosingPr: true,
    });
    expect(store.issues.get("I_both")).toMatchObject({
      matchedByAuthor: true,
      matchedByClosingPr: true,
    });
  });

  it("preserves the first close time while updating a title after an issue is reopened", async () => {
    const store = createStore();
    const firstApi: GitHubCompletedIssueApi = {
      async listClosedIssuesPage() {
        return { hasNextPage: false, endCursor: null, issues: [completedIssue()], rateLimit: {} };
      },
    };

    await synchronizeCompletedIssues({
      api: firstApi,
      repository,
      store,
      synchronizedAt: new Date("2026-07-02T00:00:00Z"),
      trackedActors: [{ actorType: "user", githubLogin: "mytysoldier", githubUserId: 3 }],
    });

    const reclosedApi: GitHubCompletedIssueApi = {
      async listClosedIssuesPage() {
        return {
          hasNextPage: false,
          endCursor: null,
          issues: [
            completedIssue({
              closedAt: new Date("2026-07-03T00:00:00Z"),
              title: "変更後のタイトル",
            }),
          ],
          rateLimit: {},
        };
      },
    };

    await synchronizeCompletedIssues({
      api: reclosedApi,
      repository,
      store,
      synchronizedAt: new Date("2026-07-04T00:00:00Z"),
      trackedActors: [{ actorType: "user", githubLogin: "mytysoldier", githubUserId: 3 }],
    });

    expect(store.issues.size).toBe(1);
    expect(store.issues.get("I_node_1")).toMatchObject({
      firstClosedAt: new Date("2026-07-01T00:00:00Z"),
      lastSeenAt: new Date("2026-07-04T00:00:00Z"),
      title: "変更後のタイトル",
    });
  });

  it("returns a sanitized typed error and retains stored records when GitHub fails", async () => {
    const api: GitHubCompletedIssueApi = {
      async listClosedIssuesPage() {
        throw { status: 404, message: "mytysoldier/private-project was not found" };
      },
    };
    const store = createStore();

    await expect(
      synchronizeCompletedIssues({ api, repository, store, trackedActors }),
    ).rejects.toEqual(
      expect.objectContaining({
        message: "GitHub API request failed (status: 404)",
        name: "GitHubApiError",
        status: 404,
      }),
    );
    expect(store.issues.size).toBe(0);
    await expect(
      synchronizeCompletedIssues({ api, repository, store, trackedActors }),
    ).rejects.toBeInstanceOf(GitHubApiError);
  });
});
