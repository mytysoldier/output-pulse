import type { Octokit } from "@octokit/rest";

import type { PersistedPullRequest, PullRequestStore } from "../db/pull-request-store.js";
import type { UpsertResult } from "../db/upsert-result.js";
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
  insertedCount: number;
  rateLimit: GitHubRateLimit;
  savedCount: number;
  updatedCount: number;
}

/**
 * Octokitを利用して、1ページ分のPull Requestを取得するAPIアダプターを作成する。
 * GitHub APIのレスポンスを同期処理で扱う型へ変換し、APIエラーを統一する。
 */
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

/**
 * 対象リポジトリのPull Requestを全ページ取得し、tracked actor作成分だけを保存する。
 * 取得件数、保存件数、最後に取得したレート制限情報を返す。
 */
export async function synchronizePullRequests({
  api,
  repository,
  since,
  store,
  synchronizedAt = new Date(),
  trackedActors,
  until,
}: {
  api: GitHubPullRequestApi;
  repository: TargetRepository;
  since?: Date;
  store: PullRequestStore;
  synchronizedAt?: Date;
  trackedActors: TrackedActor[];
  until?: Date;
}): Promise<PullRequestSynchronizationResult> {
  const result = await listPullRequests(api, repository);
  const trackedActorIds = new Set(trackedActors.map((actor) => actor.githubUserId));
  const synchronizedPullRequests = result.pullRequests
    .filter(
      (pullRequest): pullRequest is GitHubPullRequest & { authorGithubUserId: number } =>
        pullRequest.authorGithubUserId !== null &&
        trackedActorIds.has(pullRequest.authorGithubUserId) &&
        isWithinPeriod(pullRequest, since, until),
    )
    .map((pullRequest) => toPersistedPullRequest({ pullRequest, repository, synchronizedAt }));

  const persistence = toUpsertResult(
    await store.upsertPullRequests(synchronizedPullRequests),
    synchronizedPullRequests.length,
  );

  return {
    fetchedCount: result.pullRequests.length,
    insertedCount: persistence.insertedCount,
    rateLimit: result.rateLimit,
    savedCount: synchronizedPullRequests.length,
    updatedCount: persistence.updatedCount,
  };
}

function toUpsertResult(result: UpsertResult | undefined, attemptedCount: number): UpsertResult {
  return result ?? { insertedCount: attemptedCount, updatedCount: 0 };
}

/** 作成またはマージのどちらかが対象期間内のPRだけを同期対象にする。 */
function isWithinPeriod(pullRequest: GitHubPullRequest, since?: Date, until?: Date): boolean {
  return (
    isWithinRange(pullRequest.createdAt, since, until) ||
    (pullRequest.mergedAt !== null && isWithinRange(pullRequest.mergedAt, since, until))
  );
}

function isWithinRange(date: Date, since?: Date, until?: Date): boolean {
  return (since === undefined || date >= since) && (until === undefined || date <= until);
}

/**
 * 指定リポジトリのPull Requestをページネーションで全件取得する。
 * 最後に取得したページのレート制限情報とともに返す。
 */
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

/**
 * GitHub APIのPull Requestを、DBへUpsertできる保存形式へ変換する。
 * マージ日時があるPull Requestは状態を常にmergedとして扱う。
 */
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

/**
 * GitHub APIレスポンスのレート制限ヘッダーをアプリケーション用の値へ変換する。
 */
function getRateLimit(headers: Record<string, string | number | undefined>): GitHubRateLimit {
  const remaining = parseHeaderNumber(headers["x-ratelimit-remaining"]);
  const reset = parseHeaderNumber(headers["x-ratelimit-reset"]);

  return {
    ...(remaining === undefined ? {} : { remaining }),
    ...(reset === undefined ? {} : { resetAt: new Date(reset * 1000) }),
  };
}

/**
 * レート制限ヘッダーの数値を安全に解析し、無効な値は未設定として扱う。
 */
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

/**
 * 不明な例外を、公開しても安全なGitHub APIエラーへ正規化する。
 */
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
