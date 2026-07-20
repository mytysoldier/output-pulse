import type { Octokit } from "@octokit/rest";

import type { CompletedIssueStore, PersistedCompletedIssue } from "../db/completed-issue-store.js";
import type { TrackedActor } from "../db/target-store.js";
import type { GitHubRateLimit, TargetRepository } from "./targets.js";
import { GitHubApiError } from "./targets.js";

const CLOSED_ISSUES_PER_PAGE = 100;

const CLOSED_ISSUES_QUERY = `
  query ListClosedIssues($owner: String!, $repository: String!, $cursor: String) {
    repository(owner: $owner, name: $repository) {
      issues(first: ${CLOSED_ISSUES_PER_PAGE}, after: $cursor, states: CLOSED, orderBy: { field: UPDATED_AT, direction: DESC }) {
        nodes {
          id
          number
          title
          author {
            ... on User { databaseId }
            ... on Bot { databaseId }
          }
          closedEvents: timelineItems(first: 100, itemTypes: [CLOSED_EVENT]) {
            nodes {
              ... on ClosedEvent {
                createdAt
                closer {
                  ... on PullRequest {
                    author {
                      ... on User { databaseId }
                      ... on Bot { databaseId }
                    }
                  }
                }
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
  closedEvents: GitHubClosedIssueEvent[];
  githubNodeId: string;
  number: number;
  title: string;
}

export interface GitHubClosedIssueEvent {
  closedAt: Date;
  closingPullRequestAuthorGithubUserId: number | null;
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
        closedEvents: {
          nodes: Array<{
            createdAt: string;
            closer: { author: GitHubActor | null } | null;
          }>;
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
    const matchedByClosingPr = issue.closedEvents.some(
      (event) =>
        event.closingPullRequestAuthorGithubUserId !== null &&
        trackedActorIds.has(event.closingPullRequestAuthorGithubUserId),
    );
    const firstQualifyingEvent = issue.closedEvents
      .toSorted((left, right) => left.closedAt.getTime() - right.closedAt.getTime())
      .find(
        (event) =>
          matchedByAuthor ||
          (event.closingPullRequestAuthorGithubUserId !== null &&
            trackedActorIds.has(event.closingPullRequestAuthorGithubUserId)),
      );

    if (firstQualifyingEvent === undefined) {
      return [];
    }

    return [
      toPersistedCompletedIssue({
        issue,
        matchedByAuthor,
        matchedByClosingPr,
        firstClosedAt: firstQualifyingEvent.closedAt,
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
  const closedEvents: GitHubClosedIssueEvent[] = issue.closedEvents.nodes.map((closedEvent) => {
    const databaseId = closedEvent.closer?.author?.databaseId;
    return {
      closedAt: new Date(closedEvent.createdAt),
      closingPullRequestAuthorGithubUserId: databaseId ?? null,
    };
  });

  if (closedEvents.length === 0) {
    return [];
  }

  return [
    {
      authorGithubUserId: issue.author?.databaseId ?? null,
      closedEvents,
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
  firstClosedAt,
  repository,
  synchronizedAt,
}: {
  issue: GitHubCompletedIssue;
  matchedByAuthor: boolean;
  matchedByClosingPr: boolean;
  firstClosedAt: Date;
  repository: TargetRepository;
  synchronizedAt: Date;
}): PersistedCompletedIssue {
  return {
    firstClosedAt,
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
