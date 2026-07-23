import { eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { pullRequests } from "./schema/index.js";
import type { UpsertResult } from "./upsert-result.js";

export interface PersistedPullRequest {
  githubNodeId: string;
  repositoryId: number;
  number: number;
  authorGithubUserId: number;
  createdAt: Date;
  mergedAt: Date | null;
  state: "closed" | "merged" | "open";
  firstSeenAt: Date;
  lastSeenAt: Date;
}

export interface PullRequestStore {
  refreshPullRequests?(pullRequests: PersistedPullRequest[]): Promise<UpsertResult | undefined>;
  upsertPullRequests(pullRequests: PersistedPullRequest[]): Promise<UpsertResult | undefined>;
}

export function createPullRequestStore(database: NodePgDatabase): PullRequestStore {
  return {
    async upsertPullRequests(synchronizedPullRequests) {
      if (synchronizedPullRequests.length === 0) {
        return { insertedCount: 0, updatedCount: 0 };
      }

      const results = await database
        .insert(pullRequests)
        .values(synchronizedPullRequests)
        .onConflictDoUpdate({
          target: pullRequests.githubNodeId,
          set: {
            repositoryId: sql`excluded.${sql.identifier(pullRequests.repositoryId.name)}`,
            number: sql`excluded.${sql.identifier(pullRequests.number.name)}`,
            authorGithubUserId: sql`excluded.${sql.identifier(
              pullRequests.authorGithubUserId.name,
            )}`,
            createdAt: sql`excluded.${sql.identifier(pullRequests.createdAt.name)}`,
            mergedAt: sql`excluded.${sql.identifier(pullRequests.mergedAt.name)}`,
            state: sql`excluded.${sql.identifier(pullRequests.state.name)}`,
            lastSeenAt: sql`excluded.${sql.identifier(pullRequests.lastSeenAt.name)}`,
          },
        })
        .returning({ inserted: sql<boolean>`xmax = 0` });

      return countUpserts(results);
    },

    async refreshPullRequests(refreshedPullRequests) {
      if (refreshedPullRequests.length === 0) {
        return { insertedCount: 0, updatedCount: 0 };
      }

      const results = await Promise.all(
        refreshedPullRequests.map((pullRequest) =>
          database
            .update(pullRequests)
            .set({
              lastSeenAt: pullRequest.lastSeenAt,
              mergedAt: pullRequest.mergedAt,
              state: pullRequest.state,
            })
            .where(eq(pullRequests.githubNodeId, pullRequest.githubNodeId))
            .returning({ githubNodeId: pullRequests.githubNodeId }),
        ),
      );

      return { insertedCount: 0, updatedCount: results.flat().length };
    },
  };
}

function countUpserts(results: Array<{ inserted: boolean }>): UpsertResult {
  const insertedCount = results.filter((result) => result.inserted).length;
  return { insertedCount, updatedCount: results.length - insertedCount };
}
