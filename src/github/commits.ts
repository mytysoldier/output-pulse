import type { Octokit } from "@octokit/rest";

import type { PersistedCommit, CommitStore } from "../db/commit-store.js";
import type { UpsertResult } from "../db/upsert-result.js";
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
  /**
   * 指定したデフォルトブランチから、期間で絞り込んだコミットの1ページを取得する。
   */
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
  insertedCount: number;
  persistedCount: number;
  rateLimit: GitHubRateLimit;
  updatedCount: number;
}

/**
 * GitHub REST APIを呼び出し、デフォルトブランチのコミットをアプリ用の形式へ変換するAPIアダプターを作成する。
 */
export function createGitHubCommitApi(client: Octokit): GitHubCommitApi {
  return {
    /**
     * 指定したページのコミットを取得し、コミッター時刻・GitHub author ID・SHAだけを返す。
     * 空リポジトリを示す409応答は、同期可能な0件のページとして扱う。
     */
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
        if (isEmptyRepositoryError(error)) {
          return { rateLimit: {}, commits: [] };
        }

        throw toGitHubApiError(error);
      }
    },
  };
}

/**
 * 対象リポジトリの全ページを取得し、tracked actorがauthorのコミットだけをSHAで重複除去して保存する。
 */
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
        trackedActorIds.has(commit.authorGithubUserId) &&
        isWithinRange(commit.committedAt, since, until)
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

  const persistence = toUpsertResult(await store.upsertCommits(commits), commits.length);

  return {
    fetchedCount,
    insertedCount: persistence.insertedCount,
    persistedCount: commits.length,
    rateLimit,
    updatedCount: persistence.updatedCount,
  };
}

function toUpsertResult(result: UpsertResult | undefined, attemptedCount: number): UpsertResult {
  return result ?? { insertedCount: attemptedCount, updatedCount: 0 };
}

function isWithinRange(date: Date, since?: Date, until?: Date): boolean {
  return (since === undefined || date >= since) && (until === undefined || date <= until);
}

/**
 * GitHubのレスポンスヘッダーから、残りリクエスト数と制限解除時刻を取り出す。
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
 * GitHubレスポンスヘッダーの文字列または数値を、安全な有限数に変換する。
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
 * GitHubクライアントからの任意の例外を、詳細情報を漏らさないGitHubApiErrorへ変換する。
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

/**
 * GitHubが空リポジトリ（コミット未作成）を示す409応答を返したか判定する。
 */
function isEmptyRepositoryError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && error.status === 409;
}
