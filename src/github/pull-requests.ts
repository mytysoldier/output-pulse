import type { Octokit } from "@octokit/rest";

import type { PersistedPullRequest, PullRequestStore } from "../db/pull-request-store.js";
import type { TrackedActor } from "../db/target-store.js";
import type { GitHubRateLimit, TargetRepository } from "./targets.js";
import { GitHubApiError } from "./targets.js";

const PULL_REQUESTS_PER_PAGE = 100;

export interface GitHubPullRequest {
  authorGithubUserId: number | null;
  createdAt: Date;
  githubNodeId: string;
  mergedAt: Date | null;
  number: number;
  state: "closed" | "open";
}

export interface GitHubPullRequestPage {
  pullRequests: GitHubPullRequest[];
  rateLimit: GitHubRateLimit;
}

export interface GitHubPullRequestApi {
  listPullRequestsPage({
    owner,
    repository,
    page,
    perPage,
  }: {
    owner: string;
    repository: string;
    page: number;
    perPage: number;
  }): Promise<GitHubPullRequestPage>;
}

export interface PullRequestSynchronizationResult {
  fetchedCount: number;
  rateLimit: GitHubRateLimit;
  savedCount: number;
}

export function createGitHubPullRequestApi(client: Octokit): GitHubPullRequestApi {
  return {
    async listPullRequestsPage({ owner, repository, page, perPage }) {
      try {
        const response = await client.rest.pulls.list({
          owner,
          page,
          per_page: perPage,
          repo: repository,
          state: "all",
        });

        return {
          pullRequests: response.data.map((pullRequest) => ({
            authorGithubUserId: pullRequest.user?.id ?? null,
            createdAt: new Date(pullRequest.created_at),
            githubNodeId: pullRequest.node_id,
            mergedAt: pullRequest.merged_at === null ? null : new Date(pullRequest.merged_at),
            number: pullRequest.number,
            state: pullRequest.state === "open" ? "open" : "closed",
          })),
          rateLimit: getRateLimit(response.headers),
        };
      } catch (error) {
        throw toGitHubApiError(error);
      }
    },
  };
}

export async function synchronizePullRequests({
  api,
  repository,
  store,
  synchronizedAt = new Date(),
  trackedActors,
}: {
  api: GitHubPullRequestApi;
  repository: TargetRepository;
  store: PullRequestStore;
  synchronizedAt?: Date;
  trackedActors: TrackedActor[];
}): Promise<PullRequestSynchronizationResult> {
  const result = await listPullRequests(api, repository);
  const trackedActorIds = new Set(trackedActors.map((actor) => actor.githubUserId));
  const synchronizedPullRequests = result.pullRequests
    .filter(
      (pullRequest): pullRequest is GitHubPullRequest & { authorGithubUserId: number } =>
        pullRequest.authorGithubUserId !== null &&
        trackedActorIds.has(pullRequest.authorGithubUserId),
    )
    .map((pullRequest) => toPersistedPullRequest({ pullRequest, repository, synchronizedAt }));

  await store.upsertPullRequests(synchronizedPullRequests);

  return {
    fetchedCount: result.pullRequests.length,
    rateLimit: result.rateLimit,
    savedCount: synchronizedPullRequests.length,
  };
}

async function listPullRequests(
  api: GitHubPullRequestApi,
  repository: TargetRepository,
): Promise<{ pullRequests: GitHubPullRequest[]; rateLimit: GitHubRateLimit }> {
  const pullRequests: GitHubPullRequest[] = [];
  let page = 1;
  let rateLimit: GitHubRateLimit = {};

  while (true) {
    let response: GitHubPullRequestPage;

    try {
      response = await api.listPullRequestsPage({
        owner: repository.ownerLogin,
        page,
        perPage: PULL_REQUESTS_PER_PAGE,
        repository: repository.name,
      });
    } catch (error) {
      throw toGitHubApiError(error);
    }

    rateLimit = response.rateLimit;
    pullRequests.push(...response.pullRequests);

    if (response.pullRequests.length < PULL_REQUESTS_PER_PAGE) {
      return { pullRequests, rateLimit };
    }

    page += 1;
  }
}

function toPersistedPullRequest({
  pullRequest,
  repository,
  synchronizedAt,
}: {
  pullRequest: GitHubPullRequest & { authorGithubUserId: number };
  repository: TargetRepository;
  synchronizedAt: Date;
}): PersistedPullRequest {
  return {
    authorGithubUserId: pullRequest.authorGithubUserId,
    createdAt: pullRequest.createdAt,
    firstSeenAt: synchronizedAt,
    githubNodeId: pullRequest.githubNodeId,
    lastSeenAt: synchronizedAt,
    mergedAt: pullRequest.mergedAt,
    number: pullRequest.number,
    repositoryId: repository.githubRepositoryId,
    state: pullRequest.mergedAt === null ? pullRequest.state : "merged",
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
