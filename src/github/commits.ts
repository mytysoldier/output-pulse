import type { Octokit } from "@octokit/rest";

import type { PersistedCommit, CommitStore } from "../db/commit-store.js";
import type { TrackedActor } from "../db/target-store.js";
import { GitHubApiError, type GitHubRateLimit, type TargetRepository } from "./targets.js";

const COMMITS_PER_PAGE = 100;

export interface GitHubCommit {
  sha: string;
  authorGithubUserId: number | undefined;
  committedAt: Date;
}

export interface GitHubCommitPage {
  rateLimit: GitHubRateLimit;
  commits: GitHubCommit[];
}

export interface GitHubCommitApi {
  listDefaultBranchCommitsPage(input: {
    owner: string;
    repository: string;
    defaultBranch: string;
    page: number;
    perPage: number;
    since?: Date;
    until?: Date;
  }): Promise<GitHubCommitPage>;
}

export interface CommitSynchronizationResult {
  fetchedCount: number;
  persistedCount: number;
  rateLimit: GitHubRateLimit;
}

export function createGitHubCommitApi(client: Octokit): GitHubCommitApi {
  return {
    async listDefaultBranchCommitsPage({
      owner,
      repository,
      defaultBranch,
      page,
      perPage,
      since,
      until,
    }) {
      try {
        const response = await client.rest.repos.listCommits({
          owner,
          repo: repository,
          sha: defaultBranch,
          page,
          per_page: perPage,
          ...(since === undefined ? {} : { since: since.toISOString() }),
          ...(until === undefined ? {} : { until: until.toISOString() }),
        });

        return {
          rateLimit: getRateLimit(response.headers),
          commits: response.data
            .map((commit) => {
              const committedAt = commit.commit.committer?.date;

              if (committedAt === null || committedAt === undefined) {
                return undefined;
              }

              return {
                sha: commit.sha,
                authorGithubUserId: commit.author?.id,
                committedAt: new Date(committedAt),
              };
            })
            .filter((commit): commit is GitHubCommit => commit !== undefined),
        };
      } catch (error) {
        throw toGitHubApiError(error);
      }
    },
  };
}

export async function synchronizeRepositoryCommits({
  api,
  store,
  repository,
  trackedActors,
  since,
  until,
  synchronizedAt = new Date(),
}: {
  api: GitHubCommitApi;
  store: CommitStore;
  repository: TargetRepository;
  trackedActors: TrackedActor[];
  since?: Date;
  until?: Date;
  synchronizedAt?: Date;
}): Promise<CommitSynchronizationResult> {
  const trackedActorIds = new Set(trackedActors.map((actor) => actor.githubUserId));
  const commitsBySha = new Map<string, PersistedCommit>();
  let page = 1;
  let fetchedCount = 0;
  let rateLimit: GitHubRateLimit = {};

  while (true) {
    let response: GitHubCommitPage;

    try {
      response = await api.listDefaultBranchCommitsPage({
        owner: repository.ownerLogin,
        repository: repository.name,
        defaultBranch: repository.defaultBranch,
        page,
        perPage: COMMITS_PER_PAGE,
        since,
        until,
      });
    } catch (error) {
      throw toGitHubApiError(error);
    }

    rateLimit = response.rateLimit;
    fetchedCount += response.commits.length;
    for (const commit of response.commits) {
      if (
        commit.authorGithubUserId !== undefined &&
        trackedActorIds.has(commit.authorGithubUserId)
      ) {
        commitsBySha.set(commit.sha, {
          repositoryId: repository.githubRepositoryId,
          sha: commit.sha,
          authorGithubUserId: commit.authorGithubUserId,
          committedAt: commit.committedAt,
          firstSeenAt: synchronizedAt,
          lastSeenAt: synchronizedAt,
        });
      }
    }

    if (response.commits.length < COMMITS_PER_PAGE) {
      break;
    }

    page += 1;
  }

  const commits = [...commitsBySha.values()];

  await store.upsertCommits(commits);

  return {
    fetchedCount,
    persistedCount: commits.length,
    rateLimit,
  };
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
