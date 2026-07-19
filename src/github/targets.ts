import { Octokit } from "@octokit/rest";

import type { PersistedRepository, TargetStore, TrackedActor } from "../db/target-store.js";

export const DEFAULT_GITHUB_OWNER = "mytysoldier";

const REPOSITORIES_PER_PAGE = 100;

export interface GitHubRateLimit {
  remaining?: number;
  resetAt?: Date;
}

export interface GitHubRepository {
  id: number;
  name: string;
  owner: {
    id: number;
    login: string;
    type: string;
  } | null;
  visibility: string | null;
  defaultBranch: string;
  isFork: boolean;
  isArchived: boolean;
}

export interface GitHubRepositoryPage {
  rateLimit: GitHubRateLimit;
  repositories: GitHubRepository[];
}

export interface GitHubRepositoryApi {
  listOwnedRepositoriesPage(page: number, perPage: number): Promise<GitHubRepositoryPage>;
}

export interface TargetRepository extends PersistedRepository {
  name: string;
  ownerLogin: string;
}

export interface SynchronizationTargets {
  rateLimit: GitHubRateLimit;
  repositories: TargetRepository[];
  trackedActors: TrackedActor[];
}

export class GitHubConfigurationError extends Error {
  readonly name = "GitHubConfigurationError";

  constructor() {
    super("GH_READ_TOKEN must be configured");
  }
}

export class GitHubApiError extends Error {
  readonly name = "GitHubApiError";

  constructor(readonly status?: number) {
    super(
      status === undefined
        ? "GitHub API request failed"
        : `GitHub API request failed (status: ${status})`,
    );
  }
}

export function createGitHubClient(token: string | undefined): Octokit {
  if (token?.trim() === "") {
    throw new GitHubConfigurationError();
  }

  if (token === undefined) {
    throw new GitHubConfigurationError();
  }

  return new Octokit({ auth: token });
}

export function createGitHubRepositoryApi(client: Octokit): GitHubRepositoryApi {
  return {
    async listOwnedRepositoriesPage(page, perPage) {
      try {
        const response = await client.rest.repos.listForAuthenticatedUser({
          affiliation: "owner",
          page,
          per_page: perPage,
          visibility: "all",
        });

        return {
          rateLimit: getRateLimit(response.headers),
          repositories: response.data.map((repository) => ({
            id: repository.id,
            name: repository.name,
            owner:
              repository.owner === null
                ? null
                : {
                    id: repository.owner.id,
                    login: repository.owner.login,
                    type: repository.owner.type,
                  },
            visibility: repository.visibility ?? (repository.private ? "private" : "public"),
            defaultBranch: repository.default_branch,
            isFork: repository.fork,
            isArchived: repository.archived,
          })),
        };
      } catch (error) {
        throw toGitHubApiError(error);
      }
    },
  };
}

export async function loadSynchronizationTargets({
  api,
  store,
  owner = DEFAULT_GITHUB_OWNER,
}: {
  api: GitHubRepositoryApi;
  store: TargetStore;
  owner?: string;
}): Promise<SynchronizationTargets> {
  const { rateLimit, repositories } = await listTargetRepositories(api, owner);

  await store.upsertRepositories(repositories.map(toPersistedRepository));
  const [enabledRepositoryIds, trackedActors] = await Promise.all([
    store.listEnabledRepositoryIds(),
    store.listEnabledTrackedActors(),
  ]);
  const enabledRepositoryIdSet = new Set(enabledRepositoryIds);

  return {
    rateLimit,
    repositories: repositories.filter((repository) =>
      enabledRepositoryIdSet.has(repository.githubRepositoryId),
    ),
    trackedActors,
  };
}

async function listTargetRepositories(
  api: GitHubRepositoryApi,
  owner: string,
): Promise<{ rateLimit: GitHubRateLimit; repositories: TargetRepository[] }> {
  const repositories: TargetRepository[] = [];
  let page = 1;
  let rateLimit: GitHubRateLimit = {};

  while (true) {
    let response: GitHubRepositoryPage;

    try {
      response = await api.listOwnedRepositoriesPage(page, REPOSITORIES_PER_PAGE);
    } catch (error) {
      throw toGitHubApiError(error);
    }

    rateLimit = response.rateLimit;
    repositories.push(
      ...response.repositories
        .filter((repository) => isTargetRepository(repository, owner))
        .map(toTargetRepository),
    );

    if (response.repositories.length < REPOSITORIES_PER_PAGE) {
      return { rateLimit, repositories };
    }

    page += 1;
  }
}

function toTargetRepository(
  repository: GitHubRepository & { owner: NonNullable<GitHubRepository["owner"]> },
): TargetRepository {
  return {
    githubRepositoryId: repository.id,
    ownerGithubUserId: repository.owner.id,
    visibility: repository.visibility ?? "private",
    defaultBranch: repository.defaultBranch,
    isFork: repository.isFork,
    isArchived: repository.isArchived,
    name: repository.name,
    ownerLogin: repository.owner.login,
  };
}

function toPersistedRepository(repository: TargetRepository): PersistedRepository {
  return {
    githubRepositoryId: repository.githubRepositoryId,
    ownerGithubUserId: repository.ownerGithubUserId,
    visibility: repository.visibility,
    defaultBranch: repository.defaultBranch,
    isFork: repository.isFork,
    isArchived: repository.isArchived,
  };
}

function isTargetRepository(
  repository: GitHubRepository,
  owner: string,
): repository is GitHubRepository & {
  owner: NonNullable<GitHubRepository["owner"]>;
} {
  return (
    repository.owner !== null &&
    repository.owner.type === "User" &&
    repository.owner.login.toLowerCase() === owner.toLowerCase() &&
    !repository.isFork &&
    !repository.isArchived
  );
}

function getRateLimit(headers: Record<string, string | number | undefined>): GitHubRateLimit {
  const remaining = parseHeaderNumber(headers["x-ratelimit-remaining"]);
  const reset = parseHeaderNumber(headers["x-ratelimit-reset"]);

  return {
    ...(remaining === undefined ? {} : { remaining }),
    ...(reset === undefined ? {} : { resetAt: new Date(reset * 1000) }),
  };
}

function parseHeaderNumber(value: number | string | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }

  if (value === undefined) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function toGitHubApiError(error: unknown): GitHubApiError {
  if (error instanceof GitHubApiError) {
    return error;
  }

  if (typeof error === "object" && error !== null && "status" in error) {
    const { status } = error;
    if (typeof status === "number") {
      return new GitHubApiError(status);
    }
  }

  return new GitHubApiError();
}
