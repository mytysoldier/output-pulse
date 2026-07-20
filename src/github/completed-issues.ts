import type { Octokit } from "@octokit/rest";

import type { CompletedIssueStore, PersistedCompletedIssue } from "../db/completed-issue-store.js";
import type { TrackedActor } from "../db/target-store.js";
import type { GitHubRateLimit, TargetRepository } from "./targets.js";
import { GitHubApiError } from "./targets.js";

const CLOSED_ISSUES_PER_PAGE = 100;
const CLOSING_PULL_REQUESTS_PER_ISSUE = 100;

const CLOSED_ISSUES_QUERY = `
  query ListClosedIssues($owner: String!, $repository: String!, $cursor: String) {
    repository(owner: $owner, name: $repository) {
      issues(first: ${CLOSED_ISSUES_PER_PAGE}, after: $cursor, states: CLOSED, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          id
          number
          title
          closedAt
          author {
            ... on User { databaseId }
            ... on Bot { databaseId }
          }
          closedByPullRequestsReferences(first: ${CLOSING_PULL_REQUESTS_PER_ISSUE}, includeClosedPrs: true) {
            nodes {
              author {
                ... on User { databaseId }
                ... on Bot { databaseId }
              }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
    rateLimit { remaining resetAt }
  }
`;

export interface GitHubCompletedIssue {
  authorGithubUserId: number | null;
  closedAt: Date;
  closingPullRequestAuthorGithubUserIds: number[];
  githubNodeId: string;
  number: number;
  title: string;
}

export interface GitHubCompletedIssuePage {
  endCursor: string | null;
  hasNextPage: boolean;
  issues: GitHubCompletedIssue[];
  rateLimit: GitHubRateLimit;
}

export interface GitHubCompletedIssueApi {
  listClosedIssuesPage({
    cursor,
    owner,
    repository,
  }: {
    cursor?: string;
    owner: string;
    repository: string;
  }): Promise<GitHubCompletedIssuePage>;
}

export interface CompletedIssueSynchronizationResult {
  fetchedCount: number;
  rateLimit: GitHubRateLimit;
  savedCount: number;
}

interface ClosedIssuesQueryResponse {
  rateLimit: { remaining: number; resetAt: string | null };
  repository: {
    issues: {
      nodes: Array<{
        author: GitHubActor | null;
        closedAt: string | null;
        closedByPullRequestsReferences: {
          nodes: Array<{ author: GitHubActor | null }>;
        };
        id: string;
        number: number;
        title: string;
      }>;
      pageInfo: { endCursor: string | null; hasNextPage: boolean };
    };
  } | null;
}

interface GitHubActor {
  databaseId?: number | null;
}

type ClosedIssueNode = NonNullable<
  ClosedIssuesQueryResponse["repository"]
>["issues"]["nodes"][number];

/** GitHub GraphQL APIで、Closed IssueとGitHub判定のClose元PRを取得する。 */
export function createGitHubCompletedIssueApi(client: Octokit): GitHubCompletedIssueApi {
  return {
    async listClosedIssuesPage({ cursor, owner, repository }) {
      try {
        const response = await client.graphql<ClosedIssuesQueryResponse>(CLOSED_ISSUES_QUERY, {
          cursor: cursor ?? null,
          owner,
          repository,
        });

        if (response.repository === null) {
          throw new GitHubApiError(404);
        }

        return {
          endCursor: response.repository.issues.pageInfo.endCursor,
          hasNextPage: response.repository.issues.pageInfo.hasNextPage,
          issues: response.repository.issues.nodes.flatMap(toGitHubCompletedIssue),
          rateLimit: {
            remaining: response.rateLimit.remaining,
            ...(response.rateLimit.resetAt === null
              ? {}
              : { resetAt: new Date(response.rateLimit.resetAt) }),
          },
        };
      } catch (error) {
        throw toGitHubApiError(error);
      }
    },
  };
}

/** Closed Issueを全ページ取得し、作者またはClose元PR作者がtracked actorなら保存する。 */
export async function synchronizeCompletedIssues({
  api,
  repository,
  store,
  synchronizedAt = new Date(),
  trackedActors,
}: {
  api: GitHubCompletedIssueApi;
  repository: TargetRepository;
  store: CompletedIssueStore;
  synchronizedAt?: Date;
  trackedActors: TrackedActor[];
}): Promise<CompletedIssueSynchronizationResult> {
  const result = await listClosedIssues(api, repository);
  const trackedActorIds = new Set(trackedActors.map((actor) => actor.githubUserId));
  const synchronizedIssues = result.issues.flatMap((issue) => {
    const matchedByAuthor =
      issue.authorGithubUserId !== null && trackedActorIds.has(issue.authorGithubUserId);
    const matchedByClosingPr = issue.closingPullRequestAuthorGithubUserIds.some(
      (authorGithubUserId) => trackedActorIds.has(authorGithubUserId),
    );

    if (!matchedByAuthor && !matchedByClosingPr) {
      return [];
    }

    return [
      toPersistedCompletedIssue({
        issue,
        matchedByAuthor,
        matchedByClosingPr,
        repository,
        synchronizedAt,
      }),
    ];
  });

  await store.upsertCompletedIssues(synchronizedIssues);

  return {
    fetchedCount: result.issues.length,
    rateLimit: result.rateLimit,
    savedCount: synchronizedIssues.length,
  };
}

async function listClosedIssues(
  api: GitHubCompletedIssueApi,
  repository: TargetRepository,
): Promise<{ issues: GitHubCompletedIssue[]; rateLimit: GitHubRateLimit }> {
  const issues: GitHubCompletedIssue[] = [];
  let cursor: string | undefined;
  let rateLimit: GitHubRateLimit = {};

  do {
    let response: GitHubCompletedIssuePage;

    try {
      response = await api.listClosedIssuesPage({
        cursor,
        owner: repository.ownerLogin,
        repository: repository.name,
      });
    } catch (error) {
      throw toGitHubApiError(error);
    }

    issues.push(...response.issues);
    rateLimit = response.rateLimit;
    cursor = response.endCursor ?? undefined;

    if (!response.hasNextPage) {
      return { issues, rateLimit };
    }
  } while (cursor !== undefined);

  throw new GitHubApiError();
}

function toGitHubCompletedIssue(issue: ClosedIssueNode): GitHubCompletedIssue[] {
  if (issue.closedAt === null) {
    return [];
  }

  return [
    {
      authorGithubUserId: issue.author?.databaseId ?? null,
      closedAt: new Date(issue.closedAt),
      closingPullRequestAuthorGithubUserIds: issue.closedByPullRequestsReferences.nodes.flatMap(
        (pullRequest) => {
          const databaseId = pullRequest.author?.databaseId;
          return databaseId === undefined || databaseId === null ? [] : [databaseId];
        },
      ),
      githubNodeId: issue.id,
      number: issue.number,
      title: issue.title,
    },
  ];
}

function toPersistedCompletedIssue({
  issue,
  matchedByAuthor,
  matchedByClosingPr,
  repository,
  synchronizedAt,
}: {
  issue: GitHubCompletedIssue;
  matchedByAuthor: boolean;
  matchedByClosingPr: boolean;
  repository: TargetRepository;
  synchronizedAt: Date;
}): PersistedCompletedIssue {
  return {
    firstClosedAt: issue.closedAt,
    githubNodeId: issue.githubNodeId,
    lastSeenAt: synchronizedAt,
    matchedByAuthor,
    matchedByClosingPr,
    number: issue.number,
    repositoryId: repository.githubRepositoryId,
    title: issue.title,
    visibility: repository.visibility,
  };
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
