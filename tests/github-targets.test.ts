import { describe, expect, it } from "vitest";

import type { TargetStore } from "../src/db/target-store.js";
import {
  type GitHubRepository,
  type GitHubRepositoryApi,
  GitHubApiError,
  loadSynchronizationTargets,
} from "../src/github/targets.js";

const ownerRepository: GitHubRepository = {
  id: 101,
  name: "private-project",
  owner: { id: 1, login: "mytysoldier", type: "User" },
  visibility: "private",
  defaultBranch: "main",
  isFork: false,
  isArchived: false,
};

function createStore(): TargetStore & {
  persistedRepositories: Parameters<TargetStore["upsertRepositories"]>[0];
} {
  return {
    persistedRepositories: [],
    async listEnabledTrackedActors() {
      return [
        { githubUserId: 1, githubLogin: "mytysoldier", actorType: "user" },
        { githubUserId: 2, githubLogin: "output-pulse-bot", actorType: "bot" },
      ];
    },
    async upsertRepositories(repositories) {
      this.persistedRepositories = repositories;
    },
  };
}

describe("loadSynchronizationTargets", () => {
  it("paginates, filters targets, and persists only safe repository fields", async () => {
    const pages = [
      Array.from({ length: 100 }, (_, index) => ({
        ...ownerRepository,
        id: index + 1,
        name: `private-project-${index}`,
      })),
      [
        ownerRepository,
        { ...ownerRepository, id: 102, name: "forked", isFork: true },
        { ...ownerRepository, id: 103, name: "archived", isArchived: true },
        {
          ...ownerRepository,
          id: 104,
          name: "organization",
          owner: { id: 2, login: "org", type: "Organization" },
        },
      ],
    ];
    const requestedPages: number[] = [];
    const api: GitHubRepositoryApi = {
      async listOwnedRepositoriesPage(page) {
        requestedPages.push(page);
        return {
          rateLimit: { remaining: 4990 },
          repositories: pages[page - 1] ?? [],
        };
      },
    };
    const store = createStore();

    const targets = await loadSynchronizationTargets({ api, store });

    expect(requestedPages).toEqual([1, 2]);
    expect(targets.repositories).toHaveLength(101);
    expect(targets.repositories[0]).toMatchObject({
      name: "private-project-0",
      visibility: "private",
    });
    expect(targets.trackedActors).toEqual([
      { githubUserId: 1, githubLogin: "mytysoldier", actorType: "user" },
      { githubUserId: 2, githubLogin: "output-pulse-bot", actorType: "bot" },
    ]);
    expect(store.persistedRepositories).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          githubRepositoryId: 101,
          ownerGithubUserId: 1,
          defaultBranch: "main",
          visibility: "private",
        }),
      ]),
    );
    expect(store.persistedRepositories[0]).not.toHaveProperty("name");
  });

  it("returns a sanitized typed error when GitHub rejects a request", async () => {
    const api: GitHubRepositoryApi = {
      async listOwnedRepositoriesPage() {
        throw { status: 401, message: "token for mytysoldier/private-project" };
      },
    };
    const store = createStore();

    await expect(loadSynchronizationTargets({ api, store })).rejects.toEqual(
      expect.objectContaining({
        name: "GitHubApiError",
        message: "GitHub API request failed (status: 401)",
        status: 401,
      }),
    );
    await expect(loadSynchronizationTargets({ api, store })).rejects.toBeInstanceOf(GitHubApiError);
  });
});
